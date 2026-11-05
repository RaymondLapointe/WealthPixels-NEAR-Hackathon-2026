import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNativeExecutionState, broadcastNativeTransfer, createNativeExecutionState, decodeNativeState, encodeNativeState,
  publicNativeExecutionSummary, readNativeState, reconcileNativeEvm, reconcileNativeSigning, requestNativeSignature,
  saveNativeState, withNativeStateLock, type NativeApproval, type NativeExecutionPorts, type NativeExecutionState,
} from "../../src/execution/native-workflow.js";
import { DEFAULT_NATIVE_DELIVERY_POLICY } from "../../src/evm/sepolia-native.js";
import { assembleSignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { normalizeMpcOutcome } from "../../src/near/signing.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { nativeObservationRpc, nativePreflight } from "./fixtures/native-delivery.js";
import { recordedOutcome, recordedState, RECORDED_NEAR_HASH } from "./fixtures/recorded-mpc.js";

// All observations, submission capabilities and packet results below are offline mocks.
// No authentic native Treasury signature exists yet; authentic recorded ERC-20 proof
// must fail native authorization. Positive native crypto tests use a public algebraic
// fixture at the lower-level verifier, without weakening this pinned Treasury workflow.
const NEAR_HASH = "1".repeat(32);
function recordedErc20Signed() {
  const recorded = recordedState(), prepared = recorded.preflight.prepared;
  const signature = normalizeMpcOutcome(recordedOutcome(), "treasury", RECORDED_NEAR_HASH, prepared.unsignedHash);
  return assembleSignedErc20Transfer(prepared, signature, prepared.senderAddress);
}
function state(): NativeExecutionState {
  const preflight = nativePreflight();
  return createNativeExecutionState(preflight, preflight.approvedTermsHash);
}
function approval(value: NativeExecutionState): NativeApproval & { credentialPath: string } {
  return { role: "treasury", approval: value.preflight.prepared.unsignedHash, expectedTermsHash: value.preflight.approvedTermsHash,
    nearRpcUrl: "https://offline.invalid/not-requested", credentialPath: "offline-fixture-only-no-file-read" };
}
function deniedPorts(): NativeExecutionPorts {
  const deny = async (): Promise<never> => { throw new Error("Unexpected offline capability invocation."); };
  return { evm: { request: deny }, verifyMpc: deny, prepareSigning: deny, readOutcome: deny,
    broadcast: { sendRawTransaction: deny }, save: deny };
}
function mockPorts(value: NativeExecutionState, events: string[], result: "success" | "timeout" = "success"): NativeExecutionPorts {
  const ports = deniedPorts(); ports.evm = nativeObservationRpc().rpc;
  ports.prepareSigning = async () => ({ transactionHash: NEAR_HASH, signerAccountId: VERIFIED_IDENTITIES.treasury.accountId,
    receiverId: "v1.signer-prod.testnet", request: { payload_v2: { Ecdsa: value.preflight.prepared.unsignedHash.slice(2) },
      path: "wealthpixels/sepolia/v1", domain_id: 0 }, gasTgas: 100, depositYocto: "1",
    async broadcastOnce() { events.push("mock-near-send"); if (result === "timeout") throw new Error("offline timeout"); return {}; } });
  ports.save = async next => { events.push(next.status); };
  return ports;
}

test("native execution state roundtrips exact bigint allocation and binds external terms and policy", () => {
  const value = state(), hash = value.preflight.approvedTermsHash;
  assert.deepEqual(decodeNativeState(encodeNativeState(value), hash), value);
  assert.equal(value.preflight.prepared.value, 2_000_000_000_000_000n);
  assert.equal(value.preflight.prepared.data, "0x");
  assert.equal(value.role, "treasury");
  assert.throws(() => decodeNativeState(encodeNativeState(value), `0x${"ab".repeat(32)}`));
  assert.throws(() => decodeNativeState(encodeNativeState(value), hash, {
    ...DEFAULT_NATIVE_DELIVERY_POLICY, operatingReserveWei: DEFAULT_NATIVE_DELIVERY_POLICY.operatingReserveWei + 1n,
  }));
});

test("native state codec rejects role, digest, value, bytes, timestamp and marker substitutions", () => {
  const value = state(), hash = value.preflight.approvedTermsHash;
  for (const changed of [
    { ...value, kind: "erc20-execution" }, { ...value, role: "investor" }, { ...value, status: "unknown" },
    { ...value, createdAt: "2026-02-30T00:00:00.000Z" }, { ...value, force: true },
    { ...value, nearTransactionHash: NEAR_HASH }, { ...value, signed: recordedErc20Signed() },
    { ...value, preflight: { ...value.preflight, prepared: { ...value.preflight.prepared, value: 1n } } },
    { ...value, preflight: { ...value.preflight, prepared: { ...value.preflight.prepared, unsignedSerialized: "0x02" } } },
    { ...value, preflight: { ...value.preflight, prepared: { ...value.preflight.prepared, nonce: 2 } } },
  ]) assert.throws(() => decodeNativeState(encodeNativeState(changed), hash));
  assert.throws(() => decodeNativeState('{"bad":{"$bigint":"1e18"}}', hash));
  assert.throws(() => decodeNativeState(" ".repeat(2_000_001), hash));
  assert.throws(() => decodeNativeState(encodeNativeState({ ...value, status: "near-uncertain", nearTransactionHash: "invalid" }), hash));
});

test("native inspection omits executable serialization and preserves original value and digest", () => {
  const value = state(), summary = publicNativeExecutionSummary(value) as { parameters: Record<string, unknown> };
  assert.equal(summary.parameters.value, value.preflight.prepared.value);
  assert.equal(summary.parameters.unsignedHash, value.preflight.prepared.unsignedHash);
  assert.equal("unsignedSerialized" in summary.parameters, false);
  assert.equal("serialized" in summary, false);
  assert.equal("nearOutcome" in summary, false);
});

test("native signing requires exact unsigned approval and explicit Treasury role before any capability", async () => {
  const value = state(), input = approval(value);
  await assert.rejects(requestNativeSignature(value, { ...input, approval: "wrong" }, deniedPorts()), /signing approval/);
  await assert.rejects(requestNativeSignature(value, { ...input, role: "investor" as "treasury" }, deniedPorts()), /Explicit Treasury/);
  await assert.rejects(requestNativeSignature(value, { ...input, expectedTermsHash: `0x${"ab".repeat(32)}` }, deniedPorts()));
  await assert.rejects(broadcastNativeTransfer(value, input, deniedPorts()), /Only a verified/);
});

test("expired native preparations stop without opening credentials or resetting timestamps", async () => {
  const value = state(); value.createdAt = "2020-01-01T00:00:00.000Z";
  const before = encodeNativeState(value);
  await assert.rejects(requestNativeSignature(value, approval(value), deniedPorts()), /expired/);
  assert.equal(encodeNativeState(value), before);
});

test("fresh native nonce, funding, gas, fee and RPC failures stop before preparing a signature", async () => {
  for (const observed of [
    { confirmedNonce: 2, pendingNonce: 2 }, { treasuryBalanceWei: 1n }, { estimatedGas: 21_001n },
    { baseFeePerGas: 4001n }, { simulationResult: "0x01" }, { senderCode: "0x6000" },
  ]) {
    const value = state(), ports = deniedPorts(), before = encodeNativeState(value);
    ports.evm = nativeObservationRpc(observed).rpc;
    await assert.rejects(requestNativeSignature(value, approval(value), ports));
    assert.equal(encodeNativeState(value), before);
  }
  const value = state(), ports = deniedPorts(); ports.evm = nativeObservationRpc({}, "eth_estimateGas").rpc;
  await assert.rejects(requestNativeSignature(value, approval(value), ports), /eth_estimateGas/);
});

test("native NEAR attempt marker and hash are saved before exactly one mocked submission", async () => {
  const value = state(), events: string[] = [], ports = mockPorts(value, events);
  await requestNativeSignature(value, approval(value), ports);
  assert.deepEqual(events, ["near-submitting", "mock-near-send", "near-submitted"]);
  assert.equal(value.nearTransactionHash, NEAR_HASH);
  assert.equal(value.status, "near-submitted");
  assert.equal(value.signed, undefined);
  await assert.rejects(requestNativeSignature(value, approval(value), ports), /already attempted/);
  assert.equal(events.filter(entry => entry === "mock-near-send").length, 1);
});

test("native NEAR timeout preserves uncertain outcome and blocks any automatic second submission", async () => {
  const value = state(), events: string[] = [], ports = mockPorts(value, events, "timeout"), input = approval(value);
  await requestNativeSignature(value, input, ports);
  assert.deepEqual(events, ["near-submitting", "mock-near-send", "near-uncertain"]);
  assert.equal(value.status, "near-uncertain"); assert.match(value.recovery!, /no automatic/);
  await assert.rejects(requestNativeSignature(value, input, ports), /already attempted/);
  assert.equal(events.filter(entry => entry === "mock-near-send").length, 1);
});

test("native durable marker failure prevents submission and retains attempted state", async () => {
  const value = state(), events: string[] = [], ports = mockPorts(value, events);
  ports.save = async () => { throw new Error("offline fsync failure"); };
  await assert.rejects(requestNativeSignature(value, approval(value), ports), /fsync failure/);
  assert.equal(value.status, "near-submitting"); assert.equal(value.nearTransactionHash, NEAR_HASH);
  assert.deepEqual(events, []);
  await assert.rejects(requestNativeSignature(value, approval(value), ports), /already attempted/);
});

test("post-submission native save failure cannot erase the durable attempt or cause a retry", async () => {
  const value = state(), events: string[] = [], ports = mockPorts(value, events); let saves = 0;
  ports.save = async next => { events.push(next.status); if (++saves === 2) throw new Error("offline post-send save failure"); };
  await assert.rejects(requestNativeSignature(value, approval(value), ports), /post-send/);
  assert.deepEqual(events, ["near-submitting", "mock-near-send", "near-submitted"]);
  assert.equal(value.status, "near-submitted"); assert.equal(value.nearTransactionHash, NEAR_HASH);
  await assert.rejects(requestNativeSignature(value, approval(value), ports), /already attempted/);
});

test("native preparation expiry during local signing preparation stops before marker and submission", async () => {
  const value = state(), events: string[] = [], ports = mockPorts(value, events), prepare = ports.prepareSigning;
  const realNow = Date.now;
  ports.prepareSigning = async (...args) => { const packet = await prepare(...args); Date.now = () => Date.parse(value.createdAt) + 900_001; return packet; };
  try { await assert.rejects(requestNativeSignature(value, approval(value), ports), /expired/); }
  finally { Date.now = realNow; }
  assert.equal(value.status, "prepared"); assert.equal(value.nearTransactionHash, undefined); assert.deepEqual(events, []);
});

test("native expiry after saving the submission marker never sends and preserves reconciliation state", async () => {
  const value = state(), events: string[] = [], ports = mockPorts(value, events), realNow = Date.now;
  ports.save = async next => { events.push(next.status); if (next.status === "near-submitting") Date.now = () => Date.parse(value.createdAt) + 900_001; };
  try { await requestNativeSignature(value, approval(value), ports); }
  finally { Date.now = realNow; }
  assert.deepEqual(events, ["near-submitting", "near-uncertain"]);
  assert.equal(value.nearTransactionHash, NEAR_HASH); assert.equal(value.status, "near-uncertain");
});

test("native signing packet substitutions cannot persist an attempt or invoke the mock send", async () => {
  const value = state(), events: string[] = [], ports = mockPorts(value, events), prepare = ports.prepareSigning;
  ports.prepareSigning = async (...args) => ({ ...await prepare(...args), signerAccountId: VERIFIED_IDENTITIES.investor.accountId });
  await assert.rejects(requestNativeSignature(value, approval(value), ports), /signing packet/);
  assert.equal(value.status, "prepared"); assert.deepEqual(events, []);
});

test("public native reconciliation failures and nonfinal outcomes preserve state without submission ports", async () => {
  for (const kind of ["unavailable", "nonfinal", "failed", "erc20-proof"] as const) {
    const value = state(); value.status = "near-uncertain"; value.nearTransactionHash = RECORDED_NEAR_HASH;
    const before = encodeNativeState(value); let saves = 0;
    const ports = {
      verifyMpc: async () => ({}) as Awaited<ReturnType<NativeExecutionPorts["verifyMpc"]>>,
      readOutcome: async () => {
        if (kind === "unavailable") throw new Error("offline provider secret suppressed");
        if (kind === "nonfinal") return { final_execution_status: "EXECUTED" };
        if (kind === "failed") return { final_execution_status: "FINAL", status: { Failure: {} } };
        return recordedOutcome();
      },
      save: async () => { saves++; },
    };
    await assert.rejects(reconcileNativeSigning(value, { nearRpcUrl: "offline", expectedTermsHash: value.preflight.approvedTermsHash }, ports));
    assert.equal(encodeNativeState(value), before); assert.equal(saves, 0);
    assert.equal("prepareSigning" in ports, false); assert.equal("broadcast" in ports, false);
  }
});

test("native near-failed recovery requires its existing hash and cannot substitute an ERC-20 signature", async () => {
  const value = state(); value.status = "near-failed"; value.nearTransactionHash = RECORDED_NEAR_HASH;
  const before = encodeNativeState(value), ports = deniedPorts();
  ports.verifyMpc = async () => ({}) as Awaited<ReturnType<NativeExecutionPorts["verifyMpc"]>>;
  ports.readOutcome = async () => recordedOutcome();
  await assert.rejects(reconcileNativeSigning(value, { nearRpcUrl: "offline", expectedTermsHash: value.preflight.approvedTermsHash }, ports), /exact native digest/);
  assert.equal(encodeNativeState(value), before);
  delete value.nearTransactionHash;
  await assert.rejects(reconcileNativeSigning(value, { nearRpcUrl: "offline", expectedTermsHash: value.preflight.approvedTermsHash }, ports), /existing NEAR/);
});

test("authentic Treasury ERC-20 signature and hash cannot authorize native broadcast or reconciliation", async () => {
  const value = state(), signed = recordedErc20Signed();
  Object.assign(value, { status: "signed", nearTransactionHash: RECORDED_NEAR_HASH, nearOutcome: recordedOutcome(), signed });
  assert.throws(() => assertNativeExecutionState(value, value.preflight.approvedTermsHash));
  await assert.rejects(broadcastNativeTransfer(value, { ...approval(value), approval: signed.hash }, deniedPorts()));
  value.status = "evm-uncertain";
  await assert.rejects(reconcileNativeEvm(value, { expectedTermsHash: value.preflight.approvedTermsHash }, deniedPorts()));
});

test("native state persistence uses ignored runtime paths, shared durable writes and exclusive locks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wealthpixels-native-offline-"));
  try {
    const value = state(), hash = value.preflight.approvedTermsHash;
    const file = join(directory, ".local", "transfers", "native-fixture.json");
    await assert.rejects(saveNativeState(join(directory, "public.json"), value, hash, DEFAULT_NATIVE_DELIVERY_POLICY, directory), /inside .local/);
    await saveNativeState(file, value, hash, DEFAULT_NATIVE_DELIVERY_POLICY, directory);
    assert.deepEqual(await readNativeState(file, hash, DEFAULT_NATIVE_DELIVERY_POLICY, directory), value);
    assert.deepEqual(decodeNativeState(await readFile(file, "utf8"), hash), value);
    await withNativeStateLock(file, hash, DEFAULT_NATIVE_DELIVERY_POLICY, async (loaded, save) => {
      await assert.rejects(withNativeStateLock(file, hash, DEFAULT_NATIVE_DELIVERY_POLICY, async () => undefined, directory), /locked/);
      assert.equal(loaded.createdAt, value.createdAt); await save(loaded);
    }, directory);
    await withNativeStateLock(file, hash, DEFAULT_NATIVE_DELIVERY_POLICY, async loaded => assert.equal(loaded.status, "prepared"), directory);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "wealthpixels-native-offline-")), "Temporary cleanup must stay in the generated test directory.");
    await rm(directory, { recursive: true, force: true });
  }
});
