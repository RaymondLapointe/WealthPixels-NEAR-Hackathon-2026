import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Signature, Transaction } from "ethers";
import { baseDecode } from "near-api-js";
import { authorizeEvmBroadcast, type EvmBroadcastTransport } from "../evm/broadcast.js";
import { assembleTreasuryNativeTransfer, type AssembledNativeTransfer } from "../evm/native-transfer.js";
import { assertStandaloneNativePreflight, recheckStandaloneNative, type StandaloneNativePreflight } from "../evm/standalone-native.js";
import { verifyNativeTransferReceipt, type NativeDeliverySnapshot, type VerifiedNativeReceipt } from "../evm/sepolia-native.js";
import type { SepoliaReadRpc } from "../evm/sepolia-link.js";
import { normalizeMpcOutcome, type prepareMpcSigning, type readMpcSigningOutcome, type verifyRoleMpc } from "../near/signing.js";
import { assertNearSubmissionRecord, assertNearSubmissionSuccessor, type NearSubmissionRecord } from "../near/submission.js";
import { VERIFIED_IDENTITIES } from "../near/identities.js";
import { check, fingerprint, frozen, hexHash, label, utc } from "../purchase/integrity.js";
import { requireUint256 } from "../purchase/amounts.js";
import { normalizeEvmSignatureScalar } from "../evidence/verify.js";
import { decodeEncodedState, encodeState, runtimeStatePath, saveEncodedState, withStateLock, type ExecutionStatus } from "./state.js";

export type StandaloneNativeStatus = ExecutionStatus | "evm-failed";
export interface StandaloneNativeBinding { readonly role: "treasury"; readonly expectedIntentHash: string }
export interface StandaloneNativeApproval extends StandaloneNativeBinding {
  readonly approval: string; readonly reference: string; readonly nearRpcUrl: string;
}
export interface StandaloneNativeBroadcastApproval extends StandaloneNativeApproval {
  readonly recovery?: boolean; readonly expiredPreparationAcknowledgment?: string;
}
export interface StandaloneNativeBroadcastAudit {
  readonly schemaVersion: 1; readonly kind: "standalone-native-broadcast-audit"; readonly role: "treasury";
  readonly testId: string; readonly intentHash: string; readonly originalCreatedAt: string;
  readonly nearTransactionHash: string; readonly unsignedHash: string; readonly signedHash: string;
  readonly approval: { readonly hash: string; readonly reference: string };
  readonly recovery: boolean; readonly expiredPreparationAcknowledgment: string | null;
  readonly checkedAt: string; readonly completedAt: string; readonly expiresAt: string;
  readonly near: { readonly authority: unknown; readonly outcome: unknown };
  readonly evm: { readonly snapshot: NativeDeliverySnapshot; readonly knownTransaction: false; readonly knownReceipt: false };
  readonly auditHash: string;
}
export interface StandaloneNativeFailedReceipt {
  readonly transactionHash: string; readonly blockNumber: bigint; readonly blockHash: string;
  readonly gasUsed: bigint; readonly effectiveGasPriceWei: bigint; readonly actualFeeWei: bigint;
  readonly transaction: unknown; readonly receipt: unknown; readonly block: unknown; readonly parent: unknown;
}
export interface StandaloneNativeExecutionState {
  schemaVersion: 1; kind: "standalone-native-eth-execution"; role: "treasury"; status: StandaloneNativeStatus;
  preflight: StandaloneNativePreflight; createdAt: string;
  signingApproval?: { readonly digest: string; readonly reference: string; readonly at: string };
  nearTransactionHash?: string; nearOutcome?: unknown; signed?: AssembledNativeTransfer;
  nearSubmission?: NearSubmissionRecord;
  broadcastAudit?: StandaloneNativeBroadcastAudit;
  evmAttempt?: { readonly signedHash: string; readonly at: string; readonly auditHash: string };
  externalObservation?: { readonly signedHash: string; readonly at: string };
  receipt?: VerifiedNativeReceipt; failedReceipt?: StandaloneNativeFailedReceipt; recovery?: string;
}
export interface StandaloneNativeExecutionPorts {
  readonly evm: SepoliaReadRpc; readonly verifyMpc: typeof verifyRoleMpc; readonly prepareSigning: typeof prepareMpcSigning;
  readonly readOutcome: typeof readMpcSigningOutcome; readonly broadcast: EvmBroadcastTransport;
  save(state: StandaloneNativeExecutionState): Promise<void>;
  saveAudit(audit: StandaloneNativeBroadcastAudit): Promise<void>;
  readonly now?: () => number;
}
export type StandaloneNativeSigningPorts = Pick<StandaloneNativeExecutionPorts, "evm" | "verifyMpc" | "prepareSigning" | "save" | "now">;
export type StandaloneNativeSigningReconciliationPorts = Pick<StandaloneNativeExecutionPorts, "verifyMpc" | "readOutcome" | "save" | "now">;
export type StandaloneNativeAuditPorts = Pick<StandaloneNativeExecutionPorts, "evm" | "verifyMpc" | "readOutcome" | "now">;
export type StandaloneNativeBroadcastPorts = StandaloneNativeAuditPorts & Pick<StandaloneNativeExecutionPorts, "save" | "saveAudit" | "broadcast">;
export type StandaloneNativeEvmReconciliationPorts = Pick<StandaloneNativeExecutionPorts, "evm" | "save" | "now">;
const AGE_MS = 900_000, AUDIT_MS = 30_000;
const statuses = new Set<StandaloneNativeStatus>(["prepared", "near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed",
  "evm-submitting", "evm-submitted", "evm-uncertain", "evm-failed", "confirmed"]);
