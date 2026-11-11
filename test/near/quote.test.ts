import assert from "node:assert/strict";
import test from "node:test";
import { parseUsdcAmount } from "../../src/purchase/amounts.js";
import { createPurchaseFeeEstimate } from "../../src/purchase/costs.js";
import { createDemonstrationPriceProvider, type PriceSet, type PriceProvider } from "../../src/purchase/prices.js";
import { createPurchaseQuote, assertPurchaseQuote, approvePurchaseQuote, assertQuoteApproval, assertPaymentAuthorizationEligible,
  quoteFromProvider, DEFAULT_PURCHASE_QUOTE_POLICY, type PurchaseQuote } from "../../src/purchase/quote.js";
import { prices, priceInput, costs, fixtureQuote, termsFor, AT, seconds } from "./fixtures/purchase-quote.js";

function build(p: PriceSet, amount = "10", c = costs(p, amount), purpose: "offline" | "prepayment" = "offline") {
  return createPurchaseQuote({ purchaseId: p.purchaseId, purpose, investmentUsdcBaseUnits: parseUsdcAmount(amount), prices: p, costs: c, createdAt: AT });
}
function approval(q: PurchaseQuote) { return approvePurchaseQuote(q, { role: "investor", approval: q.quoteHash, reference: "SIMULATED investor approval", approvedAt: AT }); }

test("quote integrates all six system costs, with exact conversions, deposits and separate maximum reserves", () => {
  const q = fixtureQuote(), f = q.feeAssessment;
  assert.equal(f.expectedCosts.length, 6); assert.equal(f.maxExpectedFeeBps, 1000n);
  assert.equal(f.expectedCosts.filter(c => c.payer === "investor").length, 2);
  assert.equal(f.expectedCosts.filter(c => c.payer === "treasury").length, 4);
  assert.equal(f.totalExpectedUsdcBaseUnitsCeil, 435_541n);
  assert.equal(f.expectedFeeBpsCeil, 436n); assert.equal(f.totalMaximumReserveUsdcBaseUnitsCeil, 2_273_742n);
  assert.equal(f.eligible, true); assert.equal(q.executionAuthorized, false);
  const near = f.expectedCosts.filter(c => c.asset === "NEAR");
  assert.equal(near[0]!.bufferedGas, 10_800_000_000_000n);
  assert.equal(near[0]!.expectedNativeBaseUnits, 1_080_000_000_000_000_000_001n);
  assert.equal(near[0]!.maximumNativeReserveBaseUnits, 102_913_918_400_603_200_000_001n);
});

for (const amount of ["1", "5", "10", "20", "100"]) {
  test(`${amount} USDC quote supports variable amounts without an arbitrary minimum`, () => {
    const p = prices(), c = costs(p, amount);
    const cheaper = { ...c, evm: c.evm.map(item => ({ ...item, observedBaseFeePerGasWei: 100_000_000n,
      assumedBaseFeePerGasWei: 100_000_000n, maxPriorityFeePerGasWei: 10_000_000n, maxFeePerGasWei: 500_000_000n })) };
    const q = build(p, amount, cheaper);
    assert.equal(q.terms.investmentUsdcBaseUnits, BigInt(amount) * 1_000_000n);
    assert.deepEqual(q.terms.allocationBps, { eth: 5000n, link: 5000n });
    assert.equal(q.terms.quantities.ethWei, BigInt(amount) * 200_000_000_000_000n);
    assert.equal(q.terms.quantities.linkBaseUnits, BigInt(amount) * 50_000_000_000_000_000n);
    assertPurchaseQuote(q, q.quoteHash); assert.ok(q.feeAssessment.eligible);
  });
}

test("exactly 10% passes, values immediately below pass and immediately above fail without rounding", () => {
  const nearTotalYocto = 3n * (10_800_000_000_000n * 100_000_000n + 1n);
  for (const delta of [-1n, 0n, 1n]) {
    const input = priceInput();
    const p = prices(false, { ...input, prices: { ...input.prices, NEAR: { ...input.prices.NEAR,
      numerator: 567_700n * 10n ** 24n + delta, denominator: nearTotalYocto * 1_000_000n } } });
    if (delta > 0n) assert.throws(() => build(p), /exceed/);
    else { const q = build(p); assert.equal(q.feeAssessment.eligible, true); assert.equal(q.feeAssessment.expectedFeeBpsCeil, 1000n); }
  }
});

