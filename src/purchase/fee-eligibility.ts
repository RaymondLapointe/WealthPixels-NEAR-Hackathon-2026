import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { BPS_DENOMINATOR, DEFAULT_GAS_BUFFER_BPS, MAX_EXPECTED_FEE_BPS } from "./config.js";

/** Cost accounting only: this module has no RPC, credential, signing or state-write ports. */
export const PURCHASE_FEE_LEGS = ["investor-usdc-payment", "treasury-link-delivery", "treasury-eth-delivery"] as const;
export type PurchaseFeeLeg = typeof PURCHASE_FEE_LEGS[number];
export type FeePayer = "investor" | "treasury";
export type FeeMode = "offline" | "live";
export type FeeAsset = "ETH" | "NEAR";
export interface ExactFraction { readonly numerator: bigint; readonly denominator: bigint }
export interface FeePriceRate {
  readonly asset: FeeAsset;
  /** USD per whole native token. USDC equivalence assumes one nominal test USDC per USD. */
  readonly usdNumerator: bigint;
  readonly usdDenominator: bigint;
  readonly sourceUrl: string;
  readonly reference: string;
  readonly evidence: "verified-public" | "approved-demonstration" | "offline-fixture" | "unverified";
  /** Required for an explicitly approved fixed demonstration price. */
  readonly approvalReference?: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}
export interface EvmFeeEstimate {
  readonly leg: PurchaseFeeLeg;
  readonly payer: FeePayer;
  readonly estimatedGas: bigint;
  readonly gasBufferBps?: bigint;
  /** Explicit expected fee assumption; these are not the transaction's maximum fee caps. */
  readonly assumedBaseFeePerGasWei: bigint;
  readonly assumedPriorityFeePerGasWei: bigint;
  readonly maxPriorityFeePerGasWei: bigint;
  readonly maxFeePerGasWei: bigint;
  readonly gasLimitCap: bigint;
  readonly maxTotalFeeWei: bigint;
}
export interface NearFeeEstimate {
  readonly leg: PurchaseFeeLeg;
  readonly payer: FeePayer;
  /** Estimate signing execution gas, excluding the separately declared transaction overhead. */
  readonly estimatedExecutionGas: bigint;
  readonly transactionOverheadGas: bigint;
  readonly gasBufferBps?: bigint;
  readonly assumedGasPriceYoctoNear: bigint;
  /** Gas attachment is a maximum reserve, not a prediction that all attached gas is burned. */
  readonly attachedGas: bigint;
  /** Conservatively assume the original attached deposit is spent; never count forwarded deposits twice. */
  readonly attachedDepositYoctoNear: bigint;
}
export interface FeeEstimateInput {
  readonly chainId: bigint;
  readonly quoteTermsHash: string;
  readonly investmentUsdcBaseUnits: bigint;
  readonly mode: FeeMode;
  readonly sampledAt: string;
  readonly asOf: string;
  readonly expiresAt: string;
  readonly estimateReference: string;
  readonly maxExpectedFeeBps?: bigint;
  readonly maxEstimateAgeMs?: number;
  readonly rates: Readonly<Record<FeeAsset, FeePriceRate>>;
  readonly evm: readonly EvmFeeEstimate[];
  readonly near: readonly NearFeeEstimate[];
}
export interface EstimatedCost {
  readonly leg: PurchaseFeeLeg;
  readonly payer: FeePayer;
  readonly asset: FeeAsset;
  readonly bufferedGas: bigint;
  readonly expectedNativeBaseUnits: bigint;
  readonly maximumNativeReserveBaseUnits: bigint;
  readonly expectedUsdcExact: ExactFraction;
  readonly maximumReserveUsdcExact: ExactFraction;
}
export interface FeeAssessment {
  readonly kind: "fee-estimate-v1";
  readonly snapshot: FeeEstimateInput;
  readonly feeAssessmentHash: string;
  readonly maxExpectedFeeBps: bigint;
  readonly expectedCosts: readonly EstimatedCost[];
  readonly totalExpectedUsdcExact: ExactFraction;
  /** Conservative display values; eligibility uses the exact rational total, not these rounded values. */
  readonly totalExpectedUsdcBaseUnitsCeil: bigint;
  readonly expectedFeeBpsCeil: bigint;
  readonly totalMaximumReserveUsdcBaseUnitsCeil: bigint;
  readonly eligible: boolean;
  readonly expiresAt: string;
  readonly priceAssumption: "one-nominal-test-USDC-per-USD";
  readonly executionProof: "none-caller-supplied-estimates";
}

