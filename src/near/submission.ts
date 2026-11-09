import { isDeepStrictEqual } from "node:util";
import { baseDecode } from "near-api-js";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID, type AuthorityRole } from "./config.js";
import { VERIFIED_IDENTITIES } from "./identities.js";

export type NearSubmissionStage = "prepared" | "public-checks" | "checks-failed-before-send" |
  "send-intent" | "rpc-response" | "rpc-uncertain";
export type NearDiagnosticCategory = "PUBLIC_CHECK_FAILED" | "DEADLINE_EXPIRED" | "HTTP_ERROR" |
  "RPC_ERROR" | "RPC_RESPONSE_INVALID" | "TIMEOUT" | "NETWORK_ERROR" | "MPC_READ_UNAVAILABLE" | "UNCLASSIFIED_ERROR" | "RPC_RESPONSE";
export interface NearSubmissionDiagnostic {
  readonly category: NearDiagnosticCategory;
  readonly httpStatus?: number;
  readonly rpcCode?: number;
  readonly rpcErrorName?: string;
  readonly finalExecutionStatus?: string;
  readonly transactionHash?: string;
}
export interface NearSubmissionEvent {
  readonly stage: NearSubmissionStage;
  readonly at: string;
  readonly diagnostic?: NearSubmissionDiagnostic;
}
/** Public recovery metadata only; never includes credential paths, private keys, signed bytes or arbitrary RPC text. */
export interface NearSubmissionRecord {
  readonly schemaVersion: 1;
  readonly kind: "near-signing-submission";
  readonly networkId: "testnet";
  readonly role: AuthorityRole;
  readonly signerAccountId: string;
  readonly accessPublicKey: string;
  readonly receiverId: typeof MPC_CONTRACT_ID;
  readonly transactionHash: string;
  readonly digest: string;
  readonly precedingAccessKeyNonce: string;
  readonly transactionNonce: string;
  readonly referenceBlock: { readonly hash: string; readonly height: number };
  readonly rpcOrigin: string;
  readonly preparedAt: string;
  readonly submissionDeadlineAt: string | null;
  readonly domainId: typeof ECDSA_DOMAIN_ID;
  readonly path: typeof DERIVATION_PATH;
  readonly gasTgas: 100;
  readonly depositYocto: "1";
  readonly events: readonly NearSubmissionEvent[];
}
export interface NearSubmissionBinding { readonly role: AuthorityRole; readonly transactionHash: string; readonly digest: string; }
const categories = new Set<NearDiagnosticCategory>(["PUBLIC_CHECK_FAILED", "DEADLINE_EXPIRED", "HTTP_ERROR", "RPC_ERROR",
  "RPC_RESPONSE_INVALID", "TIMEOUT", "NETWORK_ERROR", "MPC_READ_UNAVAILABLE", "UNCLASSIFIED_ERROR", "RPC_RESPONSE"]);
const rpcNames = new Set(["UNKNOWN_TRANSACTION", "INVALID_TRANSACTION", "REQUEST_ROUTED", "TIMEOUT_ERROR", "INTERNAL_ERROR",
  "HANDLER_ERROR", "REQUEST_VALIDATION_ERROR", "METHOD_NOT_FOUND", "PARSE_ERROR", "UNKNOWN_BLOCK", "UNAVAILABLE_SHARD"]);