test("one USDC may fail economics under costly conditions while remaining a supported investment amount", () => {
  assert.throws(() => fixtureQuote("1"), /exceed/);
  assert.equal(fixtureQuote("5").terms.investmentUsdcBaseUnits, 5_000_000n);
});

test("portfolio ETH value is not included in execution costs", () => {
  const ten = fixtureQuote("10"), hundred = fixtureQuote("100");
  assert.equal(hundred.terms.quantities.ethWei, ten.terms.quantities.ethWei * 10n);
  assert.deepEqual(hundred.feeAssessment.totalExpectedUsdcExact, ten.feeAssessment.totalExpectedUsdcExact);
});

test("missing costs, incorrect role/token/amount and signing assumptions fail closed", () => {
  const p = prices(), c = costs(p);
  const invalid = [
    { ...c, evm: c.evm.slice(1) }, { ...c, near: [c.near[0]!, c.near[0]!, c.near[2]!] },
    { ...c, nearObservation: { ...c.nearObservation, gasPriceYoctoNear: 0n } },
    { ...c, evm: c.evm.map((item, i) => i === 0 ? { ...item, payer: "treasury" as const } : item) },
    { ...c, evm: c.evm.map((item, i) => i === 0 ? { ...item, decimals: 18 } : item) },
    { ...c, evm: c.evm.map((item, i) => i === 1 ? { ...item, tokenAddress: c.evm[0]!.tokenAddress } : item) },
    { ...c, evm: c.evm.map(item => ({ ...item, amountBaseUnits: item.amountBaseUnits + 1n })) },
    { ...c, near: c.near.map(item => ({ ...item, accountId: "wrong.testnet" })) },
    { ...c, near: c.near.map(item => ({ ...item, attachedGas: 1n })) },
    { ...c, near: c.near.map(item => ({ ...item, attachedDepositYoctoNear: 0n })) },
    { ...c, near: c.near.map(item => ({ ...item, transactionOverheadGas: 0n })) },
    { ...c, near: c.near.map(item => ({ ...item, executionAssumptionReference: "" })) },
    { ...c, evmObservation: { ...c.evmObservation, chainId: 1n } },
    { ...c, termsHash: `0x${"00".repeat(32)}` },
  ];
  for (const value of invalid) assert.throws(() => build(p, "10", value));
});

test("gas and fee observations enforce protective caps and cannot underestimate an observed base fee", () => {
  const p = prices(), c = costs(p);
  for (const change of [{ estimatedGas: 150_001n }, { estimatedGas: 0n }, { assumedBaseFeePerGasWei: 1n },
    { maxFeePerGasWei: 30_000_000_001n }, { maxFeePerGasWei: 1n }]) {
    assert.throws(() => build(p, "10", { ...c, evm: c.evm.map(item => ({ ...item, ...change })) }));
  }
  assert.throws(() => build(p, "10", { ...c, nearObservation: { ...c.nearObservation, blockHash: "invalid" } }));
});

test("legacy acceptance and current execution observations retain their original 60-second limits", () => {
  const q = fixtureQuote(); assert.equal(q.expiresAt, seconds(60)); assert.equal(q.requestedExpiresAt, seconds(1800));
  const p = prices(false, { ...priceInput(), expiresAt: seconds(20) });
  assert.equal(build(p).expiresAt, seconds(20));
  const c = costs(prices());
  const current = build(prices(), "10", { ...c, expiresAt: seconds(10) });
  assert.equal(current.schemaVersion, 2); assert.equal(current.expiresAt, seconds(300));
  assert.equal(current.feeAssessment.expiresAt, seconds(10));
  assert.throws(() => createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "offline", investmentUsdcBaseUnits: 10_000_000n,
    prices: p, costs: c, createdAt: seconds(20) }));
  assert.throws(() => createPurchaseFeeEstimate(q.terms, q.prices, q.costs, { asOf: seconds(60), purpose: "offline", maxExpectedFeeBps: 1000n, maxEstimateAgeMs: 60_000 }));
  assert.throws(() => build(prices(), "10", { ...c, sampledAt: seconds(1) }));
});

