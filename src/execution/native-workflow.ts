import { readFile } from "node:fs/promises";
import { baseDecode } from "near-api-js";
import { assembleTreasuryNativeTransfer, type AssembledNativeTransfer } from "../evm/native-transfer.js";
import { authorizeEvmBroadcast, type EvmBroadcastTransport } from "../evm/broadcast.js";
import { assertNativeDelivery, recheckNativeDelivery, verifyNativeDeliveryReceipt,
  DEFAULT_NATIVE_DELIVERY_POLICY, type NativeDeliveryPolicy, type NativeDeliveryPreflight,
  type VerifiedNativeReceipt } from "../evm/sepolia-native.js";
import type { SepoliaReadRpc } from "../evm/sepolia-link.js";
import { normalizeMpcOutcome, type prepareMpcSigning, type verifyRoleMpc, type readMpcSigningOutcome } from "../near/signing.js";
import { VERIFIED_IDENTITIES } from "../near/identities.js";
import { assertNearSubmissionRecord, assertNearSubmissionSuccessor, type NearSubmissionRecord } from "../near/submission.js";
import { decodeEncodedState, encodeState, runtimeStatePath, saveEncodedState, withStateLock, type ExecutionStatus } from "./state.js";

export interface NativeExecutionState {
  schemaVersion: 1; kind: "native-eth-execution"; role: "treasury"; status: ExecutionStatus;
  preflight: NativeDeliveryPreflight; createdAt: string;
  nearTransactionHash?: string; nearOutcome?: unknown; signed?: AssembledNativeTransfer;
  nearSubmission?: NearSubmissionRecord;
  receipt?: VerifiedNativeReceipt; recovery?: string;
}
export interface NativeExecutionPorts {
  evm: SepoliaReadRpc;
  verifyMpc: typeof verifyRoleMpc;
  prepareSigning: typeof prepareMpcSigning;
  readOutcome: typeof readMpcSigningOutcome;
  broadcast: EvmBroadcastTransport;
  /** Must use the durable native state save wrapper in an exclusive state-file lock. */
  save(state: NativeExecutionState): Promise<void>;
}
export type NativeSigningPorts = Pick<NativeExecutionPorts, "evm" | "prepareSigning" | "save">;
/** Public-only reconciliation deliberately cannot prepare signatures or broadcast. */
export type NativeSigningReconciliationPorts = Pick<NativeExecutionPorts, "verifyMpc" | "readOutcome" | "save">;
export type NativeBroadcastPorts = Pick<NativeExecutionPorts, "evm" | "verifyMpc" | "broadcast" | "save">;
export type NativeEvmReconciliationPorts = Pick<NativeExecutionPorts, "evm" | "save">;
export interface NativeStateBinding {
  readonly expectedTermsHash: string;
  readonly expectedPolicy?: NativeDeliveryPolicy;
}
export interface NativeApproval extends NativeStateBinding {
  readonly role: "treasury"; readonly approval: string; readonly nearRpcUrl: string;
}
const STATUSES = new Set<ExecutionStatus>(["prepared", "near-submitting", "near-submitted", "near-uncertain", "near-failed",
  "signed", "evm-submitting", "evm-submitted", "evm-uncertain", "confirmed"]);