const signedStatuses = new Set<StandaloneNativeStatus>(["signed", "evm-submitting", "evm-submitted", "evm-uncertain", "evm-failed", "confirmed"]);
function now(ports: { readonly now?: () => number }): number {
  const value = ports.now ? ports.now() : Date.now(); check(Number.isSafeInteger(value) && value >= 0, "Invalid standalone operation clock."); return value;
}
function hash(value: unknown): string { check(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "Invalid public transaction/block hash."); return value.toLowerCase(); }
function nearHash(value: unknown): string {
  check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32, "A complete existing NEAR transaction hash is required."); return value;
}
function object(value: unknown): Record<string, any> { check(value && typeof value === "object" && !Array.isArray(value), "Missing public standalone transaction object."); return value as Record<string, any>; }
function quantity(value: unknown): bigint {
  check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Malformed public EVM quantity."); return requireUint256(BigInt(value), "Public EVM quantity");
}
function binding(state: StandaloneNativeExecutionState, input: StandaloneNativeBinding): void {
  check(input.role === "treasury", "Explicit Treasury role selection is required."); assertStandaloneNativeExecutionState(state, input.expectedIntentHash);
}
function verifiedSigned(state: StandaloneNativeExecutionState): AssembledNativeTransfer {
  const signature = normalizeMpcOutcome(state.nearOutcome, "treasury", nearHash(state.nearTransactionHash), state.preflight.prepared.unsignedHash);
  const expected = assembleTreasuryNativeTransfer(state.preflight.prepared, signature);
  check(isDeepStrictEqual(state.signed, expected), "Saved standalone native bytes differ from the exact MPC-authorized digest and full Treasury key."); return expected;
}
function replaceState(state: StandaloneNativeExecutionState, candidate: StandaloneNativeExecutionState): void {
  for (const key of Object.keys(state)) if (!(key in candidate)) delete (state as unknown as Record<string, unknown>)[key]; Object.assign(state, candidate);
}
async function commit(state: StandaloneNativeExecutionState, candidate: StandaloneNativeExecutionState,
  save: StandaloneNativeExecutionPorts["save"], expectedIntentHash: string): Promise<void> {
  assertStandaloneNativeExecutionState(candidate, expectedIntentHash); await save(candidate); replaceState(state, candidate);
}

