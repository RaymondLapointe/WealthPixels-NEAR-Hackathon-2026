import { isDeepStrictEqual } from "node:util";
import { VERIFIED_IDENTITIES } from "../near/identities.js";
import { DEFAULT_EXECUTION_LIMITS, MAX_EXPECTED_FEE_BPS, SEPOLIA_ASSETS } from "./config.js";
import { createPurchaseTerms, type PurchaseTerms } from "./terms.js";
import { createPurchaseFeeEstimate, costObservationDeadline, type CompletePurchaseCosts } from "./costs.js";
import { assertFeeEligible, revalidateFeeEligibilityBeforePayment, type FeeAssessment } from "./fee-eligibility.js";
import { assertPriceSet, toAllocationPrices, type PriceProvider, type PriceSet, type PricingPurpose } from "./prices.js";
import { createErc20AssetIntent } from "../evm/asset-intent.js";
import type { NativeDeliveryPolicy } from "../evm/sepolia-native.js";
import { requireUint256 } from "./amounts.js";
import { check, fingerprint, frozen, hexHash, label, purchaseId, utc } from "./integrity.js";

export interface PurchaseQuotePolicy {
  readonly maxExpectedFeeBps: bigint; readonly maxEstimateAgeMs: number; readonly nominalQuoteWindowMs: number;
  readonly execution: NativeDeliveryPolicy;
}
export const DEFAULT_PURCHASE_QUOTE_POLICY: PurchaseQuotePolicy = frozen({ maxExpectedFeeBps: MAX_EXPECTED_FEE_BPS,
  maxEstimateAgeMs: 60_000, nominalQuoteWindowMs: 30 * 60_000,
  execution: { ...DEFAULT_EXECUTION_LIMITS, operatingReserveWei: 1_000_000_000_000_000n } });