const SIGNED_STATUSES = new Set<ExecutionStatus>(["signed", "evm-submitting", "evm-submitted", "evm-uncertain", "confirmed"]);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function policy(binding: NativeStateBinding): NativeDeliveryPolicy { return binding.expectedPolicy ?? DEFAULT_NATIVE_DELIVERY_POLICY; }
function nearHash(value: unknown): string {
  try {
    check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32, "Invalid hash.");
    return value;
  } catch { throw new Error("A valid existing NEAR signing transaction hash is required."); }
}
function nonceQuantity(value: unknown): bigint {
  check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value),
    "Native nonce lookup returned an invalid public quantity; preserve state and reconcile.");
  const result = BigInt(value);
  check(result <= BigInt(Number.MAX_SAFE_INTEGER), "Native nonce is outside the supported range; preserve state and reconcile.");
  return result;
}
function exactSigned(actual: AssembledNativeTransfer | undefined, expected: AssembledNativeTransfer): void {
  check(actual && actual.hash === expected.hash && actual.serialized === expected.serialized && actual.senderAddress === expected.senderAddress,
    "Saved native signed bytes differ from the verified original digest and Treasury sender.");
}
function verifiedSignature(state: NativeExecutionState): AssembledNativeTransfer {
  const signature = normalizeMpcOutcome(state.nearOutcome, "treasury", nearHash(state.nearTransactionHash), state.preflight.prepared.unsignedHash);
  const signed = assembleTreasuryNativeTransfer(state.preflight.prepared, signature);
  exactSigned(state.signed, signed);
  return signed;
}
export function assertNativeExecutionState(value: NativeExecutionState, expectedTermsHash: string,
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): void {
  check(value && typeof value === "object" && !Array.isArray(value) && value.schemaVersion === 1 && value.kind === "native-eth-execution" &&
    value.role === "treasury" && STATUSES.has(value.status), "Unsupported native Treasury execution state.");
  const allowed = new Set(["schemaVersion", "kind", "role", "status", "preflight", "createdAt", "nearTransactionHash", "nearSubmission", "nearOutcome", "signed", "receipt", "recovery"]);
  check(Object.keys(value).every(key => allowed.has(key)), "Unexpected native execution state fields.");
  check(typeof value.createdAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt)) && new Date(value.createdAt).toISOString() === value.createdAt, "Invalid original native preparation timestamp.");
  check(value.recovery === undefined || (typeof value.recovery === "string" && value.recovery.length <= 2048), "Invalid native recovery note.");
  assertNativeDelivery(value.preflight, expectedTermsHash, expectedPolicy);
  if (value.status === "prepared") {
    check(value.nearTransactionHash === undefined && value.nearSubmission === undefined && value.nearOutcome === undefined && value.signed === undefined && value.receipt === undefined,
      "Prepared native state cannot contain a prior submission or signature.");
  } else nearHash(value.nearTransactionHash);
  if (value.nearSubmission !== undefined) assertNearSubmissionRecord(value.nearSubmission,
    { role: "treasury", transactionHash: nearHash(value.nearTransactionHash), digest: value.preflight.prepared.unsignedHash });
  if (SIGNED_STATUSES.has(value.status)) verifiedSignature(value);
  else check(value.signed === undefined && value.receipt === undefined, "An unsigned native state cannot contain signed execution evidence.");
  check(value.status !== "confirmed" || value.receipt !== undefined, "Confirmed native execution requires verified receipt evidence.");
}
function assertFresh(state: NativeExecutionState): void {
  const age = Date.now() - Date.parse(state.createdAt);
  check(Number.isFinite(age) && age >= -30_000 && age <= 15 * 60_000,
    "Native preparation expired. Preserve its original timestamp and reconcile; normal signing/broadcast cannot bypass expiry.");
}
function assertApproved(state: NativeExecutionState, input: NativeApproval, signed = false): void {
  check(input.role === "treasury", "Explicit Treasury role selection is required for native delivery.");
  assertNativeExecutionState(state, input.expectedTermsHash, policy(input));
  const hash = signed ? state.signed?.hash : state.preflight.prepared.unsignedHash;
  check(input.approval === hash, `Explicit native ${signed ? "broadcast" : "signing"} approval must match the exact ${signed ? "signed transaction hash" : "unsigned digest"}.`);
  assertFresh(state);
}
export function createNativeExecutionState(preflight: NativeDeliveryPreflight, expectedTermsHash: string,
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY, createdAt = new Date().toISOString()): NativeExecutionState {
  const state: NativeExecutionState = { schemaVersion: 1, kind: "native-eth-execution", role: "treasury", status: "prepared",
    preflight: structuredClone(preflight), createdAt };
  assertNativeExecutionState(state, expectedTermsHash, expectedPolicy);
  return state;
}
export function decodeNativeState(text: string, expectedTermsHash: string,
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): NativeExecutionState {
  const value = decodeEncodedState(text) as NativeExecutionState;
  assertNativeExecutionState(value, expectedTermsHash, expectedPolicy);
  return value;
}
export async function readNativeState(file: string, expectedTermsHash: string,
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY, root = process.cwd()): Promise<NativeExecutionState> {
  const safe = await runtimeStatePath(file, root);
  return decodeNativeState(await readFile(safe, "utf8"), expectedTermsHash, expectedPolicy);
}
export async function saveNativeState(file: string, state: NativeExecutionState, expectedTermsHash: string,
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY, root = process.cwd()): Promise<void> {
  assertNativeExecutionState(state, expectedTermsHash, expectedPolicy);
  await saveEncodedState(await runtimeStatePath(file, root, true), state);
}
/** Operator/coordinator boundary: the whole read/act/durable-save cycle holds the existing exclusive lock. */
export async function withNativeStateLock<T>(file: string, expectedTermsHash: string, expectedPolicy: NativeDeliveryPolicy,
  action: (state: NativeExecutionState, save: (state: NativeExecutionState) => Promise<void>) => Promise<T>, root = process.cwd()): Promise<T> {
  const safe = await runtimeStatePath(file, root);
  return withStateLock(safe, async () => {
    const state = await readNativeState(safe, expectedTermsHash, expectedPolicy, root);
    return action(state, next => saveNativeState(safe, next, expectedTermsHash, expectedPolicy, root));
  });
}
/** Only public parameters/hashes; omit executable unsigned/signed transaction bytes. */
export function publicNativeExecutionSummary(state: NativeExecutionState): unknown {
  const { unsignedSerialized: _unsigned, ...parameters } = state.preflight.prepared;
  return { kind: state.kind, role: state.role, status: state.status, createdAt: state.createdAt,
    termsHash: state.preflight.approvedTermsHash, parameters, policy: state.preflight.policy,
    nearTransactionHash: state.nearTransactionHash, nearSubmission: state.nearSubmission, evmTransactionHash: state.signed?.hash,
    recoveredSender: state.signed?.senderAddress, receipt: state.receipt, recovery: state.recovery };
}