/** Pure timing gate only. Passing it grants no cryptographic or submission capability. */
export function assertStandalonePreparationFresh(createdAt: string, clockMs: number): void {
  check(Number.isSafeInteger(clockMs), "Invalid standalone preparation clock."); const age = clockMs - utc(createdAt);
  check(age >= 0 && age <= AGE_MS, "Standalone native preparation expired or has a future timestamp; preserve it and use the bound recovery route only for valid signed bytes.");
}
export interface StandaloneBroadcastFacts {
  readonly role: "treasury"; readonly status: StandaloneNativeStatus; readonly intentHash: string; readonly createdAt: string;
  readonly signedHash: string; readonly attempted: boolean; readonly externallyObserved: boolean;
}
/** Public-field gate only; strict state/MPC/signature verification is mandatory before its caller may submit. */
export function assertStandaloneBroadcastApproval(facts: StandaloneBroadcastFacts, input: StandaloneNativeBroadcastApproval, clockMs: number): void {
  check(facts.role === "treasury" && input.role === "treasury" && facts.status === "signed" && !facts.attempted && !facts.externallyObserved,
    "Only an unattempted signed Treasury native operation qualifies; reconcile known hashes and prior attempts instead.");
  check(hexHash(input.expectedIntentHash) === hexHash(facts.intentHash) && input.approval === hexHash(facts.signedHash), "Exact standalone intent and signed-hash approval are required.");
  label(input.reference, "Standalone broadcast approval reference");
  const age = clockMs - utc(facts.createdAt); check(Number.isSafeInteger(clockMs) && age >= 0, "Standalone preparation timestamp is in the future.");
  if (input.recovery) check(age > AGE_MS && input.expiredPreparationAcknowledgment === facts.createdAt, "Recovery requires acknowledgment of the exact original expired preparation timestamp.");
  else { check(input.expiredPreparationAcknowledgment === undefined, "Expired timestamp acknowledgment is available only through recovery."); assertStandalonePreparationFresh(facts.createdAt, clockMs); }
}
/** Pure audit clock gate; it never authenticates an audit or authorizes a send. */
export function assertStandaloneAuditFresh(checkedAt: string, completedAt: string, clockMs: number): void {
  const start = utc(checkedAt), completed = utc(completedAt);
  check(Number.isSafeInteger(clockMs) && completed >= start && completed <= start + AUDIT_MS && clockMs >= completed && clockMs <= start + AUDIT_MS,
    "Standalone broadcast audit exceeded its 30-second freshness window; reconcile without retrying if a marker already exists.");
}
function broadcastFacts(state: StandaloneNativeExecutionState): StandaloneBroadcastFacts {
  return { role: state.role, status: state.status, intentHash: state.preflight.intent.intentHash, createdAt: state.createdAt,
    signedHash: state.signed?.hash ?? "", attempted: !!state.evmAttempt, externallyObserved: !!state.externalObservation };
}
function assertAudit(a: StandaloneNativeBroadcastAudit, state: StandaloneNativeExecutionState): void {
  const { auditHash, ...body } = a;
  check(a.schemaVersion === 1 && a.kind === "standalone-native-broadcast-audit" && auditHash === fingerprint("standalone-native-broadcast-audit-v1", body) &&
    a.role === "treasury" && a.testId === state.preflight.intent.testId && a.intentHash === state.preflight.intent.intentHash && a.originalCreatedAt === state.createdAt &&
    a.nearTransactionHash === state.nearTransactionHash && a.unsignedHash === state.preflight.prepared.unsignedHash && a.signedHash === state.signed?.hash &&
    a.approval.hash === a.signedHash && typeof a.recovery === "boolean" && a.expiresAt === new Date(utc(a.checkedAt) + AUDIT_MS).toISOString() &&
    a.evm.knownTransaction === false && a.evm.knownReceipt === false, "Standalone audit identity, approval, timestamps or preserved observations changed.");
  label(a.approval.reference, "Standalone audit approval reference");
  assertStandaloneAuditFresh(a.checkedAt, a.completedAt, utc(a.completedAt));
  assertStandaloneBroadcastApproval({ ...broadcastFacts(state), status: "signed", attempted: false, externallyObserved: false },
    { role: "treasury", expectedIntentHash: a.intentHash, approval: a.signedHash, reference: a.approval.reference, nearRpcUrl: "public-observation-only",
      recovery: a.recovery, ...(a.expiredPreparationAcknowledgment ? { expiredPreparationAcknowledgment: a.expiredPreparationAcknowledgment } : {}) }, utc(a.checkedAt));
}
function assertNearFailure(state: StandaloneNativeExecutionState, outcome: unknown): void {
  const o = object(outcome), tx = object(o.transaction), expected = state.preflight.intent.near;
  check(o.final_execution_status === "FINAL" && tx.hash === state.nearTransactionHash && tx.signer_id === expected.accountId &&
    tx.public_key === VERIFIED_IDENTITIES.treasury.accessPublicKey && tx.receiver_id === expected.contractId && Array.isArray(tx.actions) && tx.actions.length === 1,
  "Final NEAR failure does not identify the exact standalone Treasury request.");
  const direct = object(tx.actions[0]); check(Object.keys(direct).join() === "FunctionCall", "Require the original direct MPC signing action.");
  const action = object(direct.FunctionCall);
  check(typeof action.args === "string" && action.args.length <= 32768, "Require bounded public signing arguments.");
  const bytes = Buffer.from(action.args, "base64");
  check(bytes.toString("base64") === action.args &&
    action.method_name === "sign" && String(action.gas) === "100000000000000" && action.deposit === "1", "Final NEAR failure signing parameters changed.");
  const args = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))), request = object(args.request), payload = object(request.payload_v2), status = object(o.status);
  check(Object.keys(args).join() === "request" && Object.keys(request).sort().join() === "domain_id,path,payload_v2" && Object.keys(payload).join() === "Ecdsa" &&
    payload.Ecdsa === state.preflight.prepared.unsignedHash.slice(2) && request.path === expected.path && request.domain_id === expected.domainId &&
    Object.keys(status).join() === "Failure", "Final NEAR failure does not bind the original native digest, path and domain.");
}
export function assertStandaloneNativeExecutionState(value: StandaloneNativeExecutionState, expectedIntentHash: string): void {
  check(value && value.schemaVersion === 1 && value.kind === "standalone-native-eth-execution" && value.role === "treasury" && statuses.has(value.status), "Unsupported standalone native execution state.");
  const allowed = new Set(["schemaVersion", "kind", "role", "status", "preflight", "createdAt", "signingApproval", "nearTransactionHash", "nearSubmission", "nearOutcome", "signed",
    "broadcastAudit", "evmAttempt", "externalObservation", "receipt", "failedReceipt", "recovery"]);
  check(Object.keys(value).every(key => allowed.has(key)), "Unexpected standalone execution fields.");
  utc(value.createdAt); assertStandaloneNativePreflight(value.preflight, expectedIntentHash);
  if (value.recovery !== undefined) label(value.recovery, "Standalone reconciliation note", 2048);
  if (value.status === "prepared") check(!value.nearTransactionHash && !value.nearSubmission && !value.signingApproval && !value.nearOutcome && !value.signed && !value.evmAttempt &&
    !value.externalObservation && !value.broadcastAudit && !value.receipt && !value.failedReceipt, "Prepared state cannot contain previous signing or submission evidence.");
  else { nearHash(value.nearTransactionHash); check(value.signingApproval?.digest === value.preflight.prepared.unsignedHash, "Missing original hash-bound signing approval.");
    label(value.signingApproval!.reference, "Signing approval reference"); check(utc(value.signingApproval!.at) >= utc(value.createdAt) &&
      utc(value.signingApproval!.at) - utc(value.createdAt) <= AGE_MS, "Original signing approval was outside preparation validity."); }
  if (value.nearSubmission !== undefined) assertNearSubmissionRecord(value.nearSubmission,
    { role: "treasury", transactionHash: nearHash(value.nearTransactionHash), digest: value.preflight.prepared.unsignedHash });
  if (signedStatuses.has(value.status)) verifiedSigned(value);
  else check(!value.signed && !value.receipt && !value.failedReceipt && !value.evmAttempt && !value.externalObservation && !value.broadcastAudit, "Unsigned state cannot contain EVM execution evidence.");
  if (value.status === "near-failed") assertNearFailure(value, value.nearOutcome);
  if (value.broadcastAudit) assertAudit(value.broadcastAudit, value);
  if (value.evmAttempt) check(value.broadcastAudit && value.signed?.hash === value.evmAttempt.signedHash && value.broadcastAudit.auditHash === value.evmAttempt.auditHash &&
    utc(value.evmAttempt.at) >= utc(value.broadcastAudit.completedAt) && utc(value.evmAttempt.at) <= utc(value.broadcastAudit.expiresAt), "EVM attempt lost its durable exact-hash audit.");
  if (value.externalObservation) check(!value.evmAttempt && value.externalObservation.signedHash === value.signed?.hash && utc(value.externalObservation.at) >= utc(value.createdAt), "Invalid read-only external hash observation.");
  if (["evm-submitting", "evm-submitted", "evm-uncertain", "evm-failed", "confirmed"].includes(value.status)) check(value.evmAttempt || value.externalObservation, "EVM stage requires a durable attempt or explicit external observation.");
  if (value.status === "confirmed") {
    const r = value.receipt, p = value.preflight.prepared;
    check(r && !value.failedReceipt && r.transactionHash === value.signed?.hash && r.blockNumber > value.preflight.snapshot.blockNumber && r.confirmations >= 2n &&
      r.gasUsed >= 21_000n && r.gasUsed <= p.gasLimit && r.effectiveGasPriceWei <= p.maxFeePerGas && r.actualFeeWei === r.gasUsed * r.effectiveGasPriceWei &&
      r.nativeDeltas.treasury === -p.amountWei - r.actualFeeWei && r.nativeDeltas.investor === p.amountWei &&
      r.after.treasuryEth - r.before.treasuryEth === r.nativeDeltas.treasury && r.after.investorEth - r.before.investorEth === p.amountWei,
    "Confirmed standalone receipt does not prove exact native value and gas accounting."); hash(r.blockHash);
  } else check(value.receipt === undefined, "Unconfirmed standalone state cannot contain a success receipt.");
  if (value.status === "evm-failed") check(value.failedReceipt && value.failedReceipt.transactionHash === value.signed?.hash &&
    value.failedReceipt.actualFeeWei === value.failedReceipt.gasUsed * value.failedReceipt.effectiveGasPriceWei, "Failed native execution requires preserved actual-fee evidence.");
  else check(value.failedReceipt === undefined, "Only an onchain-failed state may contain failed native receipt evidence.");
}
export function createStandaloneNativeState(preflight: StandaloneNativePreflight, expectedIntentHash: string,
  createdAt = new Date().toISOString()): StandaloneNativeExecutionState {
  const value: StandaloneNativeExecutionState = { schemaVersion: 1, kind: "standalone-native-eth-execution", role: "treasury", status: "prepared", preflight: structuredClone(preflight), createdAt };
  assertStandaloneNativeExecutionState(value, expectedIntentHash); return value;
}
export function decodeStandaloneNativeState(text: string, expectedIntentHash: string): StandaloneNativeExecutionState {
  const value = decodeEncodedState(text) as StandaloneNativeExecutionState; assertStandaloneNativeExecutionState(value, expectedIntentHash); return value;
}
export async function readStandaloneNativeState(file: string, expectedIntentHash: string, root = process.cwd()): Promise<StandaloneNativeExecutionState> {
  return decodeStandaloneNativeState(await readFile(await runtimeStatePath(resolve(root, file), root), "utf8"), expectedIntentHash);
}
export async function saveStandaloneNativeState(file: string, state: StandaloneNativeExecutionState, expectedIntentHash: string, root = process.cwd()): Promise<void> {
  assertStandaloneNativeExecutionState(state, expectedIntentHash); await saveEncodedState(await runtimeStatePath(resolve(root, file), root, true), state);
}
export async function withStandaloneNativeStateLock<T>(file: string, expectedIntentHash: string,
  action: (state: StandaloneNativeExecutionState, save: StandaloneNativeExecutionPorts["save"]) => Promise<T>, root = process.cwd()): Promise<T> {
  const safe = await runtimeStatePath(resolve(root, file), root);
  return withStateLock(safe, async () => action(await readStandaloneNativeState(safe, expectedIntentHash, root),
    state => saveStandaloneNativeState(safe, state, expectedIntentHash, root)));
}
export function publicStandaloneNativeExecutionSummary(state: StandaloneNativeExecutionState): unknown {
  const { unsignedSerialized: _bytes, ...parameters } = state.preflight.prepared;
  return { kind: state.kind, role: state.role, status: state.status, createdAt: state.createdAt,
    expiresAt: new Date(utc(state.createdAt) + AGE_MS).toISOString(), intent: state.preflight.intent, parameters,
    rawGasEstimate: state.preflight.snapshot.estimatedGas, bufferedGasLimit: state.preflight.prepared.gasLimit,
    nearTransactionHash: state.nearTransactionHash, nearSubmission: state.nearSubmission, evmTransactionHash: state.signed?.hash, recoveredSender: state.signed?.senderAddress,
    signingApproval: state.signingApproval, broadcastAuditHash: state.broadcastAudit?.auditHash, evmAttempt: state.evmAttempt,
    externalObservation: state.externalObservation, receipt: state.receipt, failedReceipt: state.failedReceipt, recovery: state.recovery };
}