function integer(value: unknown, label: string, positive = false): bigint {
  if (typeof value !== "bigint" || value < (positive ? 1n : 0n)) throw new Error(`${label} must be ${positive ? "positive" : "nonnegative"} bigint`);
  return value;
}
function bps(value: unknown, label: string): bigint {
  const result = integer(value, label);
  if (result > BPS_DENOMINATOR) throw new Error(`${label} must not exceed 10000`);
  return result;
}
function gasBufferBps(value: unknown, label: string): bigint {
  const result = bps(value, label);
  if (result < DEFAULT_GAS_BUFFER_BPS) throw new Error(`${label} must retain at least the 20% conservative gas buffer`);
  return result;
}
function timestamp(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a UTC ISO timestamp`);
  }
  if (new Date(value).toISOString() !== value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z")) throw new Error(`${label} must be a valid calendar timestamp`);
  return Date.parse(value);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}
function fraction(numerator: bigint, denominator: bigint): ExactFraction {
  integer(numerator, "Fraction numerator"); integer(denominator, "Fraction denominator", true);
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  return Object.freeze({ numerator: numerator / a, denominator: denominator / a });
}
function sum(values: readonly ExactFraction[]): ExactFraction {
  return values.reduce((a, b) => fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator), fraction(0n, 1n));
}
function ceil(value: ExactFraction): bigint { return (value.numerator + value.denominator - 1n) / value.denominator; }
function buffered(value: bigint, bufferBps: bigint): bigint { return (value * (BPS_DENOMINATOR + bufferBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR; }
function nativeToUsdc(value: bigint, asset: FeeAsset, rate: FeePriceRate): ExactFraction {
  return fraction(value * rate.usdNumerator * 1_000_000n, 10n ** (asset === "ETH" ? 18n : 24n) * rate.usdDenominator);
}
function expectedPayer(leg: PurchaseFeeLeg): FeePayer { return leg === "investor-usdc-payment" ? "investor" : "treasury"; }
function requireLeg(value: { leg: PurchaseFeeLeg; payer: FeePayer }): void {
  if (!PURCHASE_FEE_LEGS.includes(value.leg) || value.payer !== expectedPayer(value.leg)) throw new Error("Fee leg or payer is invalid");
}
function requireAllLegs<T extends { leg: PurchaseFeeLeg; payer: FeePayer }>(values: readonly T[], label: string, exactlyOnce: boolean): readonly T[] {
  if (!Array.isArray(values) || values.length < 3) throw new Error(`${label} must include all three purchase legs`);
  values.forEach(requireLeg);
  for (const leg of PURCHASE_FEE_LEGS) {
    const count = values.filter(value => value.leg === leg).length;
    if (count === 0 || (exactlyOnce && count !== 1)) throw new Error(`${label} has a missing or duplicate fee leg`);
  }
  return values;
}
function validateRate(value: FeePriceRate | undefined, asset: FeeAsset, asOf: number, mode: FeeMode): FeePriceRate {
  if (!value || value.asset !== asset) throw new Error(`${asset} conversion rate is required`);
  integer(value.usdNumerator, `${asset} price numerator`, true);
  integer(value.usdDenominator, `${asset} price denominator`, true);
  let url: URL;
  try { url = new URL(value.sourceUrl); } catch { throw new Error(`${asset} price source URL is required`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${asset} price source must be public HTTPS without credentials`);
  text(value.reference, `${asset} price reference`);
  if (!["verified-public", "approved-demonstration", "offline-fixture"].includes(value.evidence)) throw new Error(`${asset} conversion provenance is unverified`);
  if (mode === "live" && value.evidence === "offline-fixture") throw new Error("Offline price fixtures cannot authorize live payment");
  if (value.evidence === "approved-demonstration") text(value.approvalReference, "Demonstration-price approval reference");
  if (timestamp(value.observedAt, `${asset} price observation`) > asOf || timestamp(value.expiresAt, `${asset} price expiration`) <= asOf) {
    throw new Error(`${asset} conversion rate is stale or from the future`);
  }
  return Object.freeze({ ...value });
}
function hash(kind: string, value: unknown): string {
  const canonical = (field: unknown): unknown => {
    if (typeof field === "bigint") return field.toString();
    if (Array.isArray(field)) return field.map(canonical);
    if (field && typeof field === "object") return Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
    return field;
  };
  return `0x${createHash("sha256").update(`${kind}\n${JSON.stringify(canonical(value))}`).digest("hex")}`;
}
function core(input: Pick<FeeEstimateInput, "chainId" | "quoteTermsHash" | "investmentUsdcBaseUnits" | "mode" | "asOf" | "rates">) {
  if (input.chainId !== 11155111n) throw new Error("Fee accounting requires Ethereum Sepolia chain ID 11155111");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.quoteTermsHash)) throw new Error("An immutable quote terms hash is required");
  integer(input.investmentUsdcBaseUnits, "USDC investment", true);
  if (input.mode !== "offline" && input.mode !== "live") throw new Error("Explicit offline or live fee mode is required");
  const asOf = timestamp(input.asOf, "Fee assessment time");
  const rates = Object.freeze({ ETH: validateRate(input.rates?.ETH, "ETH", asOf, input.mode), NEAR: validateRate(input.rates?.NEAR, "NEAR", asOf, input.mode) });
  return { asOf, rates };
}