export async function requestNativeSignature(state: NativeExecutionState,
  input: NativeApproval & { readonly credentialPath: string }, ports: NativeSigningPorts): Promise<void> {
  check(state.status === "prepared", "Native signing was already attempted; reconcile the existing NEAR hash without retrying.");
  assertApproved(state, input);
  await recheckNativeDelivery(state.preflight, ports.evm, input.expectedTermsHash, policy(input));
  assertApproved(state, input);
  const signing = await ports.prepareSigning({ role: "treasury", credentialPath: input.credentialPath,
    rpcUrl: input.nearRpcUrl, digest: state.preflight.prepared.unsignedHash,
    submissionDeadlineMs: Date.parse(state.createdAt) + 15 * 60_000 });
  assertApproved(state, input);
  nearHash(signing.transactionHash);
  check(signing.signerAccountId === VERIFIED_IDENTITIES.treasury.accountId && signing.receiverId === "v1.signer-prod.testnet" &&
    signing.request.payload_v2.Ecdsa === state.preflight.prepared.unsignedHash.slice(2) && signing.request.domain_id === 0 &&
    signing.request.path === "wealthpixels/sepolia/v1" && signing.gasTgas === 100 && signing.depositYocto === "1",
    "Prepared NEAR signing packet differs from the exact native digest or Treasury authority.");
  state.nearTransactionHash = signing.transactionHash;
  assertNearSubmissionRecord(signing.submission, { role: "treasury", transactionHash: signing.transactionHash, digest: state.preflight.prepared.unsignedHash });
  state.nearSubmission = structuredClone(signing.submission);
  state.status = "near-submitting";
  await ports.save(state); // Durable attempt marker always precedes the single mutation capability.
  try {
    assertNativeExecutionState(state, input.expectedTermsHash, policy(input)); assertFresh(state);
    await signing.broadcastOnce(async next => {
      assertNearSubmissionSuccessor(state.nearSubmission!, next);
      const candidate: NativeExecutionState = { ...structuredClone(state), nearSubmission: structuredClone(next) };
      await ports.save(candidate);
      state.nearSubmission = candidate.nearSubmission;
    });
    state.status = "near-submitted";
  } catch {
    state.status = "near-uncertain";
    state.recovery = "Reconcile the saved NEAR hash and access-key nonce; no automatic signing retry is allowed.";
  }
  await ports.save(state);
}

export async function reconcileNativeSigning(state: NativeExecutionState, input: NativeStateBinding & { readonly nearRpcUrl: string },
  ports: NativeSigningReconciliationPorts): Promise<void> {
  check(["near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed"].includes(state.status),
    "Native operation has no existing NEAR signing submission to reconcile.");
  assertNativeExecutionState(state, input.expectedTermsHash, policy(input));
  const hash = nearHash(state.nearTransactionHash);
  let outcome: unknown;
  try { await ports.verifyMpc("treasury", input.nearRpcUrl); outcome = await ports.readOutcome("treasury", hash, input.nearRpcUrl); }
  catch { throw new Error("Public native NEAR reconciliation reads failed; state was not changed and no submission was made."); }
  check(outcome && typeof outcome === "object" && "final_execution_status" in outcome && outcome.final_execution_status === "FINAL",
    "Native NEAR execution is not FINAL; preserve the state and reconcile later.");
  let signed: AssembledNativeTransfer;
  try {
    const signature = normalizeMpcOutcome(outcome, "treasury", hash, state.preflight.prepared.unsignedHash);
    signed = assembleTreasuryNativeTransfer(state.preflight.prepared, signature);
    if (state.status === "signed") { exactSigned(state.signed, signed); return; }
  } catch { throw new Error("Final MPC proof does not authorize the exact native digest and full Treasury public key; state was not changed."); }
  const candidate: NativeExecutionState = { ...structuredClone(state), status: "signed", signed, nearOutcome: structuredClone(outcome) };
  delete candidate.recovery;
  assertNativeExecutionState(candidate, input.expectedTermsHash, policy(input));
  try { await ports.save(candidate); }
  catch { throw new Error("Verified native MPC result could not be saved; original in-memory state was not changed."); }
  Object.assign(state, candidate); delete state.recovery;
}