export interface PlannedPurchaseTransaction {
  readonly leg: "investor-usdc-payment" | "treasury-link-delivery" | "treasury-eth-delivery";
  readonly role: "treasury" | "investor"; readonly nearAccountId: string; readonly senderAddress: string; readonly recipientAddress: string;
  readonly asset: "USDC" | "LINK" | "ETH"; readonly tokenAddress: string | null; readonly decimals: number; readonly amountBaseUnits: bigint;
  readonly signingApproval: "exact-unsigned-digest"; readonly broadcastApproval: "exact-signed-hash";
  readonly transactionPreparationRequired: true;
}
export interface PurchaseQuote {
  readonly schemaVersion: 1; readonly kind: "purchase-quote"; readonly purchaseId: string; readonly purpose: PricingPurpose;
  readonly createdAt: string; readonly requestedExpiresAt: string; readonly expiresAt: string;
  readonly policy: PurchaseQuotePolicy; readonly prices: PriceSet; readonly terms: PurchaseTerms;
  readonly costs: CompletePurchaseCosts; readonly feeAssessment: FeeAssessment;
  readonly transactions: readonly PlannedPurchaseTransaction[]; readonly executionAuthorized: false; readonly quoteHash: string;
}
export interface PurchaseQuoteInput {
  readonly purchaseId: string; readonly purpose: PricingPurpose; readonly investmentUsdcBaseUnits: bigint;
  readonly prices: PriceSet; readonly costs: CompletePurchaseCosts; readonly createdAt: string;
  readonly requestedExpiresAt?: string; readonly policy?: PurchaseQuotePolicy;
}
export interface QuoteApproval {
  readonly kind: "investor-quote-approval"; readonly role: "investor"; readonly quoteHash: string;
  readonly reference: string; readonly approvedAt: string; readonly approvalHash: string;
}
export interface PaymentEligibility {
  readonly kind: "prepayment-eligibility"; readonly quoteHash: string; readonly priceSetHash: string;
  readonly checkedAt: string; readonly expiresAt: string; readonly freshCosts: CompletePurchaseCosts;
  readonly feeAssessment: FeeAssessment; readonly executionAuthorized: false; readonly eligibilityHash: string;
}
function checkedPolicy(value: PurchaseQuotePolicy): PurchaseQuotePolicy {
  requireUint256(value.maxExpectedFeeBps, "Fee ratio limit");
  check(value.maxExpectedFeeBps <= MAX_EXPECTED_FEE_BPS, "Quote policy cannot relax the configured 10% ceiling.");
  check(Number.isSafeInteger(value.maxEstimateAgeMs) && value.maxEstimateAgeMs > 0 && value.maxEstimateAgeMs <= 60_000, "Fee estimate age must not exceed 60 seconds.");
  check(Number.isSafeInteger(value.nominalQuoteWindowMs) && value.nominalQuoteWindowMs > 0 && value.nominalQuoteWindowMs <= 30 * 60_000, "Nominal quote window cannot exceed 30 minutes.");
  const e = value.execution;
  check(e && typeof e === "object", "Execution policy is required.");
  for (const key of ["gasLimitCap", "maxFeePerGasCap", "maxTotalFeeWei", "operatingReserveWei"] as const) requireUint256(e[key], key, true);
  check(e.gasLimitCap <= DEFAULT_EXECUTION_LIMITS.gasLimitCap && e.maxFeePerGasCap <= DEFAULT_EXECUTION_LIMITS.maxFeePerGasCap &&
    e.maxTotalFeeWei <= DEFAULT_EXECUTION_LIMITS.maxTotalFeeWei && e.gasBufferBps >= 2000n && e.gasBufferBps <= 10000n,
    "Quote cannot weaken protective transaction limits or the 20% buffer.");
  return frozen(value);
}
function planned(terms: PurchaseTerms): readonly PlannedPurchaseTransaction[] {
  const usdc = createErc20AssetIntent(terms, "usdc-payment", terms.termsHash), link = createErc20AssetIntent(terms, "link-delivery", terms.termsHash);
  const entry = (leg: PlannedPurchaseTransaction["leg"], role: "investor" | "treasury", asset: PlannedPurchaseTransaction["asset"],
    tokenAddress: string | null, decimals: number, amountBaseUnits: bigint): PlannedPurchaseTransaction => ({
    leg, role, nearAccountId: VERIFIED_IDENTITIES[role].accountId, senderAddress: VERIFIED_IDENTITIES[role].evmAddress,
    recipientAddress: VERIFIED_IDENTITIES[role === "investor" ? "treasury" : "investor"].evmAddress,
    asset, tokenAddress, decimals, amountBaseUnits, signingApproval: "exact-unsigned-digest", broadcastApproval: "exact-signed-hash", transactionPreparationRequired: true });
  return frozen([entry("investor-usdc-payment", "investor", "USDC", SEPOLIA_ASSETS.USDC.address, 6, usdc.amountBaseUnits),
    entry("treasury-link-delivery", "treasury", "LINK", SEPOLIA_ASSETS.LINK.address, 18, link.amountBaseUnits),
    entry("treasury-eth-delivery", "treasury", "ETH", null, 18, terms.quantities.ethWei)]);
}
/** Calculation only. It prepares no unsigned/signed blockchain transaction and grants no execution permission. */
export function createPurchaseQuote(input: PurchaseQuoteInput): PurchaseQuote {
  purchaseId(input.purchaseId);
  const policy = checkedPolicy(input.policy ?? DEFAULT_PURCHASE_QUOTE_POLICY), created = utc(input.createdAt);
  assertPriceSet(input.prices, { purchaseId: input.purchaseId, asOf: input.createdAt, purpose: input.purpose });
  const terms = createPurchaseTerms({ investmentUsdcBaseUnits: input.investmentUsdcBaseUnits,
    ...toAllocationPrices(input.prices, { purchaseId: input.purchaseId, asOf: input.createdAt, purpose: input.purpose }) });
  const requestedExpiresAt = input.requestedExpiresAt ?? new Date(created + policy.nominalQuoteWindowMs).toISOString();
  const deadline = Math.min(utc(requestedExpiresAt), created + policy.nominalQuoteWindowMs, utc(input.prices.expiresAt),
    utc(costObservationDeadline(input.costs, policy.maxEstimateAgeMs)));
  check(deadline > created, "Quote has no remaining price or fee validity.");
  const feeAssessment = createPurchaseFeeEstimate(terms, input.prices, input.costs, { asOf: input.createdAt, purpose: input.purpose,
    maxExpectedFeeBps: policy.maxExpectedFeeBps, maxEstimateAgeMs: policy.maxEstimateAgeMs,
    expiresAt: new Date(deadline).toISOString(), executionPolicy: policy.execution });
  assertFeeEligible(feeAssessment);
  const body = { schemaVersion: 1 as const, kind: "purchase-quote" as const, purchaseId: input.purchaseId, purpose: input.purpose,
    createdAt: input.createdAt, requestedExpiresAt, expiresAt: feeAssessment.expiresAt,
    policy, prices: input.prices, terms, costs: input.costs, feeAssessment, transactions: planned(terms), executionAuthorized: false as const };
  return frozen({ ...body, quoteHash: fingerprint("purchase-quote-v1", body) });
}
export async function quoteFromProvider(input: Omit<PurchaseQuoteInput, "prices"> & { readonly expectedPriceSetHash?: string }, provider: PriceProvider): Promise<PurchaseQuote> {
  const prices = await provider.getPrices({ purchaseId: input.purchaseId, asOf: input.createdAt, purpose: input.purpose,
    ...(input.expectedPriceSetHash ? { expectedPriceSetHash: input.expectedPriceSetHash } : {}) });
  if (input.expectedPriceSetHash !== undefined) check(prices.setHash === hexHash(input.expectedPriceSetHash), "Provider returned a different approved price set.");
  return createPurchaseQuote({ ...input, prices });
}
/** Historical integrity remains inspectable after expiry; action methods enforce the current clock separately. */
export function assertPurchaseQuote(value: PurchaseQuote, expectedQuoteHash: string, expectedPolicy = DEFAULT_PURCHASE_QUOTE_POLICY): void {
  const rebuilt = createPurchaseQuote({ purchaseId: value.purchaseId, purpose: value.purpose, investmentUsdcBaseUnits: value.terms.investmentUsdcBaseUnits,
    prices: value.prices, costs: value.costs, createdAt: value.createdAt, requestedExpiresAt: value.requestedExpiresAt, policy: expectedPolicy });
  check(isDeepStrictEqual(value, rebuilt) && hexHash(expectedQuoteHash) === rebuilt.quoteHash, "Immutable quote, fee assessment or trusted policy changed.");
}
export function approvePurchaseQuote(quote: PurchaseQuote, input: { readonly role: "investor"; readonly approval: string; readonly reference: string; readonly approvedAt: string },
  policy = DEFAULT_PURCHASE_QUOTE_POLICY): QuoteApproval {
  assertPurchaseQuote(quote, input.approval, policy);
  check(input.role === "investor", "Investor quote approval is required."); label(input.reference, "Investor approval reference");
  check(utc(input.approvedAt) >= utc(quote.createdAt) && utc(input.approvedAt) < utc(quote.expiresAt), "Quote is expired or not yet valid.");
  const body = { kind: "investor-quote-approval" as const, role: "investor" as const, quoteHash: quote.quoteHash, reference: input.reference, approvedAt: input.approvedAt };
  return frozen({ ...body, approvalHash: fingerprint("investor-quote-approval-v1", body) });
}
export function assertQuoteApproval(quote: PurchaseQuote, approval: QuoteApproval, policy = DEFAULT_PURCHASE_QUOTE_POLICY): void {
  const expected = approvePurchaseQuote(quote, { role: approval.role, approval: approval.quoteHash, reference: approval.reference, approvedAt: approval.approvedAt }, policy);
  check(isDeepStrictEqual(approval, expected), "Quote approval integrity failed.");
}
export function assertPaymentAuthorizationEligible(quote: PurchaseQuote, approval: QuoteApproval,
  input: { readonly role: "investor"; readonly approval: string; readonly asOf: string; readonly freshCosts: CompletePurchaseCosts },
  policy = DEFAULT_PURCHASE_QUOTE_POLICY): PaymentEligibility {
  assertPurchaseQuote(quote, input.approval, policy); assertQuoteApproval(quote, approval, policy);
  check(quote.purpose === "prepayment" && input.role === "investor", "Offline quotes or incorrect roles cannot authorize prepayment eligibility.");
  check(utc(input.asOf) >= utc(approval.approvedAt) && utc(input.asOf) < utc(quote.expiresAt), "Approved quote or fee observations have expired.");
  assertPriceSet(quote.prices, { purchaseId: quote.purchaseId, asOf: input.asOf, purpose: "prepayment", expectedPriceSetHash: quote.prices.setHash });
  const fresh = createPurchaseFeeEstimate(quote.terms, quote.prices, input.freshCosts, { asOf: input.asOf, purpose: "prepayment",
    maxExpectedFeeBps: policy.maxExpectedFeeBps, maxEstimateAgeMs: policy.maxEstimateAgeMs, expiresAt: quote.expiresAt, executionPolicy: policy.execution });
  const feeAssessment = revalidateFeeEligibilityBeforePayment(quote.feeAssessment, fresh.snapshot);
  const body = { kind: "prepayment-eligibility" as const, quoteHash: quote.quoteHash, priceSetHash: quote.prices.setHash,
    checkedAt: input.asOf, expiresAt: feeAssessment.expiresAt, freshCosts: input.freshCosts, feeAssessment, executionAuthorized: false as const };
  return frozen({ ...body, eligibilityHash: fingerprint("prepayment-eligibility-v1", body) });
}
