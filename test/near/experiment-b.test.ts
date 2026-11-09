import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { actions, baseDecode, baseEncode, createTransaction, PublicKey } from "near-api-js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../../src/near/identities.js";
import { normalizeMpcOutcome } from "../../src/near/signing.js";
import {
  assertExperimentBState, canonicalExperimentBMessage, experimentBDigest, observeExperimentB, prepareExperimentB,
  publicExperimentBSummary, reconcileExperimentB, submitExperimentB, type ExperimentBState,
} from "../../src/near/experiment-b.js";
import {
  experimentBFixture, EXPERIMENT_B_FIXTURE_ID, EXPERIMENT_B_FIXTURE_AT, EXPERIMENT_B_FIXTURE_BLOCK,
  EXPERIMENT_B_FIXTURE_HEIGHT, EXPERIMENT_B_FIXTURE_NONCE, EXPERIMENT_B_FIXTURE_FEE_BUDGET,
  EXPERIMENT_B_FIXTURE_CREDENTIAL,
} from "./fixtures/experiment-b.js";
import { recordedInvestorOutcome, INVESTOR_NEAR_HASH } from "./fixtures/recorded-investor-mpc.js";

// All B states, public observations, credentials and positive signature results below are OFFLINE SYNTHETIC fixtures.
type Fixture = ReturnType<typeof experimentBFixture>;
const approval = (s: ExperimentBState) => ({ role: "investor" as const, approveDigest: s.digest, approveNearHash: s.transactionHash,
  reference: "OFFLINE-SYNTHETIC-EXPLICIT-DUAL-HASH-APPROVAL", credentialPath: EXPERIMENT_B_FIXTURE_CREDENTIAL });
const options = (f: Fixture, budget = EXPERIMENT_B_FIXTURE_FEE_BUDGET) => ({ id: EXPERIMENT_B_FIXTURE_ID,
  feeBudgetYocto: budget, primaryRpc: f.primary, secondaryRpc: f.secondary });
async function settle(action: () => Promise<unknown>) { try { await action(); } catch { /* Durable state and capability counts are asserted below. */ } }
async function submitted() {
  const f = experimentBFixture(), state = await f.prepare();
  await submitExperimentB(state, approval(state), f.ports, f.save);
  assert.equal(f.sendCount(), 1);
  return { f, state };
}
function request(outcome: any): any {
  return JSON.parse(Buffer.from(outcome.transaction.actions[0].FunctionCall.args, "base64").toString("utf8"));
}
function changeRequest(outcome: any, change: (args: any) => void) {
  const args = request(outcome); change(args);
  outcome.transaction.actions[0].FunctionCall.args = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

test("OFFLINE SYNTHETIC B canonical bytes use exactly two LF-terminated domain-separated lines and a unique Investor ID", () => {
  const message = canonicalExperimentBMessage(EXPERIMENT_B_FIXTURE_ID);
  assert.equal(message, 'WealthPixels/Experiment-B/NEAR-testnet/MPC-diagnostic/v1\n' +
    '{"experimentId":"experiment-b-investor-offline-synthetic-001","nearAccountId":"wealthpixels-investor.testnet","purpose":"diagnostic-only-no-asset-transfer"}\n');
  assert.equal(message.split("\n").length, 3); assert.doesNotMatch(message, /\r/);
  assert.equal(experimentBDigest(EXPERIMENT_B_FIXTURE_ID), "0x" + createHash("sha256").update(Buffer.from(message, "utf8")).digest("hex"));
  assert.notEqual(experimentBDigest(EXPERIMENT_B_FIXTURE_ID), experimentBDigest(EXPERIMENT_B_FIXTURE_ID + "-next"));
  assert.notEqual(experimentBDigest(EXPERIMENT_B_FIXTURE_ID), "0x" + createHash("sha256").update(message.replace("Experiment-B", "Experiment-A")).digest("hex"));
  for (const id of ["", "experiment-b-treasury-offline-synthetic", "experiment-b-investor-UPPER", EXPERIMENT_B_FIXTURE_ID + "\n", "{}"])
    assert.throws(() => canonicalExperimentBMessage(id));
  assert.doesNotMatch(message, /chainId|nonce|to:|EIP-1559|permit|wallet-auth|authorization|0x02/);
});

test("OFFLINE SYNTHETIC B preflight is credential-free and pins authority, key and balance to the same FINAL block", async () => {
  const f = experimentBFixture(), preflight = await observeExperimentB(options(f), f.ports);
  assert.equal(preflight.authority.rootPublicKey, VERIFIED_MPC_ROOT);
  assert.equal(preflight.authority.version, "3.18.0"); assert.equal(preflight.authority.evmAddress, VERIFIED_IDENTITIES.investor.evmAddress);
  assert.equal(preflight.authority.blockHash, EXPERIMENT_B_FIXTURE_BLOCK);
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.count("local-sign-mock"), 0); assert.equal(f.sendCount(), 0);
  const queries = f.calls.filter(call => call.method === "query");
  assert.ok(queries.length >= 2);
  assert.ok(queries.every(call => call.params.account_id === VERIFIED_IDENTITIES.investor.accountId && call.params.block_id === EXPERIMENT_B_FIXTURE_BLOCK));
  assert.ok(f.calls.every(call => !["send_tx", "eth_sendRawTransaction", "eth_signTransaction"].includes(call.method ?? "")));
});

