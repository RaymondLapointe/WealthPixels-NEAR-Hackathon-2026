import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { actions, baseDecode, baseEncode, createTransaction, PublicKey } from "near-api-js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import {
  assertExperimentAState, observeExperimentA, prepareExperimentA, publicExperimentASummary,
  reconcileExperimentA, submitExperimentA, type ExperimentAState,
} from "../../src/near/experiment-a.js";
import {
  experimentAFixture, EXPERIMENT_A_FIXTURE_AT, EXPERIMENT_A_FIXTURE_BLOCK,
  EXPERIMENT_A_FIXTURE_HEIGHT, EXPERIMENT_A_FIXTURE_NONCE, EXPERIMENT_A_FIXTURE_FEE,
  EXPERIMENT_A_FIXTURE_CREDENTIAL,
} from "./fixtures/experiment-a.js";

type Fixture = ReturnType<typeof experimentAFixture>;
const approval = (state: ExperimentAState) => ({ role: "investor" as const, approval: state.transactionHash,
  reference: "OFFLINE-FIXTURE-EXPLICIT-HASH-APPROVAL", credentialPath: EXPERIMENT_A_FIXTURE_CREDENTIAL });
async function settle(action: () => Promise<unknown>) { try { await action(); } catch { /* Failure is asserted through durable state and capability counts below. */ } }
async function submitted() {
  const f = experimentAFixture(), state = await f.prepare();
  await submitExperimentA(state, approval(state), f.ports, f.save);
  return { f, state };
}
const eventJson = (state: ExperimentAState) => JSON.stringify(state.events);

test("Experiment A fixture preflight is credential-free and observes only the fixed Investor at one FINAL block", async () => {
  const f = experimentAFixture();
  await observeExperimentA({ primaryRpc: f.primary, secondaryRpc: f.secondary }, f.ports);
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.count("local-sign-mock"), 0); assert.equal(f.sendCount(), 0);
  const queries = f.calls.filter(call => call.method === "query");
  assert.ok(queries.length >= 2);
  assert.ok(queries.every(call => call.params.account_id === VERIFIED_IDENTITIES.investor.accountId && call.params.block_id === EXPERIMENT_A_FIXTURE_BLOCK));
  assert.ok(f.calls.every(call => !["send_tx", "eth_sendRawTransaction", "call_function"].includes(call.method ?? "")));
});

test("Experiment A prepares exact one-yocto self-transfer, fresh nonce and SDK transaction hash without signing", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  const identity = VERIFIED_IDENTITIES.investor;
  assert.equal(state.kind, "experiment-a-near-self-transfer"); assert.equal(state.mode, "offline-fixtures");
  assert.equal(state.role, "investor"); assert.equal(state.signerAccountId, identity.accountId);
  assert.equal(state.receiverId, identity.accountId); assert.equal(state.publicKey, identity.accessPublicKey);
  assert.equal(state.action, "Transfer"); assert.equal(state.amountYocto, "1");
  assert.equal(state.previousNonce, EXPERIMENT_A_FIXTURE_NONCE.toString());
  assert.equal(state.transactionNonce, (EXPERIMENT_A_FIXTURE_NONCE + 1n).toString());
  assert.equal(state.referenceBlock.hash, EXPERIMENT_A_FIXTURE_BLOCK); assert.equal(state.referenceBlock.height, EXPERIMENT_A_FIXTURE_HEIGHT);
  const tx = createTransaction(identity.accountId, PublicKey.fromString(identity.accessPublicKey), identity.accountId,
    EXPERIMENT_A_FIXTURE_NONCE + 1n, [actions.transfer(1n)], baseDecode(EXPERIMENT_A_FIXTURE_BLOCK));
  assert.equal(state.transactionHash, baseEncode(createHash("sha256").update(tx.encode()).digest()));
  assert.equal(Date.parse(state.expiresAt) - Date.parse(state.createdAt), 900_000);
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("prepared metadata rejects tampered action, amount, sender, key, nonce, reference, hash and original expiry", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  for (const change of [
    { action: "FunctionCall" }, { amountYocto: "2" }, { receiverId: VERIFIED_IDENTITIES.treasury.accountId },
    { signerAccountId: VERIFIED_IDENTITIES.treasury.accountId }, { role: "treasury" },
    { publicKey: VERIFIED_IDENTITIES.treasury.accessPublicKey }, { transactionNonce: "8" }, { previousNonce: "3" },
    { transactionHash: "1".repeat(32) }, { referenceBlock: { ...state.referenceBlock, hash: "1".repeat(32) } },
    { expiresAt: new Date(Date.parse(state.expiresAt) + 1).toISOString() },
    { private_key: "OFFLINE-UNTRUSTED-FIELD" },
  ]) assert.throws(() => assertExperimentAState({ ...structuredClone(state), ...change }));
  assertExperimentAState(state);
});

