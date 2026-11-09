import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { actions, baseDecode, baseEncode, createTransaction, PublicKey, type Transaction } from "near-api-js";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID } from "./config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "./identities.js";
import { createExperimentAPorts, type ExperimentASigner } from "./experiment-a.js";
import { calculateExperimentBFeeModel, type ExperimentBFeeInputs, type ExperimentBFeeModel } from "./experiment-b-fees.js";
import { deriveEvmPublicKey, ReadOnlyMpcClient, type MpcViewTransport } from "./mpc.js";
import { normalizeMpcOutcome, verifyRoleMpc, type VerifiedMpcEcdsaSignature, type VerifiedRoleMpc } from "./signing.js";
import { appendNearSubmissionEvent, assertNearSubmissionDiagnostic, assertNearSubmissionRecord, assertNearSubmissionSuccessor,
  createNearSubmissionRecord, nearRpcResponseDiagnostic, type NearSubmissionDiagnostic, type NearSubmissionRecord } from "./submission.js";

export const EXPERIMENT_B_PRIMARY_RPC = "https://test.rpc.fastnear.com";
export const EXPERIMENT_B_SECONDARY_RPC = "https://archival-rpc.testnet.near.org";
export const EXPERIMENT_B_PREPARATION_MS = 900_000;
const IDENTITY = VERIFIED_IDENTITIES.investor;
const GAS = "100000000000000";
const SCALAR_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ZERO_HASH = "1".repeat(32);
type RpcMethod = "status" | "block" | "query" | "EXPERIMENTAL_protocol_config" | "gas_price" | "tx" | "send_tx";
/** Fixture verification is executable injected code; no persisted flag selects a verifier. */
export interface ExperimentBPorts {
  readonly mode: "live" | "offline-fixtures";
  now(): number;
  rpc(endpoint: string, method: RpcMethod, params: unknown): Promise<unknown>;
  loadSigner(credentialPath: string): Promise<ExperimentASigner>;
  verifySignature(publicKey: string, message: Uint8Array, signature: Uint8Array): boolean;
  readAuthority(endpoint: string): Promise<VerifiedRoleMpc>;
  verifyMpcOutcome(outcome: unknown, hash: string, digest: string): VerifiedMpcEcdsaSignature;
}
export interface ExperimentBAuthority {
  readonly rootPublicKey: string; readonly version: "3.18.0"; readonly minimumGasTgas: number;
  readonly derivedPublicKeySec1: string; readonly evmAddress: string;
  readonly blockHash: string; readonly blockHeight: number;
  readonly domainProtocol: "CaitSith" | "RobustEcdsa"; readonly domainEpoch: number;
  readonly domainAttempt: number; readonly domainThreshold: number;
}
export interface ExperimentBPreflight {
  readonly kind: "experiment-b-read-only-preflight"; readonly mode: ExperimentBPorts["mode"];
  readonly networkId: "testnet"; readonly id: string; readonly message: string; readonly digest: string;
  readonly primaryRpc: string; readonly secondaryRpc: string; readonly observedAt: string;
  readonly accountId: string; readonly publicKey: string; readonly authority: ExperimentBAuthority;
  readonly referenceBlock: { readonly hash: string; readonly height: number; readonly timestampNanosec: string };
  readonly previousNonce: string; readonly balanceYocto: string; readonly storageUsage: number;
  readonly storageReserveYocto: string; readonly spendableYocto: string;
  readonly feeModel: ExperimentBFeeModel; readonly feeBudgetYocto: string;
  readonly transactionValidityPeriod: number;
}
export type ExperimentBStatus = "prepared" | "attempting" | "failed-before-send" | "submission-uncertain" |
  "rpc-accepted" | "unresolved" | "final-failure" | "mpc-verified";