test("immutable quote binds prices, investment, allocation, fee record, planned identities and policy", () => {
  const q = fixtureQuote();
  for (const value of [
    { ...q, terms: { ...q.terms, investmentUsdcBaseUnits: 100_000_000n } },
    { ...q, terms: { ...q.terms, allocationBps: { eth: 4000n, link: 6000n } } },
    { ...q, feeAssessment: { ...q.feeAssessment, eligible: false } },
    { ...q, feeAssessment: { ...q.feeAssessment, totalExpectedUsdcBaseUnitsCeil: 0n } },
    { ...q, prices: { ...q.prices, providerId: "silent-price-substitution" } },
    { ...q, costs: { ...q.costs, sampledAt: seconds(10) } },
    { ...q, transactions: q.transactions.map(t => ({ ...t, role: "treasury" as const })) },
    { ...q, transactions: q.transactions.map(t => ({ ...t, recipientAddress: t.senderAddress })) },
    { ...q, expiresAt: seconds(1800) }, { ...q, executionAuthorized: true },
    { ...q, policy: { ...q.policy, maxEstimateAgeMs: 120_000 } },
  ]) assert.throws(() => assertPurchaseQuote(value as PurchaseQuote, q.quoteHash));
  assert.ok(Object.isFrozen(q)); assert.ok(Object.isFrozen(q.feeAssessment.expectedCosts));
  assertPurchaseQuote(q, q.quoteHash); // Historical inspection does not reinterpret expiry or reprice.
});

test("two interchangeable pricing-provider implementations yield identical arithmetic with distinct provenance", async () => {
  const a = prices(true), b = prices(true, priceInput("offline-purchase-10", "synthetic-provider-B"));
  const providers: PriceProvider[] = [createDemonstrationPriceProvider(a), { async getPrices(request) {
    const checked = createDemonstrationPriceProvider(b); return checked.getPrices(request);
  } }];
  const values = [];
  for (let i = 0; i < providers.length; i++) {
    const p = i === 0 ? a : b;
    values.push(await quoteFromProvider({ purchaseId: p.purchaseId, purpose: "prepayment", investmentUsdcBaseUnits: 10_000_000n,
      costs: costs(p, "10", "live"), createdAt: AT, expectedPriceSetHash: p.setHash }, providers[i]!));
  }
  assert.deepEqual(values[0]!.terms.quantities, values[1]!.terms.quantities);
  assert.deepEqual(values[0]!.feeAssessment.totalExpectedUsdcExact, values[1]!.feeAssessment.totalExpectedUsdcExact);
  assert.notEqual(values[0]!.quoteHash, values[1]!.quoteHash);
  let calls = 0;
  await assert.rejects(quoteFromProvider({ purchaseId: a.purchaseId, purpose: "prepayment", investmentUsdcBaseUnits: 10_000_000n,
    costs: costs(a, "10", "live"), createdAt: AT }, { async getPrices() { calls++; throw new Error("Offline source unavailable"); } }), /unavailable/);
  assert.equal(calls, 1);
});

test("Investor quote approval is hash-bound, time-bounded and immutable", () => {
  const q = fixtureQuote("10", true), a = approval(q);
  assertQuoteApproval(q, a);
  for (const change of [{ role: "treasury" as "investor" }, { approval: `0x${"00".repeat(32)}` }, { reference: "" },
    { approvedAt: seconds(-1) }, { approvedAt: seconds(60) }]) {
    assert.throws(() => approvePurchaseQuote(q, { role: "investor", approval: q.quoteHash, reference: "offline", approvedAt: AT, ...change }));
  }
  assert.throws(() => assertQuoteApproval(q, { ...a, reference: "changed approval" }));
});

test("fresh prepayment eligibility rechecks all six costs without repricing or extending the original quote", () => {
  const q = fixtureQuote("10", true), a = approval(q), before = q.quoteHash;
  const freshCosts = { ...q.costs, sampledAt: seconds(10), reference: "Fresh mocked six-cost observation" };
  const result = assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash, asOf: seconds(10), freshCosts });
  assert.equal(result.executionAuthorized, false); assert.equal(result.expiresAt, seconds(60));
  assert.equal(result.priceSetHash, q.prices.setHash); assert.equal(q.quoteHash, before);
  assert.equal(q.costs.sampledAt, AT);
  const increased = { ...freshCosts, evm: freshCosts.evm.map(item => ({ ...item, observedBaseFeePerGasWei: 2_000_000_000n, assumedBaseFeePerGasWei: 2_000_000_000n })) };
  assert.ok(assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash, asOf: seconds(10), freshCosts: increased }).feeAssessment.eligible);
});