test("inspection exposes public recovery metadata without credentials or executable signed payloads", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  const summary = publicExperimentASummary(state), text = JSON.stringify(summary);
  assert.match(text, new RegExp(state.transactionHash));
  assert.match(text, /275946428000002/);
  assert.doesNotMatch(text, /private_key|signed_tx_base64|credentialPath|OFFLINE-FIXTURE-SECRET/);
});

test("wrong network, changed access key, function-call permission and additional keys fail closed before signing", async () => {
  for (const mutate of [
    (f: Fixture) => { f.control.network = "mainnet"; },
    (f: Fixture) => { f.control.key = VERIFIED_IDENTITIES.treasury.accessPublicKey; },
    (f: Fixture) => { f.control.permission = { FunctionCall: { receiver_id: "anything.testnet", method_names: [] } }; },
    (f: Fixture) => { f.control.extraKey = true; },
  ]) {
    const f = experimentAFixture(); mutate(f);
    await assert.rejects(f.prepare());
    assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  }
});

test("fee estimation uses exact protocol costs and rejects excessive, missing or unavailable mandatory inputs", async () => {
  const valid = experimentAFixture(), state = await valid.prepare();
  assert.match(JSON.stringify(state.preflight), new RegExp(EXPERIMENT_A_FIXTURE_FEE.toString()));
  for (const mutate of [
    (f: Fixture) => { f.control.gasPrice = "100000000000000000000000000000000"; },
    (f: Fixture) => { delete f.control.config.runtime_config.transaction_costs.action_creation_config.transfer_cost; },
    (f: Fixture) => { f.control.balance = 1n; },
    (f: Fixture) => { f.control.readFailure = "gas_price"; },
    (f: Fixture) => { f.control.config.transaction_validity_period = 0; },
  ]) {
    const f = experimentAFixture(); mutate(f);
    await assert.rejects(f.prepare());
    assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  }
});

test("preparation and public snapshots cannot be used to silently refresh original timestamps", async () => {
  const f = experimentAFixture(), preflight = await observeExperimentA({ primaryRpc: f.primary, secondaryRpc: f.secondary }, f.ports);
  f.clock.advance(900_001);
  assert.throws(() => prepareExperimentA("experiment-a-investor-offline-002", preflight, f.clock.now()));
});

test("submission requires exact hash-bound approval and explicit Investor role before credential access", async () => {
  for (const change of [{ approval: "1".repeat(32) }, { role: "treasury" }, { reference: "" }]) {
    const f = experimentAFixture(), state = await f.prepare();
    await assert.rejects(submitExperimentA(state, { ...approval(state), ...change } as any, f.ports, f.save));
    assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  }
});

test("the exact diagnostic metadata and attempt are durable before loading one credential and submitting once", async () => {
  const { f, state } = await submitted();
  assert.equal(f.count("credential-read-mock"), 1); assert.equal(f.count("local-sign-mock"), 1); assert.equal(f.sendCount(), 1);
  const loadIndex = f.calls.findIndex(call => call.kind === "credential-read-mock"), sendIndex = f.calls.findIndex(call => call.method === "send_tx");
  assert.ok(f.calls.slice(0, loadIndex).some(call => call.kind === "save"));
  assert.ok(f.calls.slice(loadIndex, sendIndex).some(call => call.kind === "save" && call.params.stage === "send-intent"));
  assert.ok(f.saved.every(saved => saved.transactionHash === state.transactionHash && saved.transactionNonce === state.transactionNonce &&
    saved.referenceBlock.hash === EXPERIMENT_A_FIXTURE_BLOCK && saved.amountYocto === "1"));
  assert.ok(state.attempt); assert.equal(state.attempt!.approvedHash, state.transactionHash);
  assert.equal(state.createdAt, EXPERIMENT_A_FIXTURE_AT);
  assert.doesNotMatch(JSON.stringify(f.saved), /private_key|signed_tx_base64|OFFLINE-FIXTURE-SECRET/);
});

