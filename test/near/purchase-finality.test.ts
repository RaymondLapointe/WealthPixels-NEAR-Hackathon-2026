import assert from "node:assert/strict";
import test from "node:test";
import { beaconHeaderRoot, createReadOnlyBeaconTransport, HistoricalFinalityError, verifyHistoricalPaymentFinality,
  type BeaconReadTransport, type HistoricalFinalityInput } from "../../src/evidence/purchase-finality.js";
import type { SepoliaReadRpc } from "../../src/evm/sepolia-link.js";

// Public Beacon header observations, fetched on 2026-11-07 from publicnode.
// These are header-hash regression values, not evidence of a WealthPixels purchase.
const PARENT_ROOT = "0xf264b4ea89e66749ff954288aa9f30a91e7e11c2eeffd6ea70d00f4b4a158028";
const CHECKPOINT_ROOT = "0x3087199b0afc7615d48fece43d0f7ac746967e34f52a3d01dd07be3682fc36a2";
const PARENT_MESSAGE = { slot: "11526916", proposer_index: "1509", parent_root: "0x1c308b270025b81978df7e7506a280f84a002d614b3ece666c240fef99236d9a",
  state_root: "0xde746a90219736798c898124f1288cf4f82dde727a67811d4c8900af0a8c5987", body_root: "0x01d69e92fc390e947aa45b065a0ecea435b7cb0e461593d25dd1e22ac748f45c" };
const CHECKPOINT_MESSAGE = { slot: "11526848", proposer_index: "1143", parent_root: "0xd34d12004bccf2ca6d326332f6c93cce3caf29750cfe9e9a7abd646ca4960f7f",
  state_root: "0x42be56d4a7f5dd79b0692f4ddd9e8c02853a9d1cefa763a60ed4cf3493825c23", body_root: "0x5d15b5817809267ee380a61704d6e9c9bbcb4b0c43460882aa2dbfd9f2e37da1" };
