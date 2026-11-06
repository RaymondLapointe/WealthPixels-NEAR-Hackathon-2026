import { isDeepStrictEqual } from "node:util";
import { assertPurchaseQuote, DEFAULT_PURCHASE_QUOTE_POLICY, type PurchaseQuote, type PurchaseQuotePolicy } from "./quote.js";
import { assertPriceSet, toFeePriceRates } from "./prices.js";
import { normalizePurchaseCostObservations, type CompletePurchaseCosts } from "./costs.js";
import { valueActualExecutionCosts, valueExecutionCosts, type ActualEvmCost, type ActualNearCost } from "./fee-eligibility.js";
import { check, fingerprint, frozen, hexHash, utc } from "./integrity.js";

/** The coordinator must independently validate the complete durable authorization before using this reference. */
export interface AuthorizedPurchaseCostReference {
  readonly quoteHash: string; readonly priceSetHash: string; readonly checkedAt: string; readonly authorizationHash: string;
}
function acceptedAssumptions(quote: PurchaseQuote, authorization: AuthorizedPurchaseCostReference, asOf: string,
  policy: PurchaseQuotePolicy) {
  assertPurchaseQuote(quote, authorization.quoteHash, policy);
  check(quote.purpose === "prepayment" && quote.prices.mode === "approved-demonstration",
    "Accepted-order calculations require an approved demonstration-price prepayment quote.");
  check(authorization.quoteHash === quote.quoteHash && authorization.priceSetHash === quote.prices.setHash,
    "Accepted-order authorization refers to another quote or price set.");
  hexHash(authorization.authorizationHash);
  const checked = utc(authorization.checkedAt);
  check(checked >= utc(quote.createdAt) && checked < utc(quote.expiresAt) && utc(asOf) >= checked,
    "The original payment authorization was not within quote validity or the accounting clock moved backwards.");
  // This historical check proves approval at authorization. It never makes the old prices current again.
  assertPriceSet(quote.prices, { purchaseId: quote.purchaseId, asOf: authorization.checkedAt,
    purpose: "prepayment", expectedPriceSetHash: authorization.priceSetHash });
  const originalRates = toFeePriceRates(quote.prices, { purchaseId: quote.purchaseId, asOf: authorization.checkedAt, purpose: "prepayment" });
  const rates = { ETH: { numerator: originalRates.ETH.usdNumerator, denominator: originalRates.ETH.usdDenominator },
    NEAR: { numerator: originalRates.NEAR.usdNumerator, denominator: originalRates.NEAR.usdDenominator } };
  const reference: AuthorizedPurchaseCostReference = { quoteHash: authorization.quoteHash, priceSetHash: authorization.priceSetHash,
    checkedAt: authorization.checkedAt, authorizationHash: authorization.authorizationHash };
  return { rates, reference };
}

/** Fresh network costs valued at already accepted historical assumptions; this grants no signing or broadcast permission. */
export function assessAuthorizedPurchaseCosts(quote: PurchaseQuote, authorization: AuthorizedPurchaseCostReference,
  freshCosts: CompletePurchaseCosts, asOf: string, policy = DEFAULT_PURCHASE_QUOTE_POLICY) {
  const { rates, reference } = acceptedAssumptions(quote, authorization, asOf, policy);
  const normalized = normalizePurchaseCostObservations(quote.terms, freshCosts, { purchaseId: quote.purchaseId,
    asOf, purpose: "prepayment", maxEstimateAgeMs: policy.maxEstimateAgeMs, executionPolicy: policy.execution });
  check(utc(freshCosts.sampledAt) >= utc(quote.costs.sampledAt) &&
    freshCosts.evmObservation.blockNumber >= quote.costs.evmObservation.blockNumber &&
    (freshCosts.evmObservation.blockNumber !== quote.costs.evmObservation.blockNumber || freshCosts.evmObservation.blockHash === quote.costs.evmObservation.blockHash) &&
    freshCosts.nearObservation.blockHeight >= quote.costs.nearObservation.blockHeight &&
    (freshCosts.nearObservation.blockHeight !== quote.costs.nearObservation.blockHeight || freshCosts.nearObservation.blockHash === quote.costs.nearObservation.blockHash),
    "Fresh accepted-order costs moved backwards or conflict with original canonical observation references.");
  if (quote.costs.assetIdentity) check(isDeepStrictEqual(quote.costs.assetIdentity, freshCosts.assetIdentity),
    "USDC implementation identity changed after the quote was approved.");
  const { normalizedEvm: _evm, normalizedNear: _near, ...values } = valueExecutionCosts(normalized.evm, normalized.near,
    rates, quote.terms.investmentUsdcBaseUnits, policy.maxExpectedFeeBps);
  const body = { schemaVersion: 1 as const, kind: "authorized-purchase-cost-assessment" as const,
    context: "locked-approved-order-assumptions" as const, purchaseId: quote.purchaseId,
    authorization: reference, originalPrices: quote.prices, freshCosts, checkedAt: asOf, expiresAt: normalized.expiresAt,
    ...values, priceAssumption: "one-nominal-test-USDC-per-USD" as const,
    executionProof: "none-calculation-only" as const, executionAuthorized: false as const };
  return frozen({ ...body, assessmentHash: fingerprint("authorized-purchase-cost-assessment-v1", body) });
}
export type AuthorizedCostAssessment = ReturnType<typeof assessAuthorizedPurchaseCosts>;

/** Completed receipt accounting may outlive price validity. Actual overruns never cancel the settlement obligation. */
export function valueAuthorizedActualCosts(quote: PurchaseQuote, authorization: AuthorizedPurchaseCostReference,
  input: { readonly evm: readonly ActualEvmCost[]; readonly near: readonly ActualNearCost[] }, asOf: string,
  policy = DEFAULT_PURCHASE_QUOTE_POLICY) {
  const { rates, reference } = acceptedAssumptions(quote, authorization, asOf, policy);
  const values = valueActualExecutionCosts(input.evm, input.near, rates, quote.terms.investmentUsdcBaseUnits, policy.maxExpectedFeeBps);
  const body = { schemaVersion: 1 as const, kind: "authorized-purchase-actual-costs" as const,
    context: "locked-approved-order-assumptions" as const, purchaseId: quote.purchaseId,
    chainId: 11155111n, quoteTermsHash: quote.terms.termsHash, investmentUsdcBaseUnits: quote.terms.investmentUsdcBaseUnits,
    authorization: reference, originalPrices: quote.prices, asOf, evm: input.evm, near: input.near, ...values,
    priceAssumption: "one-nominal-test-USDC-per-USD" as const, evidenceSource: "caller-supplied-receipt-observations" as const,
    settlementObligation: "unchanged-by-accounting" as const };
  return frozen({ ...body, actualCostRecordHash: fingerprint("authorized-purchase-actual-costs-v1", body) });
}
export type AuthorizedActualCosts = ReturnType<typeof valueAuthorizedActualCosts>;