test("OFFLINE SYNTHETIC B prepares exact SDK FunctionCall bytes, nonce plus one and both immutable hashes without signing", async () => {
  const f = experimentBFixture(), state = await f.prepare(), identity = VERIFIED_IDENTITIES.investor;
  assert.equal(state.kind, "experiment-b-near-mpc-diagnostic"); assert.equal(state.mode, "offline-fixtures");
  assert.equal(state.role, "investor"); assert.equal(state.signerAccountId, identity.accountId); assert.equal(state.publicKey, identity.accessPublicKey);
  assert.equal(state.receiverId, "v1.signer-prod.testnet"); assert.equal(state.action, "FunctionCall"); assert.equal(state.methodName, "sign");
  assert.equal(state.gas, "100000000000000"); assert.equal(state.depositYocto, "1");
  assert.equal(state.path, "wealthpixels/sepolia/v1"); assert.equal(state.domainId, 0);
  assert.equal(state.previousNonce, EXPERIMENT_B_FIXTURE_NONCE.toString()); assert.equal(state.transactionNonce, (EXPERIMENT_B_FIXTURE_NONCE + 1n).toString());
  assert.equal(state.referenceBlock.hash, EXPERIMENT_B_FIXTURE_BLOCK); assert.equal(state.referenceBlock.height, EXPERIMENT_B_FIXTURE_HEIGHT);
  const args = { request: { payload_v2: { Ecdsa: state.digest.slice(2) }, path: "wealthpixels/sepolia/v1", domain_id: 0 } };
  const tx = createTransaction(identity.accountId, PublicKey.fromString(identity.accessPublicKey), "v1.signer-prod.testnet",
    EXPERIMENT_B_FIXTURE_NONCE + 1n, [actions.functionCall("sign", args, 100_000_000_000_000n, 1n)], baseDecode(EXPERIMENT_B_FIXTURE_BLOCK));
  assert.equal(state.transactionHash, baseEncode(createHash("sha256").update(tx.encode()).digest()));
  assert.equal(Date.parse(state.expiresAt) - Date.parse(state.createdAt), 900_000);
  assert.equal(state.submission.digest, state.digest); assert.equal(state.submission.transactionHash, state.transactionHash);
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  assert.doesNotMatch(JSON.stringify(state), /serializedEvm|unsignedEvm|chainId|eip1559|signed_tx_base64|private_key/);
});

test("OFFLINE SYNTHETIC B stored preparation rejects role, envelope, digest, reference and deadline tampering", async () => {
  const f = experimentBFixture(), state = await f.prepare();
  for (const change of [
    { action: "Transfer" }, { methodName: "anything" }, { gas: "99000000000000" }, { depositYocto: "2" },
    { role: "treasury" }, { signerAccountId: VERIFIED_IDENTITIES.treasury.accountId }, { publicKey: VERIFIED_IDENTITIES.treasury.accessPublicKey },
    { receiverId: VERIFIED_IDENTITIES.treasury.accountId }, { path: "wealthpixels/sepolia/v2" }, { domainId: 1 },
    { message: state.message.replace(/\n/g, "\r\n") }, { digest: "0x" + "11".repeat(32) },
    { previousNonce: "3" }, { transactionNonce: "4" }, { transactionHash: "1".repeat(32) },
    { referenceBlock: { ...state.referenceBlock, hash: "1".repeat(32) } },
    { expiresAt: new Date(Date.parse(state.expiresAt) + 1).toISOString() }, { private_key: "OFFLINE-SYNTHETIC-INVALID-CREDENTIAL" },
  ]) assert.throws(() => assertExperimentBState({ ...structuredClone(state), ...change }));
  assertExperimentBState(state);
  const summary = JSON.stringify(publicExperimentBSummary(state));
  assert.match(summary, new RegExp(state.transactionHash)); assert.ok(summary.includes(state.digest));
  assert.doesNotMatch(summary, /private_key|signed_tx_base64|credentialPath|OFFLINE-SYNTHETIC-INVALID-credentials/);
});