export interface ExperimentBEvent { readonly stage: string; readonly at: string; readonly diagnostic?: NearSubmissionDiagnostic }
export interface ExperimentBFinalProof {
  readonly endpoint: string; readonly transactionHash: string; readonly transactionNonce: string;
  readonly transactionBlockHash: string; readonly transactionBlockHeight: number;
  readonly finalExecutionStatus: "FINAL"; readonly success: boolean;
  readonly receiptIds: readonly string[]; readonly totalTokensBurntYocto: string;
  readonly publicSignature: string; readonly signature: VerifiedMpcEcdsaSignature | null;
  readonly outcome: unknown;
}
export interface ExperimentBReconciliationDiagnostic {
  readonly stage: "status" | "tx-lookup" | "final-outcome" | "canonical-blocks" | "signature-verification";
  readonly code: "RPC_FAILED" | "WRONG_NETWORK" | "INVALID_RESPONSE" | "INCOMPLETE" | "INVALID_OUTCOME" | "INVALID_STATE" | "VERIFICATION_FAILED";
  readonly diagnostic: NearSubmissionDiagnostic;
}
export interface ExperimentBState {
  readonly schemaVersion: 1; readonly kind: "experiment-b-near-mpc-diagnostic";
  readonly mode: ExperimentBPorts["mode"]; readonly id: string; readonly role: "investor";
  readonly signerAccountId: string; readonly publicKey: string; readonly receiverId: string;
  readonly action: "FunctionCall"; readonly methodName: "sign"; readonly gas: typeof GAS; readonly depositYocto: "1";
  readonly path: typeof DERIVATION_PATH; readonly domainId: typeof ECDSA_DOMAIN_ID;
  readonly message: string; readonly digest: string; readonly primaryRpc: string; readonly secondaryRpc: string;
  readonly previousNonce: string; readonly transactionNonce: string;
  readonly referenceBlock: ExperimentBPreflight["referenceBlock"];
  readonly transactionHash: string; readonly createdAt: string; readonly expiresAt: string;
  readonly preflight: ExperimentBPreflight; readonly preparationHash: string;
  status: ExperimentBStatus;
  attempt: { readonly approvedDigest: string; readonly approvedHash: string; readonly reference: string; readonly at: string } | null;
  submission: NearSubmissionRecord; events: readonly ExperimentBEvent[];
  verification: { readonly primary: ExperimentBFinalProof | null; readonly secondary: ExperimentBFinalProof | null;
    readonly primaryDiagnostic: ExperimentBReconciliationDiagnostic | null; readonly secondaryDiagnostic: ExperimentBReconciliationDiagnostic | null;
    readonly observedAt: string } | null;
}
export class ExperimentBError extends Error {
  constructor(readonly code: string, message: string, readonly diagnostic?: NearSubmissionDiagnostic,
    readonly publicFeeBalance?: { readonly balanceYocto: string; readonly storageReserveYocto: string; readonly spendableYocto: string;
      readonly feeBudgetYocto: string; readonly estimatedFullAttachmentBurnYocto: string; readonly upfrontGasYocto: string;
      readonly requiredSpendableYocto: string; readonly feeWithinBudget: boolean; readonly spendableCoversUpfrontFunding: boolean }) {
    super(message); this.name = "ExperimentBError";
  }
}
function check(value: unknown, code: string, message: string): asserts value { if (!value) throw new ExperimentBError(code, message); }
function object(value: unknown): Record<string, any> {
  check(value && typeof value === "object" && !Array.isArray(value), "INVALID_RESPONSE", "Invalid public diagnostic data."); return value as Record<string, any>;
}
function exact(value: object, fields: readonly string[]): void {
  check(Object.keys(value).sort().join(",") === [...fields].sort().join(","), "INVALID_STATE", "Unexpected diagnostic fields.");
}
function quantity(value: unknown): bigint {
  check((typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0), "INVALID_RESPONSE", "Invalid exact public quantity."); return BigInt(value);
}
function nonce(value: unknown): bigint { const n = quantity(value); check(n < (1n << 64n), "INVALID_STATE", "Diagnostic nonce exceeds uint64."); return n; }
function hash(value: unknown): string {
  check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32,
    "INVALID_STATE", "Require a 32-byte base58 NEAR hash."); return value;
}
function timestamp(value: unknown): number {
  check(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    "INVALID_STATE", "Invalid original diagnostic timestamp."); return Date.parse(value);
}
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function mode(ports: ExperimentBPorts): void { check(["live", "offline-fixtures"].includes(ports.mode), "INVALID_INPUT", "Invalid diagnostic services."); }
function publicReference(value: unknown): string {
  check(typeof value === "string" && value.length > 0 && value.length <= 200 && /^[\x20-\x7e]+$/.test(value) && value.trim() === value,
    "INVALID_INPUT", "Use a bounded public approval reference."); return value;
}
function safeDiagnostic(error: unknown, fallback: NearSubmissionDiagnostic["category"]): NearSubmissionDiagnostic {
  if (error && typeof error === "object" && "diagnostic" in error) {
    try { const d = (error as { diagnostic: unknown }).diagnostic; assertNearSubmissionDiagnostic(d); return structuredClone(d); } catch { /* Never persist provider messages. */ }
  }
  return { category: fallback };
}
export function experimentBRpcUrl(value: string): string {
  try {
    const url = new URL(value), hostname = url.hostname.toLowerCase();
    check(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === "/" &&
      !hostname.includes("mainnet") && !isIP(hostname) && !hostname.includes(":") &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(hostname) &&
      !["localhost", "local", "internal", "home", "lan"].some(suffix => hostname === suffix || hostname.endsWith("." + suffix)),
      "INVALID_INPUT", "Use a public root HTTPS Testnet RPC origin without credentials, local hosts or nonstandard ports."); return url.origin;
  } catch { throw new ExperimentBError("INVALID_INPUT", "Use a public root HTTPS Testnet RPC origin without credentials, local hosts or nonstandard ports."); }
}
export function canonicalExperimentBMessage(id: string): string {
  check(typeof id === "string" && /^experiment-b-investor-[a-z0-9][a-z0-9-]{0,95}$/.test(id), "INVALID_INPUT", "Use a unique experiment-b-investor diagnostic identifier.");
  return "WealthPixels/Experiment-B/NEAR-testnet/MPC-diagnostic/v1\n" + JSON.stringify({ experimentId: id,
    nearAccountId: IDENTITY.accountId, purpose: "diagnostic-only-no-asset-transfer" }) + "\n";
}
export function experimentBDigest(id: string): string {
  const digest = "0x" + sha(canonicalExperimentBMessage(id));
  check(BigInt(digest) < SCALAR_ORDER, "INVALID_DIGEST", "Diagnostic digest is outside the secp256k1 scalar range; do not reduce it."); return digest;
}
function requestArgs(digest: string): Uint8Array {
  check(/^0x[0-9a-f]{64}$/.test(digest) && BigInt(digest) < SCALAR_ORDER, "INVALID_DIGEST", "Require the exact diagnostic scalar digest.");
  return Buffer.from(JSON.stringify({ request: { payload_v2: { Ecdsa: digest.slice(2) }, path: DERIVATION_PATH, domain_id: ECDSA_DOMAIN_ID } }), "utf8");
}
function transaction(state: Pick<ExperimentBState, "transactionNonce" | "referenceBlock" | "digest">): Transaction {
  return createTransaction(IDENTITY.accountId, PublicKey.fromString(IDENTITY.accessPublicKey), MPC_CONTRACT_ID,
    nonce(state.transactionNonce), [actions.functionCall("sign", requestArgs(state.digest), BigInt(GAS), 1n)], baseDecode(hash(state.referenceBlock.hash)));
}
/** Production public reads use one raw POST each; ReadOnlyMpcClient never gets an SDK retry transport. */
export function createExperimentBPorts(repositoryRoot = process.cwd()): ExperimentBPorts {
  const base = createExperimentAPorts(repositoryRoot);
  return { ...base,
    verifyMpcOutcome: (outcome, txHash, digest) => normalizeMpcOutcome(outcome, "investor", txHash, digest),
    async readAuthority(endpoint) {
      endpoint = experimentBRpcUrl(endpoint);
      const transport: MpcViewTransport = {
        async viewNodeStatus() { const status = object(await base.rpc(endpoint, "status", []));
          check(status.chain_id === "testnet" && status.sync_info?.syncing === false, "WRONG_NETWORK", "Require synchronized NEAR Testnet."); return status; },
        viewBlock: query => base.rpc(endpoint, "block", query),
        async callFunction(request) {
          const result = object(await base.rpc(endpoint, "query", { request_type: "call_function", account_id: request.contractId,
            method_name: request.method, args_base64: Buffer.from(JSON.stringify(request.args), "utf8").toString("base64"), block_id: request.blockQuery.blockId }));
          check(result.block_hash === request.blockQuery.blockId && Array.isArray(result.result) && result.result.length <= 131072 &&
            result.result.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255), "INVALID_RESPONSE", "Invalid pinned MPC public view.");
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(result.result)));
        },
      };
      const client = new ReadOnlyMpcClient({ rpcUrl: endpoint }, transport);
      // Only the read bridge is used. The existing authority verifier still checks the production identities and sole registered key.
      return verifyRoleMpc("investor", endpoint, { mode: "offline-fixtures",
        readMpc: async () => ({ inspection: await client.inspect(), derivation: await client.derive(IDENTITY.accountId, DERIVATION_PATH) }),
        rpc: (method, params) => { check(method === "query", "INVALID_INPUT", "Authority verification only permits the pinned public key query."); return base.rpc(endpoint, method, params); },
        inspectFile: async () => { throw new Error("No credential operation in public authority reads."); },
        readCredentialText: async () => { throw new Error("No credential operation in public authority reads."); },
        createSigner: () => { throw new Error("No signer operation in public authority reads."); },
      });
    },
  };
}
function authoritySummary(value: VerifiedRoleMpc): ExperimentBAuthority {
  const a = object(value), i = object(a.inspection), d = object(a.derivation), domain = object(i.domain);
  const trusted = deriveEvmPublicKey(VERIFIED_MPC_ROOT, IDENTITY.accountId, DERIVATION_PATH);
  check(a.role === "investor" && a.accessPublicKey === IDENTITY.accessPublicKey && nonce(a.accessKeyNonce) < (1n << 64n) - 1n &&
    i.networkId === "testnet" && i.contractId === MPC_CONTRACT_ID && i.domainId === 0 && i.version === "3.18.0" &&
    i.rootPublicKey === VERIFIED_MPC_ROOT && Number.isSafeInteger(i.minimumGasTgas) && i.minimumGasTgas > 0 && i.minimumGasTgas <= 100 &&
    domain.id === 0 && domain.purpose === "Sign" && ["CaitSith", "RobustEcdsa"].includes(domain.protocol) &&
    Number.isSafeInteger(domain.keyEpoch) && domain.keyEpoch >= 0 && Number.isSafeInteger(domain.keyAttempt) && domain.keyAttempt >= 0 &&
    Number.isSafeInteger(domain.reconstructionThreshold) && domain.reconstructionThreshold >= 2 &&
    d.nearAccountId === IDENTITY.accountId && d.derivationPath === DERIVATION_PATH && d.domainId === 0 &&
    d.localMatchesContract === true && d.blockHash === i.blockHash && d.blockHeight === i.blockHeight &&
    d.derivedPublicKeySec1 === trusted && d.evmAddress === IDENTITY.evmAddress,
    "AUTHORITY_FAILED", "Investor public MPC authority, root, domain, gas or full derivation changed.");
  hash(i.blockHash); check(Number.isSafeInteger(i.blockHeight) && i.blockHeight > 0, "INVALID_RESPONSE", "Invalid FINAL authority block.");
  return { rootPublicKey: i.rootPublicKey, version: i.version, minimumGasTgas: i.minimumGasTgas, derivedPublicKeySec1: trusted,
    evmAddress: IDENTITY.evmAddress, blockHash: i.blockHash, blockHeight: i.blockHeight, domainProtocol: domain.protocol,
    domainEpoch: domain.keyEpoch, domainAttempt: domain.keyAttempt, domainThreshold: domain.reconstructionThreshold };
}
function validateFeeModel(value: unknown, digest: string): asserts value is ExperimentBFeeModel {
  const f = object(value);
  const input: ExperimentBFeeInputs = { protocolVersion: f.protocolVersion, requestBytes: f.requestBytes,
    receiptSendGas: f.receiptSendGas, receiptExecutionGas: f.receiptExecutionGas,
    functionCallSendGas: f.functionCallSendGas, functionCallExecutionGas: f.functionCallExecutionGas,
    functionCallByteSendGas: f.functionCallByteSendGas, functionCallByteExecutionGas: f.functionCallByteExecutionGas,
    blockGasPriceYocto: f.blockGasPriceYocto, receiptPurchaseFloorYocto: f.receiptPurchaseFloorYocto,
    gasRefundPenalty: f.gasRefundPenalty, minimumGasRefundPenalty: f.minimumGasRefundPenalty };
  check(f.requestBytes === Buffer.byteLength("sign", "utf8") + requestArgs(digest).length &&
    isDeepStrictEqual(calculateExperimentBFeeModel(input), f), "INVALID_STATE", "FunctionCall fee inputs, allowance or reserve arithmetic changed.");
}
function assertPreflight(value: ExperimentBPreflight): void {
  const p = object(value);
  exact(p, ["kind", "mode", "networkId", "id", "message", "digest", "primaryRpc", "secondaryRpc", "observedAt", "accountId", "publicKey", "authority",
    "referenceBlock", "previousNonce", "balanceYocto", "storageUsage", "storageReserveYocto", "spendableYocto", "feeModel", "feeBudgetYocto", "transactionValidityPeriod"]);
  check(p.kind === "experiment-b-read-only-preflight" && ["live", "offline-fixtures"].includes(p.mode) && p.networkId === "testnet" &&
    p.accountId === IDENTITY.accountId && p.publicKey === IDENTITY.accessPublicKey && p.message === canonicalExperimentBMessage(p.id) && p.digest === experimentBDigest(p.id),
    "INVALID_STATE", "Preflight differs from the domain-separated Investor diagnostic.");
  check(experimentBRpcUrl(p.primaryRpc) === p.primaryRpc && experimentBRpcUrl(p.secondaryRpc) === p.secondaryRpc && p.primaryRpc !== p.secondaryRpc,
    "INVALID_STATE", "Use two distinct public diagnostic RPC origins.");
  const block = object(p.referenceBlock); exact(block, ["hash", "height", "timestampNanosec"]); hash(block.hash);
  check(Number.isSafeInteger(block.height) && block.height > 0, "INVALID_STATE", "Invalid prepared FINAL block height.");
  const observedAt = timestamp(p.observedAt), blockMs = Number(quantity(block.timestampNanosec) / 1_000_000n);
  check(Number.isSafeInteger(blockMs) && blockMs <= observedAt + 120_000 && blockMs >= observedAt - 60_000,
    "STALE_OBSERVATION", "The original FINAL block timestamp differs from the bounded observation.");
  const a = object(p.authority); exact(a, ["rootPublicKey", "version", "minimumGasTgas", "derivedPublicKeySec1", "evmAddress", "blockHash", "blockHeight",
    "domainProtocol", "domainEpoch", "domainAttempt", "domainThreshold"]);
  check(a.rootPublicKey === VERIFIED_MPC_ROOT && a.version === "3.18.0" && Number.isSafeInteger(a.minimumGasTgas) && a.minimumGasTgas > 0 && a.minimumGasTgas <= 100 &&
    a.derivedPublicKeySec1 === deriveEvmPublicKey(VERIFIED_MPC_ROOT, IDENTITY.accountId, DERIVATION_PATH) && a.evmAddress === IDENTITY.evmAddress &&
    a.blockHash === block.hash && a.blockHeight === block.height && ["CaitSith", "RobustEcdsa"].includes(a.domainProtocol) &&
    Number.isSafeInteger(a.domainEpoch) && a.domainEpoch >= 0 && Number.isSafeInteger(a.domainAttempt) && a.domainAttempt >= 0 &&
    Number.isSafeInteger(a.domainThreshold) && a.domainThreshold >= 2, "INVALID_STATE", "Prepared MPC public authority changed.");
  check(nonce(p.previousNonce) < (1n << 64n) - 1n && typeof p.previousNonce === "string", "INVALID_STATE", "Invalid preceding Investor key nonce.");
  validateFeeModel(p.feeModel, p.digest);
  check(typeof p.feeBudgetYocto === "string" && quantity(p.feeBudgetYocto) > 0n, "INVALID_STATE", "Require an explicit positive diagnostic fee budget.");
  check(Number.isSafeInteger(p.storageUsage) && p.storageUsage >= 0 && typeof p.balanceYocto === "string" && typeof p.storageReserveYocto === "string" &&
    typeof p.spendableYocto === "string" && quantity(p.balanceYocto) >= quantity(p.storageReserveYocto) &&
    quantity(p.spendableYocto) === quantity(p.balanceYocto) - quantity(p.storageReserveYocto), "FEE_OR_BALANCE_FAILED", "Fresh storage reserve arithmetic must match the Investor balance.");
  const feeWithinBudget = quantity(p.feeModel.estimatedFullAttachmentBurnYocto) <= quantity(p.feeBudgetYocto);
  const spendableCoversUpfrontFunding = quantity(p.spendableYocto) >= quantity(p.feeModel.requiredSpendableYocto);
  if (!feeWithinBudget || !spendableCoversUpfrontFunding) throw new ExperimentBError("FEE_OR_BALANCE_FAILED",
    "Diagnostic budget must cover planned full attachment burn and spendable balance must separately cover the upfront reserve.", undefined,
    { balanceYocto: p.balanceYocto, storageReserveYocto: p.storageReserveYocto, spendableYocto: p.spendableYocto, feeBudgetYocto: p.feeBudgetYocto,
      estimatedFullAttachmentBurnYocto: p.feeModel.estimatedFullAttachmentBurnYocto, upfrontGasYocto: p.feeModel.upfrontGasYocto,
      requiredSpendableYocto: p.feeModel.requiredSpendableYocto, feeWithinBudget, spendableCoversUpfrontFunding });
  check(Number.isSafeInteger(p.transactionValidityPeriod) && p.transactionValidityPeriod > 0, "INVALID_STATE", "Missing protocol transaction validity period.");
}
/** Credential-free public observations; this does not prepare an unsigned transaction or approve a budget. */
export async function observeExperimentB(options: { id: string; feeBudgetYocto: string; primaryRpc?: string; secondaryRpc?: string }, ports: ExperimentBPorts): Promise<ExperimentBPreflight> {
  mode(ports); const startedAt = ports.now(), message = canonicalExperimentBMessage(options.id), digest = experimentBDigest(options.id);
  check(typeof options.feeBudgetYocto === "string" && quantity(options.feeBudgetYocto) > 0n, "INVALID_INPUT", "Supply a separately approved positive Experiment B fee budget.");
  const primaryRpc = experimentBRpcUrl(options.primaryRpc ?? EXPERIMENT_B_PRIMARY_RPC), secondaryRpc = experimentBRpcUrl(options.secondaryRpc ?? EXPERIMENT_B_SECONDARY_RPC);
  check(primaryRpc !== secondaryRpc, "INVALID_INPUT", "Select two distinct public diagnostic endpoints.");
  const status = object(await ports.rpc(primaryRpc, "status", []));
  check(status.chain_id === "testnet" && status.sync_info?.syncing === false, "WRONG_NETWORK", "Require synchronized NEAR Testnet.");
  const authority = await ports.readAuthority(primaryRpc), summary = authoritySummary(authority);
  const block = object(await ports.rpc(primaryRpc, "block", { block_id: summary.blockHash })), h = object(block.header);
  check(h.hash === summary.blockHash && h.height === summary.blockHeight, "INVALID_RESPONSE", "Public observations must share the MPC FINAL block.");
  const blockMs = Number(quantity(h.timestamp_nanosec) / 1_000_000n);
  check(Number.isSafeInteger(blockMs) && blockMs <= ports.now() + 120_000 && blockMs >= ports.now() - 60_000,
    "STALE_OBSERVATION", "The FINAL reference block is stale or has an invalid timestamp.");
  const account = object(await ports.rpc(primaryRpc, "query", { request_type: "view_account", account_id: IDENTITY.accountId, block_id: h.hash }));
  const keys = object(await ports.rpc(primaryRpc, "query", { request_type: "view_access_key_list", account_id: IDENTITY.accountId, block_id: h.hash }));
  for (const result of [account, keys]) check(result.block_hash === h.hash && result.block_height === h.height, "INVALID_RESPONSE", "Investor observations do not share the FINAL block.");
  check(account.code_hash === ZERO_HASH && Array.isArray(keys.keys) && keys.keys.length === 1 && keys.keys[0]?.public_key === IDENTITY.accessPublicKey &&
    keys.keys[0]?.access_key?.permission === "FullAccess" && nonce(keys.keys[0].access_key.nonce) === nonce(authority.accessKeyNonce),
    "AUTHORITY_FAILED", "Require the existing ordinary Investor and its sole unchanged verified FullAccess key.");
  const config = object(await ports.rpc(primaryRpc, "EXPERIMENTAL_protocol_config", { block_id: h.hash }));
  check(config.chain_id === "testnet" && config.protocol_version === 88, "UNSUPPORTED_PRICING", "Only documented Testnet protocol-88 FunctionCall pricing is supported.");
  const runtime = object(config.runtime_config), costs = object(runtime.transaction_costs), receipt = object(costs.action_receipt_creation_config), creation = object(costs.action_creation_config);
  const call = object(creation.function_call_cost), byte = object(creation.function_call_cost_per_byte);
  // nearcore 2.14.0 parameter schedule and protocol 85/88 deltas explicitly specify penalty 0/100 and minimum 0 Gas.
  // RPC omits these fields on some nodes. Any exposed values must agree with the versioned schedule.
  for (const source of [runtime, costs]) {
    if (Object.hasOwn(source, "gas_refund_penalty")) { const penalty = object(source.gas_refund_penalty);
      check(quantity(penalty.numerator) === 0n && quantity(penalty.denominator) > 0n, "UNSUPPORTED_PRICING", "Observed refund penalty contradicts the documented schedule."); }
    if (Object.hasOwn(source, "min_gas_refund_penalty")) check(quantity(source.min_gas_refund_penalty) === 0n,
      "UNSUPPORTED_PRICING", "Observed minimum refund penalty contradicts the documented schedule.");
  }
  const price = object(await ports.rpc(primaryRpc, "gas_price", [h.hash]));
  const feeModel = calculateExperimentBFeeModel({ protocolVersion: 88, requestBytes: Buffer.byteLength("sign", "utf8") + requestArgs(digest).length,
    receiptSendGas: quantity(receipt.send_not_sir).toString(), receiptExecutionGas: quantity(receipt.execution).toString(),
    functionCallSendGas: quantity(call.send_not_sir).toString(), functionCallExecutionGas: quantity(call.execution).toString(),
    functionCallByteSendGas: quantity(byte.send_not_sir).toString(), functionCallByteExecutionGas: quantity(byte.execution).toString(),
    blockGasPriceYocto: quantity(price.gas_price).toString(), receiptPurchaseFloorYocto: quantity(runtime.min_gas_purchase_price).toString(),
    gasRefundPenalty: { numerator: "0", denominator: "100" }, minimumGasRefundPenalty: "0" });
  check(Number.isSafeInteger(account.storage_usage) && account.storage_usage >= 0, "INVALID_RESPONSE", "Invalid Investor storage observation.");
  check(quantity(runtime.storage_amount_per_byte) > 0n, "UNSUPPORTED_PRICING", "Missing positive protocol storage price.");
  const balance = quantity(account.amount), reserve = BigInt(account.storage_usage) * quantity(runtime.storage_amount_per_byte);
  check(balance >= reserve, "FEE_OR_BALANCE_FAILED", "Investor storage reserve is insufficient.");
  const finishedAt = ports.now(); check(finishedAt >= startedAt && finishedAt - startedAt <= 60_000 && blockMs >= finishedAt - 60_000,
    "STALE_OBSERVATION", "Diagnostic observations expired during public reads.");
  const observed: ExperimentBPreflight = { kind: "experiment-b-read-only-preflight", mode: ports.mode, networkId: "testnet", id: options.id, message, digest,
    primaryRpc, secondaryRpc, observedAt: new Date(startedAt).toISOString(), accountId: IDENTITY.accountId, publicKey: IDENTITY.accessPublicKey,
    authority: summary, referenceBlock: { hash: h.hash, height: h.height, timestampNanosec: String(h.timestamp_nanosec) },
    previousNonce: nonce(keys.keys[0].access_key.nonce).toString(), balanceYocto: balance.toString(), storageUsage: account.storage_usage,
    storageReserveYocto: reserve.toString(), spendableYocto: (balance - reserve).toString(), feeModel, feeBudgetYocto: options.feeBudgetYocto,
    transactionValidityPeriod: config.transaction_validity_period };
  assertPreflight(observed); return structuredClone(observed);
}
function preparationBody(s: Omit<ExperimentBState, "preparationHash"> | ExperimentBState): unknown {
  return { schemaVersion: s.schemaVersion, kind: s.kind, mode: s.mode, id: s.id, role: s.role, signerAccountId: s.signerAccountId, publicKey: s.publicKey,
    receiverId: s.receiverId, action: s.action, methodName: s.methodName, gas: s.gas, depositYocto: s.depositYocto, path: s.path, domainId: s.domainId,
    message: s.message, digest: s.digest, primaryRpc: s.primaryRpc, secondaryRpc: s.secondaryRpc, previousNonce: s.previousNonce,
    transactionNonce: s.transactionNonce, referenceBlock: s.referenceBlock, transactionHash: s.transactionHash, createdAt: s.createdAt, expiresAt: s.expiresAt, preflight: s.preflight };
}
export function prepareExperimentB(id: string, preflight: ExperimentBPreflight, nowMs: number): ExperimentBState {
  assertPreflight(preflight); canonicalExperimentBMessage(id);
  check(preflight.id === id && Number.isSafeInteger(nowMs) && nowMs >= timestamp(preflight.observedAt) && nowMs - timestamp(preflight.observedAt) <= 60_000,
    "STALE_OBSERVATION", "Preparation requires this diagnostic's public observations no older than 60 seconds.");
  const createdAt = new Date(nowMs).toISOString(), expiresAt = new Date(nowMs + EXPERIMENT_B_PREPARATION_MS).toISOString();
  const referenceBlock = structuredClone(preflight.referenceBlock), transactionNonce = (nonce(preflight.previousNonce) + 1n).toString();
  const transactionHash = baseEncode(createHash("sha256").update(transaction({ transactionNonce, referenceBlock, digest: preflight.digest }).encode()).digest());
  const body: Omit<ExperimentBState, "preparationHash"> = { schemaVersion: 1, kind: "experiment-b-near-mpc-diagnostic", mode: preflight.mode, id,
    role: "investor", signerAccountId: IDENTITY.accountId, publicKey: IDENTITY.accessPublicKey, receiverId: MPC_CONTRACT_ID, action: "FunctionCall", methodName: "sign",
    gas: GAS, depositYocto: "1", path: DERIVATION_PATH, domainId: ECDSA_DOMAIN_ID, message: preflight.message, digest: preflight.digest,
    primaryRpc: preflight.primaryRpc, secondaryRpc: preflight.secondaryRpc, previousNonce: preflight.previousNonce, transactionNonce, referenceBlock,
    transactionHash, createdAt, expiresAt, preflight: structuredClone(preflight), status: "prepared", attempt: null,
    submission: createNearSubmissionRecord({ role: "investor", transactionHash, digest: preflight.digest, precedingAccessKeyNonce: preflight.previousNonce,
      referenceBlock: { hash: referenceBlock.hash, height: referenceBlock.height }, rpcUrl: preflight.primaryRpc, preparedAt: createdAt, submissionDeadlineAt: expiresAt }),
    events: [{ stage: "prepared", at: createdAt }], verification: null };
  const state = { ...body, preparationHash: sha(JSON.stringify(preparationBody(body))) }; assertExperimentBState(state); return state;
}
const eventStages = new Set(["prepared", "attempt-marked", "public-checks", "credential-validated", "send-intent", "preflight-failed",
  "rpc-accepted", "submission-uncertain", "reconciliation-unresolved", "final-failure", "mpc-verified"]);