export async function broadcastNativeTransfer(state: NativeExecutionState, input: NativeApproval, ports: NativeBroadcastPorts): Promise<void> {
  check(state.status === "signed", "Only a verified MPC-signed native operation may be broadcast; reconcile previous attempts first.");
  assertApproved(state, input, true);
  await ports.verifyMpc("treasury", input.nearRpcUrl);
  const checked = verifiedSignature(state);
  await recheckNativeDelivery(state.preflight, ports.evm, input.expectedTermsHash, policy(input));
  const [receipt, known] = await Promise.all([
    ports.evm.request("eth_getTransactionReceipt", [checked.hash]), ports.evm.request("eth_getTransactionByHash", [checked.hash]),
  ]);
  check(receipt === null && known === null, "Native signed hash is already known or lookup is uncertain; reconcile without broadcasting.");
  assertApproved(state, input, true);
  const sendOnce = authorizeEvmBroadcast(checked.serialized, checked.hash, input.approval, ports.broadcast);
  state.status = "evm-submitting";
  await ports.save(state);
  try {
    assertNativeExecutionState(state, input.expectedTermsHash, policy(input)); assertFresh(state);
    await sendOnce();
    state.status = "evm-submitted";
  } catch {
    state.status = "evm-uncertain";
    state.recovery = "Reconcile the signed native hash and confirmed/pending nonce; no signing, replacement or broadcast retry is automatic.";
  }
  await ports.save(state);
}

export async function reconcileNativeEvm(state: NativeExecutionState, input: NativeStateBinding,
  ports: NativeEvmReconciliationPorts): Promise<void> {
  check(["evm-submitting", "evm-submitted", "evm-uncertain", "confirmed"].includes(state.status), "Native operation has no EVM submission to reconcile.");
  assertNativeExecutionState(state, input.expectedTermsHash, policy(input));
  const signed = verifiedSignature(state), chain = await ports.evm.request("eth_chainId", []);
  check(typeof chain === "string" && /^0x[0-9a-f]+$/i.test(chain) && BigInt(chain) === 11155111n, "Native reconciliation requires Ethereum Sepolia.");
  const receipt = await ports.evm.request("eth_getTransactionReceipt", [signed.hash]);
  if (receipt === null) {
    const [transaction, confirmed, pending] = await Promise.all([
      ports.evm.request("eth_getTransactionByHash", [signed.hash]),
      ports.evm.request("eth_getTransactionCount", [state.preflight.prepared.senderAddress, "latest"]),
      ports.evm.request("eth_getTransactionCount", [state.preflight.prepared.senderAddress, "pending"]),
    ]);
    check(transaction === null || (typeof transaction === "object" && "hash" in transaction && transaction.hash === signed.hash),
      "Native transaction lookup is uncertain; preserve state without resubmitting.");
    const confirmedNonce = nonceQuantity(confirmed), pendingNonce = nonceQuantity(pending);
    check(pendingNonce >= confirmedNonce, "Native nonce observations conflict; preserve state and reconcile.");
    const note = `No native receipt. Known transaction: ${transaction ? "yes" : "no"}; confirmed nonce ${confirmedNonce}, pending nonce ${pendingNonce}, approved nonce ${state.preflight.prepared.nonce}. Reconcile; no automatic retry.`;
    const candidate = { ...structuredClone(state), recovery: note };
    await ports.save(candidate); Object.assign(state, candidate); return;
  }
  check(receipt && typeof receipt === "object", "Native receipt lookup is uncertain; preserve state without resubmitting.");
  const verified = await verifyNativeDeliveryReceipt(state.preflight, signed, ports.evm, input.expectedTermsHash, policy(input));
  const candidate: NativeExecutionState = { ...structuredClone(state), status: "confirmed", receipt: verified };
  delete candidate.recovery;
  await ports.save(candidate); Object.assign(state, candidate); delete state.recovery;
}

// Keep the shared encoding contract visible to native-only integration callers.
export { encodeState as encodeNativeState };