test("OFFLINE SYNTHETIC B requires pinned Investor root, role, key, domain, path, version and full derived public key", async () => {
  for (const change of [
    (f: Fixture) => { f.control.network = "mainnet"; },
    (f: Fixture) => { (f.control.authority as any).role = "treasury"; },
    (f: Fixture) => { (f.control.authority as any).accessPublicKey = VERIFIED_IDENTITIES.treasury.accessPublicKey; },
    (f: Fixture) => { (f.control.authority.inspection as any).rootPublicKey = "OFFLINE-SYNTHETIC-WRONG-ROOT"; },
    (f: Fixture) => { (f.control.authority.inspection as any).version = "3.18.1"; },
    (f: Fixture) => { (f.control.authority.inspection as any).domainId = 1; },
    (f: Fixture) => { (f.control.authority.inspection.domain as any).purpose = "Reshare"; },
    (f: Fixture) => { (f.control.authority.inspection as any).minimumGasTgas = 101; },
    (f: Fixture) => { (f.control.authority.derivation as any).derivationPath = "other/offline/synthetic"; },
    (f: Fixture) => { (f.control.authority.derivation as any).derivedPublicKeySec1 = f.control.authority.inspection.rootPublicKeySec1; },
    (f: Fixture) => { (f.control.authority.derivation as any).evmAddress = VERIFIED_IDENTITIES.treasury.evmAddress; },
    (f: Fixture) => { f.control.key = VERIFIED_IDENTITIES.treasury.accessPublicKey; },
    (f: Fixture) => { f.control.permission = { FunctionCall: { receiver_id: "anything.testnet", method_names: [] } }; },
    (f: Fixture) => { f.control.extraKey = true; },
  ]) {
    const f = experimentBFixture(); change(f); await assert.rejects(f.prepare());
    assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  }
});

test("OFFLINE SYNTHETIC B FunctionCall estimate covers full 100 Tgas at twice block price and separates receipt-floor upfront funding", async () => {
  const f = experimentBFixture(), state = await f.prepare(), fee = state.preflight.feeModel;
  assert.equal(fee.pricingPolicy, "near-protocol-88-mpc-function-call-v1");
  const bytes = Buffer.byteLength("sign") + Buffer.byteLength(JSON.stringify({ request: { payload_v2: { Ecdsa: state.digest.slice(2) }, path: state.path, domain_id: 0 } }));
  assert.equal(fee.requestBytes, bytes);
  const base = 108_059_500_000n + 2_319_861_500_000n + BigInt(bytes) * 2_235_934n;
  assert.equal(fee.sendGas, base.toString()); assert.equal(fee.receiptGas, (base + 100_000_000_000_000n).toString());
  assert.equal(fee.assumedBlockGasPriceYocto, "200000000"); assert.equal(fee.receiptPurchasePriceYocto, "1000000000");
  assert.equal(fee.estimatedFullAttachmentBurnYocto, ((base * 2n + 100_000_000_000_000n) * 200_000_000n).toString());
  assert.equal(fee.requiredSpendableYocto, (base * 200_000_000n + (base + 100_000_000_000_000n) * 1_000_000_000n + 1n).toString());
  assert.ok(BigInt(fee.requiredSpendableYocto) > BigInt(fee.estimatedFullAttachmentBurnYocto));
  assert.equal(fee.estimatedRefundFeeYocto, "0"); assert.match(fee.refundScheduleSource, /nearcore.*85-88/);
  // A Transfer fee table cannot supply these mandatory FunctionCall inputs.
  delete f.control.config.runtime_config.transaction_costs.action_creation_config.function_call_cost;
  f.control.config.runtime_config.transaction_costs.action_creation_config.transfer_cost = { send_not_sir: 1, execution: 1 };
  await assert.rejects(f.prepare());
});

test("OFFLINE SYNTHETIC B never defaults to A's budget and rejects unavailable, unsupported or contradictory pricing before credentials", async () => {
  const absent = experimentBFixture();
  await assert.rejects(observeExperimentB({ ...options(absent), feeBudgetYocto: undefined as any }, absent.ports));
  for (const change of [
    (f: Fixture) => { f.control.gasPrice = "0"; },
    (f: Fixture) => { f.control.readFailure = "gas_price"; },
    (f: Fixture) => { delete f.control.config.runtime_config.min_gas_purchase_price; },
    (f: Fixture) => { delete f.control.config.runtime_config.transaction_costs.action_creation_config.function_call_cost_per_byte; },
    (f: Fixture) => { f.control.config.protocol_version = 89; },
    (f: Fixture) => { f.control.config.runtime_config.gas_refund_penalty = { numerator: 1, denominator: 100 }; },
    (f: Fixture) => { f.control.config.runtime_config.transaction_costs.min_gas_refund_penalty = 1; },
    (f: Fixture) => { f.control.config.transaction_validity_period = 0; },
  ]) {
    const f = experimentBFixture(); change(f); await assert.rejects(f.prepare());
    assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  }
  const aBudget = experimentBFixture(); await assert.rejects(observeExperimentB(options(aBudget, "100000000000000000000"), aBudget.ports));
  assert.equal(aBudget.count("credential-read-mock"), 0);
});

