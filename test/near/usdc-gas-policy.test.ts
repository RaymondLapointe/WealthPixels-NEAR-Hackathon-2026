import assert from "node:assert/strict";
import test from "node:test";
import { Transaction } from "ethers";
import { DEFAULT_EXECUTION_LIMITS, purchaseExecutionPolicyForLeg } from "../../src/purchase/config.js";
import { DEFAULT_PURCHASE_QUOTE_POLICY, assertPurchaseQuote, createPurchaseQuote } from "../../src/purchase/quote.js";
import { normalizePurchaseCostObservations } from "../../src/purchase/costs.js";
import { buildErc20AssetTransfer, createErc20AssetIntent } from "../../src/evm/asset-intent.js";
import { assertPreparedPurchaseLeg, preparePurchaseLeg, recheckPurchaseLeg } from "../../src/purchase/legs.js";
import { AT, costs, fixtureQuote, prices } from "./fixtures/purchase-quote.js";
import { FEES, purchaseObservationRpc } from "./fixtures/purchase-legs.js";

// Synthetic public observations only. These tests never prepare a live transaction.
function asset(leg: "usdc-payment" | "link-delivery", gas: bigint, overrides = {}) {
  const quote = fixtureQuote(), intent = createErc20AssetIntent(quote.terms, leg, quote.terms.termsHash);
  return buildErc20AssetTransfer(intent, quote.terms, { nonce: 0, estimatedGas: gas,
    maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n, ...overrides });
}
test("USDC observed estimate 154151 uses exactly 184982 buffered gas, below its separate 200000 ceiling", () => {
  const value = asset("usdc-payment", 154_151n);
  assert.equal(value.prepared.gasLimit, 184_982n);
  assert.equal(Transaction.from(value.prepared.unsignedSerialized).gasLimit, 184_982n);
  assert.equal(value.policy.gasLimitCap, 200_000n);
  assert.equal(value.policy.gasBufferBps, 2000n);
  assert.equal(value.policy.maxFeePerGasCap, 30_000_000_000n);
  assert.equal(value.policy.maxTotalFeeWei, 3_600_000_000_000_000n);
});
test("USDC ceiling includes its exact boundary and rejects the next buffered gas unit", () => {
  assert.equal(asset("usdc-payment", 166_666n).prepared.gasLimit, 200_000n);
  assert.throws(() => asset("usdc-payment", 166_667n), /gas limit cap/);
});
test("LINK and native delivery retain their 180000 protective ceiling", () => {
  assert.throws(() => asset("link-delivery", 154_151n), /gas limit cap/);
  for (const leg of ["link-delivery", "eth-delivery", "treasury-link-delivery", "treasury-eth-delivery"] as const) {
    assert.equal(purchaseExecutionPolicyForLeg(DEFAULT_PURCHASE_QUOTE_POLICY.execution, leg).gasLimitCap, 180_000n);
  }
  assert.equal(DEFAULT_EXECUTION_LIMITS.gasLimitCap, 180_000n);
});
test("larger USDC ceiling never weakens maximum gas-price or total-fee guards", () => {
  assert.throws(() => asset("usdc-payment", 154_151n, { maxFeePerGas: 30_000_000_001n }), /fee per gas cap/);
  assert.throws(() => asset("usdc-payment", 154_151n, { maxFeePerGas: 30_000_000_000n }), /total fee cap/);
});
test("asset-specific policies reject unapproved ceilings and preserve tighter approved USDC limits", () => {
  const limits = DEFAULT_PURCHASE_QUOTE_POLICY.execution;
  for (const change of [{ usdcPaymentGasLimitCap: 200_001n }, { gasLimitCap: 180_001n }, { usdcPaymentGasLimitCap: 0n }]) {
    assert.throws(() => purchaseExecutionPolicyForLeg({ ...limits, ...change }, "usdc-payment"), /gas ceilings/);
  }
  assert.equal(purchaseExecutionPolicyForLeg({ ...limits, usdcPaymentGasLimitCap: 190_000n }, "usdc-payment").gasLimitCap, 190_000n);
});
test("immutable quote binds USDC ceiling and rejects altered policy without a new quotation", () => {
  const quote = fixtureQuote();
  assert.equal(quote.policy.execution.usdcPaymentGasLimitCap, 200_000n);
  assert.throws(() => assertPurchaseQuote({ ...quote, policy: { ...quote.policy,
    execution: { ...quote.policy.execution, usdcPaymentGasLimitCap: 199_999n } } }, quote.quoteHash));
  const p = prices();
  assert.throws(() => createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "offline", createdAt: AT, prices: p,
    investmentUsdcBaseUnits: 10_000_000n, costs: costs(p), policy: { ...DEFAULT_PURCHASE_QUOTE_POLICY,
      execution: { ...DEFAULT_PURCHASE_QUOTE_POLICY.execution, usdcPaymentGasLimitCap: 200_001n } } }));
});
test("purchase preparation, integrity and fresh recheck consistently use USDC-specific buffered gas", async () => {
  const quote = fixtureQuote(), rpc = purchaseObservationRpc("usdc-payment", { gas: 154_151n });
  const value = await preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, rpc.rpc);
  assert.equal(value.prepared.gasLimit, 184_982n);
  assertPreparedPurchaseLeg(value, quote, quote.quoteHash);
  await recheckPurchaseLeg(value, quote, quote.quoteHash, purchaseObservationRpc("usdc-payment", { gas: 154_151n }).rpc);
  await assert.rejects(recheckPurchaseLeg(value, quote, quote.quoteHash,
    purchaseObservationRpc("usdc-payment", { gas: 154_152n }).rpc), /gas buffer/);
  assert.ok(rpc.calls.every(call => !/sign|send|broadcast/i.test(call.method)));
});
test("six-cost normalization applies the USDC ceiling without relaxing delivery or economic limits", () => {
  const p = prices(), c = costs(p), q = fixtureQuote();
  const observations = { ...c, evm: c.evm.map(item => ({ ...item,
    estimatedGas: item.leg === "investor-usdc-payment" ? 154_151n : item.estimatedGas,
    observedBaseFeePerGasWei: 1000n, assumedBaseFeePerGasWei: 1000n,
    maxFeePerGasWei: 5000n, maxPriorityFeePerGasWei: 1000n })) };
  const options = { purchaseId: p.purchaseId, asOf: AT, purpose: "offline" as const,
    maxEstimateAgeMs: 60_000, executionPolicy: q.policy.execution };
  const result = normalizePurchaseCostObservations(q.terms, observations, options);
  assert.equal(result.evm[0]!.gasLimitCap, 200_000n);
  assert.equal(result.evm[0]!.estimatedGas, 154_151n);
  assert.equal(result.evm[1]!.gasLimitCap, 180_000n);
  assert.equal(result.evm[2]!.gasLimitCap, 180_000n);
  const quote = createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "offline", createdAt: AT,
    prices: p, investmentUsdcBaseUnits: 10_000_000n, costs: observations });
  assert.equal(quote.feeAssessment.expectedCosts[0]!.bufferedGas, 184_982n);
  assert.equal(quote.policy.maxExpectedFeeBps, 1000n);
  for (const leg of ["treasury-link-delivery", "treasury-eth-delivery"] as const) {
    assert.throws(() => normalizePurchaseCostObservations(q.terms,
      { ...observations, evm: observations.evm.map(item => ({ ...item, estimatedGas: item.leg === leg ? 154_151n : item.estimatedGas })) }, options));
  }
});
