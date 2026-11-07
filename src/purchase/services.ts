import { isDeepStrictEqual } from "node:util";
import { getAddress } from "ethers";
import { baseDecode } from "near-api-js";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID, type AuthorityRole } from "../near/config.js";
import { requireRole, VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { deriveEvmPublicKey } from "../near/mpc.js";
import { normalizeMpcOutcome, prepareMpcSigning, readMpcSigningOutcome } from "../near/signing.js";
import { assembleSignedErc20Transfer } from "../evm/erc20-transfer.js";
import { assembleTreasuryNativeTransfer, assertTreasuryNativeSignedTransfer } from "../evm/native-transfer.js";
import { createSepoliaReadRpc, type SepoliaReadRpc } from "../evm/sepolia-link.js";
import { createEvmBroadcastTransport, type EvmBroadcastTransport } from "../evm/broadcast.js";
import { assertPreparedPurchaseLeg, assertPurchaseLegSigned, assertErc20SignedBytes, preparePurchaseLeg, recheckPurchaseLeg, verifyMinedPurchaseLeg,
  type PreparedPurchaseLeg, type PublicLegObservation, type PurchaseLeg, type PurchaseLegReceiptResult, type PurchaseLegSigned } from "./legs.js";
import { assertPurchaseQuote, type PurchaseQuote } from "./quote.js";
import { normalizePurchaseCostObservations } from "./costs.js";
import { PURCHASE_FEE_LEGS, type ActualNearCost, type PurchaseFeeLeg } from "./fee-eligibility.js";
import { collectPurchaseCosts, inspectNearSigningAuthority, inspectReadiness, RECORDED_MPC_SIGNING_ASSUMPTIONS,
  type NearSigningAssumptions, type ReadinessPorts } from "./readiness.js";
import type { PurchaseExecutionDriver } from "./settlement.js";
import { check, fingerprint, frozen, hexHash } from "./integrity.js";

export interface PurchaseExecutionServiceOptions {
  readonly nearRpcUrl: string; readonly evmRpcUrl: string; readonly repositoryRoot?: string;
  readonly nearSigningAssumptions?: NearSigningAssumptions;
}
/** Trusted dependency injection for offline unit tests; never a CLI or JSON bypass.
 * Injected readiness observations retain mode:'offline' and cannot authorize real prepayment.
 * Signature, complete-key, intent and receipt verification cannot be replaced through these ports.
 */
export interface PurchaseExecutionServiceDependencies {
  readonly evm?: SepoliaReadRpc; readonly readinessPorts?: ReadinessPorts;
  readonly now?: () => number; readonly broadcast?: EvmBroadcastTransport;
}
function rpcUrl(value: string): string {
  try { const url = new URL(value); check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && !url.hostname.toLowerCase().includes("mainnet"), "Unsafe public RPC."); return url.toString(); }
  catch { throw new Error("Purchase services require public HTTPS testnet RPC URLs without credentials or query strings."); }
}
function record(value: unknown): Record<string, any> { check(value && typeof value === "object" && !Array.isArray(value), "Missing public execution object."); return value as Record<string, any>; }
function uint(value: unknown): bigint { check(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), "Invalid public NEAR amount."); const result = BigInt(value); check(result < 1n << 256n, "NEAR amount exceeds bounds."); return result; }
function quantity(value: unknown): bigint { check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid EVM lookup quantity."); return BigInt(value); }
function nonce(value: unknown): number { const n = quantity(value); check(n <= BigInt(Number.MAX_SAFE_INTEGER), "Unsupported EVM lookup nonce."); return Number(n); }
function nearHash(value: unknown): string { check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32, "Invalid public NEAR transaction or receipt hash."); return value; }
function legFee(quote: PurchaseQuote, leg: PurchaseLeg) {
  const name: PurchaseFeeLeg = leg === "usdc-payment" ? "investor-usdc-payment" : leg === "link-delivery" ? "treasury-link-delivery" : "treasury-eth-delivery";
  const matches = quote.costs.evm.filter(item => item.leg === name); check(matches.length === 1, "Approved quote has no unique selected fees for this leg.");
  return matches[0]!;
}
function checkedQuote(quote: PurchaseQuote): void { assertPurchaseQuote(quote, quote.quoteHash, quote.policy); }
function implementation(quote: PurchaseQuote) {
  const pin = quote.costs.assetIdentity?.usdcImplementation;
  check(pin && getAddress(pin.address) === pin.address && /^0x[0-9a-f]{64}$/.test(pin.codeHash), "Live purchase services require the reviewed USDC implementation identity in the approved quote.");
  return pin;
}
function assertPreparedFees(quote: PurchaseQuote, prepared: PreparedPurchaseLeg): void {
  assertPreparedPurchaseLeg(prepared, quote, quote.quoteHash);
  const fee = legFee(quote, prepared.leg);
  check(prepared.prepared.maxFeePerGas === fee.maxFeePerGasWei && prepared.prepared.maxPriorityFeePerGas === fee.maxPriorityFeePerGasWei,
    "Prepared transaction fee parameters differ from the exact approved quote selection.");
  if (prepared.leg === "usdc-payment") check(isDeepStrictEqual(prepared.snapshot.usdcImplementation, implementation(quote)), "USDC preparation differs from the approved quote implementation.");
}
function assertLookupSignature(prepared: PreparedPurchaseLeg, signed: PurchaseLegSigned): void {
  const expectedRole = prepared.leg === "usdc-payment" ? "investor" : "treasury";
  check(prepared.role === expectedRole && prepared.prepared.senderAddress === VERIFIED_IDENTITIES[expectedRole].evmAddress, "Lookup role or signing sender changed.");
  if (prepared.leg === "eth-delivery") assertTreasuryNativeSignedTransfer(prepared.prepared, signed);
  else assertErc20SignedBytes(prepared.prepared, signed, deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES[expectedRole].accountId, DERIVATION_PATH));
}
/** Replay matches exact method/parameters and consumes every recorded response once.
 * Parallel network completion order is immaterial; every observation and all proof fields are compared.
 */