test("OFFLINE SYNTHETIC B cannot pay upfront gas by anticipating a refund even with enough balance for its fee budget", async () => {
  const f = experimentBFixture(), state = await f.prepare();
  f.control.balance = BigInt(state.preflight.storageReserveYocto) + BigInt(state.preflight.feeModel.estimatedFullAttachmentBurnYocto) + 2n;
  await assert.rejects(f.prepare()); assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("OFFLINE SYNTHETIC B rejects stale fee snapshots and stale preparation without relabeling their timestamps", async () => {
  const f = experimentBFixture(), rpc = f.ports.rpc;
  f.ports.rpc = async (...args) => { const result = await rpc(...args); if (args[1] === "gas_price") f.clock.advance(60_001); return result; };
  await assert.rejects(observeExperimentB(options(f), f.ports)); assert.equal(f.count("credential-read-mock"), 0);
  const g = experimentBFixture(), preflight = await observeExperimentB(options(g), g.ports);
  g.clock.advance(60_001); assert.throws(() => prepareExperimentB(EXPERIMENT_B_FIXTURE_ID, preflight, g.clock.now()));
});

test("OFFLINE SYNTHETIC B requires both exact approvals and Investor role before durable marking or credential access", async () => {
  for (const change of [{ approveDigest: "0x" + "11".repeat(32) }, { approveNearHash: "1".repeat(32) }, { role: "treasury" },
    { credentialPath: EXPERIMENT_B_FIXTURE_CREDENTIAL.replace("investor.json", "treasury.json") }]) {
    const f = experimentBFixture(), state = await f.prepare();
    await assert.rejects(submitExperimentB(state, { ...approval(state), ...change } as any, f.ports, f.save));
    assert.equal(state.status, "prepared"); assert.equal(f.saved.length, 0); assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
  }
});

test("OFFLINE SYNTHETIC B saves approval and send intent before each corresponding capability and never serializes executable payloads", async () => {
  const { f, state } = await submitted();
  assert.equal(state.status, "rpc-accepted"); assert.equal(state.verification, null);
  const load = f.calls.findIndex(c => c.kind === "credential-read-mock"), send = f.calls.findIndex(c => c.method === "send_tx");
  assert.ok(f.calls.slice(0, load).some(c => c.kind === "save" && c.params.stage === "attempt-marked"));
  assert.ok(f.calls.slice(load, send).some(c => c.kind === "save" && c.params.stage === "send-intent"));
  assert.equal(state.attempt!.approvedDigest, state.digest); assert.equal(state.attempt!.approvedHash, state.transactionHash);
  assert.ok(f.saved.every(s => s.transactionHash === state.transactionHash && s.digest === state.digest && s.referenceBlock.hash === state.referenceBlock.hash && s.expiresAt === state.expiresAt));
  assert.doesNotMatch(JSON.stringify(f.saved), /private_key|signed_tx_base64|OFFLINE-SYNTHETIC-INVALID-credentials/);
  assert.equal(f.signed!.transaction.actions.length, 1); assert.equal(f.signed!.transaction.actions[0]!.functionCall!.gas, 100_000_000_000_000n);
});

test("OFFLINE SYNTHETIC B nonce drift, authority drift, unavailable reads and budget growth fail before credentials without replacing either approved hash", async () => {
  for (const change of [(f: Fixture) => { f.control.nonce += 1n; }, (f: Fixture) => { f.control.authorityFailure = true; },
    (f: Fixture) => { f.control.readFailure = "query"; }, (f: Fixture) => { f.control.gasPrice = "200000000"; }]) {
    const f = experimentBFixture(), state = await f.prepare(), original = { hash: state.transactionHash, digest: state.digest, expires: state.expiresAt };
    change(f); await settle(() => submitExperimentB(state, approval(state), f.ports, f.save));
    assert.equal(state.status, "failed-before-send"); assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
    assert.deepEqual({ hash: state.transactionHash, digest: state.digest, expires: state.expiresAt }, original);
    await assert.rejects(submitExperimentB(state, approval(state), f.ports, f.save));
  }
});

test("OFFLINE SYNTHETIC B wrong local key, changed bytes, incorrect hash and failed Ed25519 verification stop before POST", async () => {
  for (const change of [(f: Fixture) => { f.control.wrongSigner = true; }, (f: Fixture) => { f.control.hashChanged = true; },
    (f: Fixture) => { f.control.signatureValid = false; }, (f: Fixture) => { f.control.signedTransactionChanged = true; }]) {
    const f = experimentBFixture(), state = await f.prepare(); change(f);
    await settle(() => submitExperimentB(state, approval(state), f.ports, f.save));
    assert.equal(state.status, "failed-before-send"); assert.equal(f.sendCount(), 0);
  }
});

test("OFFLINE SYNTHETIC B original 15-minute expiry prevents credential access and cannot be extended", async () => {
  const f = experimentBFixture(), state = await f.prepare(), original = structuredClone(state);
  f.clock.advance(900_000); await assert.rejects(submitExperimentB(state, approval(state), f.ports, f.save));
  assert.deepEqual(state, original); assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("OFFLINE SYNTHETIC B advancing clock binds one approval timestamp to its durable marker", async () => {
  const f = experimentBFixture(), state = await f.prepare();
  f.ports.now = () => { const at = f.clock.now(); f.clock.advance(1); return at; };
  await submitExperimentB(state, approval(state), f.ports, f.save);
  assert.equal(f.sendCount(), 1); assert.equal(state.attempt!.at, state.events.find(e => e.stage === "attempt-marked")!.at);
  assert.equal(state.createdAt, EXPERIMENT_B_FIXTURE_AT);
});

test("OFFLINE SYNTHETIC B save failures preserve the last durable stage and never authorize a send or automatic repeat", async () => {
  for (const failStage of ["attempt-marked", "public-checks", "credential-validated", "send-intent"]) {
    const f = experimentBFixture(), state = await f.prepare();
    await assert.rejects(submitExperimentB(state, approval(state), f.ports, async next => {
      if (next.events.at(-1)?.stage === failStage) throw new Error("OFFLINE SYNTHETIC durable write failed");
      await f.save(next);
    }));
    assert.equal(f.sendCount(), 0);
    if (f.saved.length) {
      assert.deepEqual(state, f.saved.at(-1));
      const restarted = structuredClone(f.saved.at(-1)!); assertExperimentBState(restarted, f.ports);
      await assert.rejects(submitExperimentB(restarted, approval(restarted), f.ports, f.save));
    } else { assert.equal(state.status, "prepared"); assert.equal(f.count("credential-read-mock"), 0); }
    assert.equal(f.sendCount(), 0);
  }
});

test("OFFLINE SYNTHETIC B saved send marker is followed by fresh deadline and 60-second fee checks", async () => {
  for (const delay of [60_001, 900_000]) {
    const f = experimentBFixture(), state = await f.prepare(), expiresAt = state.expiresAt;
    await submitExperimentB(state, approval(state), f.ports, async next => {
      await f.save(next); if (next.events.at(-1)?.stage === "send-intent") f.clock.advance(delay);
    });
    assert.equal(state.status, "failed-before-send"); assert.equal(f.sendCount(), 0); assert.equal(state.expiresAt, expiresAt);
    assert.equal(state.events.at(-1)!.diagnostic!.category, delay === 900_000 ? "DEADLINE_EXPIRED" : "PUBLIC_CHECK_FAILED");
  }
});

test("OFFLINE SYNTHETIC B post-sign nonce drift stops the single prepared request without signing a replacement", async () => {
  const f = experimentBFixture(), state = await f.prepare(), hash = state.transactionHash;
  await submitExperimentB(state, approval(state), f.ports, async next => {
    await f.save(next); if (next.events.at(-1)?.stage === "credential-validated") f.control.nonce += 1n;
  });
  assert.equal(state.status, "failed-before-send"); assert.equal(state.transactionHash, hash);
  assert.equal(f.count("local-sign-mock"), 1); assert.equal(f.sendCount(), 0);
  await assert.rejects(submitExperimentB(state, approval(state), f.ports, f.save));
});

test("OFFLINE SYNTHETIC B a slow original-reference lookup expires fresh fee checks before loading credentials", async () => {
  const f = experimentBFixture(), state = await f.prepare(), rpc = f.ports.rpc;
  f.ports.rpc = async (...args) => { const result = await rpc(...args);
    if (args[1] === "block" && (args[2] as any).block_id === EXPERIMENT_B_FIXTURE_HEIGHT) f.clock.advance(60_001);
    return result; };
  await submitExperimentB(state, approval(state), f.ports, f.save);
  assert.equal(state.status, "failed-before-send"); assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("OFFLINE SYNTHETIC B timeout after POST preserves uncertain public hashes and restart cannot sign or send again", async () => {
  const f = experimentBFixture(), state = await f.prepare(); f.control.sendFailure = new Error("OFFLINE SYNTHETIC timeout untrusted-secret-text");
  await submitExperimentB(state, approval(state), f.ports, f.save);
  assert.equal(state.status, "submission-uncertain"); assert.equal(state.verification, null); assert.equal(f.sendCount(), 1);
  assert.doesNotMatch(JSON.stringify(state), /untrusted-secret-text/);
  const restarted = structuredClone(f.saved.at(-1)!); assertExperimentBState(restarted, f.ports);
  await assert.rejects(submitExperimentB(restarted, approval(restarted), f.ports, f.save));
  assert.equal(f.count("local-sign-mock"), 1); assert.equal(f.sendCount(), 1);
});

test("OFFLINE SYNTHETIC B post-send persistence failure leaves durable send intent and prohibits resubmission", async () => {
  const f = experimentBFixture(), state = await f.prepare();
  await assert.rejects(submitExperimentB(state, approval(state), f.ports, async next => {
    if (f.sendCount() > 0) throw new Error("OFFLINE SYNTHETIC post-send storage unavailable"); await f.save(next);
  }));
  assert.equal(state.events.at(-1)!.stage, "send-intent"); assert.deepEqual(state, f.saved.at(-1));
  const restarted = structuredClone(f.saved.at(-1)!); assertExperimentBState(restarted, f.ports);
  await assert.rejects(submitExperimentB(restarted, approval(restarted), f.ports, f.save)); assert.equal(f.sendCount(), 1);
});

test("OFFLINE SYNTHETIC B accepts minimal NONE acknowledgement without inventing FINAL proof; wrong hash stays uncertain", async () => {
  for (const wrongHash of [false, true]) {
    const f = experimentBFixture(), state = await f.prepare(), rpc = f.ports.rpc;
    f.ports.rpc = async (...args) => { const result = await rpc(...args); return args[1] === "send_tx" ?
      { final_execution_status: "NONE", ...(wrongHash ? { transaction: { hash: "1".repeat(32) } } : {}) } : result; };
    await submitExperimentB(state, approval(state), f.ports, f.save);
    assert.equal(state.status, wrongHash ? "submission-uncertain" : "rpc-accepted"); assert.equal(state.verification, null);
    await assert.rejects(submitExperimentB(state, approval(state), f.ports, f.save)); assert.equal(f.sendCount(), 1);
  }
});

test("OFFLINE SYNTHETIC B conflicting acknowledgement hash fields preserve uncertainty even when one hash matches", async () => {
  const f = experimentBFixture(), state = await f.prepare(), rpc = f.ports.rpc;
  f.ports.rpc = async (...args) => { const result = await rpc(...args); return args[1] === "send_tx" ?
    { final_execution_status: "NONE", transaction: { hash: state.transactionHash }, transaction_hash: "1".repeat(32) } : result; };
  await submitExperimentB(state, approval(state), f.ports, f.save);
  assert.equal(state.status, "submission-uncertain"); assert.equal(state.verification, null);
  await assert.rejects(submitExperimentB(state, approval(state), f.ports, f.save)); assert.equal(f.sendCount(), 1);
});

test("OFFLINE SYNTHETIC B restart reconciliation is bounded, credential-free and requires both endpoint FINAL proofs", async () => {
  const { f, state } = await submitted(), restarted = structuredClone(f.saved.at(-1)!);
  const start = f.calls.length, loads = f.count("credential-read-mock"), signs = f.count("local-sign-mock");
  await reconcileExperimentB(restarted, f.ports, f.save);
  assert.equal(restarted.status, "mpc-verified"); assert.ok(restarted.verification!.primary!.signature);
  assert.equal(restarted.verification!.primary!.totalTokensBurntYocto, "800000000000000000000");
  assert.equal(restarted.transactionHash, state.transactionHash); assert.equal(restarted.digest, state.digest); assert.equal(restarted.expiresAt, state.expiresAt);
  assert.equal(f.count("credential-read-mock"), loads); assert.equal(f.count("local-sign-mock"), signs); assert.equal(f.sendCount(), 1);
  const lookups = f.calls.slice(start).filter(c => c.method === "tx");
  assert.equal(lookups.length, 2); assert.deepEqual(lookups.map(c => c.endpoint).sort(), [f.primary, f.secondary].sort());
  assert.ok(lookups.every(c => c.params.tx_hash === state.transactionHash && c.params.sender_account_id === VERIFIED_IDENTITIES.investor.accountId && c.params.wait_until === "NONE"));
  assertExperimentBState(restarted, f.ports);
  // Data claiming fixture mode cannot select these executable cryptographic mocks.
  assert.throws(() => assertExperimentBState(restarted)); assert.throws(() => publicExperimentBSummary(restarted));
  assert.ok(publicExperimentBSummary(restarted, f.ports));
});

test("OFFLINE SYNTHETIC B incomplete, unavailable and contradictory outcomes preserve partial evidence without success", async () => {
  for (const change of [
    (f: Fixture, s: ExperimentBState) => { f.control.outcome = { ...f.outcome(s.transactionHash, s.digest), final_execution_status: "EXECUTED" }; },
    (f: Fixture) => { f.control.outcomeFailure = new Error("OFFLINE SYNTHETIC UNKNOWN_TRANSACTION"); },
    (f: Fixture) => { f.control.secondaryFailure = new Error("OFFLINE SYNTHETIC secondary unavailable"); },
    (f: Fixture, s: ExperimentBState) => { const o = f.outcome(s.transactionHash, s.digest); o.receipts_outcome[0].outcome.tokens_burnt = "1"; f.control.secondaryOutcome = o; },
  ]) {
    const { f, state } = await submitted(); change(f, state); const loads = f.count("credential-read-mock");
    await reconcileExperimentB(state, f.ports, f.save);
    assert.equal(state.status, "unresolved"); assert.ok(state.verification); assert.equal(f.sendCount(), 1); assert.equal(f.count("credential-read-mock"), loads);
    assert.ok(f.calls.some(c => c.endpoint === f.secondary && c.method === "tx"));
    await assert.rejects(submitExperimentB(state, approval(state), f.ports, f.save));
  }
});

test("OFFLINE SYNTHETIC B unavailable endpoints each retain bounded safe lookup diagnostics without raw provider messages", async () => {
  const { f, state } = await submitted();
  f.control.outcomeFailure = new Error("OFFLINE SYNTHETIC primary unavailable untrusted-secret-text");
  f.control.secondaryFailure = new Error("OFFLINE SYNTHETIC secondary unavailable untrusted-secret-text");
  const firstLookup = f.calls.filter(c => c.method === "tx").length;
  await reconcileExperimentB(state, f.ports, f.save);
  assert.equal(state.status, "unresolved"); assert.equal(state.verification!.primary, null); assert.equal(state.verification!.secondary, null);
  for (const diagnostic of [state.verification!.primaryDiagnostic, state.verification!.secondaryDiagnostic]) {
    assert.ok(diagnostic); assert.equal(diagnostic.stage, "tx-lookup");
    assert.ok(["RPC_FAILED", "VERIFICATION_FAILED"].includes(diagnostic.code));
    assert.ok(diagnostic.diagnostic.category);
  }
  assert.equal(f.calls.filter(c => c.method === "tx").length, firstLookup + 2);
  assert.doesNotMatch(JSON.stringify(state), /untrusted-secret-text|primary unavailable|secondary unavailable/);
  assertExperimentBState(state, f.ports);
  const forged = structuredClone(state); (forged.verification!.primaryDiagnostic as any).rawProviderMessage = "OFFLINE-SYNTHETIC-UNTRUSTED";
  assert.throws(() => assertExperimentBState(forged, f.ports));
  assert.equal(f.count("credential-read-mock"), 1); assert.equal(f.sendCount(), 1);
});

test("OFFLINE SYNTHETIC B FINAL proof rejects changed account, action, nonce, gas, path, domain, digest, hash and public signature", async () => {
  for (const change of [
    (o: any) => { o.transaction.signer_id = VERIFIED_IDENTITIES.treasury.accountId; },
    (o: any) => { o.transaction.receiver_id = VERIFIED_IDENTITIES.treasury.accountId; },
    (o: any) => { o.transaction.public_key = VERIFIED_IDENTITIES.treasury.accessPublicKey; },
    (o: any) => { o.transaction.nonce = "4"; }, (o: any) => { o.transaction.hash = "1".repeat(32); },
    (o: any) => { o.transaction.actions = [{ Transfer: { deposit: "1" } }]; },
    (o: any) => { o.transaction.actions[0].FunctionCall.method_name = "other"; },
    (o: any) => { o.transaction.actions[0].FunctionCall.gas = 99_000_000_000_000; },
    (o: any) => { o.transaction.actions[0].FunctionCall.deposit = "2"; },
    (o: any) => { changeRequest(o, a => { a.request.path = "other/offline/synthetic"; }); },
    (o: any) => { changeRequest(o, a => { a.request.domain_id = 1; }); },
    (o: any) => { changeRequest(o, a => { a.request.payload_v2.Ecdsa = "11".repeat(32); }); },
    (o: any) => { o.transaction.signature = "ed25519:" + baseEncode(new Uint8Array(64).fill(1)); },
    (o: any) => { o.receipts_outcome[0].id = "1".repeat(32); },
  ]) {
    const { f, state } = await submitted(), wrong = f.outcome(state.transactionHash, state.digest); change(wrong); f.control.outcome = wrong;
    await reconcileExperimentB(state, f.ports, f.save);
    assert.equal(state.status, "unresolved"); assert.equal(state.verification!.primary, null); assert.equal(f.sendCount(), 1);
  }
});

test("OFFLINE SYNTHETIC B mock signature-verifier rejection is unresolved and cannot masquerade as a chain failure", async () => {
  const { f, state } = await submitted(); f.control.mpcVerifyFailure = true;
  await reconcileExperimentB(state, f.ports, f.save);
  assert.equal(state.status, "unresolved"); assert.equal(state.verification!.primary, null); assert.equal(state.verification!.secondary, null); assert.equal(f.sendCount(), 1);
});

test("OFFLINE SYNTHETIC B genuine corroborated FINAL chain failure preserves failed evidence and never requests another signature", async () => {
  const { f, state } = await submitted(), failed = f.outcome(state.transactionHash, state.digest);
  const reason = { ActionError: { kind: "OFFLINE-SYNTHETIC-CONTRACT-FAILURE" } };
  failed.status = { Failure: reason } as any; failed.receipts_outcome[0].outcome.status = { Failure: reason } as any;
  f.control.outcome = failed;
  await reconcileExperimentB(state, f.ports, f.save);
  assert.equal(state.status, "final-failure"); assert.equal(state.verification!.primary!.success, false); assert.equal(state.verification!.primary!.signature, null);
  assertExperimentBState(state, f.ports);
  await assert.rejects(submitExperimentB(state, approval(state), f.ports, f.save)); assert.equal(f.sendCount(), 1);
  for (const change of [
    (s: ExperimentBState) => { (s.verification!.primary as any).success = true; },
    (s: ExperimentBState) => { (s.verification!.primary as any).outcome.status = { SuccessValue: "" }; },
    (s: ExperimentBState) => { (s.verification!.primary as any).publicSignature = "ed25519:" + baseEncode(new Uint8Array(64).fill(1)); },
    (s: ExperimentBState) => { s.events = s.events.filter(e => e.stage !== "send-intent"); },
  ]) {
    const forged = structuredClone(state); change(forged);
    assert.throws(() => assertExperimentBState(forged, f.ports)); await assert.rejects(reconcileExperimentB(forged, f.ports, f.save));
  }
});

test("OFFLINE SYNTHETIC B forged terminal labels, missing durable send history and altered stored proofs cannot pass inspection or reconciliation", async () => {
  const { f, state } = await submitted();
  for (const status of ["mpc-verified", "final-failure"] as const) {
    const forged = structuredClone(state); forged.status = status;
    assert.throws(() => assertExperimentBState(forged, f.ports));
    await assert.rejects(reconcileExperimentB(forged, f.ports, f.save));
  }
  await reconcileExperimentB(state, f.ports, f.save); assert.equal(state.status, "mpc-verified");
  for (const change of [
    (s: ExperimentBState) => { s.verification = null; },
    (s: ExperimentBState) => { (s.verification!.primary as any).transactionHash = "1".repeat(32); },
    (s: ExperimentBState) => { (s.verification!.primary as any).transactionNonce = "4"; },
    (s: ExperimentBState) => { (s.verification!.primary as any).totalTokensBurntYocto = "1"; },
    (s: ExperimentBState) => { (s.verification!.primary as any).signature.recovery_id = 1; },
    (s: ExperimentBState) => { s.events = s.events.filter(e => e.stage !== "send-intent"); },
    (s: ExperimentBState) => { (s.referenceBlock as any).hash = "1".repeat(32); },
    (s: ExperimentBState) => { (s.submission as any).referenceBlock.hash = "1".repeat(32); },
    (s: ExperimentBState) => { (s.verification as any).offlineBypass = true; },
    (s: ExperimentBState) => { s.status = "final-failure"; },
  ]) {
    const forged = structuredClone(state); change(forged); assert.throws(() => assertExperimentBState(forged, f.ports));
    await assert.rejects(reconcileExperimentB(forged, f.ports, f.save));
  }
  assert.equal(f.sendCount(), 1);
});

test("OFFLINE SYNTHETIC B terminal reconciliation revalidates persisted proof and makes independent reads without using credentials", async () => {
  const { f, state } = await submitted(); await reconcileExperimentB(state, f.ports, f.save);
  const before = f.calls.filter(c => c.method === "tx").length;
  await reconcileExperimentB(state, f.ports, f.save);
  assert.equal(f.calls.filter(c => c.method === "tx").length, before + 2); assert.equal(state.status, "mpc-verified");
  assert.equal(f.count("credential-read-mock"), 1); assert.equal(f.count("local-sign-mock"), 1); assert.equal(f.sendCount(), 1);
});

test("OFFLINE SYNTHETIC B unattempted preparation has no reconciliation or resubmission authority", async () => {
  const f = experimentBFixture(), state = await f.prepare(); await assert.rejects(reconcileExperimentB(state, f.ports, f.save));
  assert.equal(f.count("credential-read-mock"), 0); assert.equal(f.sendCount(), 0);
});

test("historical public Investor signature cannot authenticate the OFFLINE SYNTHETIC diagnostic digest through the real normalizer", () => {
  const diagnosticDigest = experimentBDigest(EXPERIMENT_B_FIXTURE_ID);
  // Historical public evidence is read from a committed fixture only; this performs no runtime state or network access.
  assert.throws(() => normalizeMpcOutcome(recordedInvestorOutcome(), "investor", INVESTOR_NEAR_HASH, diagnosticDigest));
});
