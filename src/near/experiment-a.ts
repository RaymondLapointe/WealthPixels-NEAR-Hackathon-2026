import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { actions, baseDecode, baseEncode, createTransaction, KeyPairSigner, PublicKey,
  type KeyPairString, type SignedTransaction, type Transaction } from "near-api-js";
import { VERIFIED_IDENTITIES } from "./identities.js";
import { assertNearSubmissionDiagnostic, nearRpcErrorDiagnostic, nearRpcResponseDiagnostic,
  type NearSubmissionDiagnostic } from "./submission.js";

export const EXPERIMENT_A_PRIMARY_RPC = "https://test.rpc.fastnear.com";
export const EXPERIMENT_A_SECONDARY_RPC = "https://archival-rpc.testnet.near.org";
export const EXPERIMENT_A_FEE_BUDGET_YOCTO = "100000000000000000000";
export const EXPERIMENT_A_PREPARATION_MS = 900_000;
const IDENTITY = VERIFIED_IDENTITIES.investor;
const ZERO_HASH = "1".repeat(32);
type RpcMethod = "status" | "block" | "query" | "EXPERIMENTAL_protocol_config" | "gas_price" | "tx" | "send_tx";
export interface ExperimentASigner {
  getPublicKey(): Promise<PublicKey>;
  signTransaction(transaction: Transaction): Promise<{ txHash: Uint8Array; signedTransaction: SignedTransaction }>;
}
/** Code-injected offline services are never selectable through a CLI or state-file flag. */
export interface ExperimentAPorts {
  readonly mode: "live" | "offline-fixtures";
  now(): number;
  rpc(endpoint: string, method: RpcMethod, params: unknown): Promise<unknown>;
  loadSigner(credentialPath: string): Promise<ExperimentASigner>;
  verifySignature(publicKey: string, message: Uint8Array, signature: Uint8Array): boolean;
}
export interface ExperimentAPreflight {
  readonly kind: "experiment-a-read-only-preflight";
  readonly mode: ExperimentAPorts["mode"];
  readonly networkId: "testnet";
  readonly primaryRpc: string; readonly secondaryRpc: string;
  readonly observedAt: string;
  readonly accountId: typeof IDENTITY.accountId; readonly publicKey: typeof IDENTITY.accessPublicKey;
  readonly referenceBlock: { readonly hash: string; readonly height: number; readonly timestampNanosec: string };
  readonly previousNonce: string; readonly balanceYocto: string; readonly storageUsage: number;
  readonly storageReserveYocto: string; readonly spendableYocto: string;
  readonly gasPriceYocto: string; readonly estimatedGas: string; readonly estimatedFeeYocto: string;
  readonly feeBudgetYocto: typeof EXPERIMENT_A_FEE_BUDGET_YOCTO;
  readonly transactionValidityPeriod: number;
}
export type ExperimentAStatus = "prepared" | "attempting" | "failed-before-send" | "submission-uncertain" |
  "rpc-accepted" | "unresolved" | "final-success" | "final-failure";
