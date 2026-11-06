import assert from "node:assert/strict";
import test from "node:test";
import { assessAuthorizedPurchaseCosts, valueAuthorizedActualCosts, type AuthorizedPurchaseCostReference } from "../../src/purchase/authorized-costs.js";
import { normalizePurchaseCostObservations, createPurchaseFeeEstimate, type CompletePurchaseCosts } from "../../src/purchase/costs.js";
import { createPurchaseQuote, assertPaymentAuthorizationEligible, approvePurchaseQuote, DEFAULT_PURCHASE_QUOTE_POLICY } from "../../src/purchase/quote.js";
import { PURCHASE_FEE_LEGS, type ActualEvmCost, type ActualNearCost } from "../../src/purchase/fee-eligibility.js";
import { parseUsdcAmount } from "../../src/purchase/amounts.js";
import { fixtureQuote, prices, priceInput, costs, AT, seconds } from "./fixtures/purchase-quote.js";

// Synthetic public observations and simulated prior approval only; no signing, credentials or live execution.
const HASH = `0x${"ab".repeat(32)}`;
const authorization = (q = fixtureQuote("10", true)): AuthorizedPurchaseCostReference => ({
  quoteHash: q.quoteHash, priceSetHash: q.prices.setHash, checkedAt: seconds(10), authorizationHash: HASH });
const fresh = (c: CompletePurchaseCosts, at = 1000): CompletePurchaseCosts => ({ ...c, sampledAt: seconds(at), expiresAt: seconds(at + 300) });
function cheapQuote(amount: string) {
  const p = prices(true), c = costs(p, amount, "live");
  return createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "prepayment", prices: p,
    costs: { ...c, evm: c.evm.map(item => ({ ...item, observedBaseFeePerGasWei: 1000n, assumedBaseFeePerGasWei: 1000n,
      maxPriorityFeePerGasWei: 1000n, maxFeePerGasWei: 5000n })) }, investmentUsdcBaseUnits: parseUsdcAmount(amount), createdAt: AT });
}
function actual() {
  const evm: ActualEvmCost[] = PURCHASE_FEE_LEGS.map((leg, index) => ({ leg, payer: index ? "treasury" : "investor",
    transactionHash: `0x${String(index + 1).repeat(64)}`, executionStatus: "success", gasUsed: 50_000n, effectiveGasPriceWei: 1000n }));
  const near: ActualNearCost[] = PURCHASE_FEE_LEGS.map((leg, index) => ({ leg, payer: index ? "treasury" : "investor",
    transactionHash: String(index + 1).repeat(32), transactionTokensBurntYoctoNear: 400_000_000_000_000_000_000n,
    receiptOutcomes: [{ receiptId: `synthetic-receipt-${index}`, tokensBurntYoctoNear: 600_000_000_000_000_000_000n }],
    originalAttachedDepositYoctoNear: 1n, refundedDepositYoctoNear: 1n }));
  return { evm, near };
}