export async function replayPurchaseReceipt(quote: PurchaseQuote, prepared: PreparedPurchaseLeg, signed: PurchaseLegSigned,
  saved: PurchaseLegReceiptResult): Promise<void> {
  const observations = saved.status === "not-mined" ? saved.publicObservations : saved.proof.publicObservations;
  check(Array.isArray(observations) && observations.length > 0 && observations.length <= 5000, "Receipt replay requires bounded original public observations.");
  const consumed = new Set<number>();
  const replay: SepoliaReadRpc = { async request(method, params) {
    const index = observations.findIndex((item, candidate) => !consumed.has(candidate) && item.method === method && isDeepStrictEqual(item.params, params));
    check(index >= 0, "Receipt replay lacks the exact required public RPC response."); consumed.add(index);
    return structuredClone(observations[index]!.result);
  } };
  const actual = await verifyMinedPurchaseLeg(prepared, quote, quote.quoteHash, signed, replay);
  check(consumed.size === observations.length, "Receipt replay contains unused or duplicated public observations.");
  const canonical = (value: PurchaseLegReceiptResult) => {
    const order = (items: readonly PublicLegObservation[]) => [...items].sort((a, b) => fingerprint("public-observation-v1", a).localeCompare(fingerprint("public-observation-v1", b)));
    return value.status === "not-mined" ? { ...value, publicObservations: order(value.publicObservations) } :
      { ...value, proof: { ...value.proof, publicObservations: order(value.proof.publicObservations) } };
  };
  check(isDeepStrictEqual(canonical(actual), canonical(saved)), "Replayed canonical receipt, movement, finality or fee evidence differs from the saved result.");
}
/** Finalized public costs. One-yocto deposit refund is conservatively counted until independently proven.
 * This cost record is not a payment claim or signing-success proof; assemble verifies the full successful MPC result separately.
 */