const finalities = new Set(["NONE", "INCLUDED", "EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", "EXECUTED", "FINAL"]);
const transitions: Record<NearSubmissionStage, readonly NearSubmissionStage[]> = {
  prepared: ["public-checks"], "public-checks": ["checks-failed-before-send", "send-intent"],
  "send-intent": ["checks-failed-before-send", "rpc-response", "rpc-uncertain"],
  "checks-failed-before-send": [], "rpc-response": [], "rpc-uncertain": [],
};
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
function object(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value), "Invalid NEAR submission metadata object.");
  return value as Record<string, unknown>;
}
function exact(value: object, fields: readonly string[]): void {
  check(Object.keys(value).sort().join(",") === [...fields].sort().join(","), "Unexpected NEAR submission metadata fields.");
}
function utc(value: unknown): number {
  check(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    "Invalid NEAR submission timestamp.");
  return Date.parse(value);
}
function hash(value: unknown): string {
  check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32,
    "Invalid NEAR submission hash.");
  return value;
}
function nonce(value: unknown): bigint {
  check(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value), "Invalid NEAR submission nonce.");
  const n = BigInt(value); check(n < (1n << 64n), "NEAR submission nonce exceeds uint64."); return n;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export function assertNearSubmissionDiagnostic(value: unknown): asserts value is NearSubmissionDiagnostic {
  const d = object(value);
  check(Object.keys(d).every(key => ["category", "httpStatus", "rpcCode", "rpcErrorName", "finalExecutionStatus", "transactionHash"].includes(key)) &&
    categories.has(d.category as NearDiagnosticCategory), "Invalid NEAR submission diagnostic.");
  if (d.httpStatus !== undefined) check(Number.isInteger(d.httpStatus) && Number(d.httpStatus) >= 100 && Number(d.httpStatus) <= 599, "Invalid public HTTP status.");
  if (d.rpcCode !== undefined) check(Number.isSafeInteger(d.rpcCode), "Invalid public RPC code.");
  if (d.rpcErrorName !== undefined) check(typeof d.rpcErrorName === "string" && rpcNames.has(d.rpcErrorName), "Invalid public RPC error category.");
  if (d.finalExecutionStatus !== undefined) check(typeof d.finalExecutionStatus === "string" && finalities.has(d.finalExecutionStatus), "Invalid public execution status.");
  if (d.transactionHash !== undefined) hash(d.transactionHash);
}
/** Copy only allowlisted primitives. Provider messages, nested data, causes and URLs are deliberately omitted. */
export function nearRpcErrorDiagnostic(error: unknown, httpStatus?: number): NearSubmissionDiagnostic {
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = e.cause && typeof e.cause === "object" ? e.cause as Record<string, unknown> : {};
  const name = [cause.name, e.name].find(value => typeof value === "string" && rpcNames.has(value));
  return freeze({ category: "RPC_ERROR" as const, ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(Number.isSafeInteger(e.code) ? { rpcCode: e.code as number } : {}), ...(name === undefined ? {} : { rpcErrorName: name as string }) });
}
export function nearRpcResponseDiagnostic(response: unknown): NearSubmissionDiagnostic {
  const r = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const transaction = r.transaction && typeof r.transaction === "object" ? r.transaction as Record<string, unknown> : {};
  let transactionHash: string | undefined;
  try { if (transaction.hash !== undefined) transactionHash = hash(transaction.hash); } catch { /* Untrusted shape is not persisted. */ }
  return freeze({ category: "RPC_RESPONSE" as const,
    ...(typeof r.final_execution_status === "string" && finalities.has(r.final_execution_status) ? { finalExecutionStatus: r.final_execution_status } : {}),
    ...(transactionHash === undefined ? {} : { transactionHash }) });
}
export function assertNearSubmissionRecord(value: unknown, binding: NearSubmissionBinding): asserts value is NearSubmissionRecord {
  const r = object(value);
  exact(r, ["schemaVersion", "kind", "networkId", "role", "signerAccountId", "accessPublicKey", "receiverId", "transactionHash", "digest",
    "precedingAccessKeyNonce", "transactionNonce", "referenceBlock", "rpcOrigin", "preparedAt", "submissionDeadlineAt", "domainId", "path", "gasTgas", "depositYocto", "events"]);
  const identity = VERIFIED_IDENTITIES[binding.role];
  check(identity && r.schemaVersion === 1 && r.kind === "near-signing-submission" && r.networkId === "testnet" &&
    r.role === binding.role && r.signerAccountId === identity.accountId && r.accessPublicKey === identity.accessPublicKey &&
    r.receiverId === MPC_CONTRACT_ID && hash(r.transactionHash) === binding.transactionHash && r.digest === binding.digest &&
    typeof r.digest === "string" && /^0x[0-9a-f]{64}$/.test(r.digest) && r.domainId === ECDSA_DOMAIN_ID && r.path === DERIVATION_PATH &&
    r.gasTgas === 100 && r.depositYocto === "1", "NEAR submission metadata differs from its transaction authority or digest.");
  check(nonce(r.transactionNonce) === nonce(r.precedingAccessKeyNonce) + 1n, "NEAR transaction nonce differs from preceding key nonce plus one.");
  const block = object(r.referenceBlock); exact(block, ["hash", "height"]); hash(block.hash);
  check(Number.isSafeInteger(block.height) && Number(block.height) >= 0, "Invalid NEAR reference-block height.");
  check(typeof r.rpcOrigin === "string", "Invalid NEAR submission RPC origin.");
  const origin = new URL(r.rpcOrigin);
  check(origin.protocol === "https:" && !origin.username && !origin.password && !origin.hostname.includes("mainnet") && origin.origin === r.rpcOrigin,
    "Only a public HTTPS RPC origin may be recorded.");
  const preparedAt = utc(r.preparedAt);
  if (r.submissionDeadlineAt !== null) check(utc(r.submissionDeadlineAt) > preparedAt, "Original NEAR submission deadline is invalid.");
  check(Array.isArray(r.events) && r.events.length > 0 && r.events.length <= 5, "Invalid NEAR submission event sequence.");
  let previous: NearSubmissionEvent | undefined;
  for (const value of r.events) {
    const event = object(value); exact(event, event.diagnostic === undefined ? ["stage", "at"] : ["stage", "at", "diagnostic"]);
    check(typeof event.stage === "string" && event.stage in transitions, "Invalid NEAR submission stage.");
    const at = utc(event.at);
    if (previous) check(at >= utc(previous.at) && transitions[previous.stage].includes(event.stage as NearSubmissionStage), "Invalid NEAR submission stage transition.");
    else check(event.stage === "prepared" && at === preparedAt && event.diagnostic === undefined, "Missing initial NEAR preparation event.");
    if (event.diagnostic !== undefined) assertNearSubmissionDiagnostic(event.diagnostic);
    if (["checks-failed-before-send", "rpc-response", "rpc-uncertain"].includes(event.stage)) check(event.diagnostic !== undefined, "Missing terminal submission diagnostic.");
    else check(event.diagnostic === undefined, "Unexpected diagnostic before RPC execution.");
    if (event.stage === "rpc-response") check((event.diagnostic as NearSubmissionDiagnostic).category === "RPC_RESPONSE", "Invalid RPC response diagnostic category.");
    if (["checks-failed-before-send", "rpc-uncertain"].includes(event.stage)) check((event.diagnostic as NearSubmissionDiagnostic).category !== "RPC_RESPONSE", "Invalid failure diagnostic category.");
    previous = event as unknown as NearSubmissionEvent;
  }
}
export function assertNearSubmissionSuccessor(previous: NearSubmissionRecord, next: NearSubmissionRecord): void {
  const binding = { role: previous.role, transactionHash: previous.transactionHash, digest: previous.digest };
  assertNearSubmissionRecord(previous, binding); assertNearSubmissionRecord(next, binding);
  const { events: oldEvents, ...oldMetadata } = previous, { events: newEvents, ...newMetadata } = next;
  check(isDeepStrictEqual(oldMetadata, newMetadata) && newEvents.length === oldEvents.length + 1 &&
    isDeepStrictEqual(newEvents.slice(0, -1), oldEvents), "NEAR submission metadata or prior events changed.");
}
export function createNearSubmissionRecord(input: NearSubmissionBinding & {
  readonly precedingAccessKeyNonce: string; readonly referenceBlock: { readonly hash: string; readonly height: number };
  readonly rpcUrl: string; readonly preparedAt: string; readonly submissionDeadlineAt: string | null;
}): NearSubmissionRecord {
  const identity = VERIFIED_IDENTITIES[input.role];
  const record: NearSubmissionRecord = { schemaVersion: 1, kind: "near-signing-submission", networkId: "testnet", role: input.role,
    signerAccountId: identity.accountId, accessPublicKey: identity.accessPublicKey, receiverId: MPC_CONTRACT_ID,
    transactionHash: input.transactionHash, digest: input.digest, precedingAccessKeyNonce: input.precedingAccessKeyNonce,
    transactionNonce: (nonce(input.precedingAccessKeyNonce) + 1n).toString(), referenceBlock: { ...input.referenceBlock },
    rpcOrigin: new URL(input.rpcUrl).origin, preparedAt: input.preparedAt, submissionDeadlineAt: input.submissionDeadlineAt,
    domainId: ECDSA_DOMAIN_ID, path: DERIVATION_PATH, gasTgas: 100, depositYocto: "1", events: [{ stage: "prepared", at: input.preparedAt }] };
  assertNearSubmissionRecord(record, input); return freeze(record);
}
export function appendNearSubmissionEvent(previous: NearSubmissionRecord, event: NearSubmissionEvent): NearSubmissionRecord {
  const next = { ...previous, events: [...previous.events, structuredClone(event)] };
  assertNearSubmissionSuccessor(previous, next); return freeze(next);
}