test("prepayment fails for expired, unapproved/offline, missing, wrong-role and economically ineligible observations", () => {
  const q = fixtureQuote("10", true), a = approval(q);
  for (const input of [
    { role: "treasury" as "investor", approval: q.quoteHash, asOf: AT, freshCosts: q.costs },
    { role: "investor" as const, approval: q.quoteHash, asOf: seconds(60), freshCosts: { ...q.costs, sampledAt: seconds(60) } },
    { role: "investor" as const, approval: q.quoteHash, asOf: AT, freshCosts: { ...q.costs, mode: "offline" as const } },
    { role: "investor" as const, approval: q.quoteHash, asOf: AT, freshCosts: { ...q.costs, near: q.costs.near.slice(1) } },
    { role: "investor" as const, approval: q.quoteHash, asOf: AT, freshCosts: { ...q.costs, evm: q.costs.evm.map(item => ({ ...item,
      observedBaseFeePerGasWei: 3_000_000_000n, assumedBaseFeePerGasWei: 3_000_000_000n })) } },
  ]) assert.throws(() => assertPaymentAuthorizationEligible(q, a, input));
  const offline = fixtureQuote();
  assert.throws(() => assertPaymentAuthorizationEligible(offline, approval(offline), { role: "investor", approval: offline.quoteHash, asOf: AT, freshCosts: offline.costs }));
  assert.throws(() => createPurchaseQuote({ purchaseId: q.purchaseId, purpose: "prepayment", investmentUsdcBaseUnits: 10_000_000n,
    prices: prices(), costs: q.costs, createdAt: AT }));
});

test("new quote policies cannot raise the 10% threshold, relax fee freshness or protective caps", () => {
  const p = prices(), c = costs(p);
  for (const policy of [{ ...DEFAULT_PURCHASE_QUOTE_POLICY, maxExpectedFeeBps: 1001n },
    { ...DEFAULT_PURCHASE_QUOTE_POLICY, maxEstimateAgeMs: 60_001 },
    { ...DEFAULT_PURCHASE_QUOTE_POLICY, execution: { ...DEFAULT_PURCHASE_QUOTE_POLICY.execution, gasBufferBps: 1999n } },
    { ...DEFAULT_PURCHASE_QUOTE_POLICY, execution: { ...DEFAULT_PURCHASE_QUOTE_POLICY.execution, gasLimitCap: 180_001n } }]) {
    assert.throws(() => createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "offline", investmentUsdcBaseUnits: 10_000_000n,
      prices: p, costs: c, createdAt: AT, policy }));
  }
});

test("quote computation has no transaction serialization, credential or submission capability", () => {
  const previous = globalThis.fetch; globalThis.fetch = async () => { throw new Error("No network permitted"); };
  try {
    const q = fixtureQuote();
    assert.equal("unsignedSerialized" in q, false); assert.equal("signed" in q, false);
    assert.equal(q.transactions.length, 3);
    for (const t of q.transactions) { assert.equal(t.transactionPreparationRequired, true); assert.equal("nonce" in t, false); }
  } finally { globalThis.fetch = previous; }
});


test("V2 defaults to immutable price-bounded acceptance while retaining the short initial fee snapshot", () => {
  const p = prices(true), c = costs(p, "10", "live"), q = build(p, "10", c, "prepayment");
  assert.equal(q.schemaVersion, 2); assert.equal(q.expiresAt, p.expiresAt);
  assert.equal(q.feeAssessment.expiresAt, seconds(60)); assert.equal(q.executionAuthorized, false);
  const requested = createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "prepayment", investmentUsdcBaseUnits: 10_000_000n,
    prices: p, costs: c, createdAt: AT, requestedExpiresAt: seconds(90) });
  assert.equal(requested.expiresAt, seconds(90)); assert.equal(requested.feeAssessment.expiresAt, seconds(60));
  const policy = { ...DEFAULT_PURCHASE_QUOTE_POLICY, nominalQuoteWindowMs: 30_000 };
  const short = createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "prepayment", investmentUsdcBaseUnits: 10_000_000n,
    prices: p, costs: c, createdAt: AT, policy });
  assert.equal(short.expiresAt, seconds(30)); assertPurchaseQuote(short, short.quoteHash, policy);
});