/** Pure estimate; a mathematically eligible offline fixture is never a live authorization. */
export function createFeeEstimate(input: FeeEstimateInput): FeeAssessment {
  const { asOf, rates } = core(input);
  const maxExpectedFeeBps = bps(input.maxExpectedFeeBps ?? MAX_EXPECTED_FEE_BPS, "Maximum expected fee BPS");
  const maxAge = input.maxEstimateAgeMs ?? 60_000;
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) throw new Error("Maximum fee estimate age must be positive milliseconds");
  const sampledAt = timestamp(input.sampledAt, "Fee observation time");
  if (sampledAt > asOf || asOf - sampledAt > maxAge || timestamp(input.expiresAt, "Fee estimate expiration") <= asOf) throw new Error("Fee estimate is stale, expired or from the future");
  text(input.estimateReference, "Fee estimate reference");
  requireAllLegs(input.evm, "EVM estimates", true); requireAllLegs(input.near, "NEAR estimates", true);
  const evm = PURCHASE_FEE_LEGS.map(leg => Object.freeze({ ...input.evm.find(value => value.leg === leg)!, gasBufferBps: gasBufferBps(input.evm.find(value => value.leg === leg)!.gasBufferBps ?? DEFAULT_GAS_BUFFER_BPS, "EVM gas buffer BPS") }));
  const near = PURCHASE_FEE_LEGS.map(leg => Object.freeze({ ...input.near.find(value => value.leg === leg)!, gasBufferBps: gasBufferBps(input.near.find(value => value.leg === leg)!.gasBufferBps ?? DEFAULT_GAS_BUFFER_BPS, "NEAR gas buffer BPS") }));
  const expectedCosts: EstimatedCost[] = [];
  for (const item of evm) {
    const gas = buffered(integer(item.estimatedGas, "Estimated EVM gas", true), item.gasBufferBps);
    const feePerGas = integer(item.assumedBaseFeePerGasWei, "Assumed EVM base fee") + integer(item.assumedPriorityFeePerGasWei, "Assumed EVM priority fee");
    integer(feePerGas, "Expected EVM fee per gas", true);
    const maximum = gas * integer(item.maxFeePerGasWei, "EVM fee-per-gas cap", true);
    if (gas > integer(item.gasLimitCap, "EVM gas limit cap", true) || item.assumedPriorityFeePerGasWei > integer(item.maxPriorityFeePerGasWei, "EVM priority fee cap") || item.maxPriorityFeePerGasWei > item.maxFeePerGasWei || feePerGas > item.maxFeePerGasWei || maximum > integer(item.maxTotalFeeWei, "EVM total fee cap", true)) {
      throw new Error("EVM expected fees or buffered gas exceed protective transaction caps");
    }
    const expected = gas * feePerGas;
    expectedCosts.push(Object.freeze({ leg: item.leg, payer: item.payer, asset: "ETH", bufferedGas: gas, expectedNativeBaseUnits: expected, maximumNativeReserveBaseUnits: maximum, expectedUsdcExact: nativeToUsdc(expected, "ETH", rates.ETH), maximumReserveUsdcExact: nativeToUsdc(maximum, "ETH", rates.ETH) }));
  }
  for (const item of near) {
    const overhead = integer(item.transactionOverheadGas, "NEAR transaction overhead gas");
    const gas = buffered(integer(item.estimatedExecutionGas, "Estimated NEAR execution gas", true) + overhead, item.gasBufferBps);
    const maximumGas = integer(item.attachedGas, "NEAR attached gas", true) + overhead;
    if (gas > maximumGas) throw new Error("Expected NEAR gas exceeds the signing gas attachment and overhead reserve");
    const gasPrice = integer(item.assumedGasPriceYoctoNear, "Assumed NEAR gas price", true);
    const deposit = integer(item.attachedDepositYoctoNear, "NEAR original attached deposit");
    const expected = gas * gasPrice + deposit, maximum = maximumGas * gasPrice + deposit;
    expectedCosts.push(Object.freeze({ leg: item.leg, payer: item.payer, asset: "NEAR", bufferedGas: gas, expectedNativeBaseUnits: expected, maximumNativeReserveBaseUnits: maximum, expectedUsdcExact: nativeToUsdc(expected, "NEAR", rates.NEAR), maximumReserveUsdcExact: nativeToUsdc(maximum, "NEAR", rates.NEAR) }));
  }
  const total = sum(expectedCosts.map(value => value.expectedUsdcExact));
  const maximum = sum(expectedCosts.map(value => value.maximumReserveUsdcExact));
  const snapshot: FeeEstimateInput = Object.freeze({ chainId: input.chainId, quoteTermsHash: input.quoteTermsHash.toLowerCase(), investmentUsdcBaseUnits: input.investmentUsdcBaseUnits, mode: input.mode, sampledAt: input.sampledAt, asOf: input.asOf, expiresAt: input.expiresAt, estimateReference: input.estimateReference, maxExpectedFeeBps, maxEstimateAgeMs: maxAge, rates, evm: Object.freeze(evm), near: Object.freeze(near) });
  const expiresAt = new Date(Math.min(Date.parse(input.expiresAt), Date.parse(rates.ETH.expiresAt), Date.parse(rates.NEAR.expiresAt))).toISOString();
  return Object.freeze({ kind: "fee-estimate-v1", snapshot, feeAssessmentHash: hash("fee-estimate-v1", snapshot), maxExpectedFeeBps, expectedCosts: Object.freeze(expectedCosts), totalExpectedUsdcExact: total, totalExpectedUsdcBaseUnitsCeil: ceil(total), expectedFeeBpsCeil: ceil(fraction(total.numerator * BPS_DENOMINATOR, total.denominator * input.investmentUsdcBaseUnits)), totalMaximumReserveUsdcBaseUnitsCeil: ceil(maximum), eligible: total.numerator * BPS_DENOMINATOR <= input.investmentUsdcBaseUnits * maxExpectedFeeBps * total.denominator, expiresAt, priceAssumption: "one-nominal-test-USDC-per-USD", executionProof: "none-caller-supplied-estimates" });
}