export function observeNearExecutionCost(roleValue: AuthorityRole, hashValue: string, raw: unknown, leg: PurchaseLeg): ActualNearCost {
  const role = requireRole(roleValue), hash = nearHash(hashValue), outcome = record(raw), tx = record(outcome.transaction), identity = VERIFIED_IDENTITIES[role];
  check(role === (leg === "usdc-payment" ? "investor" : "treasury") && ["usdc-payment", "link-delivery", "eth-delivery"].includes(leg), "NEAR cost leg and role do not match.");
  check(outcome.final_execution_status === "FINAL" && tx.hash === hash && tx.signer_id === identity.accountId && tx.public_key === identity.accessPublicKey && tx.receiver_id === MPC_CONTRACT_ID &&
    Array.isArray(tx.actions) && tx.actions.length === 1, "NEAR actual costs require the finalized exact role transaction.");
  const direct = record(tx.actions[0]); check(Object.keys(direct).length === 1 && direct.FunctionCall, "NEAR costs require one original direct MPC call.");
  const action = record(direct.FunctionCall);
  check(action.method_name === "sign" && String(action.gas) === "100000000000000" && action.deposit === "1" && typeof action.args === "string" && action.args.length <= 32768,
    "Original NEAR signing method, gas, deposit or request changed.");
  const bytes = Buffer.from(action.args, "base64"); check(bytes.toString("base64") === action.args, "NEAR signing arguments require canonical public base64.");
  let args: Record<string, any>;
  try { args = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); } catch { throw new Error("Malformed public NEAR signing request."); }
  const request = record(args.request), payload = record(request.payload_v2);
  check(Object.keys(args).join() === "request" && Object.keys(request).sort().join() === "domain_id,path,payload_v2" && request.domain_id === ECDSA_DOMAIN_ID && request.path === DERIVATION_PATH &&
    Object.keys(payload).join() === "Ecdsa" && typeof payload.Ecdsa === "string" && /^[0-9a-fA-F]{64}$/.test(payload.Ecdsa), "NEAR signing request does not use the approved public path, domain and digest format.");
  const finalStatus = record(outcome.status); check(Object.keys(finalStatus).length === 1 && ("SuccessValue" in finalStatus || "Failure" in finalStatus), "NEAR cost outcome is not final success or failure.");
  if ("SuccessValue" in finalStatus) normalizeMpcOutcome(outcome, role, hash, "0x" + payload.Ecdsa.toLowerCase());
  const transaction = record(outcome.transaction_outcome), transactionExecution = record(transaction.outcome);
  check(transaction.id === hash && transactionExecution.executor_id === identity.accountId, "NEAR transaction cost identity differs from the finalized role.");
  check(Array.isArray(outcome.receipts_outcome) && outcome.receipts_outcome.length > 0 && outcome.receipts_outcome.length <= 1000, "Complete finalized NEAR receipt costs are required.");
  const ids = new Set<string>();
  const receiptOutcomes = outcome.receipts_outcome.map((value: unknown) => {
    const entry = record(value), receiptId = nearHash(entry.id); check(!ids.has(receiptId) && receiptId !== hash, "Duplicate NEAR receipt cost identity."); ids.add(receiptId);
    return { receiptId, tokensBurntYoctoNear: uint(record(entry.outcome).tokens_burnt) };
  });
  for (const value of [transactionExecution, ...outcome.receipts_outcome.map((entry: any) => record(entry.outcome))]) {
    check(Array.isArray(value.receipt_ids) && value.receipt_ids.every((id: unknown) => ids.has(nearHash(id))), "Finalized NEAR outcome omits an emitted receipt cost.");
  }
  const costLeg: PurchaseFeeLeg = leg === "usdc-payment" ? "investor-usdc-payment" : leg === "link-delivery" ? "treasury-link-delivery" : "treasury-eth-delivery";
  return frozen({ leg: costLeg, payer: role, transactionHash: hash, transactionTokensBurntYoctoNear: uint(transactionExecution.tokens_burnt), receiptOutcomes,
    originalAttachedDepositYoctoNear: 1n, refundedDepositYoctoNear: 0n,
    depositAccounting: "conservative-one-yocto-deposit-counted-as-cost-refund-not-proven" });
}
/** Production composition only. Constructing it submits nothing and reads no credential.
 * The coordinator supplies independent hash-bound approvals before invoking mutation capabilities.
 */
