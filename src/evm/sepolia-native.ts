import { isDeepStrictEqual } from "node:util";
import { Signature, Transaction, getAddress, keccak256 } from "ethers";
import { VERIFIED_IDENTITIES } from "../near/identities.js";
import { BPS_DENOMINATOR, DEFAULT_EXECUTION_LIMITS, DEFAULT_GAS_BUFFER_BPS } from "../purchase/config.js";
import { requireUint256 } from "../purchase/amounts.js";
import { assertPurchaseTerms, createPurchaseTerms, type PurchaseTerms } from "../purchase/terms.js";
import type { ActualEvmCost, EvmFeeEstimate } from "../purchase/fee-eligibility.js";
import { normalizeEvmSignatureScalar } from "../evidence/verify.js";
import type { AssetExecutionPolicy } from "./asset-intent.js";
import type { SepoliaReadMethod, SepoliaReadRpc } from "./sepolia-link.js";
import { assertPreparedNativeTransfer, assertTreasuryNativeSignedTransfer, buildUnsignedNativeTransfer, type PreparedNativeTransfer } from "./native-transfer.js";

export interface NativeDeliveryPolicy extends AssetExecutionPolicy { readonly operatingReserveWei: bigint }
export const DEFAULT_NATIVE_DELIVERY_POLICY: NativeDeliveryPolicy = Object.freeze({
  ...DEFAULT_EXECUTION_LIMITS, operatingReserveWei: 1_000_000_000_000_000n,
});
export interface NativeDeliverySnapshot {
  readonly chainId: bigint; readonly senderAddress: string; readonly recipientAddress: string;
  readonly senderCode: string; readonly recipientCode: string;
  readonly confirmedNonce: number; readonly pendingNonce: number;
  readonly treasuryBalanceWei: bigint; readonly investorBalanceWei: bigint;
  readonly estimatedGas: bigint; readonly baseFeePerGas: bigint; readonly simulationResult: string;
  readonly blockNumber: bigint; readonly blockHash: string;
}
export interface NativeDeliveryPreflight {
  readonly kind: "native-eth-delivery"; readonly role: "treasury"; readonly terms: PurchaseTerms;
  readonly approvedTermsHash: string; readonly policy: NativeDeliveryPolicy;
  readonly prepared: PreparedNativeTransfer; readonly snapshot: NativeDeliverySnapshot;
}
export interface NativeSignedTransaction { readonly serialized: string; readonly hash: string; readonly senderAddress: string }
export interface NativeBalances { readonly treasuryEth: bigint; readonly investorEth: bigint }
export interface VerifiedNativeReceipt {
  readonly transactionHash: string; readonly blockNumber: bigint; readonly blockHash: string; readonly confirmations: bigint;
  readonly gasUsed: bigint; readonly effectiveGasPriceWei: bigint; readonly actualFeeWei: bigint;
  readonly before: NativeBalances; readonly after: NativeBalances;
  readonly nativeDeltas: Readonly<{ treasury: bigint; investor: bigint }>;
  readonly feeObservation: ActualEvmCost;
}
export class NativeDeliveryError extends Error {
  constructor(readonly code: "INVALID_STATE" | "PREFLIGHT_FAILED" | "RPC_FAILED" | "NOT_MINED" | "RECEIPT_FAILED", message: string) {
    super(message); this.name = "NativeDeliveryError";
  }
}
function check(condition: unknown, message: string, code: NativeDeliveryError["code"] = "PREFLIGHT_FAILED"): asserts condition {
  if (!condition) throw new NativeDeliveryError(code, message);
}
function record(value: unknown): Record<string, any> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Invalid native delivery object.");
  return value as Record<string, any>;
}
function quantity(value: unknown): bigint {
  check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid public RPC quantity.");
  return requireUint256(BigInt(value), "RPC quantity");
}
function tag(value: bigint): string { return `0x${requireUint256(value, "Block number").toString(16)}`; }
function hash(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "Invalid transaction/block hash.");
  return value.toLowerCase();
}
function address(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), "Invalid native transfer address.");
  try { return getAddress(value); } catch { throw new NativeDeliveryError("INVALID_STATE", "Invalid native transfer address checksum."); }
}
function nonce(value: unknown): number {
  check(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "Nonce must be a nonnegative safe integer.");
  return value;
}
function approvedTerms(terms: PurchaseTerms, expectedTermsHash: unknown): void {
  check(typeof expectedTermsHash === "string" && /^0x[0-9a-f]{64}$/.test(expectedTermsHash),
    "An explicit exact approved purchase terms hash is required.", "INVALID_STATE");
  assertPurchaseTerms(terms, expectedTermsHash);
}
function policy(value: NativeDeliveryPolicy): NativeDeliveryPolicy {
  record(value);
  const result = Object.freeze({ gasLimitCap: requireUint256(value.gasLimitCap, "Gas limit cap", true),
    maxFeePerGasCap: requireUint256(value.maxFeePerGasCap, "Fee per gas cap", true),
    maxTotalFeeWei: requireUint256(value.maxTotalFeeWei, "Total transaction fee cap", true),
    gasBufferBps: requireUint256(value.gasBufferBps, "Gas buffer"),
    operatingReserveWei: requireUint256(value.operatingReserveWei, "Remaining operating reserve", true) });
  check(result.gasBufferBps >= DEFAULT_GAS_BUFFER_BPS && result.gasBufferBps <= BPS_DENOMINATOR,
    "Native delivery must preserve a minimum 20% gas buffer.");
  return result;
}
function bufferedGas(estimate: bigint, limits: NativeDeliveryPolicy): bigint {
  return (requireUint256(estimate, "Native gas estimate", true) * (BPS_DENOMINATOR + limits.gasBufferBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}
function snapshot(value: NativeDeliverySnapshot): NativeDeliverySnapshot {
  record(value);
  check(value.chainId === 11155111n, "Native delivery requires Ethereum Sepolia chain ID 11155111.");
  const senderAddress = address(value.senderAddress), recipientAddress = address(value.recipientAddress);
  check(senderAddress === VERIFIED_IDENTITIES.treasury.evmAddress && recipientAddress === VERIFIED_IDENTITIES.investor.evmAddress,
    "Native delivery must be Treasury to Investor.");
  check(value.senderCode === "0x" && value.recipientCode === "0x", "Both native delivery role addresses must remain code-free EOAs.");
  const confirmedNonce = nonce(value.confirmedNonce), pendingNonce = nonce(value.pendingNonce);
  check(confirmedNonce === pendingNonce, "Resolve pending Treasury transactions before native delivery.");
  check(value.simulationResult === "0x", "Native transfer simulation must return empty data.");
  check(requireUint256(value.estimatedGas, "Native gas estimate", true) >= 21_000n,
    "Native gas estimate cannot be below intrinsic transaction gas.");
  return Object.freeze({ chainId: 11155111n, senderAddress, recipientAddress, senderCode: value.senderCode, recipientCode: value.recipientCode,
    confirmedNonce, pendingNonce, treasuryBalanceWei: requireUint256(value.treasuryBalanceWei, "Treasury ETH balance"),
    investorBalanceWei: requireUint256(value.investorBalanceWei, "Investor ETH balance"),
    estimatedGas: requireUint256(value.estimatedGas, "Native gas estimate", true),
    baseFeePerGas: requireUint256(value.baseFeePerGas, "Base fee"), simulationResult: value.simulationResult,
    blockNumber: requireUint256(value.blockNumber, "Observation block", true), blockHash: hash(value.blockHash) });
}
function validateObservation(prepared: PreparedNativeTransfer, observed: NativeDeliverySnapshot, limits: NativeDeliveryPolicy): void {
  assertPreparedNativeTransfer(prepared);
  check(prepared.senderAddress === observed.senderAddress && prepared.recipientAddress === observed.recipientAddress &&
    prepared.nonce === observed.confirmedNonce && prepared.nonce === observed.pendingNonce, "Native delivery sender, recipient or nonce changed.");
  check(bufferedGas(observed.estimatedGas, limits) <= prepared.gasLimit, "Fresh native gas estimate no longer preserves the approved buffer.");
  check(prepared.gasLimit <= limits.gasLimitCap && prepared.maxFeePerGas <= limits.maxFeePerGasCap &&
    prepared.maximumFeeWei <= limits.maxTotalFeeWei, "Native transaction exceeds approved protective gas/fee caps.");
  check(observed.baseFeePerGas + prepared.maxPriorityFeePerGas <= prepared.maxFeePerGas, "Signed native fee parameters cannot cover current base fee plus priority.");
  check(observed.treasuryBalanceWei >= prepared.amountWei + prepared.maximumFeeWei + limits.operatingReserveWei,
    "Treasury ETH cannot cover delivery value, maximum fee and required operating reserve.");
}
/** Shared native checks, independent of purchase quotation or payment state. */
export function validateNativeTransferObservation(prepared: PreparedNativeTransfer, observed: NativeDeliverySnapshot,
  limits: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): void {
  validateObservation(prepared, snapshot(observed), policy(limits));
}

/** Pure snapshot builder. Callers establish public observations and approval separately. */
export function prepareNativeDelivery(terms: PurchaseTerms, approvedTermsHash: string,
  fees: { readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint },
  observedValue: NativeDeliverySnapshot, limitsValue: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): NativeDeliveryPreflight {
  approvedTerms(terms, approvedTermsHash);
  const limits = policy(limitsValue), observed = snapshot(observedValue);
  const frozenTerms = createPurchaseTerms({ investmentUsdcBaseUnits: terms.investmentUsdcBaseUnits,
    ethPrice: terms.prices.ETH, linkPrice: terms.prices.LINK, allocationBps: terms.allocationBps });
  const prepared = buildUnsignedNativeTransfer({ chainId: 11155111n,
    senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress, recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress,
    amountWei: terms.quantities.ethWei, nonce: observed.confirmedNonce, gasLimit: bufferedGas(observed.estimatedGas, limits),
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  validateObservation(prepared, observed, limits);
  return Object.freeze({ kind: "native-eth-delivery", role: "treasury", terms: frozenTerms,
    approvedTermsHash, policy: limits, prepared, snapshot: observed });
}
export function assertNativeDelivery(value: NativeDeliveryPreflight, expectedTermsHash: string,
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): void {
  check(value && value.kind === "native-eth-delivery" && value.role === "treasury", "Unsupported native delivery role or state.", "INVALID_STATE");
  const expected = prepareNativeDelivery(value.terms, expectedTermsHash, {
    maxFeePerGas: value.prepared.maxFeePerGas, maxPriorityFeePerGas: value.prepared.maxPriorityFeePerGas,
  }, value.snapshot, expectedPolicy);
  check(isDeepStrictEqual(value, expected), "Native delivery terms, transaction, observation or trusted policy mismatch.", "INVALID_STATE");
}
async function read(rpc: SepoliaReadRpc, method: SepoliaReadMethod, params: readonly unknown[]): Promise<unknown> {
  try { return await rpc.request(method, params); }
  catch { throw new NativeDeliveryError("RPC_FAILED", `Native public RPC read failed (${method}); raw details suppressed. No retry was attempted.`); }
}

/** Exact native-value observations; no token, quotation, payment or transaction submission capability. */
export async function observeNativeTransferAmount(amountWei: bigint, rpc: SepoliaReadRpc): Promise<NativeDeliverySnapshot> {
  requireUint256(amountWei, "Native observation amount", true);
  check(quantity(await read(rpc, "eth_chainId", [])) === 11155111n, "Native observation requires Sepolia.");
  const block = record(await read(rpc, "eth_getBlockByNumber", ["latest", false]));
  const blockNumber = quantity(block.number), blockHash = hash(block.hash), blockTag = tag(blockNumber);
  const senderAddress = VERIFIED_IDENTITIES.treasury.evmAddress, recipientAddress = VERIFIED_IDENTITIES.investor.evmAddress;
  const call = { from: senderAddress, to: recipientAddress, value: tag(amountWei), data: "0x" };
  const [senderCode, recipientCode, treasury, investor, confirmed, pending, simulationResult, estimate] = await Promise.all([
    read(rpc, "eth_getCode", [senderAddress, blockTag]), read(rpc, "eth_getCode", [recipientAddress, blockTag]),
    read(rpc, "eth_getBalance", [senderAddress, blockTag]), read(rpc, "eth_getBalance", [recipientAddress, blockTag]),
    read(rpc, "eth_getTransactionCount", [senderAddress, blockTag]), read(rpc, "eth_getTransactionCount", [senderAddress, "pending"]),
    read(rpc, "eth_call", [call, blockTag]), read(rpc, "eth_estimateGas", [call, blockTag]),
  ]);
  const confirmedNonce = quantity(confirmed), pendingNonce = quantity(pending);
  check(confirmedNonce <= BigInt(Number.MAX_SAFE_INTEGER) && pendingNonce <= BigInt(Number.MAX_SAFE_INTEGER), "Unsupported native nonce.");
  const canonical = record(await read(rpc, "eth_getBlockByNumber", [blockTag, false]));
  check(quantity(canonical.number) === blockNumber && hash(canonical.hash) === blockHash, "Native observation block changed during public reads.");
  return snapshot({ chainId: 11155111n, senderAddress, recipientAddress, senderCode: senderCode as string, recipientCode: recipientCode as string,
    confirmedNonce: Number(confirmedNonce), pendingNonce: Number(pendingNonce), treasuryBalanceWei: quantity(treasury), investorBalanceWei: quantity(investor),
    estimatedGas: quantity(estimate), baseFeePerGas: quantity(block.baseFeePerGas), simulationResult: simulationResult as string, blockNumber, blockHash });
}
/** Purchase adapter retains its original terms validation. */
export async function observeNativeDelivery(terms: PurchaseTerms, approvedTermsHash: string, rpc: SepoliaReadRpc): Promise<NativeDeliverySnapshot> {
  approvedTerms(terms, approvedTermsHash);
  return observeNativeTransferAmount(terms.quantities.ethWei, rpc);
}
/** Refresh exact existing bytes; never rebuild a transaction to accommodate changing state. */
export async function recheckNativeDelivery(value: NativeDeliveryPreflight, rpc: SepoliaReadRpc, expectedTermsHash: string,
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): Promise<NativeDeliverySnapshot> {
  assertNativeDelivery(value, expectedTermsHash, expectedPolicy);
  const fresh = await observeNativeDelivery(value.terms, expectedTermsHash, rpc);
  check(fresh.blockNumber >= value.snapshot.blockNumber, "Native recheck returned an older block.");
  check(fresh.blockNumber !== value.snapshot.blockNumber || fresh.blockHash === value.snapshot.blockHash,
    "Native recheck returned a different hash for the original observation block.");
  validateObservation(value.prepared, fresh, policy(expectedPolicy));
  return fresh;
}

/** Adapter into Task 03B accounting. Assumed effective fees remain distinct from maximum reserves. */
export function nativeDeliveryFeeEstimate(value: NativeDeliveryPreflight, expectedTermsHash: string,
  assumptions: { readonly assumedBaseFeePerGasWei: bigint; readonly assumedPriorityFeePerGasWei: bigint },
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): EvmFeeEstimate {
  assertNativeDelivery(value, expectedTermsHash, expectedPolicy);
  return estimateNativeDeliveryFees({ estimatedGas: value.snapshot.estimatedGas, baseFeePerGas: value.snapshot.baseFeePerGas },
    { maxFeePerGas: value.prepared.maxFeePerGas, maxPriorityFeePerGas: value.prepared.maxPriorityFeePerGas }, assumptions, value.policy);
}
/** Pre-quote cost adapter: no transaction serialization, nonce selection, RPC or signing. */
export function estimateNativeDeliveryFees(observation: { readonly estimatedGas: bigint; readonly baseFeePerGas: bigint },
  fees: { readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint },
  assumptions: { readonly assumedBaseFeePerGasWei: bigint; readonly assumedPriorityFeePerGasWei: bigint },
  expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): EvmFeeEstimate {
  const limits = policy(expectedPolicy), estimate = requireUint256(observation.estimatedGas, "Native gas estimate", true);
  check(estimate >= 21_000n, "Native gas estimate cannot be below intrinsic gas.");
  const observedBase = requireUint256(observation.baseFeePerGas, "Observed native base fee");
  const maximum = requireUint256(fees.maxFeePerGas, "Native maximum fee per gas", true);
  const tip = requireUint256(fees.maxPriorityFeePerGas, "Native priority fee");
  const gas = bufferedGas(estimate, limits);
  check(tip <= maximum && gas <= limits.gasLimitCap && maximum <= limits.maxFeePerGasCap && gas * maximum <= limits.maxTotalFeeWei,
    "Native cost observation exceeds protective transaction limits.");
  const base = requireUint256(assumptions.assumedBaseFeePerGasWei, "Expected native base fee");
  const priority = requireUint256(assumptions.assumedPriorityFeePerGasWei, "Expected native priority fee");
  check(base >= observedBase && base + priority > 0n && base + priority <= maximum && priority === tip,
    "Expected native fee assumptions exceed signed transaction caps.");
  return Object.freeze({ leg: "treasury-eth-delivery", payer: "treasury", estimatedGas: estimate,
    gasBufferBps: limits.gasBufferBps, assumedBaseFeePerGasWei: base, assumedPriorityFeePerGasWei: priority,
    maxPriorityFeePerGasWei: tip, maxFeePerGasWei: maximum,
    gasLimitCap: limits.gasLimitCap, maxTotalFeeWei: limits.maxTotalFeeWei });
}

/** Quiet-account balance attribution: unrelated same-block ETH activity fails closed on ambiguous deltas. */
export function assertNativeBalanceDeltas(amountWei: bigint, actualFeeWei: bigint, before: NativeBalances, after: NativeBalances) {
  requireUint256(amountWei, "Delivered native value", true); requireUint256(actualFeeWei, "Actual native gas fee");
  const treasury = requireUint256(after.treasuryEth, "After Treasury balance") - requireUint256(before.treasuryEth, "Before Treasury balance");
  const investor = requireUint256(after.investorEth, "After Investor balance") - requireUint256(before.investorEth, "Before Investor balance");
  check(investor === amountWei && treasury === -(amountWei + actualFeeWei), "Canonical ETH balance deltas differ from delivery value and actual gas; reconcile other activity.", "RECEIPT_FAILED");
  return Object.freeze({ treasury, investor });
}

/** Generic native receipt validation supports public algebraic fixtures; role binding is in the wrapper below. */
export async function verifyNativeTransferReceipt(prepared: PreparedNativeTransfer, signed: NativeSignedTransaction,
  rpc: SepoliaReadRpc, referenceBlockNumber: bigint): Promise<VerifiedNativeReceipt> {
  assertPreparedNativeTransfer(prepared);
  requireUint256(referenceBlockNumber, "Reference block", true);
  const expectedHash = hash(signed.hash), expectedTx = Transaction.from(signed.serialized);
  check(keccak256(signed.serialized) === expectedHash && expectedTx.hash === expectedHash && expectedTx.from === prepared.senderAddress &&
    signed.senderAddress === prepared.senderAddress && expectedTx.unsignedSerialized === prepared.unsignedSerialized,
    "Signed native bytes, digest, sender or transaction hash mismatch.", "RECEIPT_FAILED");
  check(quantity(await read(rpc, "eth_chainId", [])) === 11155111n, "Native receipt RPC must report Sepolia.", "RECEIPT_FAILED");
  const [rawValue, receiptValue, headValue] = await Promise.all([
    read(rpc, "eth_getTransactionByHash", [expectedHash]), read(rpc, "eth_getTransactionReceipt", [expectedHash]), read(rpc, "eth_blockNumber", []),
  ]);
  check(rawValue !== null && receiptValue !== null, "Native transaction/receipt not mined; reconcile the existing hash without resubmission.", "NOT_MINED");
  const raw = record(rawValue), receipt = record(receiptValue);
  check(hash(raw.hash) === expectedHash && quantity(raw.type) === 2n && quantity(raw.chainId) === 11155111n &&
    address(raw.from) === prepared.senderAddress && address(raw.to) === prepared.recipientAddress && quantity(raw.value) === prepared.amountWei &&
    raw.input === "0x" && quantity(raw.nonce) === BigInt(prepared.nonce) && quantity(raw.gas) === prepared.gasLimit &&
    quantity(raw.maxFeePerGas) === prepared.maxFeePerGas && quantity(raw.maxPriorityFeePerGas) === prepared.maxPriorityFeePerGas &&
    Array.isArray(raw.accessList) && raw.accessList.length === 0, "Mined native transaction differs from approved value, digest or parameters.", "RECEIPT_FAILED");
  const parity = quantity(raw.v);
  check([0n, 1n, 27n, 28n].includes(parity), "Invalid native signature recovery value.", "RECEIPT_FAILED");
  const reconstructed = Transaction.from(prepared.unsignedSerialized);
  reconstructed.signature = Signature.from({ r: normalizeEvmSignatureScalar(raw.r), s: normalizeEvmSignatureScalar(raw.s), v: Number(parity) });
  check(reconstructed.serialized === signed.serialized && reconstructed.hash === expectedHash && reconstructed.from === prepared.senderAddress,
    "Mined native signature does not reconstruct the approved sender and exact bytes.", "RECEIPT_FAILED");
  const blockNumber = quantity(receipt.blockNumber), blockHash = hash(receipt.blockHash), head = quantity(headValue);
  check(quantity(receipt.status) === 1n && hash(receipt.transactionHash) === expectedHash && address(receipt.from) === prepared.senderAddress &&
    address(receipt.to) === prepared.recipientAddress && quantity(raw.blockNumber) === blockNumber && hash(raw.blockHash) === blockHash,
    "Native receipt is failed or differs from its mined transaction.", "RECEIPT_FAILED");
  check(blockNumber > referenceBlockNumber && head >= blockNumber + 1n, "Native receipt needs a later block and at least two confirmations.", "RECEIPT_FAILED");
  const gasUsed = quantity(receipt.gasUsed), effectiveGasPriceWei = quantity(receipt.effectiveGasPrice), actualFeeWei = gasUsed * effectiveGasPriceWei;
  check(gasUsed >= 21_000n && gasUsed <= prepared.gasLimit && effectiveGasPriceWei <= prepared.maxFeePerGas && actualFeeWei <= prepared.maximumFeeWei,
    "Native actual gas or fee exceeds approved bounds.", "RECEIPT_FAILED");
  const blockTag = tag(blockNumber), parentTag = tag(blockNumber - 1n);
  const [blockValue, parentValue, beforeSender, beforeRecipient, afterSender, afterRecipient, senderCode, recipientCode] = await Promise.all([
    read(rpc, "eth_getBlockByNumber", [blockTag, false]), read(rpc, "eth_getBlockByNumber", [parentTag, false]),
    read(rpc, "eth_getBalance", [prepared.senderAddress, parentTag]), read(rpc, "eth_getBalance", [prepared.recipientAddress, parentTag]),
    read(rpc, "eth_getBalance", [prepared.senderAddress, blockTag]), read(rpc, "eth_getBalance", [prepared.recipientAddress, blockTag]),
    read(rpc, "eth_getCode", [prepared.senderAddress, blockTag]), read(rpc, "eth_getCode", [prepared.recipientAddress, blockTag]),
  ]);
  const block = record(blockValue), parent = record(parentValue);
  check(hash(block.hash) === blockHash && quantity(block.number) === blockNumber && quantity(parent.number) === blockNumber - 1n &&
    hash(block.parentHash) === hash(parent.hash), "Native receipt block or parent is not canonical.", "RECEIPT_FAILED");
  check(senderCode === "0x" && recipientCode === "0x", "Native role addresses must remain code-free EOAs.", "RECEIPT_FAILED");
  const base = quantity(block.baseFeePerGas), uncapped = base + prepared.maxPriorityFeePerGas;
  check(base <= prepared.maxFeePerGas && effectiveGasPriceWei === (uncapped < prepared.maxFeePerGas ? uncapped : prepared.maxFeePerGas),
    "Native effective gas price differs from mined EIP-1559 parameters.", "RECEIPT_FAILED");
  const before = Object.freeze({ treasuryEth: quantity(beforeSender), investorEth: quantity(beforeRecipient) });
  const after = Object.freeze({ treasuryEth: quantity(afterSender), investorEth: quantity(afterRecipient) });
  const nativeDeltas = assertNativeBalanceDeltas(prepared.amountWei, actualFeeWei, before, after);
  const finalBlock = record(await read(rpc, "eth_getBlockByNumber", [blockTag, false]));
  check(hash(finalBlock.hash) === blockHash && quantity(finalBlock.number) === blockNumber, "Native receipt block changed during verification.", "RECEIPT_FAILED");
  const feeObservation: ActualEvmCost = Object.freeze({ leg: "treasury-eth-delivery", payer: "treasury", transactionHash: expectedHash,
    executionStatus: "success", gasUsed, effectiveGasPriceWei });
  return Object.freeze({ transactionHash: expectedHash, blockNumber, blockHash, confirmations: head - blockNumber + 1n,
    gasUsed, effectiveGasPriceWei, actualFeeWei, before, after, nativeDeltas, feeObservation });
}
export async function verifyNativeDeliveryReceipt(value: NativeDeliveryPreflight, signed: NativeSignedTransaction,
  rpc: SepoliaReadRpc, expectedTermsHash: string, expectedPolicy: NativeDeliveryPolicy = DEFAULT_NATIVE_DELIVERY_POLICY): Promise<VerifiedNativeReceipt> {
  assertNativeDelivery(value, expectedTermsHash, expectedPolicy);
  assertTreasuryNativeSignedTransfer(value.prepared, signed);
  return verifyNativeTransferReceipt(value.prepared, signed, rpc, value.snapshot.blockNumber);
}