const hash = (byte: string) => "0x" + byte.repeat(32);
const INPUT: HistoricalFinalityInput = { paymentBlockNumber: 100n, paymentBlockHash: hash("11"), linkBlockNumber: 120n, linkBlockHash: hash("22") };
interface FixtureOptions {
  fork?: string; badHeader?: boolean; zeroCheckpoint?: boolean; futureEpoch?: boolean; optimistic?: boolean; noncanonicalHeader?: boolean;
  badEnvelope?: boolean; badBid?: boolean; wrongNetwork?: boolean; wrongPaymentHash?: boolean; reorg?: boolean; unavailable?: boolean;
  badPayloadHash?: boolean; badTimestamp?: boolean;
}
function fixture(options: FixtureOptions = {}, input = INPUT) {
  const calls: { chain: string; method: string; params?: readonly unknown[] }[] = [], blockReads = new Map<string, number>();
  const payload = { block_number: "111", block_hash: hash("44"), parent_hash: hash("33"), timestamp: "1200" };
  const checkpointBlock = { version: options.fork ?? "gloas", execution_optimistic: false, finalized: true,
    data: { message: { ...CHECKPOINT_MESSAGE, body: options.fork && options.fork !== "gloas" ? { execution_payload: payload } :
      { signed_execution_payload_bid: { message: { slot: CHECKPOINT_MESSAGE.slot, block_hash: options.badBid ? hash("55") : payload.block_hash, parent_block_hash: payload.parent_hash } } } } } };
  // Synthetic execution blocks below intentionally do not represent live transactions.
  const evm: SepoliaReadRpc = { async request(method, params) {
    calls.push({ chain: "evm", method, params });
    if (method === "eth_chainId") return options.wrongNetwork ? "0x1" : "0xaa36a7";
    if (method !== "eth_getBlockByNumber") throw new Error("Unexpected/mutating fixture method");
    const tag = params[0] as string, count = (blockReads.get(tag) ?? 0) + 1; blockReads.set(tag, count);
    if (tag === "0x6f") return { number: tag, hash: options.badPayloadHash ? hash("55") : payload.block_hash, parentHash: payload.parent_hash, timestamp: options.badTimestamp ? "0x515" : "0x4b0" };
    if (tag === "0x" + input.paymentBlockNumber.toString(16)) return { number: tag, hash: options.wrongPaymentHash || options.reorg && count > 1 ? hash("55") : input.paymentBlockHash, timestamp: "0x3e8" };
    if (tag === "0x78") return { number: tag, hash: input.linkBlockHash, timestamp: "0x514", parentBeaconBlockRoot: PARENT_ROOT };
    if (tag === "0x6e") return { number: tag, hash: payload.parent_hash, timestamp: "0x4a6" };
    throw new Error("Unexpected synthetic execution block");
  } };
  const beacon: BeaconReadTransport = { async get(path) {
    calls.push({ chain: "beacon", method: path });
    if (options.unavailable && path.includes("finality_checkpoints")) throw new Error("https://private.invalid/do-not-leak");
    if (path.includes("/headers/")) {
      const parent = path.endsWith(PARENT_ROOT), message = parent ? PARENT_MESSAGE : CHECKPOINT_MESSAGE;
      return { execution_optimistic: options.optimistic ?? false, finalized: !parent,
        data: { root: parent ? PARENT_ROOT : CHECKPOINT_ROOT, canonical: !options.noncanonicalHeader,
          header: { message: options.badHeader && parent ? { ...message, proposer_index: "1510" } : message, signature: "0x" + "11".repeat(96) } } };
    }
    if (path.includes("finality_checkpoints")) {
      assert.equal(path, `/eth/v1/beacon/states/${PARENT_MESSAGE.state_root}/finality_checkpoints`);
      return { execution_optimistic: false, finalized: false, data: { finalized: {
        epoch: options.futureEpoch ? "9999999" : "360214", root: options.zeroCheckpoint ? hash("00") : CHECKPOINT_ROOT } } };
    }
    if (path.includes("/blocks/")) return checkpointBlock;
    if (path.includes("/execution_payload_envelopes/")) return { version: "gloas", execution_optimistic: false, finalized: true, data: { message: {
      beacon_block_root: options.badEnvelope ? hash("55") : CHECKPOINT_ROOT, parent_beacon_block_root: CHECKPOINT_MESSAGE.parent_root, payload } } };
    throw new Error("Unexpected synthetic Beacon request");
  } };
  return { evm, beacon, calls };
}
test("SSZ header hashing matches independently observed public Beacon block roots", () => {
  assert.equal(beaconHeaderRoot(PARENT_MESSAGE), PARENT_ROOT);
  assert.equal(beaconHeaderRoot(CHECKPOINT_MESSAGE), CHECKPOINT_ROOT);
  assert.throws(() => beaconHeaderRoot({ ...PARENT_MESSAGE, slot: "18446744073709551616" }), /uint64/);
});
test("historical Gloas finality uses the exact anchored parent state and conservative applied execution parent", async () => {
  const ports = fixture(), result = await verifyHistoricalPaymentFinality(INPUT, ports);
  assert.equal(result.kind, "historical-payment-finality"); assert.equal(result.parentHeaderRootVerified, true);
  assert.equal(result.trustModel, "public-execution-and-beacon-rpc"); assert.equal(result.consensusProofVerified, false);
  assert.equal(result.parentBeaconBlockRoot, PARENT_ROOT); assert.equal(result.parentBeaconStateRoot, PARENT_MESSAGE.state_root);
  assert.equal(result.checkpointRoot, CHECKPOINT_ROOT); assert.equal(result.checkpointEpoch, 360214n);
  assert.equal(result.checkpointExecutionPayloadBlockNumber, 111n); assert.equal(result.finalizedThroughExecutionBlockNumber, 110n);
  assert.equal(result.finalityBoundary, "gloas-checkpoint-execution-parent");
  assert.match(result.limitation, /BLS consensus signatures are not verified/);
  assert.ok(ports.calls.every(call => call.chain === "beacon" || call.method === "eth_chainId" || call.method === "eth_getBlockByNumber"));
  assert.equal(ports.calls.some(call => call.params?.[0] === "finalized"), false);
});
test("pre-Gloas historical finality uses the checkpoint's embedded execution payload", async () => {
  const result = await verifyHistoricalPaymentFinality(INPUT, fixture({ fork: "deneb" }));
  assert.equal(result.finalizedThroughExecutionBlockNumber, 111n); assert.equal(result.finalityBoundary, "checkpoint-payload");
});
test("Gloas does not count the checkpoint's own asynchronous payload as already finalized", async () => {
  const input = { ...INPUT, paymentBlockNumber: 111n, paymentBlockHash: hash("44") };
  await assert.rejects(verifyHistoricalPaymentFinality(input, fixture({}, input)), error => error instanceof HistoricalFinalityError && error.code === "NOT_FINALIZED_BEFORE_DELIVERY");
});
for (const [name, options] of [
  ["wrong network", { wrongNetwork: true }], ["altered parent header", { badHeader: true }], ["zero checkpoint", { zeroCheckpoint: true }],
  ["future checkpoint epoch", { futureEpoch: true }], ["optimistic execution", { optimistic: true }], ["noncanonical beacon header", { noncanonicalHeader: true }],
  ["wrong envelope root", { badEnvelope: true }], ["mismatched signed bid", { badBid: true }], ["noncanonical payment", { wrongPaymentHash: true }],
  ["payment reorganization during verification", { reorg: true }], ["noncanonical checkpoint payload", { badPayloadHash: true }], ["inconsistent checkpoint timestamp", { badTimestamp: true }],
] as const) test(`historical finality rejects ${name}`, async () => {
  await assert.rejects(verifyHistoricalPaymentFinality(INPUT, fixture(options)), error => error instanceof HistoricalFinalityError && error.code === "INVALID_FINALITY");
});
test("missing historical state is unavailable, never replaced by a current finalized tag", async () => {
  const ports = fixture({ unavailable: true });
  await assert.rejects(verifyHistoricalPaymentFinality(INPUT, ports), error => error instanceof HistoricalFinalityError && error.code === "RPC_UNAVAILABLE" && !/private.invalid/.test(error.message));
  assert.equal(ports.calls.some(call => call.params?.[0] === "finalized"), false);
});
test("unsupported historical fork is unavailable and cannot acquire a misleading finality success", async () => {
  await assert.rejects(verifyHistoricalPaymentFinality(INPUT, fixture({ fork: "unknown-future-fork" })), error => error instanceof HistoricalFinalityError && error.code === "RPC_UNAVAILABLE");
});
test("Beacon transport permits only root-keyed historical GETs and never retries unavailable history", async () => {
  const transport = createReadOnlyBeaconTransport({ pacingMs: 0 });
  assert.throws(() => transport.get("/eth/v1/beacon/states/finalized/finality_checkpoints"), /allowlist/);
  assert.throws(() => transport.get("/eth/v1/validator/blocks/123"), /allowlist/);
  assert.throws(() => createReadOnlyBeaconTransport({ beaconUrl: "https://example.invalid/?api_key=secret" }), /public HTTPS/);
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(init?.method, "GET"); return new Response("unavailable", { status: 404 }); };
  try { await assert.rejects(transport.get(`/eth/v1/beacon/headers/${PARENT_ROOT}`), error => error instanceof HistoricalFinalityError && error.code === "RPC_UNAVAILABLE" && /HTTP 404/.test(error.message)); }
  finally { globalThis.fetch = original; }
  assert.equal(calls, 1);
});