export async function requestStandaloneNativeSignature(state: StandaloneNativeExecutionState,
  input: StandaloneNativeApproval & { readonly credentialPath: string }, ports: StandaloneNativeSigningPorts): Promise<void> {
  binding(state, input); check(state.status === "prepared", "Standalone signing was already attempted; reconcile its existing NEAR hash without retrying.");
  check(input.approval === state.preflight.prepared.unsignedHash, "Signing approval must match the exact standalone native unsigned digest.");
  label(input.reference, "Signing approval reference"); check(isAbsolute(input.credentialPath), "Select one explicit absolute protected Treasury credential file.");
  assertStandalonePreparationFresh(state.createdAt, now(ports));
  await ports.verifyMpc("treasury", input.nearRpcUrl);
  await recheckStandaloneNative(state.preflight, ports.evm, input.expectedIntentHash);
  assertStandalonePreparationFresh(state.createdAt, now(ports));
  const packet = await ports.prepareSigning({ role: "treasury", credentialPath: input.credentialPath, rpcUrl: input.nearRpcUrl, digest: input.approval,
    submissionDeadlineMs: utc(state.createdAt) + AGE_MS });
  assertStandalonePreparationFresh(state.createdAt, now(ports)); nearHash(packet.transactionHash);
  const n = state.preflight.intent.near;
  check(packet.signerAccountId === n.accountId && packet.receiverId === n.contractId && packet.request.payload_v2.Ecdsa === input.approval.slice(2) &&
    packet.request.path === n.path && packet.request.domain_id === n.domainId && packet.gasTgas === n.gasTgas && packet.depositYocto === n.depositYocto,
  "Prepared signing packet differs from the approved standalone intent and Treasury authority.");
  assertNearSubmissionRecord(packet.submission, { role: "treasury", transactionHash: packet.transactionHash, digest: state.preflight.prepared.unsignedHash });
  const marked: StandaloneNativeExecutionState = { ...structuredClone(state), status: "near-submitting", nearTransactionHash: packet.transactionHash, nearSubmission: structuredClone(packet.submission),
    signingApproval: { digest: input.approval, reference: input.reference, at: new Date(now(ports)).toISOString() } };
  assertStandaloneNativeExecutionState(marked, input.expectedIntentHash); replaceState(state, marked);
  await ports.save(state); // No submission capability is invoked until this hash/attempt is durable.
  let candidate = structuredClone(state);
  try { assertStandalonePreparationFresh(state.createdAt, now(ports)); await packet.broadcastOnce(async next => {
    assertNearSubmissionSuccessor(state.nearSubmission!, next);
    await commit(state, { ...structuredClone(state), nearSubmission: structuredClone(next) }, ports.save, input.expectedIntentHash);
  }); candidate = { ...structuredClone(state), status: "near-submitted" }; }
  catch { candidate = { ...structuredClone(state), status: "near-uncertain", recovery: "Reconcile the existing NEAR hash; no automatic signing submission or retry is permitted." }; }
  await commit(state, candidate, ports.save, input.expectedIntentHash);
}
export async function reconcileStandaloneNativeSigning(state: StandaloneNativeExecutionState,
  input: StandaloneNativeBinding & { readonly nearRpcUrl: string }, ports: StandaloneNativeSigningReconciliationPorts): Promise<void> {
  binding(state, input); check(["near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed"].includes(state.status), "No existing standalone NEAR signing attempt is available to reconcile.");
  const h = nearHash(state.nearTransactionHash); await ports.verifyMpc("treasury", input.nearRpcUrl);
  const outcome = await ports.readOutcome("treasury", h, input.nearRpcUrl), o = object(outcome);
  check(o.final_execution_status === "FINAL", "NEAR signing outcome is not FINAL; preserve its hash and reconcile later.");
  if (Object.hasOwn(object(o.status), "Failure")) {
    assertNearFailure(state, outcome);
    await commit(state, { ...structuredClone(state), status: "near-failed", nearOutcome: structuredClone(outcome),
      recovery: "The exact NEAR request finalized with failure. A replacement signing request requires a separate authorized decision." }, ports.save, input.expectedIntentHash); return;
  }
  const signature = normalizeMpcOutcome(outcome, "treasury", h, state.preflight.prepared.unsignedHash), signed = assembleTreasuryNativeTransfer(state.preflight.prepared, signature);
  if (state.status === "signed") { check(isDeepStrictEqual(signed, state.signed), "Reconciled native signed bytes changed."); return; }
  const candidate = { ...structuredClone(state), status: "signed" as const, signed, nearOutcome: structuredClone(outcome) }; delete candidate.recovery;
  await commit(state, candidate, ports.save, input.expectedIntentHash);
}
export async function auditStandaloneNativeBroadcast(state: StandaloneNativeExecutionState, input: StandaloneNativeBroadcastApproval,
  ports: StandaloneNativeAuditPorts): Promise<StandaloneNativeBroadcastAudit> {
  binding(state, input); const start = now(ports); assertStandaloneBroadcastApproval(broadcastFacts(state), input, start);
  const signed = verifiedSigned(state);
  const [authority, outcome, snapshot, known, receipt] = await Promise.all([
    ports.verifyMpc("treasury", input.nearRpcUrl), ports.readOutcome("treasury", nearHash(state.nearTransactionHash), input.nearRpcUrl),
    recheckStandaloneNative(state.preflight, ports.evm, input.expectedIntentHash), ports.evm.request("eth_getTransactionByHash", [signed.hash]),
    ports.evm.request("eth_getTransactionReceipt", [signed.hash]),
  ]);
  const signature = normalizeMpcOutcome(outcome, "treasury", state.nearTransactionHash!, state.preflight.prepared.unsignedHash);
  check(isDeepStrictEqual(assembleTreasuryNativeTransfer(state.preflight.prepared, signature), signed), "Fresh finalized MPC proof differs from the existing signed native transaction.");
  check(known === null && receipt === null, "Standalone native hash is already known; reconcile read-only without broadcasting.");
  assertStandaloneBroadcastApproval(broadcastFacts(state), input, now(ports));
  const checkedAt = new Date(start).toISOString(), completedAt = new Date(now(ports)).toISOString(); assertStandaloneAuditFresh(checkedAt, completedAt, now(ports));
  const body = { schemaVersion: 1 as const, kind: "standalone-native-broadcast-audit" as const, role: "treasury" as const,
    testId: state.preflight.intent.testId, intentHash: state.preflight.intent.intentHash, originalCreatedAt: state.createdAt,
    nearTransactionHash: state.nearTransactionHash!, unsignedHash: state.preflight.prepared.unsignedHash, signedHash: signed.hash,
    approval: { hash: input.approval, reference: input.reference }, recovery: !!input.recovery,
    expiredPreparationAcknowledgment: input.recovery ? state.createdAt : null, checkedAt, completedAt,
    expiresAt: new Date(start + AUDIT_MS).toISOString(), near: { authority, outcome }, evm: { snapshot, knownTransaction: false as const, knownReceipt: false as const } };
  return frozen({ ...body, auditHash: fingerprint("standalone-native-broadcast-audit-v1", body) });
}
export async function broadcastStandaloneNative(state: StandaloneNativeExecutionState, input: StandaloneNativeBroadcastApproval,
  ports: StandaloneNativeBroadcastPorts): Promise<void> {
  const audit = await auditStandaloneNativeBroadcast(state, input, ports), signed = verifiedSigned(state);
  await ports.saveAudit(audit); assertStandaloneAuditFresh(audit.checkedAt, audit.completedAt, now(ports));
  assertStandaloneBroadcastApproval(broadcastFacts(state), input, now(ports));
  const sendOnce = authorizeEvmBroadcast(signed.serialized, signed.hash, input.approval, ports.broadcast);
  const marked: StandaloneNativeExecutionState = { ...structuredClone(state), status: "evm-submitting", broadcastAudit: audit,
    evmAttempt: { signedHash: signed.hash, at: new Date(now(ports)).toISOString(), auditHash: audit.auditHash } };
  assertStandaloneNativeExecutionState(marked, input.expectedIntentHash); replaceState(state, marked); await ports.save(state);
  const candidate = structuredClone(state);
  try { assertStandaloneAuditFresh(audit.checkedAt, audit.completedAt, now(ports));
    if (!input.recovery) assertStandalonePreparationFresh(state.createdAt, now(ports)); await sendOnce(); candidate.status = "evm-submitted"; }
  catch { candidate.status = "evm-uncertain"; candidate.recovery = "Preserve the exact signed native hash and attempt marker. Reconcile nonce and receipt; no automatic rebroadcast or replacement is permitted."; }
  await commit(state, candidate, ports.save, input.expectedIntentHash);
}
function assertKnownNativeTransaction(state: StandaloneNativeExecutionState, rawValue: unknown): Record<string, any> {
  const raw = object(rawValue), p = state.preflight.prepared;
  check(hash(raw.hash) === state.signed!.hash && quantity(raw.type) === 2n && quantity(raw.chainId) === 11155111n &&
    typeof raw.from === "string" && raw.from.toLowerCase() === p.senderAddress.toLowerCase() && typeof raw.to === "string" && raw.to.toLowerCase() === p.recipientAddress.toLowerCase() &&
    quantity(raw.value) === p.amountWei && raw.input === "0x" && quantity(raw.nonce) === BigInt(p.nonce) && quantity(raw.gas) === p.gasLimit &&
    quantity(raw.maxFeePerGas) === p.maxFeePerGas && quantity(raw.maxPriorityFeePerGas) === p.maxPriorityFeePerGas &&
    Array.isArray(raw.accessList) && raw.accessList.length === 0, "Known native transaction differs from the exact approved intent.");
  const parity = quantity(raw.v); check([0n, 1n, 27n, 28n].includes(parity), "Invalid known native signature recovery value.");
  const t = Transaction.from(p.unsignedSerialized); t.signature = Signature.from({ r: normalizeEvmSignatureScalar(raw.r), s: normalizeEvmSignatureScalar(raw.s), v: Number(parity) });
  check(t.serialized === state.signed!.serialized, "Known native signature differs from the preserved signed bytes."); return raw;
}
/** Public availability/identity classification only. It neither verifies a
 * signature nor grants authorization; strict callers must verify exact signed
 * bytes first and canonical receipts afterward before recording completion.
 */