const reconciliationStages = new Set(["status", "tx-lookup", "final-outcome", "canonical-blocks", "signature-verification"]);
const reconciliationCodes = new Set(["RPC_FAILED", "WRONG_NETWORK", "INVALID_RESPONSE", "INCOMPLETE", "INVALID_OUTCOME", "INVALID_STATE", "VERIFICATION_FAILED"]);
/** Validate stored proofs with production cryptography by default, including when the file claims fixture mode. */
export function assertExperimentBState(value: unknown, ports?: ExperimentBPorts): asserts value is ExperimentBState {
  const s = object(value);
  exact(s, ["schemaVersion", "kind", "mode", "id", "role", "signerAccountId", "publicKey", "receiverId", "action", "methodName", "gas", "depositYocto", "path", "domainId",
    "message", "digest", "primaryRpc", "secondaryRpc", "previousNonce", "transactionNonce", "referenceBlock", "transactionHash", "createdAt", "expiresAt", "preflight", "preparationHash",
    "status", "attempt", "submission", "events", "verification"]);
  check(s.schemaVersion === 1 && s.kind === "experiment-b-near-mpc-diagnostic" && ["live", "offline-fixtures"].includes(s.mode) &&
    s.role === "investor" && s.signerAccountId === IDENTITY.accountId && s.publicKey === IDENTITY.accessPublicKey && s.receiverId === MPC_CONTRACT_ID &&
    s.action === "FunctionCall" && s.methodName === "sign" && s.gas === GAS && s.depositYocto === "1" && s.path === DERIVATION_PATH && s.domainId === ECDSA_DOMAIN_ID &&
    s.message === canonicalExperimentBMessage(s.id) && s.digest === experimentBDigest(s.id), "INVALID_STATE", "Stored diagnostic differs from the fixed Investor MPC request.");
  assertPreflight(s.preflight);
  check(s.preflight.mode === s.mode && s.preflight.id === s.id && s.preflight.message === s.message && s.preflight.digest === s.digest &&
    s.primaryRpc === s.preflight.primaryRpc && s.secondaryRpc === s.preflight.secondaryRpc && s.previousNonce === s.preflight.previousNonce &&
    typeof s.transactionNonce === "string" && nonce(s.transactionNonce) === nonce(s.previousNonce) + 1n && isDeepStrictEqual(s.referenceBlock, s.preflight.referenceBlock),
    "INVALID_STATE", "Prepared diagnostic no longer matches its pinned public observations.");
  const created = timestamp(s.createdAt), expires = timestamp(s.expiresAt);
  check(created >= timestamp(s.preflight.observedAt) && created - timestamp(s.preflight.observedAt) <= 60_000 && expires - created === EXPERIMENT_B_PREPARATION_MS,
    "INVALID_STATE", "Original preparation time or immutable fifteen-minute deadline changed.");
  check(s.transactionHash === baseEncode(createHash("sha256").update(transaction(s as ExperimentBState).encode()).digest()) &&
    s.preparationHash === sha(JSON.stringify(preparationBody(s as ExperimentBState))), "INVALID_STATE", "Approved unsigned bytes, diagnostic digest or preparation checksum changed.");
  assertNearSubmissionRecord(s.submission, { role: "investor", transactionHash: s.transactionHash, digest: s.digest });
  const expected = createNearSubmissionRecord({ role: "investor", transactionHash: s.transactionHash, digest: s.digest,
    precedingAccessKeyNonce: s.previousNonce, referenceBlock: { hash: s.referenceBlock.hash, height: s.referenceBlock.height }, rpcUrl: s.primaryRpc, preparedAt: s.createdAt, submissionDeadlineAt: s.expiresAt });
  const { events: _events, ...metadata } = s.submission, { events: _initial, ...expectedMetadata } = expected;
  check(isDeepStrictEqual(metadata, expectedMetadata), "INVALID_STATE", "Actual nonce, reference block or shared submission binding changed.");
  check(["prepared", "attempting", "failed-before-send", "submission-uncertain", "rpc-accepted", "unresolved", "final-failure", "mpc-verified"].includes(s.status) &&
    Array.isArray(s.events) && s.events.length > 0 && s.events.length <= 1000, "INVALID_STATE", "Invalid diagnostic status or event history.");
  let previousAt = created;
  const stages: string[] = [];
  for (const item of s.events) { const e = object(item); exact(e, e.diagnostic === undefined ? ["stage", "at"] : ["stage", "at", "diagnostic"]);
    const at = timestamp(e.at); check(eventStages.has(e.stage) && at >= previousAt, "INVALID_STATE", "Invalid diagnostic event order.");
    if (e.diagnostic !== undefined) assertNearSubmissionDiagnostic(e.diagnostic); previousAt = at; stages.push(e.stage); }
  check(stages[0] === "prepared" && s.events[0].at === s.createdAt && s.events[0].diagnostic === undefined &&
    stages.filter(v => v === "prepared").length === 1, "INVALID_STATE", "Missing original diagnostic preparation event.");
  const attemptStages = ["attempt-marked", "public-checks", "credential-validated", "send-intent", "preflight-failed", "rpc-accepted", "submission-uncertain"];
  for (const stage of attemptStages) check(stages.filter(v => v === stage).length <= 1, "INVALID_STATE", "A diagnostic cannot repeat an attempt stage.");
  if (s.attempt === null) check(s.status === "prepared" && stages.length === 1 && s.submission.events.length === 1 && s.verification === null,
    "INVALID_STATE", "Unattempted diagnostics cannot contain submission or final evidence.");
  else {
    const a = object(s.attempt); exact(a, ["approvedDigest", "approvedHash", "reference", "at"]); publicReference(a.reference);
    check(a.approvedDigest === s.digest && a.approvedHash === s.transactionHash && timestamp(a.at) >= created && timestamp(a.at) < expires &&
      stages[1] === "attempt-marked" && s.events[1].at === a.at && s.status !== "prepared", "INVALID_STATE", "Original two-hash Investor attempt approval changed.");
    const expectedOrder = ["attempt-marked", "public-checks", "credential-validated", "send-intent"];
    let order = -1; for (const stage of stages) { const i = expectedOrder.indexOf(stage); if (i >= 0) { check(i === order + 1, "INVALID_STATE", "Attempt stages were skipped or reordered."); order = i; } }
    const lastSubmission = s.submission.events.at(-1)?.stage;
    check((!stages.includes("public-checks") || s.submission.events.length >= 2) &&
      (lastSubmission === "prepared" || stages.includes("public-checks")) &&
      (lastSubmission !== "send-intent" || stages.includes("send-intent")) &&
      (lastSubmission !== "rpc-response" || stages.includes("rpc-accepted")) &&
      (lastSubmission !== "rpc-uncertain" || stages.includes("submission-uncertain")) &&
      (lastSubmission !== "checks-failed-before-send" || stages.includes("preflight-failed")), "INVALID_STATE", "Shared submission and diagnostic histories disagree.");
    if (s.status === "attempting") check(["attempt-marked", "public-checks", "credential-validated", "send-intent"].includes(stages.at(-1)!), "INVALID_STATE", "Invalid attempted state.");
    if (s.status === "failed-before-send") check(stages.at(-1) === "preflight-failed" && lastSubmission === "checks-failed-before-send", "INVALID_STATE", "Missing pre-send failure history.");
    if (s.status === "rpc-accepted") check(stages.at(-1) === "rpc-accepted" && lastSubmission === "rpc-response", "INVALID_STATE", "Missing RPC acceptance history.");
    if (s.status === "submission-uncertain") check(stages.at(-1) === "submission-uncertain" && lastSubmission === "rpc-uncertain", "INVALID_STATE", "Missing uncertain submission history.");
    if (["unresolved", "final-failure", "mpc-verified"].includes(s.status)) check(stages.includes("send-intent") && s.verification !== null &&
      stages.at(-1) === (s.status === "unresolved" ? "reconciliation-unresolved" : s.status), "INVALID_STATE", "Final status lacks a durable send intent and reconciliation history.");
  }
  if (s.verification !== null) {
    const v = object(s.verification); exact(v, ["primary", "secondary", "primaryDiagnostic", "secondaryDiagnostic", "observedAt"]);
    check(timestamp(v.observedAt) >= created && v.observedAt === s.events.at(-1)?.at, "INVALID_STATE", "Stored verification time differs from its event.");
    const verifier = ports ?? productionProofVerifier();
    if (ports) check(ports.mode === s.mode, "INVALID_STATE", "Proof verification mode differs from diagnostic services.");
    for (const detail of [v.primaryDiagnostic, v.secondaryDiagnostic]) if (detail !== null) {
      const d = object(detail); exact(d, ["stage", "code", "diagnostic"]);
      check(reconciliationStages.has(d.stage) && reconciliationCodes.has(d.code), "INVALID_STATE", "Invalid public endpoint failure stage or code."); assertNearSubmissionDiagnostic(d.diagnostic);
    }
    check(!(v.primary && v.primaryDiagnostic) && !(v.secondary && v.secondaryDiagnostic), "INVALID_STATE", "A validated proof cannot also have a failing endpoint diagnostic.");
    for (const [proof, endpoint] of [[v.primary, s.primaryRpc], [v.secondary, s.secondaryRpc]] as const) if (proof !== null) {
      const p = object(proof); exact(p, ["endpoint", "transactionHash", "transactionNonce", "transactionBlockHash", "transactionBlockHeight", "finalExecutionStatus", "success", "receiptIds",
        "totalTokensBurntYocto", "publicSignature", "signature", "outcome"]);
      check(isDeepStrictEqual(p, verifyFinal(s as ExperimentBState, endpoint, p.outcome, verifier, p.transactionBlockHeight)),
        "INVALID_STATE", "Stored FINAL proof, fee total or verified MPC signature changed.");
    }
    if (["mpc-verified", "final-failure"].includes(s.status)) check(v.primary && v.secondary &&
      isDeepStrictEqual({ ...v.primary, endpoint: "" }, { ...v.secondary, endpoint: "" }) &&
      v.primary.success === (s.status === "mpc-verified"), "INVALID_STATE", "Final status requires agreeing authenticated public proofs from both endpoints.");
  }
}
function productionProofVerifier(): Pick<ExperimentBPorts, "verifySignature" | "verifyMpcOutcome"> {
  return { verifySignature(publicKey, message, signature) { try { return PublicKey.fromString(publicKey).verify(message, signature); } catch { return false; } },
    verifyMpcOutcome: (outcome, txHash, digest) => normalizeMpcOutcome(outcome, "investor", txHash, digest) };
}
export function publicExperimentBSummary(state: ExperimentBState, ports?: ExperimentBPorts): unknown { assertExperimentBState(state, ports); return structuredClone(state); }
async function commit(state: ExperimentBState, candidate: ExperimentBState, ports: ExperimentBPorts, save: (state: ExperimentBState) => Promise<void>): Promise<void> {
  assertExperimentBState(state, ports); assertExperimentBState(candidate, ports);
  check(state.preparationHash === candidate.preparationHash && isDeepStrictEqual(preparationBody(state), preparationBody(candidate)) &&
    (!state.attempt || isDeepStrictEqual(state.attempt, candidate.attempt)) && candidate.events.length === state.events.length + 1 &&
    isDeepStrictEqual(candidate.events.slice(0, -1), state.events), "INVALID_STATE", "Original preparation, attempt or history cannot be replaced.");
  if (!isDeepStrictEqual(state.submission, candidate.submission)) assertNearSubmissionSuccessor(state.submission, candidate.submission);
  try { await save(structuredClone(candidate)); } catch { throw new ExperimentBError("PERSISTENCE_FAILED", "Diagnostic state could not be saved; preserve the last durable stage without retrying."); }
  Object.assign(state, structuredClone(candidate));
}
function event(state: ExperimentBState, at: string, stage: string, status: ExperimentBStatus, details: Partial<ExperimentBState> = {}, diagnostic?: NearSubmissionDiagnostic): ExperimentBState {
  return { ...structuredClone(state), ...details, status, events: [...state.events, { stage, at, ...(diagnostic ? { diagnostic } : {}) }] };
}
function fresh(state: ExperimentBState, now: number): void {
  check(Number.isSafeInteger(now) && now >= timestamp(state.createdAt) && now < timestamp(state.expiresAt), "DEADLINE_EXPIRED", "Original preparation expired; do not reset timestamps or replace this diagnostic.");
}
function freshFees(checkedAt: number, now: number): void {
  check(now >= checkedAt && now - checkedAt <= 60_000, "STALE_OBSERVATION", "Diagnostic fee, nonce and balance observations expired.");
}
function assertCredentialPath(path: string): void {
  const rel = typeof path === "string" ? relative(resolve(process.cwd()), resolve(path)) : "";
  check(typeof path === "string" && isAbsolute(path) && basename(path) === "investor.json" &&
    (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)), "CREDENTIAL_FAILED", "Select an explicit absolute external investor.json credential path.");
}
/** One immutable approval, durable attempt, local signature, send intent and raw send. No replacement or retry path. */
export async function submitExperimentB(state: ExperimentBState, input: { role: "investor"; approveDigest: string; approveNearHash: string; reference: string; credentialPath: string }, ports: ExperimentBPorts,
  save: (state: ExperimentBState) => Promise<void>): Promise<void> {
  assertExperimentBState(state, ports); mode(ports);
  check(state.mode === ports.mode && input.role === "investor" && state.status === "prepared" && state.attempt === null &&
    input.approveDigest === state.digest && input.approveNearHash === state.transactionHash,
    "APPROVAL_FAILED", "Require the unattempted Investor diagnostic and exact digest plus NEAR hash signing/submission approval.");
  publicReference(input.reference); assertCredentialPath(input.credentialPath);
  const markedNow = ports.now(); fresh(state, markedNow); const markedAt = new Date(markedNow).toISOString();
  await commit(state, event(state, markedAt, "attempt-marked", "attempting", { attempt: { approvedDigest: state.digest,
    approvedHash: state.transactionHash, reference: input.reference, at: markedAt } }), ports, save);
  let signedBytes: string, checkedAt: number;
  async function publicChecks(): Promise<number> {
    const current = await observeExperimentB({ id: state.id, feeBudgetYocto: state.preflight.feeBudgetYocto, primaryRpc: state.primaryRpc, secondaryRpc: state.secondaryRpc }, ports);
    const now = ports.now(); fresh(state, now); const observedAt = timestamp(current.observedAt); freshFees(observedAt, now);
    const { blockHash: _h1, blockHeight: _n1, ...oldAuthority } = state.preflight.authority;
    const { blockHash: _h2, blockHeight: _n2, ...newAuthority } = current.authority;
    check(isDeepStrictEqual(oldAuthority, newAuthority) && current.previousNonce === state.previousNonce && current.referenceBlock.height >= state.referenceBlock.height &&
      current.referenceBlock.height <= state.referenceBlock.height + current.transactionValidityPeriod,
      "NONCE_OR_REFERENCE_CHANGED", "Original MPC authority, nonce or reference validity changed; no substitution is permitted.");
    const originalBlock = object(await ports.rpc(state.primaryRpc, "block", { block_id: state.referenceBlock.height }));
    check(originalBlock.header?.hash === state.referenceBlock.hash && originalBlock.header?.height === state.referenceBlock.height,
      "REFERENCE_CHANGED", "The original approved reference block is no longer canonical.");
    const finishedAt = ports.now(); fresh(state, finishedAt); freshFees(observedAt, finishedAt); return observedAt;
  }
  async function failBeforeSend(error: unknown): Promise<void> {
    const d = safeDiagnostic(error, error instanceof ExperimentBError && error.code === "DEADLINE_EXPIRED" ? "DEADLINE_EXPIRED" : "PUBLIC_CHECK_FAILED"), at = new Date(ports.now()).toISOString();
    const submission = appendNearSubmissionEvent(state.submission, { stage: "checks-failed-before-send", at, diagnostic: d });
    await commit(state, event(state, at, "preflight-failed", "failed-before-send", { submission }, d), ports, save);
  }
  const checksAt = new Date(ports.now()).toISOString();
  await commit(state, event(state, checksAt, "public-checks", "attempting", { submission: appendNearSubmissionEvent(state.submission, { stage: "public-checks", at: checksAt }) }), ports, save);
  try {
    checkedAt = await publicChecks(); let now = ports.now(); fresh(state, now); freshFees(checkedAt, now);
    const signer = await ports.loadSigner(input.credentialPath);
    check((await signer.getPublicKey()).toString() === state.publicKey, "CREDENTIAL_FAILED", "Selected credential does not match the registered Investor public key.");
    now = ports.now(); fresh(state, now); freshFees(checkedAt, now);
    const unsigned = transaction(state), encoded = unsigned.encode(), signed = await signer.signTransaction(unsigned);
    check(baseEncode(signed.txHash) === state.transactionHash && Buffer.from(signed.signedTransaction.transaction.encode()).equals(Buffer.from(encoded)) &&
      signed.signedTransaction.signature.signatureType === 0 && signed.signedTransaction.signature.data.length === 64 &&
      ports.verifySignature(state.publicKey, baseDecode(state.transactionHash), signed.signedTransaction.signature.data),
      "SIGNATURE_FAILED", "Locally signed diagnostic differs from the exact approved bytes or Investor Ed25519 signature.");
    signedBytes = Buffer.from(signed.signedTransaction.encode()).toString("base64");
    const at = new Date(ports.now()).toISOString(); await commit(state, event(state, at, "credential-validated", "attempting"), ports, save);
    now = ports.now(); fresh(state, now); freshFees(checkedAt, now);
    const finalKeys = object(await ports.rpc(state.primaryRpc, "query", { request_type: "view_access_key_list", account_id: IDENTITY.accountId, finality: "final" }));
    check(Array.isArray(finalKeys.keys) && finalKeys.keys.length === 1 && finalKeys.keys[0]?.public_key === state.publicKey &&
      finalKeys.keys[0]?.access_key?.permission === "FullAccess" && nonce(finalKeys.keys[0].access_key.nonce) === nonce(state.previousNonce) &&
      Number.isSafeInteger(finalKeys.block_height) && finalKeys.block_height >= state.referenceBlock.height &&
      finalKeys.block_height <= state.referenceBlock.height + state.preflight.transactionValidityPeriod,
      "NONCE_OR_REFERENCE_CHANGED", "The FINAL Investor nonce or original reference validity changed after local signing."); hash(finalKeys.block_hash);
    now = ports.now(); fresh(state, now); freshFees(checkedAt, now);
  } catch (error) {
    if (error instanceof ExperimentBError && error.code === "PERSISTENCE_FAILED") throw error;
    await failBeforeSend(error); return;
  }
  const sendAt = new Date(ports.now()).toISOString();
  await commit(state, event(state, sendAt, "send-intent", "attempting", { submission: appendNearSubmissionEvent(state.submission, { stage: "send-intent", at: sendAt }) }), ports, save);
  try { const now = ports.now(); fresh(state, now); freshFees(checkedAt, now); } catch (error) { await failBeforeSend(error); return; }
  let response: unknown;
  try { response = await ports.rpc(state.primaryRpc, "send_tx", { signed_tx_base64: signedBytes, wait_until: "NONE" }); }
  catch (error) {
    const d = safeDiagnostic(error, "UNCLASSIFIED_ERROR"), at = new Date(ports.now()).toISOString();
    await commit(state, event(state, at, "submission-uncertain", "submission-uncertain", { submission: appendNearSubmissionEvent(state.submission, { stage: "rpc-uncertain", at, diagnostic: d }) }, d), ports, save); return;
  }
  const result = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, any> : {};
  const responseHashes = [result.transaction?.hash, result.transaction_hash];
  const validAck = responseHashes.every(value => value === undefined || value === state.transactionHash) &&
    ["NONE", "INCLUDED", "EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", "EXECUTED", "FINAL"].includes(result.final_execution_status);
  const at = new Date(ports.now()).toISOString(), d: NearSubmissionDiagnostic = validAck ? nearRpcResponseDiagnostic(result) : { category: "RPC_RESPONSE_INVALID" };
  const submission = appendNearSubmissionEvent(state.submission, { stage: validAck ? "rpc-response" : "rpc-uncertain", at, diagnostic: d });
  await commit(state, event(state, at, validAck ? "rpc-accepted" : "submission-uncertain", validAck ? "rpc-accepted" : "submission-uncertain", { submission }, d), ports, save);
}
function canonicalBase64(value: unknown, limit = 32768): string {
  check(typeof value === "string" && value.length <= limit && Buffer.from(value, "base64").toString("base64") === value,
    "INVALID_OUTCOME", "Invalid public receipt result encoding."); return value;
}
function publicStatus(value: unknown): Record<string, unknown> {
  const status = object(value); check(Object.keys(status).length === 1, "INVALID_OUTCOME", "Invalid public execution status.");
  if (Object.hasOwn(status, "SuccessReceiptId")) return { SuccessReceiptId: hash(status.SuccessReceiptId) };
  if (Object.hasOwn(status, "SuccessValue")) return { SuccessValue: canonicalBase64(status.SuccessValue) };
  check(Object.hasOwn(status, "Failure") && status.Failure && typeof status.Failure === "object" && !Array.isArray(status.Failure) &&
    Buffer.byteLength(JSON.stringify(status.Failure), "utf8") <= 16384, "INVALID_OUTCOME", "Require a bounded genuine on-chain Failure.");
  return { Failure: structuredClone(status.Failure) };
}
function publicNode(value: unknown): Record<string, any> {
  const node = object(value), o = object(node.outcome);
  check(Array.isArray(o.receipt_ids) && o.receipt_ids.length <= 100 && Array.isArray(o.logs) && o.logs.length <= 100 &&
    o.logs.every((log: unknown) => typeof log === "string" && Buffer.byteLength(log, "utf8") <= 4096) &&
    typeof o.executor_id === "string" && o.executor_id.length > 0 && o.executor_id.length <= 64,
    "INVALID_OUTCOME", "Invalid bounded public receipt metadata.");
  const receiptIds = o.receipt_ids.map((id: unknown) => hash(id));
  check(new Set(receiptIds).size === receiptIds.length, "INVALID_OUTCOME", "Duplicate public receipt links.");
  return { id: hash(node.id), block_hash: hash(node.block_hash), outcome: { executor_id: o.executor_id, gas_burnt: quantity(o.gas_burnt).toString(),
    tokens_burnt: quantity(o.tokens_burnt).toString(), logs: [...o.logs], receipt_ids: receiptIds, status: publicStatus(o.status) } };
}
/** Persist only authentic public transaction/outcome fields, never SDK objects or executable signed bytes. */
function publicOutcome(value: unknown): Record<string, any> {
  const o = object(value), tx = object(o.transaction);
  check(Array.isArray(tx.actions) && tx.actions.length === 1, "INVALID_OUTCOME", "Require one direct MPC action.");
  const direct = object(tx.actions[0]); exact(direct, ["FunctionCall"]); const call = object(direct.FunctionCall);
  exact(call, ["method_name", "args", "gas", "deposit"]);
  check(Array.isArray(o.receipts_outcome) && o.receipts_outcome.length > 0 && o.receipts_outcome.length <= 100,
    "INVALID_OUTCOME", "The complete public receipt tree is required.");
  const result = { final_execution_status: o.final_execution_status, status: publicStatus(o.status),
    transaction: { hash: tx.hash, signer_id: tx.signer_id, public_key: tx.public_key, receiver_id: tx.receiver_id,
      nonce: nonce(tx.nonce).toString(), ...(tx.priority_fee === undefined ? {} : { priority_fee: quantity(tx.priority_fee).toString() }),
      actions: [{ FunctionCall: { method_name: call.method_name, args: canonicalBase64(call.args, 8192), gas: quantity(call.gas).toString(), deposit: quantity(call.deposit).toString() } }], signature: tx.signature },
    transaction_outcome: publicNode(o.transaction_outcome), receipts_outcome: o.receipts_outcome.map(publicNode) };
  check(Buffer.byteLength(JSON.stringify(result), "utf8") <= 524288, "INVALID_OUTCOME", "Public diagnostic outcome exceeds the bounded evidence size."); return result;
}
function verifyFinal(state: ExperimentBState, endpoint: string, value: unknown, ports: Pick<ExperimentBPorts, "verifySignature" | "verifyMpcOutcome">,
  transactionBlockHeight: number): ExperimentBFinalProof {
  const o = publicOutcome(value), tx = o.transaction, call = tx.actions[0].FunctionCall;
  check(o.final_execution_status === "FINAL", "INCOMPLETE", "The diagnostic transaction has not reached FINAL execution.");
  check(tx.hash === state.transactionHash && tx.signer_id === state.signerAccountId && tx.public_key === state.publicKey && tx.receiver_id === state.receiverId &&
    nonce(tx.nonce) === nonce(state.transactionNonce) && (tx.priority_fee === undefined || quantity(tx.priority_fee) === 0n) &&
    call.method_name === "sign" && call.gas === GAS && call.deposit === "1" &&
    call.args === Buffer.from(requestArgs(state.digest)).toString("base64"), "INVALID_OUTCOME", "FINAL transaction differs from the exact approved diagnostic envelope.");
  // Rebuilt unsigned bytes bind the original reference block even though the public RPC transaction does not repeat it.
  check(baseEncode(createHash("sha256").update(transaction(state).encode()).digest()) === state.transactionHash &&
    typeof tx.signature === "string" && /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(tx.signature) &&
    baseDecode(tx.signature.slice(8)).length === 64 && ports.verifySignature(state.publicKey, baseDecode(state.transactionHash), baseDecode(tx.signature.slice(8))),
    "INVALID_OUTCOME", "The public Investor Ed25519 signature does not bind the approved nonce, reference and digest.");
  check(Number.isSafeInteger(transactionBlockHeight) && transactionBlockHeight >= state.referenceBlock.height,
    "INVALID_OUTCOME", "Invalid canonical FINAL transaction block height.");
  const root = o.transaction_outcome, rootOutcome = root.outcome, receipts = o.receipts_outcome;
  check(root.id === state.transactionHash && rootOutcome.executor_id === state.signerAccountId && rootOutcome.receipt_ids.length > 0,
    "INVALID_OUTCOME", "Missing diagnostic transaction root and initial receipt.");
  const nodes = new Map<string, Record<string, any>>();
  for (const node of receipts) { check(node.id !== root.id && !nodes.has(node.id), "INVALID_OUTCOME", "Duplicate public receipt outcome."); nodes.set(node.id, node); }
  let burnt = quantity(rootOutcome.tokens_burnt), failure = false;
  function validateStatus(outcome: Record<string, any>): void {
    const status = outcome.status;
    if (Object.hasOwn(status, "Failure")) failure = true;
    if (Object.hasOwn(status, "SuccessReceiptId")) check(outcome.receipt_ids.includes(status.SuccessReceiptId), "INVALID_OUTCOME", "Public success receipt is missing its link.");
  }
  validateStatus(rootOutcome);
  const visited = new Set<string>(), pending = [...rootOutcome.receipt_ids];
  while (pending.length) {
    const id = pending.shift()!; check(!visited.has(id) && nodes.has(id), "INVALID_OUTCOME", "Incomplete or cyclic diagnostic receipt tree."); visited.add(id);
    const outcome = nodes.get(id)!.outcome;
    check([state.receiverId, state.signerAccountId, "system"].includes(outcome.executor_id), "INVALID_OUTCOME", "Unexpected diagnostic receipt executor.");
    validateStatus(outcome); burnt += quantity(outcome.tokens_burnt); pending.push(...outcome.receipt_ids);
  }
  check(visited.size === nodes.size && (failure ? Object.hasOwn(o.status, "Failure") : Object.hasOwn(o.status, "SuccessValue")),
    "INVALID_OUTCOME", "FINAL diagnostic status disagrees with its complete receipt tree.");
  const signature = failure ? null : ports.verifyMpcOutcome(o, state.transactionHash, state.digest);
  check(failure || signature && signature.scheme === "Secp256k1", "INVALID_OUTCOME", "No verified Investor MPC signature was returned.");
  return { endpoint, transactionHash: state.transactionHash, transactionNonce: state.transactionNonce,
    transactionBlockHash: root.block_hash, transactionBlockHeight, finalExecutionStatus: "FINAL", success: !failure,
    receiptIds: [...visited], totalTokensBurntYocto: burnt.toString(), publicSignature: tx.signature, signature, outcome: o };
}
async function canonicalFinalBlocks(state: ExperimentBState, endpoint: string, outcome: Record<string, any>, ports: ExperimentBPorts): Promise<number> {
  const finalBlock = object(await ports.rpc(endpoint, "block", { finality: "final" })), finalHeader = object(finalBlock.header); hash(finalHeader.hash);
  check(Number.isSafeInteger(finalHeader.height) && finalHeader.height >= state.referenceBlock.height, "INCOMPLETE", "Invalid FINAL reconciliation boundary.");
  const blocks = new Map<string, number>();
  for (const blockHash of new Set<string>([outcome.transaction_outcome.block_hash, ...outcome.receipts_outcome.map((node: Record<string, any>) => node.block_hash)])) {
    const block = object(await ports.rpc(endpoint, "block", { block_id: blockHash })), h = object(block.header);
    check(h.hash === blockHash && Number.isSafeInteger(h.height) && h.height >= state.referenceBlock.height && h.height <= finalHeader.height,
      "INVALID_OUTCOME", "Public diagnostic outcome block has not reached the FINAL boundary.");
    const canonical = object(await ports.rpc(endpoint, "block", { block_id: h.height }));
    check(canonical.header?.hash === blockHash && canonical.header?.height === h.height,
      "INVALID_OUTCOME", "Public diagnostic outcome block is not canonical."); blocks.set(blockHash, h.height);
  }
  return blocks.get(outcome.transaction_outcome.block_hash)!;
}
/** Bounded, credential-free observations of an already attempted hash. Every call queries both endpoints without resubmission. */
export async function reconcileExperimentB(state: ExperimentBState, ports: ExperimentBPorts, save: (state: ExperimentBState) => Promise<void>): Promise<void> {
  assertExperimentBState(state, ports); mode(ports);
  check(state.mode === ports.mode && state.attempt !== null && state.events.some(e => e.stage === "send-intent") &&
    state.status !== "prepared" && state.status !== "failed-before-send", "INVALID_STATE", "Only an existing potentially submitted diagnostic can be reconciled.");
  let primary: ExperimentBFinalProof | null = null, secondary: ExperimentBFinalProof | null = null;
  let primaryDiagnostic: ExperimentBReconciliationDiagnostic | null = null, secondaryDiagnostic: ExperimentBReconciliationDiagnostic | null = null;
  let problem: unknown;
  for (const endpoint of [state.primaryRpc, state.secondaryRpc]) {
    let stage: ExperimentBReconciliationDiagnostic["stage"] = "status";
    try {
      const status = object(await ports.rpc(endpoint, "status", []));
      check(status.chain_id === "testnet" && status.sync_info?.syncing === false, "WRONG_NETWORK", "Reconciliation requires synchronized NEAR Testnet endpoints.");
      stage = "tx-lookup";
      const raw = await ports.rpc(endpoint, "tx", { tx_hash: state.transactionHash, sender_account_id: state.signerAccountId, wait_until: "NONE" });
      stage = "final-outcome";
      const outcome = publicOutcome(raw);
      check(outcome.final_execution_status === "FINAL", "INCOMPLETE", "The diagnostic has not reached FINAL execution.");
      stage = "canonical-blocks"; const blockHeight = await canonicalFinalBlocks(state, endpoint, outcome, ports);
      stage = "signature-verification";
      const proof = verifyFinal(state, endpoint, outcome, ports, blockHeight);
      if (endpoint === state.primaryRpc) primary = proof; else secondary = proof;
    } catch (error) {
      problem = error;
      const publicCode = error && typeof error === "object" && "code" in error && reconciliationCodes.has(String(error.code)) ? String(error.code) : "VERIFICATION_FAILED";
      const detail: ExperimentBReconciliationDiagnostic = { stage, code: publicCode as ExperimentBReconciliationDiagnostic["code"], diagnostic: safeDiagnostic(error, "PUBLIC_CHECK_FAILED") };
      if (endpoint === state.primaryRpc) primaryDiagnostic = detail; else secondaryDiagnostic = detail;
    }
  }
  if (!primary || !secondary || !isDeepStrictEqual({ ...primary, endpoint: "" }, { ...secondary, endpoint: "" })) {
    const at = new Date(ports.now()).toISOString();
    await commit(state, event(state, at, "reconciliation-unresolved", "unresolved", { verification: { primary, secondary, primaryDiagnostic, secondaryDiagnostic, observedAt: at } },
      safeDiagnostic(problem, "PUBLIC_CHECK_FAILED")), ports, save); return;
  }
  const at = new Date(ports.now()).toISOString(), status = primary.success ? "mpc-verified" : "final-failure";
  await commit(state, event(state, at, status, status, { verification: { primary, secondary, primaryDiagnostic, secondaryDiagnostic, observedAt: at } }), ports, save);
}