test("accepted-order assessment preserves expired original prices and quote timestamps without renewing eligibility", () => {
  const q = fixtureQuote("10", true), original = structuredClone(q);
  const result = assessAuthorizedPurchaseCosts(q, authorization(q), fresh(q.costs), seconds(1000));
  assert.equal(result.context, "locked-approved-order-assumptions"); assert.equal(result.executionAuthorized, false);
  assert.equal(result.executionProof, "none-calculation-only"); assert.equal(result.expiresAt, seconds(1060));
  assert.deepEqual(result.originalPrices, q.prices); assert.deepEqual(q, original);
  assert.equal(result.originalPrices.expiresAt, seconds(300)); assert.equal(q.expiresAt, seconds(60));
  assert.deepEqual(result.totalExpectedUsdcExact, q.feeAssessment.totalExpectedUsdcExact);
  assert.equal(result.expectedCosts.length, 6); assert.ok(Object.isFrozen(result.originalPrices));
  const approval = approvePurchaseQuote(q, { role: "investor", approval: q.quoteHash, reference: "simulated", approvedAt: AT });
  assert.throws(() => assertPaymentAuthorizationEligible(q, approval, { role: "investor", approval: q.quoteHash,
    asOf: seconds(1000), freshCosts: fresh(q.costs) }), /expired/);
  assert.throws(() => createPurchaseFeeEstimate(q.terms, q.prices, fresh(q.costs), { asOf: seconds(1000), purpose: "prepayment",
    maxExpectedFeeBps: 1000n, maxEstimateAgeMs: 60_000 }), /expired|stale/);
});
for (const amount of ["1", "5", "10", "20", "100"]) test(`${amount} USDC accepted-order valuation remains configurable`, () => {
  const q = cheapQuote(amount), result = assessAuthorizedPurchaseCosts(q, authorization(q), fresh(q.costs), seconds(1000));
  assert.equal(q.terms.investmentUsdcBaseUnits, parseUsdcAmount(amount)); assert.equal(result.eligible, true);
  assert.equal(result.expectedCosts.filter(item => item.payer === "investor").length, 2);
  assert.equal(result.expectedCosts.filter(item => item.payer === "treasury").length, 4);
});
test("accepted-order fee comparison accepts below and exactly 10% and records above 10% as ineligible", () => {
  const totalNear = 3n * (10_800_000_000_000n * 100_000_000n + 1n);
  for (const delta of [-1n, 0n, 1n]) {
    const input = priceInput(), p = prices(true, { ...input, prices: { ...input.prices, NEAR: { ...input.prices.NEAR,
      numerator: 567_700n * 10n ** 24n + delta, denominator: totalNear * 1_000_000n } } });
    const c = costs(p, "10", "live"), q = createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "prepayment", prices: p,
      costs: { ...c, near: c.near.map(item => ({ ...item, estimatedExecutionGas: 7_000_000_000_000n })) },
      investmentUsdcBaseUnits: 10_000_000n, createdAt: AT });
    const result = assessAuthorizedPurchaseCosts(q, authorization(q), fresh(c), seconds(1000));
    assert.equal(result.eligible, delta <= 0n); assert.equal(result.expectedFeeBpsCeil, delta <= 0n ? 1000n : 1001n);
  }
});
test("authorization must reference the original approved quote and fall strictly inside its original validity", () => {
  const q = fixtureQuote("10", true), a = authorization(q);
  for (const change of [{ quoteHash: `0x${"00".repeat(32)}` }, { priceSetHash: `0x${"00".repeat(32)}` },
    { checkedAt: seconds(-1) }, { checkedAt: seconds(60) }, { authorizationHash: "missing" }]) {
    assert.throws(() => assessAuthorizedPurchaseCosts(q, { ...a, ...change }, fresh(q.costs), seconds(1000)));
  }
  assert.throws(() => assessAuthorizedPurchaseCosts(q, a, fresh(q.costs), AT), /backwards/);
  assert.throws(() => assessAuthorizedPurchaseCosts(fixtureQuote(), authorization(fixtureQuote()), fresh(fixtureQuote().costs), seconds(1000)), /approved/);
});
test("accepted-order assessment rejects stale, missing, future, offline and wrong-identity costs", () => {
  const q = fixtureQuote("10", true), good = fresh(q.costs);
  for (const change of [{ sampledAt: seconds(940) }, { sampledAt: seconds(1001) }, { expiresAt: seconds(1000) },
    { mode: "offline" }, { near: good.near.slice(1) }, { evm: good.evm.slice(1) }, { termsHash: HASH }, { purchaseId: "another-purchase" },
    { evmObservation: { ...good.evmObservation, chainId: 1n } },
    { evm: good.evm.map(item => ({ ...item, amountBaseUnits: item.amountBaseUnits + 1n })) },
    { near: good.near.map(item => ({ ...item, accountId: "wrong.testnet" })) }]) {
    assert.throws(() => assessAuthorizedPurchaseCosts(q, authorization(q), { ...good, ...change } as CompletePurchaseCosts, seconds(1000)));
  }
});
test("accepted-order observations cannot move canonical references backwards or change the pinned implementation", () => {
  const initial = fixtureQuote("10", true), identity = { usdcImplementation: { address: "0x1111111111111111111111111111111111111111", codeHash: HASH } };
  const q = createPurchaseQuote({ purchaseId: initial.purchaseId, purpose: "prepayment", prices: initial.prices,
    costs: { ...initial.costs, assetIdentity: identity }, investmentUsdcBaseUnits: 10_000_000n, createdAt: AT });
  for (const change of [{ evmObservation: { ...q.costs.evmObservation, blockNumber: 99n } },
    { evmObservation: { ...q.costs.evmObservation, blockHash: HASH } },
    { nearObservation: { ...q.costs.nearObservation, blockHeight: 999n } },
    { assetIdentity: { usdcImplementation: { ...identity.usdcImplementation, codeHash: `0x${"cc".repeat(32)}` } } },
    { assetIdentity: undefined }]) assert.throws(() => assessAuthorizedPurchaseCosts(q, authorization(q), { ...fresh(q.costs), ...change }, seconds(1000)));
  assert.equal(assessAuthorizedPurchaseCosts(q, authorization(q), fresh(q.costs), seconds(1000)).eligible, true);
});
test("optional USDC implementation observations have exact, nonzero public identity fields", () => {
  const q = fixtureQuote("10", true);
  for (const implementation of [{ address: "bad", codeHash: HASH }, { address: "0x0000000000000000000000000000000000000000", codeHash: HASH },
    { address: "0x1111111111111111111111111111111111111111", codeHash: `0x${"00".repeat(32)}` },
    { address: "0x1111111111111111111111111111111111111111", codeHash: HASH, extra: true }]) {
    assert.throws(() => normalizePurchaseCostObservations(q.terms, { ...q.costs, assetIdentity: { usdcImplementation: implementation } },
      { purchaseId: q.purchaseId, asOf: AT, purpose: "prepayment", maxEstimateAgeMs: 60_000 }));
  }
});
test("actual costs after expiry use locked rates and retain realized overruns without cancelling settlement", () => {
  const q = fixtureQuote("10", true), input = actual(), before = structuredClone(q);
  const result = valueAuthorizedActualCosts(q, authorization(q), input, seconds(3600));
  assert.equal(result.costs.length, 6); assert.equal(result.totalActualUsdcBaseUnitsCeil, 3001n);
  assert.equal(result.realizedFeeBpsCeil, 4n); assert.equal(result.settlementObligation, "unchanged-by-accounting");
  const expensive = { ...input.evm[0]!, transactionHash: `0x${"ff".repeat(32)}`, executionStatus: "failed" as const,
    gasUsed: 1_000_000n, effectiveGasPriceWei: 1_000_000_000n };
  const overrun = valueAuthorizedActualCosts(q, authorization(q), { ...input, evm: [...input.evm, expensive] }, seconds(3600));
  assert.equal(overrun.exceedsOriginalFeePolicy, true); assert.equal(overrun.costs.length, 7);
  assert.equal(overrun.settlementObligation, "unchanged-by-accounting"); assert.deepEqual(q, before);
});
test("actual cost accounting rejects missing legs, duplicate hashes/receipts, wrong payer and impossible refunds", () => {
  const q = fixtureQuote("10", true), input = actual();
  for (const changed of [{ ...input, evm: input.evm.slice(1) }, { ...input, near: input.near.slice(1) },
    { ...input, evm: [...input.evm, input.evm[0]!] }, { ...input, near: [...input.near, input.near[0]!] },
    { ...input, near: input.near.map(item => ({ ...item, receiptOutcomes: input.near[0]!.receiptOutcomes })) },
    { ...input, near: input.near.map(item => ({ ...item, refundedDepositYoctoNear: 2n })) },
    { ...input, evm: input.evm.map(item => ({ ...item, payer: "investor" as const })) }]) {
    assert.throws(() => valueAuthorizedActualCosts(q, authorization(q), changed, seconds(3600)));
  }
});
test("calculations have no network or transaction capabilities and produce deterministic integrity hashes", () => {
  const q = fixtureQuote("10", true), c = fresh(q.costs), a = authorization(q);
  assert.deepEqual(assessAuthorizedPurchaseCosts(q, a, c, seconds(1000)), assessAuthorizedPurchaseCosts(q, a, c, seconds(1000)));
  assert.equal(assessAuthorizedPurchaseCosts(q, a, c, seconds(1000)).maxExpectedFeeBps, DEFAULT_PURCHASE_QUOTE_POLICY.maxExpectedFeeBps);
  assert.notEqual(assessAuthorizedPurchaseCosts(q, a, c, seconds(1000)).assessmentHash,
    assessAuthorizedPurchaseCosts(q, { ...a, authorizationHash: `0x${"cd".repeat(32)}` }, c, seconds(1000)).assessmentHash);
});
