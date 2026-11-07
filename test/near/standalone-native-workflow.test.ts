import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertStandaloneAuditFresh, assertStandaloneBroadcastApproval, assertStandaloneNativeExecutionState, assertStandalonePreparationFresh,
  auditStandaloneNativeBroadcast, broadcastStandaloneNative, classifyStandaloneNativeReceipt, createStandaloneNativeState, decodeStandaloneNativeState, encodeStandaloneNativeState,
  publicStandaloneNativeExecutionSummary, readStandaloneNativeState, reconcileStandaloneNativeEvm, reconcileStandaloneNativeSigning,
  requestStandaloneNativeSignature, saveStandaloneNativeState, withStandaloneNativeStateLock, type StandaloneBroadcastFacts,
  type StandaloneNativeBroadcastApproval } from "../../src/execution/standalone-native.js";
import { assembleSignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { normalizeMpcOutcome } from "../../src/near/signing.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { nativeObservationRpc } from "./fixtures/native-delivery.js";
import { RECORDED_NEAR_HASH, recordedOutcome, recordedState } from "./fixtures/recorded-mpc.js";
import { STANDALONE_AT, STANDALONE_NEAR_HASH, standaloneExecutionFixture, standaloneFinalFailure } from "./fixtures/standalone-native-execution.js";

test("standalone native state binds exact amount and policy without a USDC quote or payment journal", () => {
  const f = standaloneExecutionFixture();
  assert.equal(f.state.preflight.prepared.amountWei, 100_000_000_000_000n); assert.equal(f.state.preflight.prepared.value, f.intent.amountWei);
  assert.equal(f.state.preflight.prepared.data, "0x"); assert.equal(f.state.preflight.prepared.gasLimit, 25_200n);
  assert.deepEqual(decodeStandaloneNativeState(encodeStandaloneNativeState(f.state), f.intent.intentHash), f.state);
  const text = encodeStandaloneNativeState(f.state); assert.doesNotMatch(text, /USDC|purchaseId|quoteHash|paymentClaim|settlement/);
  assert.throws(() => decodeStandaloneNativeState(text, `0x${"00".repeat(32)}`));
});

test("standalone inspection omits executable bytes, credentials and public MPC response payloads", () => {
  const f = standaloneExecutionFixture(), summary = publicStandaloneNativeExecutionSummary(f.state) as any;
  assert.equal(summary.parameters.value, f.intent.amountWei); assert.equal(summary.parameters.unsignedHash, f.preflight.prepared.unsignedHash);
  assert.equal("unsignedSerialized" in summary.parameters, false); assert.equal("serialized" in summary, false);
  assert.equal("credentialPath" in summary, false); assert.equal("nearOutcome" in summary, false);
  assert.equal(summary.expiresAt, new Date(Date.parse(STANDALONE_AT) + 900_000).toISOString());
  assert.equal(summary.rawGasEstimate, 21_000n); assert.equal(summary.bufferedGasLimit, 25_200n);
});

test("state integrity rejects role, intent, amount, serialized bytes, policy, timestamp and attempt substitutions", () => {
  const f = standaloneExecutionFixture();
  for (const changed of [{ ...f.state, role: "investor" }, { ...f.state, kind: "native-eth-execution" }, { ...f.state, status: "unknown" },
    { ...f.state, createdAt: "2026-02-30T00:00:00.000Z" }, { ...f.state, force: true }, { ...f.state, nearTransactionHash: STANDALONE_NEAR_HASH },
    { ...f.state, preflight: { ...f.preflight, prepared: { ...f.preflight.prepared, value: 1n } } },
    { ...f.state, preflight: { ...f.preflight, prepared: { ...f.preflight.prepared, unsignedSerialized: "0x02" } } },
    { ...f.state, preflight: { ...f.preflight, intent: { ...f.intent, policy: { ...f.intent.policy, operatingReserveWei: 0n } } } }])
    assert.throws(() => decodeStandaloneNativeState(encodeStandaloneNativeState(changed), f.intent.intentHash));
  assert.throws(() => decodeStandaloneNativeState(" ".repeat(2_000_001), f.intent.intentHash));
});

test("pure preparation age gate keeps the15-minute maximum and rejects future timestamps", () => {
  const start = Date.parse(STANDALONE_AT);
  assert.doesNotThrow(() => assertStandalonePreparationFresh(STANDALONE_AT, start));
  assert.doesNotThrow(() => assertStandalonePreparationFresh(STANDALONE_AT, start + 900_000));
  assert.throws(() => assertStandalonePreparationFresh(STANDALONE_AT, start + 900_001), /expired/);
  assert.throws(() => assertStandalonePreparationFresh(STANDALONE_AT, start - 1), /future/);
});

function broadcastGateFixture() {
  // Public metadata only. Passing these pure gates does not authenticate a
  // signature or grant a broadcast capability in the strict production workflow.
  const f = standaloneExecutionFixture(), signedHash = `0x${"ab".repeat(32)}`;
  const facts: StandaloneBroadcastFacts = { role: "treasury", status: "signed", intentHash: f.intent.intentHash,
    createdAt: STANDALONE_AT, signedHash, attempted: false, externallyObserved: false };
  const approval: StandaloneNativeBroadcastApproval = { role: "treasury", expectedIntentHash: f.intent.intentHash, approval: signedHash,
    reference: "SIMULATED pure gate test, not live approval", nearRpcUrl: "https://example.invalid/offline" };
  return { f, facts, approval, start: Date.parse(STANDALONE_AT) };
}
test("pure recovery gate requires exact intent, signed hash and acknowledgment of the original expired timestamp", () => {
  const { facts, approval, start } = broadcastGateFixture();
  assert.doesNotThrow(() => assertStandaloneBroadcastApproval(facts, approval, start));
  const recovery = { ...approval, recovery: true, expiredPreparationAcknowledgment: STANDALONE_AT };
  assert.doesNotThrow(() => assertStandaloneBroadcastApproval(facts, recovery, start + 900_001));
  assert.throws(() => assertStandaloneBroadcastApproval(facts, approval, start + 900_001), /expired/);
  for (const changed of [{ ...recovery, approval: `0x${"00".repeat(32)}` }, { ...recovery, expectedIntentHash: `0x${"00".repeat(32)}` },
    { ...recovery, expiredPreparationAcknowledgment: undefined }, { ...recovery, expiredPreparationAcknowledgment: "2020-01-01T00:00:00.000Z" }])
    assert.throws(() => assertStandaloneBroadcastApproval(facts, changed, start + 900_001));
  assert.throws(() => assertStandaloneBroadcastApproval(facts, recovery, start), /expired/);
});

test("pure irreversible-attempt gate blocks existing markers and external observations from any duplicate send", () => {
  const { facts, approval, start } = broadcastGateFixture();
  for (const changes of [{ attempted: true }, { externallyObserved: true }, { status: "evm-uncertain" }, { role: "investor" }])
    assert.throws(() => assertStandaloneBroadcastApproval({ ...facts, ...changes } as typeof facts, approval, start));
});

test("pure audit clock gate preserves the30-second window before and after durable writes", () => {
  const start = Date.parse(STANDALONE_AT), completed = new Date(start + 10_000).toISOString();
  assert.doesNotThrow(() => assertStandaloneAuditFresh(STANDALONE_AT, completed, start + 30_000));
  assert.throws(() => assertStandaloneAuditFresh(STANDALONE_AT, completed, start + 30_001), /30-second/);
  assert.throws(() => assertStandaloneAuditFresh(STANDALONE_AT, new Date(start + 30_001).toISOString(), start + 30_001), /30-second/);
  assert.throws(() => assertStandaloneAuditFresh(STANDALONE_AT, completed, start + 9999));
});

test("pure native receipt classifier separates pending, success and failure without authenticating fixture signatures", () => {
  const f = standaloneExecutionFixture(), hash = `0x${"ab".repeat(32)}`, blockHash = `0x${"33".repeat(32)}`;
  const raw = { hash, from: f.intent.senderAddress, to: f.intent.recipientAddress, blockNumber: "0x66", blockHash };
  const receipt = { transactionHash: hash, from: raw.from, to: raw.to, blockNumber: "0x66", blockHash, status: "0x1" };
  assert.equal(classifyStandaloneNativeReceipt(null, undefined, hash, undefined, 100n), "pending");
  assert.equal(classifyStandaloneNativeReceipt(receipt, raw, hash, "0x66", 100n), "pending");
  assert.equal(classifyStandaloneNativeReceipt(receipt, raw, hash, "0x67", 100n), "success");
  assert.equal(classifyStandaloneNativeReceipt({ ...receipt, status: "0x0" }, raw, hash, "0x67", 100n), "failed");
  for (const change of [{ status: "0x2" }, { blockHash: `0x${"44".repeat(32)}` }, { blockNumber: "0x65" },
    { transactionHash: `0x${"00".repeat(32)}` }, { to: f.intent.senderAddress }])
    assert.throws(() => classifyStandaloneNativeReceipt({ ...receipt, ...change }, raw, hash, "0x66", 100n));
});

test("standalone signing approvals and public preflight failures precede any credential or submission capability", async () => {
  for (const changes of [{ approval: `0x${"00".repeat(32)}` }, { role: "investor" }, { expectedIntentHash: `0x${"00".repeat(32)}` }, { credentialPath: "relative.json" }]) {
    const f = standaloneExecutionFixture(); await assert.rejects(requestStandaloneNativeSignature(f.state, { ...f.input, ...changes } as typeof f.input, f.ports));
    assert.deepEqual(f.events, []);
  }
  for (const snapshot of [{ confirmedNonce: 2, pendingNonce: 2 }, { estimatedGas: 21_001n }, { treasuryBalanceWei: 1n },
    { baseFeePerGas: 4001n }, { simulationResult: "0x01" }, { recipientCode: "0x6000" }]) {
    const f = standaloneExecutionFixture(), before = encodeStandaloneNativeState(f.state); f.ports.evm = nativeObservationRpc(snapshot).rpc;
    await assert.rejects(requestStandaloneNativeSignature(f.state, f.input, f.ports));
    assert.deepEqual(f.events, ["public-mpc-verification"]); assert.equal(encodeStandaloneNativeState(f.state), before);
  }
});

test("standalone NEAR hash and attempt marker precede exactly one mocked submission", async () => {
  const f = standaloneExecutionFixture(); await requestStandaloneNativeSignature(f.state, f.input, f.ports);
  assert.deepEqual(f.events, ["public-mpc-verification", "prepare-signing-packet", "near-submitting", "MOCK-near-submit", "near-submitted"]);
  assert.equal(f.state.nearTransactionHash, STANDALONE_NEAR_HASH); assert.equal(f.state.status, "near-submitted");
  assert.equal(f.saved[0]!.signingApproval!.digest, f.preflight.prepared.unsignedHash);
  await assert.rejects(requestStandaloneNativeSignature(f.state, f.input, f.ports), /already attempted/);
  assert.equal(f.events.filter(e => e === "MOCK-near-submit").length, 1);
});

test("NEAR timeout and pre/post-submission save failures preserve attempted state without automatic retry", async () => {
  const timed = standaloneExecutionFixture({ timeout: true }); await requestStandaloneNativeSignature(timed.state, timed.input, timed.ports);
  assert.equal(timed.state.status, "near-uncertain"); assert.match(timed.state.recovery!, /no automatic/);
  await assert.rejects(requestStandaloneNativeSignature(timed.state, timed.input, timed.ports));
  for (const failedSave of [1, 2]) {
    const f = standaloneExecutionFixture(); let saves = 0;
    f.ports.save = async () => { if (++saves === failedSave) throw new Error("SIMULATED durable save failure"); };
    await assert.rejects(requestStandaloneNativeSignature(f.state, f.input, f.ports), /durable save/);
    assert.equal(f.state.status, "near-submitting"); assert.equal(f.state.nearTransactionHash, STANDALONE_NEAR_HASH);
    assert.equal(f.events.filter(e => e === "MOCK-near-submit").length, failedSave === 1 ? 0 : 1);
    await assert.rejects(requestStandaloneNativeSignature(f.state, f.input, f.ports), /already attempted/);
  }
});

test("preparation expiry after local packet creation or durable marker never causes a signing submission", async () => {
  const before = standaloneExecutionFixture(), originalPrepare = before.ports.prepareSigning;
  before.ports.prepareSigning = async (...args) => { const packet = await originalPrepare(...args); before.clock.advance(900_001); return packet; };
  await assert.rejects(requestStandaloneNativeSignature(before.state, before.input, before.ports), /expired/);
  assert.equal(before.state.status, "prepared"); assert.equal(before.state.nearTransactionHash, undefined);
  const after = standaloneExecutionFixture(); after.ports.save = async state => { after.events.push(state.status); if (state.status === "near-submitting") after.clock.advance(900_001); };
  await requestStandaloneNativeSignature(after.state, after.input, after.ports);
  assert.equal(after.state.status, "near-uncertain"); assert.equal(after.events.includes("MOCK-near-submit"), false);
});

test("signing packet role, digest and MPC parameter substitutions cannot create an attempt", async () => {
  for (const change of [{ signerAccountId: VERIFIED_IDENTITIES.investor.accountId }, { gasTgas: 99 }, { depositYocto: "0" },
    { request: { payload_v2: { Ecdsa: "00".repeat(32) }, path: "wealthpixels/sepolia/v1", domain_id: 0 } }]) {
    const f = standaloneExecutionFixture(), prepare = f.ports.prepareSigning;
    f.ports.prepareSigning = async (...args) => ({ ...await prepare(...args), ...change } as any);
    await assert.rejects(requestStandaloneNativeSignature(f.state, f.input, f.ports), /signing packet/);
    assert.equal(f.state.status, "prepared"); assert.equal(f.events.includes("MOCK-near-submit"), false);
  }
});

test("readonly reconciliation preserves nonfinal, unavailable or incompatible MPC outcomes without new signing", async () => {
  for (const outcome of [null, { final_execution_status: "EXECUTED" }, recordedOutcome()]) {
    const f = standaloneExecutionFixture({ nearHash: RECORDED_NEAR_HASH }); await requestStandaloneNativeSignature(f.state, f.input, f.ports);
    const before = encodeStandaloneNativeState(f.state); f.ports.readOutcome = async () => outcome;
    await assert.rejects(reconcileStandaloneNativeSigning(f.state, f.input, f.ports));
    assert.equal(encodeStandaloneNativeState(f.state), before); assert.equal(f.events.filter(e => e === "MOCK-near-submit").length, 1);
  }
});

test("a matching finalized NEAR failure is recorded and remains blocked from another signing attempt", async () => {
  const f = standaloneExecutionFixture(); await requestStandaloneNativeSignature(f.state, f.input, f.ports);
  f.ports.readOutcome = async () => standaloneFinalFailure(f.state);
  await reconcileStandaloneNativeSigning(f.state, f.input, f.ports);
  assert.equal(f.state.status, "near-failed"); assert.match(f.state.recovery!, /separate authorized decision/);
  assertStandaloneNativeExecutionState(f.state, f.intent.intentHash);
  await assert.rejects(requestStandaloneNativeSignature(f.state, f.input, f.ports), /already attempted/);
});

test("authentic LINK signature cannot be reinterpreted as standalone native authorization, audit or broadcasting", async () => {
  const f = standaloneExecutionFixture({ nearHash: RECORDED_NEAR_HASH }); await requestStandaloneNativeSignature(f.state, f.input, f.ports);
  const historical = recordedState().preflight.prepared, signature = normalizeMpcOutcome(recordedOutcome(), "treasury", RECORDED_NEAR_HASH, historical.unsignedHash);
  const signed = assembleSignedErc20Transfer(historical, signature, historical.senderAddress);
  const forged = { ...f.state, status: "signed" as const, nearOutcome: recordedOutcome(), signed };
  assert.throws(() => assertStandaloneNativeExecutionState(forged, f.intent.intentHash));
  const input = { ...f.input, approval: signed.hash, recovery: true, expiredPreparationAcknowledgment: f.state.createdAt };
  await assert.rejects(auditStandaloneNativeBroadcast(forged, input, f.ports));
  await assert.rejects(broadcastStandaloneNative(forged, input, f.ports));
  await assert.rejects(reconcileStandaloneNativeEvm(forged, f.input, f.ports));
});

test("standalone file-backed locking persists hash before a mocked POST and survives restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "wealthpixels-standalone-native-offline-"));
  try {
    const f = standaloneExecutionFixture(), file = join(root, ".local", "transfers", "native-tests", "state.json");
    await saveStandaloneNativeState(file, f.state, f.intent.intentHash, root);
    await withStandaloneNativeStateLock(file, f.intent.intentHash, async (state, save) => {
      const originalPrepare = f.ports.prepareSigning;
      f.ports.prepareSigning = async (...args) => { const packet = await originalPrepare(...args); return { ...packet, async broadcastOnce() {
        const persisted = await readStandaloneNativeState(file, f.intent.intentHash, root);
        assert.equal(persisted.status, "near-submitting"); assert.equal(persisted.nearTransactionHash, packet.transactionHash);
        assert.equal(persisted.createdAt, STANDALONE_AT); return packet.broadcastOnce();
      } }; };
      await requestStandaloneNativeSignature(state, f.input, { ...f.ports, save });
    }, root);
    const restarted = await readStandaloneNativeState(file, f.intent.intentHash, root);
    assert.equal(restarted.status, "near-submitted"); assert.equal(restarted.nearTransactionHash, STANDALONE_NEAR_HASH);
    await assert.rejects(requestStandaloneNativeSignature(restarted, f.input, f.ports), /already attempted/);
    assert.equal(f.events.filter(e => e === "MOCK-near-submit").length, 1);
    assert.match(await readFile(file, "utf8"), /\$bigint/);
    assert.throws(() => createStandaloneNativeState(f.preflight, `0x${"00".repeat(32)}`));
  } finally {
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-standalone-native-offline-"))), "Cleanup must remain inside its generated test directory.");
    await rm(root, { recursive: true, force: true });
  }
});