test("a successful RPC response alone is not finalized proof and cannot trigger another submission", async () => {
  const { f, state } = await submitted();
  assert.equal(state.verification, null); assert.notEqual(state.status, "final-success");
  const original = structuredClone(state);
  await assert.rejects(submitExperimentA(state, approval(state), f.ports, f.save));
  assert.equal(f.count("local-sign-mock"), 1); assert.equal(f.sendCount(), 1); assert.deepEqual(state, original);
});

test("nonce changes and unavailable public reads during pre-sign checks prevent credential loading and sending", async () => {
  for (const mutate of [(f: Fixture) => { f.control.nonce += 1n; }, (f: Fixture) => { f.control.readFailure = "query"; }]) {
    const f = experimentAFixture(), state = await f.prepare(); mutate(f);
    await settle(() => submitExperimentA(state, approval(state), f.ports, f.save));
    assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
    assert.equal(state.transactionNonce, (EXPERIMENT_A_FIXTURE_NONCE + 1n).toString());
  }
});

test("expired preparation prevents credential access and does not reset the transaction", async () => {
  const f = experimentAFixture(), state = await f.prepare(), createdAt = state.createdAt, expiresAt = state.expiresAt;
  f.clock.advance(900_000);
  await settle(() => submitExperimentA(state, approval(state), f.ports, f.save));
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  assert.equal(state.createdAt, createdAt); assert.equal(state.expiresAt, expiresAt);
});

test("wrong credential key and malformed locally signed hash are blocked before any network mutation", async () => {
  for (const mutate of [(f: Fixture) => { f.control.wrongSigner = true; }, (f: Fixture) => { f.control.hashChanged = true; },
    (f: Fixture) => { f.control.signatureValid = false; }]) {
    const f = experimentAFixture(), state = await f.prepare(); mutate(f);
    await settle(() => submitExperimentA(state, approval(state), f.ports, f.save));
    assert.equal(f.sendCount(), 0); assert.equal(state.transactionHash.length > 32, true);
  }
});

test("failed durable pre-send persistence prevents POST and consumes any persisted attempt", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  await settle(() => submitExperimentA(state, approval(state), f.ports, async next => {
    if (next.events.at(-1)?.stage === "send-intent") throw new Error("OFFLINE durable write failed");
    await f.save(next);
  }));
  assert.equal(f.sendCount(), 0);
  const restarted = structuredClone(f.saved.at(-1)!); assertExperimentAState(restarted);
  await assert.rejects(submitExperimentA(restarted, approval(restarted), f.ports, f.save));
  assert.equal(f.sendCount(), 0);
});

test("deadline crossing while send intent is durably saved blocks POST without extending expiry", async () => {
  const f = experimentAFixture(), state = await f.prepare(), expiresAt = state.expiresAt;
  await settle(() => submitExperimentA(state, approval(state), f.ports, async next => {
    await f.save(next); if (next.events.at(-1)?.stage === "send-intent") f.clock.advance(900_000);
  }));
  assert.equal(f.sendCount(), 0); assert.equal(state.expiresAt, expiresAt);
});

test("a transport timeout after submission starts preserves uncertainty and cannot re-sign or retry after restart", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  f.control.sendFailure = new Error("OFFLINE timeout with untrusted private text");
  await settle(() => submitExperimentA(state, approval(state), f.ports, f.save));
  assert.equal(f.sendCount(), 1); assert.equal(state.verification, null); assert.match(eventJson(state), /uncertain/);
  assert.doesNotMatch(eventJson(state), /untrusted private/);
  const restarted = structuredClone(f.saved.at(-1)!); assertExperimentAState(restarted);
  await assert.rejects(submitExperimentA(restarted, approval(restarted), f.ports, f.save));
  assert.equal(f.sendCount(), 1); assert.equal(f.count("local-sign-mock"), 1);
});

test("post-send diagnostic-save failure preserves a durable attempt and forbids another submission", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  let sent = false;
  await settle(() => submitExperimentA(state, approval(state), f.ports, async next => {
    if (f.sendCount() > 0) { sent = true; throw new Error("OFFLINE post-send persistence failed"); }
    await f.save(next);
  }));
  assert.equal(sent, true); assert.equal(f.sendCount(), 1);
  const restarted = structuredClone(f.saved.at(-1)!); assertExperimentAState(restarted);
  await assert.rejects(submitExperimentA(restarted, approval(restarted), f.ports, f.save));
  assert.equal(f.sendCount(), 1);
});