export interface ExperimentAEvent {
  readonly stage: string; readonly at: string; readonly diagnostic?: NearSubmissionDiagnostic;
}
export interface ExperimentAFinalProof {
  readonly endpoint: string; readonly transactionHash: string; readonly transactionNonce: string;
  readonly transactionBlockHash: string; readonly success: boolean; readonly finalExecutionStatus: "FINAL";
  readonly receiptIds: readonly string[]; readonly totalTokensBurntYocto: string;
  readonly publicSignature: string;
}
export interface ExperimentAState {
  readonly schemaVersion: 1; readonly kind: "experiment-a-near-self-transfer";
  readonly mode: ExperimentAPorts["mode"]; readonly id: string; readonly role: "investor";
  readonly signerAccountId: typeof IDENTITY.accountId; readonly publicKey: typeof IDENTITY.accessPublicKey;
  readonly receiverId: typeof IDENTITY.accountId; readonly action: "Transfer"; readonly amountYocto: "1";
  readonly primaryRpc: string; readonly secondaryRpc: string;
  readonly previousNonce: string; readonly transactionNonce: string;
  readonly referenceBlock: ExperimentAPreflight["referenceBlock"];
  readonly transactionHash: string; readonly createdAt: string; readonly expiresAt: string;
  readonly preflight: ExperimentAPreflight; readonly preparationHash: string;
  status: ExperimentAStatus;
  attempt: { readonly approvedHash: string; readonly reference: string; readonly at: string } | null;
  events: readonly ExperimentAEvent[];
  verification: { readonly primary: ExperimentAFinalProof | null; readonly secondary: ExperimentAFinalProof | null;
    readonly observedAt: string; readonly finalKeyNonce: string | null; readonly finalAccountBalanceYocto: string | null;
    readonly otherNonceActivity: boolean; readonly balanceObservation: "latest-public-state-not-isolated-historical-proof" } | null;
}
export class ExperimentAError extends Error {
  constructor(readonly code: string, message: string, readonly diagnostic?: NearSubmissionDiagnostic,
    readonly publicFeeBalance?: ExperimentAFeeBalanceDetails) {
    super(message); this.name = "ExperimentAError";
  }
}
export interface ExperimentAFeeBalanceDetails {
  readonly balanceYocto: string; readonly storageUsage: number; readonly storageReserveYocto: string;
  readonly spendableYocto: string; readonly gasPriceYocto: string; readonly estimatedGas: string;
  readonly estimatedFeeYocto: string; readonly approvedFeeBudgetYocto: string; readonly suppliedFeeBudgetYocto: string;
  readonly requiredSpendableYocto: string; readonly requiredGrossBalanceYocto: string;
  readonly comparisons: Readonly<Record<"storageCovered" | "spendableArithmeticMatches" | "positiveGasPrice" | "positiveGasEstimate" |
    "feeArithmeticMatches" | "approvedBudgetUnchanged" | "feeWithinBudget" | "spendableCoversFeeAndTransfer", boolean>>;
}
function check(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new ExperimentAError(code, message);
}
function object(value: unknown): Record<string, any> {
  check(value && typeof value === "object" && !Array.isArray(value), "INVALID_RESPONSE", "Invalid public diagnostic data.");
  return value as Record<string, any>;
}
function exact(value: object, fields: readonly string[]): void {
  check(Object.keys(value).sort().join(",") === [...fields].sort().join(","), "INVALID_STATE", "Unexpected diagnostic fields.");
}
function quantity(value: unknown): bigint {
  check((typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0), "INVALID_RESPONSE", "Invalid exact public quantity.");
  return BigInt(value);
}
function hash(value: unknown): string {
  check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32,
    "INVALID_STATE", "Require a 32-byte base58 NEAR hash."); return value;
}
function timestamp(value: unknown): number {
  check(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    "INVALID_STATE", "Invalid original diagnostic timestamp."); return Date.parse(value);
}
export function experimentARpcUrl(value: string): string {
  try {
    const url = new URL(value);
    check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === "/" && !url.hostname.toLowerCase().includes("mainnet"), "INVALID_INPUT", "Use a public root HTTPS Testnet RPC without credentials.");
    return url.origin;
  } catch { throw new ExperimentAError("INVALID_INPUT", "Use a public root HTTPS Testnet RPC without credentials."); }
}
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function iso(ports: ExperimentAPorts): string { return new Date(ports.now()).toISOString(); }
function mode(ports: ExperimentAPorts): void { check(["live", "offline-fixtures"].includes(ports.mode), "INVALID_INPUT", "Invalid diagnostic services."); }
function diagnostic(error: unknown, fallback: NearSubmissionDiagnostic["category"]): NearSubmissionDiagnostic {
  if (error instanceof ExperimentAError && error.diagnostic) {
    try { assertNearSubmissionDiagnostic(error.diagnostic); return structuredClone(error.diagnostic); } catch { /* Never copy arbitrary errors. */ }
  }
  return { category: fallback };
}
function label(value: unknown): string {
  check(typeof value === "string" && value.length > 0 && value.length <= 200 && /^[\x20-\x7e]+$/.test(value) && value.trim() === value,
    "INVALID_INPUT", "Use a bounded public approval reference."); return value;
}
async function rawRpc(endpoint: string, method: RpcMethod, params: unknown): Promise<unknown> {
  let response: Response;
  try { response = await fetch(experimentARpcUrl(endpoint), { method: "POST", headers: { "content-type": "application/json" },
    redirect: "error", signal: AbortSignal.timeout(20000), body: JSON.stringify({ jsonrpc: "2.0", id: "wealthpixels-experiment-a", method, params }) }); }
  catch (error) { throw new ExperimentAError("RPC_FAILED", "The diagnostic RPC transport failed.", {
    category: error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "TIMEOUT" : "NETWORK_ERROR" }); }
  if (!response.ok) throw new ExperimentAError("RPC_FAILED", "The diagnostic RPC returned an HTTP error.", { category: "HTTP_ERROR", httpStatus: response.status });
  let body: Record<string, any>;
  try { body = object(await response.json()); }
  catch { throw new ExperimentAError("RPC_FAILED", "The diagnostic RPC response was malformed.", { category: "RPC_RESPONSE_INVALID", httpStatus: response.status }); }
  if (body.jsonrpc !== "2.0" || body.id !== "wealthpixels-experiment-a") throw new ExperimentAError("RPC_FAILED", "Invalid diagnostic RPC envelope.", { category: "RPC_RESPONSE_INVALID" });
  if (body.error) throw new ExperimentAError("RPC_FAILED", "The diagnostic RPC returned an error.", nearRpcErrorDiagnostic(body.error, response.status));
  check(Object.hasOwn(body, "result"), "RPC_FAILED", "The diagnostic RPC result is missing."); return body.result;
}
/** No provider/Account send helper is used: the production transport is one POST with no retries. */
export function createExperimentAPorts(repositoryRoot = process.cwd()): ExperimentAPorts {
  let selectedPath: string | undefined;
  return { mode: "live", now: () => Date.now(), rpc: rawRpc,
    verifySignature(publicKey, message, signature) { try { return PublicKey.fromString(publicKey).verify(message, signature); } catch { return false; } },
    async loadSigner(pathValue) {
      try {
        check(isAbsolute(pathValue) && basename(pathValue) === "investor.json", "CREDENTIAL_FAILED", "Select the explicit protected Investor credential.");
        const path = resolve(pathValue), repository = await realpath(repositoryRoot), rel = relative(repository, path);
        check((rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) && (!selectedPath || selectedPath.toLowerCase() === path.toLowerCase()), "CREDENTIAL_FAILED", "Only one external Investor credential is allowed per process.");
        const info = await lstat(path);
        check(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 4096 && (await realpath(path)).toLowerCase() === path.toLowerCase(),
          "CREDENTIAL_FAILED", "The credential must be one regular protected external file."); selectedPath = path;
        const data = object(JSON.parse(await readFile(path, "utf8"))); exact(data, ["account_id", "public_key", "private_key"]);
        check(data.account_id === IDENTITY.accountId && data.public_key === IDENTITY.accessPublicKey && typeof data.private_key === "string" && data.private_key.startsWith("ed25519:"), "CREDENTIAL_FAILED", "Investor credential identity mismatch.");
        const signer = KeyPairSigner.fromSecretKey(data.private_key as KeyPairString);
        check((await signer.getPublicKey()).toString() === IDENTITY.accessPublicKey, "CREDENTIAL_FAILED", "Investor credential public key mismatch."); return signer;
      } catch { throw new ExperimentAError("CREDENTIAL_FAILED", "Protected Investor credential validation failed; no private details are exposed."); }
    } };
}
function assertPreflight(value: ExperimentAPreflight): void {
  const p = object(value);
  exact(p, ["kind", "mode", "networkId", "primaryRpc", "secondaryRpc", "observedAt", "accountId", "publicKey", "referenceBlock", "previousNonce", "balanceYocto", "storageUsage", "storageReserveYocto", "spendableYocto", "gasPriceYocto", "estimatedGas", "estimatedFeeYocto", "feeBudgetYocto", "transactionValidityPeriod"]);
  check(p.kind === "experiment-a-read-only-preflight" && ["live", "offline-fixtures"].includes(p.mode) && p.networkId === "testnet" &&
    p.accountId === IDENTITY.accountId && p.publicKey === IDENTITY.accessPublicKey, "INVALID_STATE", "Diagnostic observations differ from the Investor identity.");
  check(experimentARpcUrl(p.primaryRpc) === p.primaryRpc && experimentARpcUrl(p.secondaryRpc) === p.secondaryRpc && p.primaryRpc !== p.secondaryRpc,
    "INVALID_STATE", "Use two distinct public diagnostic RPC endpoints."); timestamp(p.observedAt);
  const b = object(p.referenceBlock); exact(b, ["hash", "height", "timestampNanosec"]); hash(b.hash);
  check(Number.isSafeInteger(b.height) && b.height > 0 && quantity(b.timestampNanosec) > 0n && quantity(p.previousNonce) < (1n << 64n) - 1n,
    "INVALID_STATE", "Invalid diagnostic nonce or reference block.");
  check(Number.isSafeInteger(p.storageUsage) && p.storageUsage >= 0 && Number.isSafeInteger(p.transactionValidityPeriod) && p.transactionValidityPeriod > 0,
    "INVALID_STATE", "Invalid storage or transaction validity observation.");
  const balance = quantity(p.balanceYocto), reserve = quantity(p.storageReserveYocto), spendable = quantity(p.spendableYocto);
  const gasPrice = quantity(p.gasPriceYocto), gas = quantity(p.estimatedGas), fee = quantity(p.estimatedFeeYocto), budget = quantity(p.feeBudgetYocto);
  const comparisons = {
    storageCovered: balance >= reserve, spendableArithmeticMatches: spendable === balance - reserve,
    positiveGasPrice: gasPrice > 0n, positiveGasEstimate: gas > 0n, feeArithmeticMatches: fee === gas * gasPrice,
    approvedBudgetUnchanged: p.feeBudgetYocto === EXPERIMENT_A_FEE_BUDGET_YOCTO,
    feeWithinBudget: fee <= budget, spendableCoversFeeAndTransfer: spendable >= fee + 1n,
  };
  if (!Object.values(comparisons).every(Boolean)) {
    const details: ExperimentAFeeBalanceDetails = { balanceYocto: balance.toString(), storageUsage: p.storageUsage,
      storageReserveYocto: reserve.toString(), spendableYocto: spendable.toString(), gasPriceYocto: gasPrice.toString(),
      estimatedGas: gas.toString(), estimatedFeeYocto: fee.toString(), approvedFeeBudgetYocto: EXPERIMENT_A_FEE_BUDGET_YOCTO,
      suppliedFeeBudgetYocto: budget.toString(), requiredSpendableYocto: (fee + 1n).toString(), requiredGrossBalanceYocto: (reserve + fee + 1n).toString(), comparisons };
    const malformed = !comparisons.spendableArithmeticMatches || !comparisons.positiveGasPrice || !comparisons.positiveGasEstimate ||
      !comparisons.feeArithmeticMatches || !comparisons.approvedBudgetUnchanged;
    const code = malformed ? "FEE_CALCULATION_INVALID" : !comparisons.storageCovered || !comparisons.spendableCoversFeeAndTransfer ? "BALANCE_INSUFFICIENT" : "FEE_BUDGET_EXCEEDED";
    throw new ExperimentAError(code, code === "FEE_BUDGET_EXCEEDED" ? "The diagnostic estimated fee exceeds the unchanged approved budget." :
      code === "BALANCE_INSUFFICIENT" ? "The diagnostic storage-safe balance is insufficient." : "The diagnostic fee or balance arithmetic is inconsistent.", undefined, details);
  }
}
function assertStoredProof(value: unknown, state: ExperimentAState, endpoint: string): void {
  const p = object(value);
  exact(p, ["endpoint", "transactionHash", "transactionNonce", "transactionBlockHash", "success", "finalExecutionStatus", "receiptIds", "totalTokensBurntYocto", "publicSignature"]);
  check(p.endpoint === endpoint && p.transactionHash === state.transactionHash && p.transactionNonce === state.transactionNonce &&
    p.finalExecutionStatus === "FINAL" && typeof p.success === "boolean", "INVALID_STATE", "Stored FINAL proof differs from the diagnostic.");
  hash(p.transactionBlockHash); quantity(p.totalTokensBurntYocto);
  check(Array.isArray(p.receiptIds) && p.receiptIds.length > 0 && p.receiptIds.length <= 20 && new Set(p.receiptIds).size === p.receiptIds.length,
    "INVALID_STATE", "Stored receipt identities are invalid.");
  for (const id of p.receiptIds) hash(id);
  check(typeof p.publicSignature === "string" && p.publicSignature.startsWith("ed25519:") && baseDecode(p.publicSignature.slice(8)).length === 64,
    "INVALID_STATE", "Stored public signature is invalid.");
  // Synthetic proof verification is only available to code-injected offline ports; the CLI rejects that mode.
  check(state.mode === "offline-fixtures" || PublicKey.fromString(state.publicKey).verify(baseDecode(state.transactionHash), baseDecode(p.publicSignature.slice(8))),
    "INVALID_STATE", "Stored public signature does not authorize this transaction.");
}
export async function observeExperimentA(options: { primaryRpc?: string; secondaryRpc?: string }, ports: ExperimentAPorts): Promise<ExperimentAPreflight> {
  mode(ports); const startedAt = ports.now();
  const primaryRpc = experimentARpcUrl(options.primaryRpc ?? EXPERIMENT_A_PRIMARY_RPC), secondaryRpc = experimentARpcUrl(options.secondaryRpc ?? EXPERIMENT_A_SECONDARY_RPC);
  check(primaryRpc !== secondaryRpc, "INVALID_INPUT", "Select two distinct diagnostic endpoints.");
  const status = object(await ports.rpc(primaryRpc, "status", []));
  check(status.chain_id === "testnet" && status.sync_info?.syncing === false, "WRONG_NETWORK", "Require a synchronized NEAR Testnet RPC.");
  const block = object(await ports.rpc(primaryRpc, "block", { finality: "final" })), h = object(block.header);
  hash(h.hash); check(Number.isSafeInteger(h.height) && h.height > 0, "INVALID_RESPONSE", "Invalid FINAL block.");
  const blockMs = Number(quantity(h.timestamp_nanosec) / 1_000_000n);
  check(Number.isSafeInteger(blockMs) && blockMs <= ports.now() + 120_000 && blockMs >= ports.now() - 60_000, "STALE_OBSERVATION", "The FINAL reference block is stale or has an invalid timestamp.");
  const account = object(await ports.rpc(primaryRpc, "query", { request_type: "view_account", account_id: IDENTITY.accountId, block_id: h.hash }));
  const keys = object(await ports.rpc(primaryRpc, "query", { request_type: "view_access_key_list", account_id: IDENTITY.accountId, block_id: h.hash }));
  for (const result of [account, keys]) check(result.block_hash === h.hash && result.block_height === h.height, "INVALID_RESPONSE", "Investor observations do not share the FINAL block.");
  check(account.code_hash === ZERO_HASH && Array.isArray(keys.keys) && keys.keys.length === 1 && keys.keys[0]?.public_key === IDENTITY.accessPublicKey && keys.keys[0]?.access_key?.permission === "FullAccess",
    "AUTHORITY_FAILED", "Require the existing ordinary Investor account and its sole verified FullAccess key.");
  const config = object(await ports.rpc(primaryRpc, "EXPERIMENTAL_protocol_config", { block_id: h.hash }));
  check(config.chain_id === "testnet", "WRONG_NETWORK", "The protocol configuration is not Testnet.");
  const runtime = object(config.runtime_config), costs = object(runtime.transaction_costs), receipt = object(costs.action_receipt_creation_config), transfer = object(object(costs.action_creation_config).transfer_cost);
  const gas = quantity(receipt.send_sir) + quantity(receipt.execution) + quantity(transfer.send_sir) + quantity(transfer.execution);
  const price = object(await ports.rpc(primaryRpc, "gas_price", [h.hash]));
  const market = quantity(price.gas_price), minimum = quantity(runtime.min_gas_purchase_price), ratio = costs.pessimistic_gas_price_inflation_ratio;
  check(Array.isArray(ratio) && ratio.length === 2 && quantity(ratio[0]) >= quantity(ratio[1]) && quantity(ratio[1]) > 0n, "INVALID_RESPONSE", "Missing conservative gas-price assumptions.");
  const gasPrice = ((market > minimum ? market : minimum) * quantity(ratio[0]) + quantity(ratio[1]) - 1n) / quantity(ratio[1]);
  check(Number.isSafeInteger(account.storage_usage) && account.storage_usage >= 0, "INVALID_RESPONSE", "Invalid Investor storage observation.");
  const balance = quantity(account.amount), reserve = BigInt(account.storage_usage) * quantity(runtime.storage_amount_per_byte);
  check(balance >= reserve, "FEE_OR_BALANCE_FAILED", "Investor storage reserve is insufficient.");
  check(ports.now() >= startedAt && ports.now() - startedAt <= 60_000 && blockMs >= ports.now() - 60_000,
    "STALE_OBSERVATION", "Diagnostic observations expired while public reads were in progress.");
  const observed: ExperimentAPreflight = { kind: "experiment-a-read-only-preflight", mode: ports.mode, networkId: "testnet", primaryRpc, secondaryRpc,
    observedAt: new Date(startedAt).toISOString(), accountId: IDENTITY.accountId, publicKey: IDENTITY.accessPublicKey, referenceBlock: { hash: h.hash, height: h.height, timestampNanosec: String(h.timestamp_nanosec) },
    previousNonce: quantity(keys.keys[0].access_key.nonce).toString(), balanceYocto: balance.toString(), storageUsage: account.storage_usage,
    storageReserveYocto: reserve.toString(), spendableYocto: (balance - reserve).toString(), gasPriceYocto: gasPrice.toString(), estimatedGas: gas.toString(), estimatedFeeYocto: (gas * gasPrice).toString(),
    feeBudgetYocto: EXPERIMENT_A_FEE_BUDGET_YOCTO, transactionValidityPeriod: config.transaction_validity_period };
  assertPreflight(observed); return structuredClone(observed);
}
function transaction(state: Pick<ExperimentAState, "transactionNonce" | "referenceBlock">): Transaction {
  return createTransaction(IDENTITY.accountId, PublicKey.fromString(IDENTITY.accessPublicKey), IDENTITY.accountId,
    quantity(state.transactionNonce), [actions.transfer(1n)], baseDecode(hash(state.referenceBlock.hash)));
}
function preparationBody(s: Omit<ExperimentAState, "preparationHash"> | ExperimentAState): unknown {
  return { schemaVersion: s.schemaVersion, kind: s.kind, mode: s.mode, id: s.id, role: s.role, signerAccountId: s.signerAccountId, publicKey: s.publicKey,
    receiverId: s.receiverId, action: s.action, amountYocto: s.amountYocto, primaryRpc: s.primaryRpc, secondaryRpc: s.secondaryRpc,
    previousNonce: s.previousNonce, transactionNonce: s.transactionNonce, referenceBlock: s.referenceBlock, transactionHash: s.transactionHash,
    createdAt: s.createdAt, expiresAt: s.expiresAt, preflight: s.preflight };
}
export function prepareExperimentA(id: string, preflight: ExperimentAPreflight, nowMs: number): ExperimentAState {
  assertPreflight(preflight); check(/^experiment-a-investor-[a-z0-9][a-z0-9-]{0,95}$/.test(id), "INVALID_INPUT", "Use a unique experiment-a-investor diagnostic identifier.");
  check(Number.isSafeInteger(nowMs) && nowMs >= timestamp(preflight.observedAt) && nowMs - timestamp(preflight.observedAt) <= 60_000,
    "STALE_OBSERVATION", "Diagnostic preparation requires observations no older than 60 seconds.");
  const createdAt = new Date(nowMs).toISOString(), referenceBlock = structuredClone(preflight.referenceBlock), transactionNonce = (quantity(preflight.previousNonce) + 1n).toString();
  const transactionHash = baseEncode(createHash("sha256").update(transaction({ transactionNonce, referenceBlock }).encode()).digest());
  const body: Omit<ExperimentAState, "preparationHash"> = { schemaVersion: 1, kind: "experiment-a-near-self-transfer", mode: preflight.mode, id,
    role: "investor", signerAccountId: IDENTITY.accountId, publicKey: IDENTITY.accessPublicKey, receiverId: IDENTITY.accountId, action: "Transfer", amountYocto: "1",
    primaryRpc: preflight.primaryRpc, secondaryRpc: preflight.secondaryRpc, previousNonce: preflight.previousNonce, transactionNonce, referenceBlock, transactionHash,
    createdAt, expiresAt: new Date(nowMs + EXPERIMENT_A_PREPARATION_MS).toISOString(), preflight: structuredClone(preflight),
    status: "prepared", attempt: null, events: [{ stage: "prepared", at: createdAt }], verification: null };
  const state = { ...body, preparationHash: sha(JSON.stringify(preparationBody(body))) }; assertExperimentAState(state); return state;
}
export function assertExperimentAState(value: unknown): asserts value is ExperimentAState {
  const s = object(value);
  exact(s, ["schemaVersion", "kind", "mode", "id", "role", "signerAccountId", "publicKey", "receiverId", "action", "amountYocto", "primaryRpc", "secondaryRpc", "previousNonce", "transactionNonce", "referenceBlock", "transactionHash", "createdAt", "expiresAt", "preflight", "preparationHash", "status", "attempt", "events", "verification"]);
  check(s.schemaVersion === 1 && s.kind === "experiment-a-near-self-transfer" && ["live", "offline-fixtures"].includes(s.mode) && /^experiment-a-investor-[a-z0-9][a-z0-9-]{0,95}$/.test(s.id) &&
    s.role === "investor" && s.signerAccountId === IDENTITY.accountId && s.publicKey === IDENTITY.accessPublicKey && s.receiverId === IDENTITY.accountId && s.action === "Transfer" && s.amountYocto === "1",
    "INVALID_STATE", "The diagnostic differs from the exact Investor self-transfer.");
  assertPreflight(s.preflight);
  check(s.mode === s.preflight.mode && s.primaryRpc === s.preflight.primaryRpc && s.secondaryRpc === s.preflight.secondaryRpc && s.previousNonce === s.preflight.previousNonce &&
    isDeepStrictEqual(s.referenceBlock, s.preflight.referenceBlock) && quantity(s.transactionNonce) === quantity(s.previousNonce) + 1n && quantity(s.transactionNonce) < (1n << 64n),
    "INVALID_STATE", "Original diagnostic metadata changed.");
  check(timestamp(s.expiresAt) === timestamp(s.createdAt) + EXPERIMENT_A_PREPARATION_MS && timestamp(s.createdAt) >= timestamp(s.preflight.observedAt) && timestamp(s.createdAt) - timestamp(s.preflight.observedAt) <= 60_000 &&
    hash(s.transactionHash) === baseEncode(createHash("sha256").update(transaction(s as ExperimentAState).encode()).digest()) &&
    s.preparationHash === sha(JSON.stringify(preparationBody(s as ExperimentAState))), "INVALID_STATE", "Diagnostic hash, preparation or original deadline changed.");
  check(["prepared", "attempting", "failed-before-send", "submission-uncertain", "rpc-accepted", "unresolved", "final-success", "final-failure"].includes(s.status), "INVALID_STATE", "Invalid diagnostic stage.");
  check(Array.isArray(s.events) && s.events.length > 0 && s.events.length <= 100 && s.events[0].stage === "prepared" && s.events[0].at === s.createdAt, "INVALID_STATE", "Missing diagnostic event history.");
  let last = timestamp(s.createdAt);
  const transitions: Record<string, readonly string[]> = {
    prepared: ["attempt-marked"],
    "attempt-marked": ["preflight-failed", "credential-validated", "reconciliation-unresolved", "final-success", "final-failure"],
    "credential-validated": ["send-intent", "reconciliation-unresolved", "final-success", "final-failure"],
    "send-intent": ["preflight-failed", "rpc-accepted", "submission-uncertain", "reconciliation-unresolved", "final-success", "final-failure"],
    "preflight-failed": [], "rpc-accepted": ["reconciliation-unresolved", "final-success", "final-failure"],
    "submission-uncertain": ["reconciliation-unresolved", "final-success", "final-failure"],
    "reconciliation-unresolved": ["reconciliation-unresolved", "final-success", "final-failure"], "final-success": [], "final-failure": [],
  };
  let previousStage: string | undefined;
  for (const event of s.events) { const e = object(event); exact(e, e.diagnostic === undefined ? ["stage", "at"] : ["stage", "at", "diagnostic"]);
    check(["prepared", "attempt-marked", "preflight-failed", "credential-validated", "send-intent", "rpc-accepted", "submission-uncertain", "reconciliation-unresolved", "final-success", "final-failure"].includes(e.stage) && timestamp(e.at) >= last, "INVALID_STATE", "Invalid diagnostic chronology.");
    if (previousStage !== undefined) check(transitions[previousStage].includes(e.stage), "INVALID_STATE", "Invalid diagnostic event transition.");
    previousStage = e.stage;
    last = timestamp(e.at); if (e.diagnostic !== undefined) assertNearSubmissionDiagnostic(e.diagnostic); }
  const lastStages: Record<ExperimentAStatus, readonly string[]> = { prepared: ["prepared"], attempting: ["attempt-marked", "credential-validated", "send-intent"],
    "failed-before-send": ["preflight-failed"], "submission-uncertain": ["submission-uncertain"], "rpc-accepted": ["rpc-accepted"],
    unresolved: ["reconciliation-unresolved"], "final-success": ["final-success"], "final-failure": ["final-failure"] };
  check(lastStages[s.status as ExperimentAStatus].includes(previousStage!), "INVALID_STATE", "Diagnostic status differs from its durable event history.");
  if (s.status === "prepared") check(s.attempt === null && s.events.length === 1 && s.verification === null, "INVALID_STATE", "A prepared diagnostic cannot contain an earlier attempt.");
  else { const attempt = object(s.attempt); exact(attempt, ["approvedHash", "reference", "at"]); label(attempt.reference);
    check(attempt.approvedHash === s.transactionHash && timestamp(attempt.at) >= timestamp(s.createdAt) && timestamp(attempt.at) < timestamp(s.expiresAt) &&
      s.events.some((e: ExperimentAEvent) => e.stage === "attempt-marked" && e.at === attempt.at), "INVALID_STATE", "Missing original hash-bound diagnostic approval."); }
  if (s.verification !== null) {
    check(["unresolved", "final-success", "final-failure"].includes(s.status), "INVALID_STATE", "Unexpected verification before reconciliation.");
    const v = object(s.verification);
    exact(v, ["primary", "secondary", "observedAt", "finalKeyNonce", "finalAccountBalanceYocto", "otherNonceActivity", "balanceObservation"]);
    check(timestamp(v.observedAt) >= timestamp(s.createdAt) && timestamp(v.observedAt) <= last &&
      v.balanceObservation === "latest-public-state-not-isolated-historical-proof", "INVALID_STATE", "Invalid public verification observation.");
    if (v.primary !== null) assertStoredProof(v.primary, s as ExperimentAState, s.primaryRpc);
    if (v.secondary !== null) assertStoredProof(v.secondary, s as ExperimentAState, s.secondaryRpc);
    if (v.finalKeyNonce !== null) quantity(v.finalKeyNonce);
    if (v.finalAccountBalanceYocto !== null) quantity(v.finalAccountBalanceYocto);
    check(v.otherNonceActivity === (v.finalKeyNonce !== null && quantity(v.finalKeyNonce) > quantity(s.transactionNonce)), "INVALID_STATE", "Invalid nonce reconciliation flag.");
  }
  if (s.status === "final-success" || s.status === "final-failure") {
    const v = object(s.verification);
    check(v.primary && v.secondary && v.primary.success === (s.status === "final-success") &&
      isDeepStrictEqual({ ...v.primary, endpoint: "" }, { ...v.secondary, endpoint: "" }) && v.finalKeyNonce !== null &&
      quantity(v.finalKeyNonce) >= quantity(s.transactionNonce) && v.finalAccountBalanceYocto !== null,
      "INVALID_STATE", "FINAL status requires corroborated proof and reconciled account observations.");
  }
}
export function publicExperimentASummary(state: ExperimentAState): unknown { assertExperimentAState(state); return structuredClone(state); }
async function commit(state: ExperimentAState, candidate: ExperimentAState, save: (state: ExperimentAState) => Promise<void>): Promise<void> {
  assertExperimentAState(state); assertExperimentAState(candidate);
  check(state.preparationHash === candidate.preparationHash && isDeepStrictEqual(preparationBody(state), preparationBody(candidate)) &&
    (!state.attempt || isDeepStrictEqual(state.attempt, candidate.attempt)) && candidate.events.length === state.events.length + 1 && isDeepStrictEqual(candidate.events.slice(0, -1), state.events),
    "INVALID_STATE", "Original diagnostic or submission history cannot be replaced.");
  try { await save(structuredClone(candidate)); } catch { throw new ExperimentAError("PERSISTENCE_FAILED", "Diagnostic state could not be saved. Preserve the last durable stage and do not retry."); }
  Object.assign(state, structuredClone(candidate));
}
function event(state: ExperimentAState, ports: ExperimentAPorts, stage: string, status: ExperimentAStatus, details: Partial<ExperimentAState> = {}, d?: NearSubmissionDiagnostic): ExperimentAState {
  return { ...structuredClone(state), ...details, status, events: [...state.events, { stage, at: iso(ports), ...(d ? { diagnostic: d } : {}) }] };
}
function fresh(state: ExperimentAState, ports: ExperimentAPorts): void {
  check(ports.now() >= timestamp(state.createdAt) && ports.now() < timestamp(state.expiresAt), "DEADLINE_EXPIRED", "Original diagnostic preparation expired; do not reset timestamps or retry this attempt.");
}
export async function submitExperimentA(state: ExperimentAState, input: { role: "investor"; approval: string; reference: string; credentialPath: string }, ports: ExperimentAPorts,
  save: (state: ExperimentAState) => Promise<void>): Promise<void> {
  assertExperimentAState(state); mode(ports);
  check(state.mode === ports.mode && input.role === "investor" && state.status === "prepared" && state.attempt === null && input.approval === state.transactionHash,
    "APPROVAL_FAILED", "Require the unattempted Investor diagnostic and exact hash-bound signing/submission approval."); label(input.reference); fresh(state, ports);
  const markedAt = iso(ports), attempt = { approvedHash: state.transactionHash, reference: input.reference, at: markedAt };
  await commit(state, { ...structuredClone(state), status: "attempting", attempt,
    events: [...state.events, { stage: "attempt-marked", at: markedAt }] }, save);
  let signedBytes: string;
  let checkedAt: number;
  try {
    const current = await observeExperimentA({ primaryRpc: state.primaryRpc, secondaryRpc: state.secondaryRpc }, ports); fresh(state, ports);
    checkedAt = timestamp(current.observedAt);
    check(current.previousNonce === state.previousNonce && current.referenceBlock.height >= state.referenceBlock.height &&
      current.referenceBlock.height <= state.referenceBlock.height + current.transactionValidityPeriod, "NONCE_OR_REFERENCE_CHANGED", "Diagnostic nonce or reference-block validity changed; no substitution is permitted.");
    const originalBlock = object(await ports.rpc(state.primaryRpc, "block", { block_id: state.referenceBlock.height }));
    check(originalBlock.header?.hash === state.referenceBlock.hash && originalBlock.header?.height === state.referenceBlock.height, "REFERENCE_CHANGED", "The original reference block is not canonical."); fresh(state, ports);
    check(ports.now() >= checkedAt && ports.now() - checkedAt <= 60_000, "STALE_OBSERVATION", "Diagnostic fee and balance observations expired before credential access.");
    const signer = await ports.loadSigner(input.credentialPath);
    check((await signer.getPublicKey()).toString() === state.publicKey, "CREDENTIAL_FAILED", "Selected credential does not match the registered Investor public key."); fresh(state, ports);
    check(ports.now() >= checkedAt && ports.now() - checkedAt <= 60_000, "STALE_OBSERVATION", "Diagnostic fee and balance observations expired before local signing.");
    const unsigned = transaction(state), encoded = unsigned.encode(), signed = await signer.signTransaction(unsigned);
    check(baseEncode(signed.txHash) === state.transactionHash && Buffer.from(signed.signedTransaction.transaction.encode()).equals(Buffer.from(encoded)) &&
      signed.signedTransaction.signature.signatureType === 0 && ports.verifySignature(state.publicKey, baseDecode(state.transactionHash), signed.signedTransaction.signature.data),
      "SIGNATURE_FAILED", "Locally signed diagnostic differs from its approved bytes or Investor signature.");
    signedBytes = Buffer.from(signed.signedTransaction.encode()).toString("base64");
    await commit(state, event(state, ports, "credential-validated", "attempting"), save); fresh(state, ports);
  } catch (error) {
    if (error instanceof ExperimentAError && error.code === "PERSISTENCE_FAILED") throw error;
    await commit(state, event(state, ports, "preflight-failed", "failed-before-send", {}, diagnostic(error, error instanceof ExperimentAError && error.code === "DEADLINE_EXPIRED" ? "DEADLINE_EXPIRED" : "PUBLIC_CHECK_FAILED")), save); return;
  }
  await commit(state, event(state, ports, "send-intent", "attempting"), save);
  try {
    fresh(state, ports);
    check(ports.now() >= checkedAt && ports.now() - checkedAt <= 60_000, "STALE_OBSERVATION", "Diagnostic fee and balance observations expired before submission.");
  } catch (error) {
    await commit(state, event(state, ports, "preflight-failed", "failed-before-send", {},
      { category: error instanceof ExperimentAError && error.code === "DEADLINE_EXPIRED" ? "DEADLINE_EXPIRED" : "PUBLIC_CHECK_FAILED" }), save); return;
  }
  let response: unknown;
  try { response = await ports.rpc(state.primaryRpc, "send_tx", { signed_tx_base64: signedBytes, wait_until: "NONE" }); }
  catch (error) { await commit(state, event(state, ports, "submission-uncertain", "submission-uncertain", {}, diagnostic(error, "UNCLASSIFIED_ERROR")), save); return; }
  const result = response && typeof response === "object" ? response as Record<string, any> : {};
  const responseHash = result.transaction?.hash ?? result.transaction_hash;
  if ((responseHash !== undefined && responseHash !== state.transactionHash) ||
      !["NONE", "INCLUDED", "EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", "EXECUTED", "FINAL"].includes(result.final_execution_status)) {
    await commit(state, event(state, ports, "submission-uncertain", "submission-uncertain", {}, { category: "RPC_RESPONSE_INVALID" }), save); return;
  }
  await commit(state, event(state, ports, "rpc-accepted", "rpc-accepted", {}, nearRpcResponseDiagnostic(result)), save);
}
function verifyFinal(state: ExperimentAState, endpoint: string, value: unknown, ports: ExperimentAPorts): ExperimentAFinalProof {
  const o = object(value), tx = object(o.transaction);
  check(o.final_execution_status === "FINAL", "INCOMPLETE", "The diagnostic transaction has not reached FINAL execution.");
  check(tx.hash === state.transactionHash && tx.signer_id === state.signerAccountId && tx.public_key === state.publicKey && tx.receiver_id === state.receiverId && quantity(tx.nonce) === quantity(state.transactionNonce) &&
    (tx.priority_fee === undefined || quantity(tx.priority_fee) === 0n) && Array.isArray(tx.actions) && tx.actions.length === 1 && Object.keys(object(tx.actions[0])).join() === "Transfer" &&
    Object.keys(object(tx.actions[0].Transfer)).join() === "deposit" && tx.actions[0].Transfer.deposit === "1", "INVALID_OUTCOME", "Finalized diagnostic transaction differs from the exact approved self-transfer.");
  check(typeof tx.signature === "string" && tx.signature.startsWith("ed25519:") && baseDecode(tx.signature.slice(8)).length === 64 &&
    ports.verifySignature(state.publicKey, baseDecode(state.transactionHash), baseDecode(tx.signature.slice(8))), "INVALID_OUTCOME", "The public Investor transaction signature is invalid.");
  const root = object(o.transaction_outcome), rootOutcome = object(root.outcome), outcomes = o.receipts_outcome;
  check(root.id === state.transactionHash && rootOutcome.executor_id === state.signerAccountId && Array.isArray(rootOutcome.receipt_ids) &&
    Array.isArray(outcomes) && outcomes.length > 0 && outcomes.length <= 20, "INVALID_OUTCOME", "The diagnostic receipt tree is missing."); hash(root.block_hash);
  const nodes = new Map<string, Record<string, any>>();
  for (const nodeValue of outcomes) { const node = object(nodeValue); hash(node.id); hash(node.block_hash); check(!nodes.has(node.id), "INVALID_OUTCOME", "Duplicate diagnostic receipt outcome."); nodes.set(node.id, node); }
  const visited = new Set<string>(), pending = [...rootOutcome.receipt_ids]; let burnt = quantity(rootOutcome.tokens_burnt), hasFailure = false;
  function validateStatus(outcome: Record<string, any>) {
    const status = object(outcome.status); check(Object.keys(status).length === 1, "INVALID_OUTCOME", "Invalid receipt execution status.");
    if (Object.hasOwn(status, "Failure")) hasFailure = true;
    else if (Object.hasOwn(status, "SuccessReceiptId")) check(outcome.receipt_ids.includes(status.SuccessReceiptId), "INVALID_OUTCOME", "Missing linked success receipt.");
    else check(Object.hasOwn(status, "SuccessValue") && status.SuccessValue === "", "INVALID_OUTCOME", "Transfer receipt has an unexpected result.");
    check(Array.isArray(outcome.logs) && outcome.logs.length === 0 && Array.isArray(outcome.receipt_ids), "INVALID_OUTCOME", "Unexpected transfer receipt logs or links."); quantity(outcome.gas_burnt);
  }
  validateStatus(rootOutcome);
  while (pending.length) { const id = pending.shift(); check(typeof id === "string" && !visited.has(id) && nodes.has(id), "INVALID_OUTCOME", "Unresolved or cyclic diagnostic receipt tree."); visited.add(id);
    const node = nodes.get(id)!, outcome = object(node.outcome); check(outcome.executor_id === state.receiverId || outcome.executor_id === "system", "INVALID_OUTCOME", "Unexpected diagnostic receipt executor.");
    validateStatus(outcome); burnt += quantity(outcome.tokens_burnt); pending.push(...outcome.receipt_ids); }
  check(visited.size === nodes.size, "INVALID_OUTCOME", "Unrelated receipt outcomes were supplied.");
  const status = object(o.status); check(Object.keys(status).length === 1 && (hasFailure ? Object.hasOwn(status, "Failure") : status.SuccessValue === ""), "INVALID_OUTCOME", "Final receipt and transaction statuses disagree.");
  return { endpoint, transactionHash: state.transactionHash, transactionNonce: state.transactionNonce, transactionBlockHash: root.block_hash,
    success: !hasFailure, finalExecutionStatus: "FINAL", receiptIds: [...visited], totalTokensBurntYocto: burnt.toString(), publicSignature: tx.signature };
}
export async function reconcileExperimentA(state: ExperimentAState, ports: ExperimentAPorts, save: (state: ExperimentAState) => Promise<void>): Promise<void> {
  assertExperimentAState(state); mode(ports);
  check(state.mode === ports.mode && state.attempt !== null && state.status !== "prepared" && state.status !== "failed-before-send", "INVALID_STATE", "Only an existing potentially submitted diagnostic can be reconciled.");
  if (state.status === "final-success" || state.status === "final-failure") return;
  let primary: ExperimentAFinalProof | null = null, secondary: ExperimentAFinalProof | null = null;
  let keyNonce: string | null = null, balance: string | null = null;
  try {
    let lookupError: unknown;
    for (const endpoint of [state.primaryRpc, state.secondaryRpc]) {
      try {
        const status = object(await ports.rpc(endpoint, "status", [])); check(status.chain_id === "testnet" && status.sync_info?.syncing === false, "WRONG_NETWORK", "Reconciliation requires synchronized Testnet endpoints.");
        const outcome = await ports.rpc(endpoint, "tx", { tx_hash: state.transactionHash, sender_account_id: state.signerAccountId, wait_until: "NONE" });
        const proof = verifyFinal(state, endpoint, outcome, ports); if (endpoint === state.primaryRpc) primary = proof; else secondary = proof;
      } catch (error) { lookupError = error; }
    }
    if (lookupError) throw lookupError;
    check(primary && secondary && isDeepStrictEqual({ ...primary, endpoint: "" }, { ...secondary, endpoint: "" }), "CONTRADICTORY_OUTCOME", "Public endpoints disagree about the finalized diagnostic.");
    const finalBlock = object(await ports.rpc(state.primaryRpc, "block", { finality: "final" })), header = object(finalBlock.header); hash(header.hash);
    const keys = object(await ports.rpc(state.primaryRpc, "query", { request_type: "view_access_key_list", account_id: state.signerAccountId, block_id: header.hash }));
    check(keys.block_hash === header.hash && keys.block_height === header.height && Array.isArray(keys.keys) && keys.keys.length === 1 && keys.keys[0]?.public_key === state.publicKey && keys.keys[0]?.access_key?.permission === "FullAccess", "AUTHORITY_FAILED", "The finalized Investor key state changed.");
    keyNonce = quantity(keys.keys[0].access_key.nonce).toString(); check(quantity(keyNonce) >= quantity(state.transactionNonce), "INCOMPLETE", "FINAL key state does not yet include the diagnostic nonce.");
    const account = object(await ports.rpc(state.primaryRpc, "query", { request_type: "view_account", account_id: state.signerAccountId, block_id: header.hash }));
    check(account.block_hash === header.hash && account.block_height === header.height, "INVALID_RESPONSE", "Final balance does not share the finalized key observation."); balance = quantity(account.amount).toString();
    const canonical = object(await ports.rpc(state.primaryRpc, "block", { block_id: primary.transactionBlockHash }));
    check(canonical.header?.hash === primary.transactionBlockHash && Number.isSafeInteger(canonical.header.height) && canonical.header.height <= header.height,
      "INVALID_OUTCOME", "The diagnostic execution block is not finalized.");
    const canonicalByHeight = object(await ports.rpc(state.primaryRpc, "block", { block_id: canonical.header.height }));
    check(canonicalByHeight.header?.hash === primary.transactionBlockHash, "INVALID_OUTCOME", "The diagnostic execution block is not canonical.");
  } catch (error) {
    await commit(state, event(state, ports, "reconciliation-unresolved", "unresolved", { verification: { primary, secondary, observedAt: iso(ports), finalKeyNonce: keyNonce, finalAccountBalanceYocto: balance,
      otherNonceActivity: keyNonce !== null && quantity(keyNonce) > quantity(state.transactionNonce), balanceObservation: "latest-public-state-not-isolated-historical-proof" } }, diagnostic(error, "PUBLIC_CHECK_FAILED")), save); return;
  }
  const status = primary!.success ? "final-success" : "final-failure";
  await commit(state, event(state, ports, status, status, { verification: { primary, secondary, observedAt: iso(ports), finalKeyNonce: keyNonce, finalAccountBalanceYocto: balance,
    otherNonceActivity: quantity(keyNonce!) > quantity(state.transactionNonce), balanceObservation: "latest-public-state-not-isolated-historical-proof" } }), save);
}