test("V2 human approval after the initial 60 seconds requires fresh economics without changing approved terms", () => {
  const q = fixtureQuote("10", true, "offline-delayed-human-approval", 2), original = structuredClone(q);
  const a = approvePurchaseQuote(q, { role: "investor", approval: q.quoteHash,
    reference: "SIMULATED delayed human review only", approvedAt: seconds(90) });
  const freshCosts = { ...q.costs, sampledAt: seconds(100), expiresAt: seconds(160) };
  const eligible = assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash,
    asOf: seconds(100), freshCosts });
  assert.equal(eligible.checkedAt, seconds(100)); assert.equal(eligible.expiresAt, seconds(160));
  assert.equal(eligible.quoteHash, q.quoteHash); assert.equal(eligible.priceSetHash, q.prices.setHash);
  assert.equal(eligible.feeAssessment.expectedCosts.length, 6); assert.equal(eligible.executionAuthorized, false);
  assert.deepEqual(q, original); assert.equal(q.feeAssessment.expiresAt, seconds(60));
  assert.throws(() => assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash,
    asOf: seconds(100), freshCosts: q.costs }), /expired|stale/i);
});

test("V2 execution freshness and original price expiry remain hard boundaries", () => {
  const q = fixtureQuote("10", true, "offline-v2-freshness", 2), a = approval(q);
  for (const freshCosts of [
    { ...q.costs, sampledAt: seconds(40), expiresAt: seconds(160) },
    { ...q.costs, sampledAt: seconds(90), expiresAt: seconds(100) },
  ]) assert.throws(() => assertPaymentAuthorizationEligible(q, a,
    { role: "investor", approval: q.quoteHash, asOf: seconds(100), freshCosts }), /expired|stale/i);
  const latest = assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash,
    asOf: seconds(299), freshCosts: { ...q.costs, sampledAt: seconds(299), expiresAt: seconds(359) } });
  assert.equal(latest.expiresAt, q.prices.expiresAt);
  assert.throws(() => approvePurchaseQuote(q, { role: "investor", approval: q.quoteHash,
    reference: "SIMULATED expired approval", approvedAt: seconds(300) }), /expired/i);
  assert.throws(() => assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash,
    asOf: seconds(300), freshCosts: { ...q.costs, sampledAt: seconds(300), expiresAt: seconds(360) } }), /expired/i);
});

test("V2 fresh observations cannot silently change fee selections or exceed the expected fee ceiling", () => {
  const q = fixtureQuote("10", true, "offline-v2-fixed-economics", 2), a = approval(q);
  const fresh = { ...q.costs, sampledAt: seconds(100), expiresAt: seconds(160) };
  for (const change of [{ maxFeePerGasWei: 4_000_000_000n }, { maxPriorityFeePerGasWei: 200_000_000n }]) {
    assert.throws(() => assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash,
      asOf: seconds(100), freshCosts: { ...fresh, evm: fresh.evm.map(item => ({ ...item, ...change })) } }), /selection|changed/i);
  }
  assert.throws(() => assertPaymentAuthorizationEligible(q, a, { role: "investor", approval: q.quoteHash,
    asOf: seconds(100), freshCosts: { ...fresh, evm: fresh.evm.map(item => ({ ...item,
      observedBaseFeePerGasWei: 3_000_000_000n, assumedBaseFeePerGasWei: 3_000_000_000n })) } }), /exceed/i);
});

test("V1 historical timing and versioned integrity cannot be silently upgraded or reinterpreted", () => {
  const legacy = fixtureQuote("10", true), current = fixtureQuote("10", true, legacy.purchaseId, 2);
  assert.equal(legacy.schemaVersion, 1); assert.equal(legacy.expiresAt, seconds(60));
  // Golden captured independently from the pre-V2 Git HEAD constructor with these synthetic inputs.
  assert.equal(legacy.quoteHash, "0xa8dc055141dcbe095e66d5119b95fd3e96f714d417f88f07b69b2bbaacdfde85");
  assert.notEqual(legacy.quoteHash, current.quoteHash);
  assertPurchaseQuote(structuredClone(legacy), legacy.quoteHash); assertPurchaseQuote(structuredClone(current), current.quoteHash);
  for (const schemaVersion of [undefined, 0, 3, "2"]) {
    assert.throws(() => assertPurchaseQuote({ ...current, schemaVersion } as unknown as PurchaseQuote, current.quoteHash), /version/i);
  }
  assert.throws(() => assertPurchaseQuote({ ...legacy, schemaVersion: 2 }, legacy.quoteHash));
  assert.throws(() => assertPurchaseQuote({ ...current, schemaVersion: 1 }, current.quoteHash));
  assert.throws(() => approvePurchaseQuote(legacy, { role: "investor", approval: legacy.quoteHash,
    reference: "SIMULATED late legacy approval", approvedAt: seconds(90) }), /expired/i);
});