export function classifyStandaloneNativeReceipt(receiptValue: unknown, rawValue: unknown, expectedHash: string,
  headValue: unknown, referenceBlockNumber: bigint): "pending" | "success" | "failed" {
  if (receiptValue === null) return "pending";
  const receipt = object(receiptValue), raw = object(rawValue), h = hexHash(expectedHash), blockNumber = quantity(receipt.blockNumber), head = quantity(headValue);
  const status = quantity(receipt.status);
  check(hash(receipt.transactionHash) === h && hash(raw.hash) === h && blockNumber > referenceBlockNumber &&
    quantity(raw.blockNumber) === blockNumber && hash(raw.blockHash) === hash(receipt.blockHash) &&
    typeof receipt.from === "string" && typeof receipt.to === "string" && typeof raw.from === "string" && typeof raw.to === "string" &&
    receipt.from.toLowerCase() === raw.from.toLowerCase() && receipt.to.toLowerCase() === raw.to.toLowerCase() &&
    head >= blockNumber && (status === 0n || status === 1n), "Native receipt identity, status or mined block is inconsistent.");
  return head === blockNumber ? "pending" : status === 0n ? "failed" : "success";
}
async function verifyFailedNativeReceipt(state: StandaloneNativeExecutionState, receiptValue: unknown, rpc: SepoliaReadRpc): Promise<StandaloneNativeFailedReceipt> {
  const p = state.preflight.prepared, receipt = object(receiptValue), transaction = assertKnownNativeTransaction(state, await rpc.request("eth_getTransactionByHash", [state.signed!.hash]));
  const blockNumber = quantity(receipt.blockNumber), blockHash = hash(receipt.blockHash), head = quantity(await rpc.request("eth_blockNumber", []));
  check(quantity(receipt.status) === 0n && hash(receipt.transactionHash) === state.signed!.hash && hash(transaction.blockHash) === blockHash &&
    quantity(transaction.blockNumber) === blockNumber && receipt.from?.toLowerCase() === p.senderAddress.toLowerCase() && receipt.to?.toLowerCase() === p.recipientAddress.toLowerCase() &&
    blockNumber > state.preflight.snapshot.blockNumber && head >= blockNumber + 1n, "Failed native receipt requires the exact transaction and two confirmations.");
  const [blockValue, parentValue] = await Promise.all([rpc.request("eth_getBlockByNumber", ["0x" + blockNumber.toString(16), false]),
    rpc.request("eth_getBlockByNumber", ["0x" + (blockNumber - 1n).toString(16), false])]);
  const block = object(blockValue), parent = object(parentValue), gasUsed = quantity(receipt.gasUsed), effectiveGasPriceWei = quantity(receipt.effectiveGasPrice), actualFeeWei = gasUsed * effectiveGasPriceWei;
  const base = quantity(block.baseFeePerGas), uncapped = base + p.maxPriorityFeePerGas;
  check(quantity(block.number) === blockNumber && hash(block.hash) === blockHash && quantity(parent.number) === blockNumber - 1n && hash(block.parentHash) === hash(parent.hash) &&
    gasUsed >= 21_000n && gasUsed <= p.gasLimit && base <= p.maxFeePerGas && effectiveGasPriceWei === (uncapped < p.maxFeePerGas ? uncapped : p.maxFeePerGas) && actualFeeWei <= p.maximumFeeWei,
  "Failed native canonicality or actual gas accounting is inconsistent.");
  const canonical = object(await rpc.request("eth_getBlockByNumber", ["0x" + blockNumber.toString(16), false]));
  check(quantity(canonical.number) === blockNumber && hash(canonical.hash) === blockHash, "Failed native receipt block changed during verification.");
  return frozen({ transactionHash: state.signed!.hash, blockNumber, blockHash, gasUsed, effectiveGasPriceWei, actualFeeWei, transaction, receipt, block, parent });
}
export async function reconcileStandaloneNativeEvm(state: StandaloneNativeExecutionState, input: StandaloneNativeBinding,
  ports: StandaloneNativeEvmReconciliationPorts): Promise<void> {
  binding(state, input); check(signedStatuses.has(state.status), "No existing standalone signed native transaction is available to reconcile.");
  const signed = verifiedSigned(state), p = state.preflight.prepared;
  check(quantity(await ports.evm.request("eth_chainId", [])) === 11155111n, "Native reconciliation requires Ethereum Sepolia.");
  const receiptValue = await ports.evm.request("eth_getTransactionReceipt", [signed.hash]);
  let candidate = structuredClone(state);
  if (!state.evmAttempt && !state.externalObservation) {
    const known = await ports.evm.request("eth_getTransactionByHash", [signed.hash]);
    check(receiptValue === null || known !== null, "RPC returned a native receipt without its transaction.");
    if (known !== null) { assertKnownNativeTransaction(state, known); candidate.externalObservation = { signedHash: signed.hash, at: new Date(now(ports)).toISOString() };
      candidate.status = "evm-uncertain"; }
  }
  if (receiptValue === null) {
    check(state.status !== "confirmed" && state.status !== "evm-failed", "Previously terminal native receipt is unavailable; preserve its evidence for exceptional reconciliation.");
    const [known, confirmed, pending] = await Promise.all([ports.evm.request("eth_getTransactionByHash", [signed.hash]),
      ports.evm.request("eth_getTransactionCount", [p.senderAddress, "latest"]), ports.evm.request("eth_getTransactionCount", [p.senderAddress, "pending"])]);
    if (known !== null) assertKnownNativeTransaction(state, known);
    const confirmedNonce = quantity(confirmed), pendingNonce = quantity(pending); check(pendingNonce >= confirmedNonce, "Conflicting native nonce observations; preserve state.");
    candidate.recovery = `No native receipt; known hash ${known ? "yes" : "no"}, confirmed nonce ${confirmedNonce}, pending nonce ${pendingNonce}, approved nonce ${p.nonce}. Preserve state; no automatic retry.`;
    await commit(state, candidate, ports.save, input.expectedIntentHash); return;
  }
  const receipt = object(receiptValue), raw = assertKnownNativeTransaction(state, await ports.evm.request("eth_getTransactionByHash", [signed.hash]));
  const availability = classifyStandaloneNativeReceipt(receipt, raw, signed.hash, await ports.evm.request("eth_blockNumber", []), state.preflight.snapshot.blockNumber);
  if (state.status === "confirmed") check(availability === "success", "Previously confirmed native receipt changed; preserve original evidence for exceptional reconciliation.");
  if (state.status === "evm-failed") check(availability === "failed", "Previously failed native receipt changed; preserve original evidence for exceptional reconciliation.");
  if (availability === "pending") {
    candidate.recovery = "Native receipt has one confirmation; reconcile later without resubmitting.";
    await commit(state, candidate, ports.save, input.expectedIntentHash); return;
  }
  if (availability === "failed") {
    const failedReceipt = await verifyFailedNativeReceipt(state, receipt, ports.evm);
    if (state.status === "evm-failed") {
      check(state.failedReceipt?.blockHash === failedReceipt.blockHash && state.failedReceipt.transactionHash === failedReceipt.transactionHash &&
        state.failedReceipt.gasUsed === failedReceipt.gasUsed && state.failedReceipt.effectiveGasPriceWei === failedReceipt.effectiveGasPriceWei,
      "Previously failed native gas evidence changed; preserve it for exceptional reconciliation."); return;
    }
    candidate = { ...candidate, status: "evm-failed", failedReceipt, recovery: "Native EVM execution failed onchain. Gas was spent; a replacement or compensation requires a separately authorized decision." };
    delete candidate.receipt;
  } else {
    const verified = await verifyNativeTransferReceipt(p, signed, ports.evm, state.preflight.snapshot.blockNumber);
    if (state.status === "confirmed") {
      const { confirmations: _priorConfirmations, ...prior } = state.receipt!, { confirmations: _currentConfirmations, ...current } = verified;
      check(isDeepStrictEqual(prior, current), "Previously confirmed native evidence changed; preserve it for exceptional reconciliation."); return;
    }
    candidate = { ...candidate, status: "confirmed", receipt: verified }; delete candidate.failedReceipt; delete candidate.recovery;
  }
  await commit(state, candidate, ports.save, input.expectedIntentHash);
}
export { encodeState as encodeStandaloneNativeState };
