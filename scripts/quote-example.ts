import { formatUsdcAmount } from "../src/purchase/amounts.js";
import { fixtureQuote } from "../test/near/fixtures/purchase-quote.js";

if (process.argv.length !== 2) throw new Error("The offline example accepts no configuration, credential or transaction arguments.");
const quote = fixtureQuote();
process.stdout.write(JSON.stringify({
  kind: "fixed-offline-purchase-example",
  executionProof: "none; no live prices, funding, human approval, transaction preparation, signing or broadcasting",
  pricingMode: quote.prices.mode, priceApproval: quote.prices.approval, quoteHash: quote.quoteHash,
  investmentUsdc: formatUsdcAmount(quote.terms.investmentUsdcBaseUnits),
  allocationBps: quote.terms.allocationBps, referencePrices: Object.fromEntries(Object.entries(quote.prices.prices)
    .map(([asset, p]) => [asset, { numerator: p.numerator, denominator: p.denominator, sourceUrl: p.sourceUrl,
      sourceReference: p.sourceReference, originalObservedAt: p.originalObservedAt, effectiveAt: p.effectiveAt, expiresAt: p.expiresAt }])),
  portfolioQuantities: quote.terms.quantities,
  expectedFeesUsdcRoundedUp: formatUsdcAmount(quote.feeAssessment.totalExpectedUsdcBaseUnitsCeil),
  expectedFeeBpsRoundedUp: quote.feeAssessment.expectedFeeBpsCeil,
  maximumFeeReservesUsdcRoundedUp: formatUsdcAmount(quote.feeAssessment.totalMaximumReserveUsdcBaseUnitsCeil),
  maxExpectedFeeBps: quote.policy.maxExpectedFeeBps, economicallyEligibleUnderFixtures: quote.feeAssessment.eligible,
  actualExecutionFees: "unavailable; no execution occurred", feeComponents: quote.feeAssessment.expectedCosts,
  createdAt: quote.createdAt, requestedExpiresAt: quote.requestedExpiresAt, effectiveExpiresAt: quote.expiresAt,
  executionAuthorized: quote.executionAuthorized,
}, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