function verifiedAssessment(assessment: FeeAssessment): FeeAssessment {
  const computed = createFeeEstimate(assessment.snapshot);
  if (!isDeepStrictEqual(computed, assessment)) throw new Error("Fee assessment integrity verification failed");
  return computed;
}
export function assertFeeEligible(assessment: FeeAssessment): void {
  if (!verifiedAssessment(assessment).eligible) throw new Error("Total expected system execution fees exceed the configured investment fee ratio");
}
/** 03D must collect fresh verified public inputs and preserve this record before authorizing payment. */
export function revalidateFeeEligibilityBeforePayment(approved: FeeAssessment, freshInput: FeeEstimateInput): FeeAssessment {
  const original = verifiedAssessment(approved);
  if (original.snapshot.mode !== "live" || freshInput.mode !== "live") throw new Error("Offline assessments cannot authorize live payment");
  const fresh = createFeeEstimate(freshInput);
  if (fresh.snapshot.quoteTermsHash !== original.snapshot.quoteTermsHash || fresh.snapshot.investmentUsdcBaseUnits !== original.snapshot.investmentUsdcBaseUnits || fresh.maxExpectedFeeBps !== original.maxExpectedFeeBps) throw new Error("Immutable quote terms, investment or fee policy changed");
  if (Date.parse(original.expiresAt) <= Date.parse(fresh.snapshot.asOf) || Date.parse(fresh.snapshot.sampledAt) < Date.parse(original.snapshot.sampledAt) || Date.parse(fresh.snapshot.asOf) < Date.parse(original.snapshot.asOf)) throw new Error("Approved quote expired or fee observations moved backwards");
  if (fresh.snapshot.maxEstimateAgeMs! > original.snapshot.maxEstimateAgeMs! || Date.parse(fresh.expiresAt) > Date.parse(original.expiresAt)) throw new Error("Revalidation cannot extend the approved freshness policy or expiration");
  assertFeeEligible(original); assertFeeEligible(fresh);
  return fresh;
}