export function createPurchaseExecutionServices(options: PurchaseExecutionServiceOptions,
  dependencies: PurchaseExecutionServiceDependencies = {}): PurchaseExecutionDriver {
  const nearRpcUrl = rpcUrl(options.nearRpcUrl), evmRpcUrl = rpcUrl(options.evmRpcUrl);
  const rpc = dependencies.evm ?? createSepoliaReadRpc(evmRpcUrl), now = dependencies.now ?? Date.now;
  const read = async (method: Parameters<SepoliaReadRpc["request"]>[0], params: readonly unknown[]) => {
    try { return await rpc.request(method, params); } catch { throw new Error(`Purchase lookup failed (${method}); provider details suppressed; reconcile without retry.`); }
  };
  const readinessOptions = (quote?: PurchaseQuote) => ({ nearRpcUrl, evmRpcUrl, ...(quote ? { usdcImplementationPin: implementation(quote) } : {}) });
  return Object.freeze<PurchaseExecutionDriver>({ mode: "live" as const, now,
    async prepare(quote, leg) {
      checkedQuote(quote); const fee = legFee(quote, leg), pin = implementation(quote);
      return preparePurchaseLeg(quote, quote.quoteHash, leg, { maxFeePerGas: fee.maxFeePerGasWei, maxPriorityFeePerGas: fee.maxPriorityFeePerGasWei, usdcImplementationPin: pin }, rpc);
    },
    assertPrepared: assertPreparedFees,
    async recheck(quote, prepared) { assertPreparedFees(quote, prepared); return recheckPurchaseLeg(prepared, quote, quote.quoteHash, rpc); },
    async verifyAuthority(role) { return inspectNearSigningAuthority(readinessOptions(), requireRole(role), dependencies.readinessPorts); },
    prepareSigning(role, digest, credentialPath, submissionDeadlineMs) { return prepareMpcSigning({ role: requireRole(role), digest, credentialPath,
      rpcUrl: nearRpcUrl, repositoryRoot: options.repositoryRoot, submissionDeadlineMs }); },
    readSigning(role, hash) { return readMpcSigningOutcome(requireRole(role), hash, nearRpcUrl); },
    assemble(quote, prepared, nearHashValue, outcome) {
      assertPreparedFees(quote, prepared);
      const signature = normalizeMpcOutcome(outcome, prepared.role, nearHashValue, prepared.prepared.unsignedHash);
      const signed = prepared.leg === "eth-delivery" ? assembleTreasuryNativeTransfer(prepared.prepared, signature) :
        assembleSignedErc20Transfer(prepared.prepared, signature, VERIFIED_IDENTITIES[prepared.role].evmAddress);
      assertPurchaseLegSigned(prepared, quote, quote.quoteHash, signed); return signed;
    },
    assertSigned(quote, prepared, signed) { assertPreparedFees(quote, prepared); assertPurchaseLegSigned(prepared, quote, quote.quoteHash, signed); },
    async inspectReceipt(quote, prepared, signed) { assertPreparedFees(quote, prepared); return verifyMinedPurchaseLeg(prepared, quote, quote.quoteHash, signed, rpc); },
    async replayReceipt(quote, prepared, signed, result) { assertPreparedFees(quote, prepared); return replayPurchaseReceipt(quote, prepared, signed, result); },
    async lookup(prepared, signed) {
      assertLookupSignature(prepared, signed); check(quantity(await read("eth_chainId", [])) === 11155111n, "Lookup RPC must be Ethereum Sepolia.");
      const block = record(await read("eth_getBlockByNumber", ["latest", false])), number = quantity(block.number), blockHash = hexHash(block.hash), tag = "0x" + number.toString(16);
      const [raw, receipt, confirmed, pending] = await Promise.all([read("eth_getTransactionByHash", [signed.hash]), read("eth_getTransactionReceipt", [signed.hash]),
        read("eth_getTransactionCount", [prepared.prepared.senderAddress, tag]), read("eth_getTransactionCount", [prepared.prepared.senderAddress, "pending"])]);
      if (raw !== null) { const tx = record(raw); check(hexHash(tx.hash) === signed.hash && getAddress(tx.from) === prepared.prepared.senderAddress && nonce(tx.nonce) === prepared.prepared.nonce,
        "Known Ethereum transaction differs from the signed hash, sender or nonce."); }
      if (receipt !== null) {
        check(raw !== null, "RPC returned a receipt without its transaction; reconcile inconsistent observations.");
        const r = record(receipt), mined = record(await read("eth_getBlockByNumber", [r.blockNumber, false]));
        check(hexHash(r.transactionHash) === signed.hash && hexHash(r.blockHash) === hexHash(mined.hash) && quantity(r.blockNumber) === quantity(mined.number), "Known Ethereum receipt is not canonical for the signed hash.");
      }
      const canonical = record(await read("eth_getBlockByNumber", [tag, false]));
      check(quantity(canonical.number) === number && hexHash(canonical.hash) === blockHash, "Lookup reference block changed.");
      const confirmedNonce = nonce(confirmed), pendingNonce = nonce(pending); check(pendingNonce >= confirmedNonce, "Pending lookup nonce is below confirmed state.");
      return { known: raw !== null, receipt: receipt !== null, confirmedNonce, pendingNonce };
    },
    async funding(quote) {
      checkedQuote(quote); const observed = await inspectReadiness(readinessOptions(quote), dependencies.readinessPorts);
      return { inventory: observed.inventory, gasPriceYoctoNear: observed.near.gasPriceYoctoNear, expiresAt: observed.expiresAt };
    },
    async collectCosts(quote) {
      checkedQuote(quote);
      const feesByLeg = Object.fromEntries(quote.costs.evm.map(item => [item.leg, { maxFeePerGasWei: item.maxFeePerGasWei, maxPriorityFeePerGasWei: item.maxPriorityFeePerGasWei }])) as Record<PurchaseFeeLeg, { maxFeePerGasWei: bigint; maxPriorityFeePerGasWei: bigint }>;
      const value = await collectPurchaseCosts(quote.terms, { ...readinessOptions(quote), purchaseId: quote.purchaseId,
        fees: feesByLeg[PURCHASE_FEE_LEGS[0]], feesByLeg, nearSigningAssumptions: options.nearSigningAssumptions ?? RECORDED_MPC_SIGNING_ASSUMPTIONS, executionPolicy: quote.policy.execution }, dependencies.readinessPorts);
      normalizePurchaseCostObservations(quote.terms, value.costs, { purchaseId: quote.purchaseId, asOf: new Date(now()).toISOString(),
        purpose: value.costs.mode === "live" ? "prepayment" : "offline", maxEstimateAgeMs: quote.policy.maxEstimateAgeMs, executionPolicy: quote.policy.execution });
      return { costs: value.costs, inventory: value.readiness.inventory };
    },
    nearCost: observeNearExecutionCost,
    broadcast: dependencies.broadcast ?? createEvmBroadcastTransport(evmRpcUrl),
  });
}
