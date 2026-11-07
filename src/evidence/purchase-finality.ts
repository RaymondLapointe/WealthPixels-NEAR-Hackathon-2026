import { createHash } from "node:crypto";
import type { SepoliaReadMethod, SepoliaReadRpc } from "../evm/sepolia-link.js";
import { frozen } from "../purchase/integrity.js";

export interface BeaconReadTransport { get(path: string): Promise<unknown> }
export interface HistoricalFinalityInput {
  readonly paymentBlockNumber: bigint; readonly paymentBlockHash: string;
  readonly linkBlockNumber: bigint; readonly linkBlockHash: string;
}
export interface HistoricalFinalityProof extends HistoricalFinalityInput {
  readonly kind: "historical-payment-finality"; readonly chainId: 11155111n;
  readonly trustModel: "public-execution-and-beacon-rpc";
  readonly consensusProofVerified: false; readonly parentHeaderRootVerified: true;
  readonly linkTimestamp: bigint; readonly parentBeaconBlockRoot: string; readonly parentBeaconSlot: bigint;
  readonly parentBeaconStateRoot: string; readonly checkpointRoot: string; readonly checkpointEpoch: bigint;
  readonly checkpointSlot: bigint; readonly checkpointFork: string;
  readonly finalizedThroughExecutionBlockNumber: bigint; readonly finalizedThroughExecutionBlockHash: string;
  readonly checkpointExecutionPayloadBlockNumber: bigint; readonly checkpointExecutionPayloadBlockHash: string;
  readonly finalityBoundary: "checkpoint-payload" | "gloas-checkpoint-execution-parent";
  readonly limitation: string;
}
export class HistoricalFinalityError extends Error {
  constructor(readonly code: "RPC_UNAVAILABLE" | "INVALID_FINALITY" | "NOT_FINALIZED_BEFORE_DELIVERY", message: string) {
    super(message); this.name = "HistoricalFinalityError";
  }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new HistoricalFinalityError("INVALID_FINALITY", message); }