export interface ActualEvmCost {
  readonly leg: PurchaseFeeLeg;
  readonly payer: FeePayer;
  readonly transactionHash: string;
  /** Failed attempts still incur gas and must be included in actual cost accounting. */
  readonly executionStatus: "success" | "failed";
  readonly gasUsed: bigint;
  readonly effectiveGasPriceWei: bigint;
}
export interface ActualNearCost {
  readonly leg: PurchaseFeeLeg;
  readonly payer: FeePayer;
  readonly transactionHash: string;
  readonly transactionTokensBurntYoctoNear: bigint;
  /** Every finalized receipt once; do not include forwarded deposits as additional spending. */
  readonly receiptOutcomes: readonly { readonly receiptId: string; readonly tokensBurntYoctoNear: bigint }[];
  readonly originalAttachedDepositYoctoNear: bigint;
  readonly refundedDepositYoctoNear: bigint;
}
export interface ActualExecutionCostInput extends Pick<FeeEstimateInput, "chainId" | "quoteTermsHash" | "investmentUsdcBaseUnits" | "mode" | "asOf" | "rates"> {
  readonly evm: readonly ActualEvmCost[];
  readonly near: readonly ActualNearCost[];
  readonly maxExpectedFeeBps?: bigint;
}
/** Accounting interface for 03D/03E: an actual overrun is recorded, never used to cancel paid delivery. */
export function recordActualExecutionFees(input: ActualExecutionCostInput) {
  const { rates } = core(input);
  const limit = bps(input.maxExpectedFeeBps ?? MAX_EXPECTED_FEE_BPS, "Maximum expected fee BPS");
  requireAllLegs(input.evm, "Actual EVM costs", false); requireAllLegs(input.near, "Actual NEAR costs", false);
  const txHashes = new Set<string>(), nearHashes = new Set<string>(), receiptIds = new Set<string>();
  const costs: { readonly leg: PurchaseFeeLeg; readonly payer: FeePayer; readonly asset: FeeAsset; readonly transactionHash: string; readonly nativeBaseUnits: bigint; readonly usdcExact: ExactFraction }[] = [];
  for (const value of input.evm) {
    const txHash = text(value.transactionHash, "EVM receipt transaction hash").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash) || txHashes.has(txHash)) throw new Error("Invalid or duplicate EVM receipt transaction hash");
    if (value.executionStatus !== "success" && value.executionStatus !== "failed") throw new Error("Known EVM execution status is required");
    txHashes.add(txHash);
    const amount = integer(value.gasUsed, "Actual EVM gas used", true) * integer(value.effectiveGasPriceWei, "Actual EVM effective gas price");
    costs.push(Object.freeze({ leg: value.leg, payer: value.payer, asset: "ETH", transactionHash: txHash, nativeBaseUnits: amount, usdcExact: nativeToUsdc(amount, "ETH", rates.ETH) }));
  }
  for (const value of input.near) {
    const txHash = text(value.transactionHash, "NEAR transaction hash");
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(txHash) || nearHashes.has(txHash)) throw new Error("Invalid or duplicate NEAR transaction hash");
    nearHashes.add(txHash);
    if (!Array.isArray(value.receiptOutcomes) || value.receiptOutcomes.length === 0) throw new Error("Complete NEAR receipt cost observations are required");
    let amount = integer(value.transactionTokensBurntYoctoNear, "Actual NEAR transaction tokens burnt");
    for (const receipt of value.receiptOutcomes) {
      const id = text(receipt.receiptId, "NEAR receipt ID");
      if (receiptIds.has(id)) throw new Error("Duplicate NEAR receipt cost");
      receiptIds.add(id); amount += integer(receipt.tokensBurntYoctoNear, "Actual NEAR receipt tokens burnt");
    }
    const deposit = integer(value.originalAttachedDepositYoctoNear, "Actual original NEAR deposit"), refund = integer(value.refundedDepositYoctoNear, "Actual refunded NEAR deposit");
    if (refund > deposit) throw new Error("NEAR deposit refund exceeds the original attachment");
    amount += deposit - refund;
    costs.push(Object.freeze({ leg: value.leg, payer: value.payer, asset: "NEAR", transactionHash: txHash, nativeBaseUnits: amount, usdcExact: nativeToUsdc(amount, "NEAR", rates.NEAR) }));
  }
  const total = sum(costs.map(value => value.usdcExact));
  const actual = Object.freeze({ kind: "actual-execution-costs-v1", chainId: input.chainId, quoteTermsHash: input.quoteTermsHash.toLowerCase(), investmentUsdcBaseUnits: input.investmentUsdcBaseUnits, mode: input.mode, asOf: input.asOf, rates, costs: Object.freeze(costs), totalActualUsdcExact: total, totalActualUsdcBaseUnitsCeil: ceil(total), realizedFeeBpsCeil: ceil(fraction(total.numerator * BPS_DENOMINATOR, total.denominator * input.investmentUsdcBaseUnits)), exceedsOriginalFeePolicy: total.numerator * BPS_DENOMINATOR > input.investmentUsdcBaseUnits * limit * total.denominator, maxExpectedFeeBps: limit, priceAssumption: "one-nominal-test-USDC-per-USD", evidenceSource: "caller-supplied-receipt-observations", settlementObligation: "unchanged-by-accounting" });
  return Object.freeze({ ...actual, actualCostRecordHash: hash("actual-execution-costs-v1", actual) });
}