test("restart-safe reconciliation is credential-free and requires FINAL corroborated execution", async () => {
  const { f, state } = await submitted();
  const restarted = structuredClone(f.saved.at(-1)!); assertExperimentAState(restarted);
  const loads = f.count("credential-read-mock"), sends = f.sendCount();
  await reconcileExperimentA(restarted, f.ports, f.save);
  assert.ok(restarted.verification); assert.equal(restarted.status, "final-success");
  assert.equal(f.count("credential-read-mock"), loads); assert.equal(f.sendCount(), sends);
  assert.equal(restarted.transactionHash, state.transactionHash);
  assert.equal(restarted.createdAt, state.createdAt); assert.equal(restarted.expiresAt, state.expiresAt);
  assert.ok(f.calls.some(call => call.endpoint === f.secondary && ["tx", "tx_status", "EXPERIMENTAL_tx_status"].includes(call.method ?? "")));
});

test("nonfinal, unavailable and contradictory public outcomes do not become successful evidence", async () => {
  for (const mutate of [
    (f: Fixture, hash: string) => { f.control.outcome = { ...f.outcome(hash), final_execution_status: "EXECUTED" }; },
    (f: Fixture) => { f.control.outcomeFailure = new Error("OFFLINE UNKNOWN_TRANSACTION"); },
    (f: Fixture) => { f.control.secondaryFailure = new Error("OFFLINE secondary unavailable"); },
    (f: Fixture, hash: string) => { const wrong = f.outcome(hash); wrong.transaction.actions[0].Transfer.deposit = "2"; f.control.secondaryOutcome = wrong; },
  ]) {
    const { f, state } = await submitted(); mutate(f, state.transactionHash);
    const loads = f.count("credential-read-mock");
    await settle(() => reconcileExperimentA(state, f.ports, f.save));
    assert.equal(state.status, "unresolved"); assert.ok(state.verification);
    assert.equal(f.count("credential-read-mock"), loads); assert.equal(f.sendCount(), 1);
  }
});

test("FINAL proof rejects altered transaction account, key, nonce, hash, action, amount or receipt outcome", async () => {
  for (const mutate of [
    (x: any) => { x.transaction.signer_id = VERIFIED_IDENTITIES.treasury.accountId; },
    (x: any) => { x.transaction.receiver_id = VERIFIED_IDENTITIES.treasury.accountId; },
    (x: any) => { x.transaction.public_key = VERIFIED_IDENTITIES.treasury.accessPublicKey; },
    (x: any) => { x.transaction.nonce = "4"; },
    (x: any) => { x.transaction.hash = "1".repeat(32); },
    (x: any) => { x.transaction.actions = [{ FunctionCall: { method_name: "sign" } }]; },
    (x: any) => { x.transaction.actions[0].Transfer.deposit = "2"; },
    (x: any) => { x.receipts_outcome[0].outcome.status = { Failure: { ActionError: { kind: "OFFLINE" } } }; },
    (x: any) => { x.receipts_outcome[0].id = "1".repeat(32); },
  ]) {
    const { f, state } = await submitted(), wrong = f.outcome(state.transactionHash); mutate(wrong); f.control.outcome = wrong;
    await settle(() => reconcileExperimentA(state, f.ports, f.save));
    assert.equal(state.verification!.primary, null); assert.equal(state.status, "unresolved"); assert.equal(f.sendCount(), 1);
  }
});

test("reconciliation cannot authorize an unattempted preparation and never exposes a submission capability", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  await assert.rejects(reconcileExperimentA(state, f.ports, f.save));
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("a real advancing clock uses one durable approval timestamp without a marker race", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  f.ports.now = () => { const now = f.clock.now(); f.clock.advance(1); return now; };
  await submitExperimentA(state, approval(state), f.ports, f.save);
  assert.equal(f.sendCount(), 1);
  assert.equal(state.attempt!.at, state.events.find(e => e.stage === "attempt-marked")!.at);
});