function record(value: unknown): Record<string, any> { check(value && typeof value === "object" && !Array.isArray(value), "Missing historical finality response object."); return value as Record<string, any>; }
function root(value: unknown, allowZero = false): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) && (allowZero || BigInt(value) !== 0n), "Invalid historical execution/beacon root.");
  return value.toLowerCase();
}
function decimal(value: unknown): bigint {
  check(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), "Invalid Beacon uint64 decimal.");
  const n = BigInt(value); check(n < 1n << 64n, "Beacon integer exceeds uint64."); return n;
}
function quantity(value: unknown): bigint { check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid execution-layer public quantity."); return BigInt(value); }
function tag(value: bigint): string { check(typeof value === "bigint" && value > 0n && value < 1n << 64n, "Expected a positive execution block number."); return "0x" + value.toString(16); }
function bytes(value: string): Buffer { return Buffer.from(value.slice(2), "hex"); }
function uint64Chunk(value: unknown): Buffer { const output = Buffer.alloc(32); output.writeBigUInt64LE(decimal(value)); return output; }
/** SSZ BeaconBlockHeader is the five fixed Phase0 fields, padded to eight SHA256 leaves.
 * This verifies header/root linkage only, not its BLS signature or the BeaconState contents.
 */
export function beaconHeaderRoot(value: unknown): string {
  const h = record(value);
  check(Object.keys(h).sort().join() === "body_root,parent_root,proposer_index,slot,state_root", "Unsupported BeaconBlockHeader fields.");
  let leaves = [uint64Chunk(h.slot), uint64Chunk(h.proposer_index), bytes(root(h.parent_root, true)), bytes(root(h.state_root)), bytes(root(h.body_root)), Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)];
  while (leaves.length > 1) {
    const next: Buffer[] = [];
    for (let index = 0; index < leaves.length; index += 2) next.push(createHash("sha256").update(Buffer.concat([leaves[index]!, leaves[index + 1]!])).digest());
    leaves = next;
  }
  return "0x" + leaves[0]!.toString("hex");
}
function metadata(raw: unknown): Record<string, any> {
  const value = record(raw);
  check(value.execution_optimistic === false && typeof value.finalized === "boolean", "Beacon history must have validated execution and explicit finality metadata.");
  return value;
}
function header(raw: unknown, expectedRoot: string, finalizedRequired = false) {
  const response = metadata(raw), data = record(response.data), signed = record(data.header), message = record(signed.message);
  check(data.canonical === true && root(data.root) === expectedRoot && beaconHeaderRoot(message) === expectedRoot &&
    typeof signed.signature === "string" && /^0x[0-9a-fA-F]{192}$/.test(signed.signature), "Beacon header is noncanonical or does not hash to the execution-anchored root.");
  if (finalizedRequired) check(response.finalized === true, "The historical finalized checkpoint header is not currently finalized.");
  return { message, slot: decimal(message.slot), stateRoot: root(message.state_root) };
}
async function observed<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof HistoricalFinalityError) throw error;
    throw new HistoricalFinalityError("RPC_UNAVAILABLE", `Historical finality read unavailable (${stage}); no retry attempted; raw provider details suppressed.`);
  }
}
const PATHS = [
  /^\/eth\/v1\/beacon\/headers\/0x[0-9a-f]{64}$/,
  /^\/eth\/v1\/beacon\/states\/0x[0-9a-f]{64}\/finality_checkpoints$/,
  /^\/eth\/v2\/beacon\/blocks\/0x[0-9a-f]{64}$/,
  /^\/eth\/v1\/beacon\/execution_payload_envelopes\/0x[0-9a-f]{64}$/,
];
/** Ethereum consensus-layer GETs only. This adds no blockchain, credentials or transaction capability. */
export function createReadOnlyBeaconTransport(options: { readonly beaconUrl?: string; readonly pacingMs?: number } = {}): BeaconReadTransport {
  let endpoint: URL;
  try {
    endpoint = new URL(options.beaconUrl ?? "https://ethereum-sepolia-beacon-api.publicnode.com");
    check(endpoint.protocol === "https:" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && endpoint.pathname === "/", "Unsafe Beacon endpoint.");
  } catch { throw new HistoricalFinalityError("INVALID_FINALITY", "Use a public HTTPS Beacon origin without credentials, query strings, fragments or a path."); }
  const pacingMs = options.pacingMs ?? 200;
  check(Number.isSafeInteger(pacingMs) && pacingMs >= 0 && pacingMs <= 2000, "Beacon read pacing must be between zero and 2000 milliseconds.");
  let queue = Promise.resolve(), lastStarted = 0;
  return Object.freeze({ get(path: string): Promise<unknown> {
    check(typeof path === "string" && PATHS.some(pattern => pattern.test(path)), "Beacon path is outside the historical-finality GET allowlist.");
    const operation = queue.then(async () => {
      const wait = Math.max(0, lastStarted + pacingMs - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastStarted = Date.now();
      return observed("Beacon GET", async () => {
        const response = await fetch(endpoint.origin + path, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new HistoricalFinalityError("RPC_UNAVAILABLE", `Historical Beacon GET unavailable (HTTP ${response.status}); archival state/block/envelope support is required; no retry attempted.`);
        const text = await response.text();
        if (text.length > 10_000_000) throw new HistoricalFinalityError("RPC_UNAVAILABLE", "Beacon history response exceeds the supported public JSON size.");
        try { return JSON.parse(text) as unknown; }
        catch { throw new HistoricalFinalityError("RPC_UNAVAILABLE", "Historical Beacon GET returned unsupported JSON; no retry attempted."); }
      });
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } });
}
/** Historical finality is read at the exact parent state committed by the LINK block.
 * Standard Beacon JSON is RPC-trusted: no SSZ state/body Merkle proof or BLS light client is claimed.
 * A current finalized tag, a local timestamp, or a stored boolean is never a substitute.
 */
export async function verifyHistoricalPaymentFinality(input: HistoricalFinalityInput,
  ports: { readonly evm: SepoliaReadRpc; readonly beacon: BeaconReadTransport }): Promise<HistoricalFinalityProof> {
  const paymentTag = tag(input.paymentBlockNumber), linkTag = tag(input.linkBlockNumber), paymentHash = root(input.paymentBlockHash), linkHash = root(input.linkBlockHash);
  check(input.paymentBlockNumber < input.linkBlockNumber, "USDC payment must precede Treasury LINK delivery.");
  const read = (method: SepoliaReadMethod, params: readonly unknown[]) => observed(method, () => ports.evm.request(method, params));
  const get = (path: string) => observed(path.includes("finality_checkpoints") ? "historical state finality" : "historical beacon block/header", () => ports.beacon.get(path));
  check(quantity(await read("eth_chainId", [])) === 11155111n, "Historical finality requires Ethereum Sepolia.");
  const payment = record(await read("eth_getBlockByNumber", [paymentTag, false])), link = record(await read("eth_getBlockByNumber", [linkTag, false]));
  check(quantity(payment.number) === input.paymentBlockNumber && root(payment.hash) === paymentHash && quantity(link.number) === input.linkBlockNumber && root(link.hash) === linkHash,
    "Payment or LINK receipt block is no longer canonical.");
  const paymentTimestamp = quantity(payment.timestamp), linkTimestamp = quantity(link.timestamp);
  check(paymentTimestamp < linkTimestamp, "Canonical payment/LINK block timestamps are inconsistent.");
  const parentBeaconBlockRoot = root(link.parentBeaconBlockRoot);
  const parent = header(await get(`/eth/v1/beacon/headers/${parentBeaconBlockRoot}`), parentBeaconBlockRoot);
  const finality = metadata(await get(`/eth/v1/beacon/states/${parent.stateRoot}/finality_checkpoints`)), checkpoint = record(record(finality.data).finalized);
  const checkpointRoot = root(checkpoint.root), checkpointEpoch = decimal(checkpoint.epoch);
  check(checkpointEpoch > 0n && checkpointEpoch * 32n <= parent.slot, "Historical checkpoint epoch is zero or later than its anchored Beacon state.");
  const checkpointHeader = header(await get(`/eth/v1/beacon/headers/${checkpointRoot}`), checkpointRoot, true);
  check(checkpointHeader.slot <= checkpointEpoch * 32n && checkpointHeader.slot <= parent.slot, "Checkpoint header slot is inconsistent with its historical epoch or parent state.");
  const checkpointBlock = metadata(await get(`/eth/v2/beacon/blocks/${checkpointRoot}`));
  check(checkpointBlock.finalized === true && typeof checkpointBlock.version === "string", "Checkpoint block must be execution-validated and finalized.");
  const message = record(record(checkpointBlock.data).message), body = record(message.body);
  check(decimal(message.slot) === checkpointHeader.slot && message.proposer_index === checkpointHeader.message.proposer_index &&
    root(message.parent_root, true) === root(checkpointHeader.message.parent_root, true) && root(message.state_root) === checkpointHeader.stateRoot,
    "Checkpoint block does not match its authenticated header fields.");
  let payload: Record<string, any>, finalityBoundary: HistoricalFinalityProof["finalityBoundary"] = "checkpoint-payload";
  if (checkpointBlock.version === "gloas") {
    const envelope = metadata(await get(`/eth/v1/beacon/execution_payload_envelopes/${checkpointRoot}`));
    check(envelope.finalized === true && envelope.version === "gloas", "Gloas checkpoint envelope must be execution-validated and finalized.");
    const envelopeMessage = record(record(envelope.data).message); payload = record(envelopeMessage.payload);
    const bid = record(record(body.signed_execution_payload_bid).message);
    check(root(envelopeMessage.beacon_block_root) === checkpointRoot && root(envelopeMessage.parent_beacon_block_root, true) === root(message.parent_root, true) &&
      root(bid.block_hash) === root(payload.block_hash) && root(bid.parent_block_hash) === root(payload.parent_hash) && decimal(bid.slot) === checkpointHeader.slot,
      "Gloas envelope, signed payload bid and checkpoint identity disagree.");
    // Gloas applies a parent's FULL payload in its child state. Conservatively count
    // only this canonical execution parent, never assume the checkpoint's own asynchronous payload was already finalized at LINK release.
    finalityBoundary = "gloas-checkpoint-execution-parent";
  } else {
    if (!["bellatrix", "capella", "deneb", "electra", "fulu"].includes(checkpointBlock.version)) throw new HistoricalFinalityError("RPC_UNAVAILABLE", "Historical checkpoint fork/payload schema is unsupported; no finality shortcut is available.");
    payload = record(body.execution_payload);
  }
  const payloadNumber = decimal(payload.block_number), payloadHash = root(payload.block_hash), payloadTimestamp = decimal(payload.timestamp);
  check(payloadNumber > 0n && payloadNumber < input.linkBlockNumber && payloadTimestamp < linkTimestamp, "Checkpoint execution payload is not earlier than LINK delivery.");
  const canonicalPayload = record(await read("eth_getBlockByNumber", [tag(payloadNumber), false]));
  check(quantity(canonicalPayload.number) === payloadNumber && root(canonicalPayload.hash) === payloadHash && quantity(canonicalPayload.timestamp) === payloadTimestamp,
    "Checkpoint execution payload is not canonical on the configured Sepolia chain.");
  let finalizedThroughExecutionBlockNumber = payloadNumber, finalizedThroughExecutionBlockHash = payloadHash, boundaryTimestamp = payloadTimestamp;
  if (finalityBoundary === "gloas-checkpoint-execution-parent") {
    finalizedThroughExecutionBlockNumber = payloadNumber - 1n; finalizedThroughExecutionBlockHash = root(payload.parent_hash);
    const executionParent = record(await read("eth_getBlockByNumber", [tag(finalizedThroughExecutionBlockNumber), false]));
    boundaryTimestamp = quantity(executionParent.timestamp);
    check(quantity(executionParent.number) === finalizedThroughExecutionBlockNumber && root(executionParent.hash) === finalizedThroughExecutionBlockHash &&
      root(canonicalPayload.parentHash) === finalizedThroughExecutionBlockHash && boundaryTimestamp < payloadTimestamp,
      "Gloas checkpoint execution parent is not the canonical applied payload.");
  }
  if (finalizedThroughExecutionBlockNumber < input.paymentBlockNumber) throw new HistoricalFinalityError("NOT_FINALIZED_BEFORE_DELIVERY", "USDC payment was not covered by the historical finalized execution boundary before LINK delivery.");
  check(paymentTimestamp <= boundaryTimestamp, "Historical finalized execution boundary predates the payment timestamp.");
  const currentPayment = record(await read("eth_getBlockByNumber", [paymentTag, false])), currentLink = record(await read("eth_getBlockByNumber", [linkTag, false]));
  check(root(currentPayment.hash) === paymentHash && quantity(currentPayment.number) === input.paymentBlockNumber && root(currentLink.hash) === linkHash &&
    quantity(currentLink.number) === input.linkBlockNumber && root(currentLink.parentBeaconBlockRoot) === parentBeaconBlockRoot, "Payment or LINK canonical execution anchor changed during finality verification.");
  return frozen({ ...input, paymentBlockHash: paymentHash, linkBlockHash: linkHash, kind: "historical-payment-finality", chainId: 11155111n,
    trustModel: "public-execution-and-beacon-rpc", consensusProofVerified: false, parentHeaderRootVerified: true, linkTimestamp,
    parentBeaconBlockRoot, parentBeaconSlot: parent.slot, parentBeaconStateRoot: parent.stateRoot, checkpointRoot, checkpointEpoch,
    checkpointSlot: checkpointHeader.slot, checkpointFork: checkpointBlock.version, finalizedThroughExecutionBlockNumber, finalizedThroughExecutionBlockHash,
    checkpointExecutionPayloadBlockNumber: payloadNumber, checkpointExecutionPayloadBlockHash: payloadHash, finalityBoundary,
    limitation: "Execution and Beacon archival RPC responses are trusted. Header SSZ hashes are checked; BeaconState/body Merkle proofs and BLS consensus signatures are not verified. This verifies historical parent-state finality, never a current-finalized-tag substitute." });
}