test("slow public reads cannot relabel an expired snapshot as freshly observed", async () => {
  const f = experimentAFixture(), rpc = f.ports.rpc;
  f.ports.rpc = async (...args) => { const result = await rpc(...args); if (args[1] === "gas_price") f.clock.advance(60_001); return result; };
  await assert.rejects(observeExperimentA({ primaryRpc: f.primary, secondaryRpc: f.secondary }, f.ports), /expired/);
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("a delayed durable send marker cannot outlive the fee observation window", async () => {
  const f = experimentAFixture(), state = await f.prepare();
  await submitExperimentA(state, approval(state), f.ports, async next => {
    await f.save(next); if (next.events.at(-1)?.stage === "send-intent") f.clock.advance(60_001);
  });
  assert.equal(state.status, "failed-before-send"); assert.equal(f.sendCount(), 0);
  assert.equal(state.events.at(-1)!.diagnostic!.category, "PUBLIC_CHECK_FAILED");
});

test("a slow canonical-reference lookup stops stale observations before credential access", async () => {
  const f = experimentAFixture(), state = await f.prepare(), rpc = f.ports.rpc;
  f.ports.rpc = async (...args) => {
    const result = await rpc(...args);
    if (args[1] === "block" && (args[2] as any).block_id !== undefined) f.clock.advance(60_001);
    return result;
  };
  await submitExperimentA(state, approval(state), f.ports, f.save);
  assert.equal(state.status, "failed-before-send"); assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("a minimal NONE acknowledgement is recorded without inventing FINAL evidence", async () => {
  const f = experimentAFixture(), state = await f.prepare(), rpc = f.ports.rpc;
  f.ports.rpc = async (...args) => { const result = await rpc(...args); return args[1] === "send_tx" ? { final_execution_status: "NONE" } : result; };
  await submitExperimentA(state, approval(state), f.ports, f.save);
  assert.equal(state.status, "rpc-accepted"); assert.equal(state.verification, null); assert.equal(f.sendCount(), 1);
  await assert.rejects(submitExperimentA(state, approval(state), f.ports, f.save));
});

test("a mismatched acknowledgement hash remains uncertain and cannot be resubmitted", async () => {
  const f = experimentAFixture(), state = await f.prepare(), rpc = f.ports.rpc;
  f.ports.rpc = async (...args) => { const result = await rpc(...args); return args[1] === "send_tx" ?
    { final_execution_status: "NONE", transaction: { hash: "1".repeat(32) } } : result; };
  await submitExperimentA(state, approval(state), f.ports, f.save);
  assert.equal(state.status, "submission-uncertain"); assert.equal(f.sendCount(), 1);
});

test("a forged FINAL label or incomplete stored proof cannot bypass public verification", async () => {
  const { f, state } = await submitted();
  const forged = structuredClone(state); forged.status = "final-success";
  assert.throws(() => assertExperimentAState(forged));
  await assert.rejects(reconcileExperimentA(forged, f.ports, f.save));
  await reconcileExperimentA(state, f.ports, f.save);
  assert.equal(state.status, "final-success");
  for (const change of [(s: ExperimentAState) => { s.verification = null; },
    (s: ExperimentAState) => { (s.verification!.primary as any).transactionHash = "1".repeat(32); },
    (s: ExperimentAState) => { (s.verification as any).unexpected = "OFFLINE-REJECTED"; }]) {
    const invalid = structuredClone(state); change(invalid); assert.throws(() => assertExperimentAState(invalid));
  }
  assert.equal(f.sendCount(), 1);
});

test("a primary lookup failure still preserves independent secondary proof without declaring success", async () => {
  const { f, state } = await submitted(); f.control.outcomeFailure = new Error("OFFLINE primary unavailable");
  await reconcileExperimentA(state, f.ports, f.save);
  assert.equal(state.status, "unresolved"); assert.equal(state.verification!.primary, null);
  assert.equal(state.verification!.secondary!.success, true);
  assert.equal(f.count("credential-read-mock"), 1); assert.equal(f.sendCount(), 1);
});

test("a genuine corroborated FINAL execution failure remains distinct from uncertainty", async () => {
  const { f, state } = await submitted(), failed = f.outcome(state.transactionHash);
  const reason = { ActionError: { kind: "OFFLINE-SYNTHETIC-FAILURE" } };
  failed.status = { Failure: reason } as any;
  failed.receipts_outcome[0].outcome.status = { Failure: reason } as any;
  f.control.outcome = failed;
  await reconcileExperimentA(state, f.ports, f.save);
  assert.equal(state.status, "final-failure"); assert.equal(state.verification!.primary!.success, false);
  await assert.rejects(submitExperimentA(state, approval(state), f.ports, f.save)); assert.equal(f.sendCount(), 1);
});
