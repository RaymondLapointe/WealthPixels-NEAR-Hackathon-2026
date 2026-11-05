import assert from "node:assert/strict";
import test from "node:test";
import {
  PURCHASE_FEE_LEGS, assertFeeEligible, createFeeEstimate, recordActualExecutionFees,
  revalidateFeeEligibilityBeforePayment, type FeeEstimateInput, type ActualExecutionCostInput,
} from "../../src/purchase/fee-eligibility.js";

// Fixed accounting fixtures, not observed blockchain fees, live prices or transaction evidence.
const AT = "2026-11-05T20:00:00.000Z", EXPIRY = "2026-11-05T20:30:00.000Z";
const HASH = `0x${"a".repeat(64)}`;
const payer = (leg: typeof PURCHASE_FEE_LEGS[number]) => leg === "investor-usdc-payment" ? "investor" as const : "treasury" as const;
function fixture(investmentUsdc = 10n, mode: "offline" | "live" = "offline"): FeeEstimateInput {
  const price = (asset: "ETH" | "NEAR", usdNumerator: bigint) => ({ asset, usdNumerator, usdDenominator: 1n,
    sourceUrl: `https://example.invalid/fixed-offline-${asset.toLowerCase()}-price`, reference: "fixed-offline-accounting-fixture",
    evidence: mode === "offline" ? "offline-fixture" as const : "verified-public" as const, observedAt: AT, expiresAt: EXPIRY });
  return { chainId: 11155111n, quoteTermsHash: HASH, investmentUsdcBaseUnits: investmentUsdc * 1_000_000n,
    mode, sampledAt: AT, asOf: AT, expiresAt: EXPIRY, estimateReference: "fixed-offline-gas-fixture-v1",
    rates: { ETH: price("ETH", 1000n), NEAR: price("NEAR", 1n) },
    evm: PURCHASE_FEE_LEGS.map(leg => ({ leg, payer: payer(leg), estimatedGas: 100_000n,
      assumedBaseFeePerGasWei: 900_000_000n, assumedPriorityFeePerGasWei: 100_000_000n,
      maxPriorityFeePerGasWei: 1_000_000_000n, maxFeePerGasWei: 5_000_000_000n,
      gasLimitCap: 180_000n, maxTotalFeeWei: 3_600_000_000_000_000n })),
    near: PURCHASE_FEE_LEGS.map(leg => ({ leg, payer: payer(leg), estimatedExecutionGas: 10_000_000_000_000n,
      transactionOverheadGas: 0n, assumedGasPriceYoctoNear: 10_000_000_000n,
      attachedGas: 100_000_000_000_000n, attachedDepositYoctoNear: 0n })) };
}
function withExtraDeposit(input: FeeEstimateInput, deposit: bigint): FeeEstimateInput {
  return { ...input, near: input.near.map((value, index) => index === 2 ? { ...value, attachedDepositYoctoNear: deposit } : value) };
}
function actualFixture(): ActualExecutionCostInput {
  const input = fixture();
  return { chainId: input.chainId, quoteTermsHash: input.quoteTermsHash, investmentUsdcBaseUnits: input.investmentUsdcBaseUnits,
    mode: input.mode, asOf: input.asOf, rates: input.rates,
    evm: PURCHASE_FEE_LEGS.map((leg, index) => ({ leg, payer: payer(leg), transactionHash: `0x${String(index + 1).repeat(64)}`,
      executionStatus: "success", gasUsed: 100_000n, effectiveGasPriceWei: 1_000_000_000n })),
    near: PURCHASE_FEE_LEGS.map((leg, index) => ({ leg, payer: payer(leg), transactionHash: String(index + 1).repeat(32),
      transactionTokensBurntYoctoNear: 40_000_000_000_000_000_000_000n,
      receiptOutcomes: [{ receiptId: `fixed-offline-receipt-${index}`, tokensBurntYoctoNear: 60_000_000_000_000_000_000_000n }],
      originalAttachedDepositYoctoNear: 1n, refundedDepositYoctoNear: 1n })) };
}

test("fee estimate sums all three EVM and three NEAR costs across both payers", () => {
  const result = createFeeEstimate(fixture());
  assert.equal(result.maxExpectedFeeBps, 1000n);
  assert.equal(result.expectedCosts.length, 6);
  assert.equal(result.totalExpectedUsdcBaseUnitsCeil, 720_000n);
  assert.equal(result.expectedFeeBpsCeil, 720n);
  assert.equal(result.eligible, true);
  assert.equal(result.expectedCosts.filter(value => value.payer === "investor").length, 2);
  assert.equal(result.expectedCosts.filter(value => value.payer === "treasury").length, 4);
  assert.equal(result.executionProof, "none-caller-supplied-estimates");
  assert.equal(result.priceAssumption, "one-nominal-test-USDC-per-USD");
});
test("expected assumptions, 20% buffered gas and maximum fee reserves remain distinct", () => {
  const result = createFeeEstimate(fixture());
  assert.equal(result.expectedCosts[0]!.bufferedGas, 120_000n);
  assert.equal(result.expectedCosts[0]!.expectedNativeBaseUnits, 120_000_000_000_000n);
  assert.equal(result.expectedCosts[0]!.maximumNativeReserveBaseUnits, 600_000_000_000_000n);
  assert.equal(result.totalMaximumReserveUsdcBaseUnitsCeil, 4_800_000n);
  assert.equal(result.eligible, true); // Caps exceed 10%; expected execution costs do not.
});
for (const [amount, feeBps, eligible] of [[1n, 7200n, false], [5n, 1440n, false], [10n, 720n, true], [20n, 360n, true], [100n, 72n, true]] as const) {
  test(`${amount} USDC has an exact fee ratio and no arbitrary investment minimum`, () => {
    const result = createFeeEstimate(fixture(amount));
    assert.equal(result.snapshot.investmentUsdcBaseUnits, amount * 1_000_000n);
    assert.equal(result.expectedFeeBpsCeil, feeBps); assert.equal(result.eligible, eligible);
    if (eligible) assert.doesNotThrow(() => assertFeeEligible(result)); else assert.throws(() => assertFeeEligible(result), /exceed/);
  });
}
test("below, exactly at and above 10% compare exact rationals without rounding a pass", () => {
  const depositAtBoundary = 280_000_000_000_000_000_000_000n;
  const below = createFeeEstimate(withExtraDeposit(fixture(), depositAtBoundary - 1n));
  const exact = createFeeEstimate(withExtraDeposit(fixture(), depositAtBoundary));
  const above = createFeeEstimate(withExtraDeposit(fixture(), depositAtBoundary + 1n));
  assert.equal(below.eligible, true); assert.equal(exact.eligible, true); assert.equal(above.eligible, false);
  assert.equal(below.totalExpectedUsdcBaseUnitsCeil, 1_000_000n);
  assert.equal(exact.totalExpectedUsdcBaseUnitsCeil, 1_000_000n);
  assert.equal(above.totalExpectedUsdcBaseUnitsCeil, 1_000_001n);
  assert.equal(exact.expectedFeeBpsCeil, 1000n); assert.equal(above.expectedFeeBpsCeil, 1001n);
});
test("fee policy is configurable and amount/fee values must be exact integers", () => {
  assert.equal(createFeeEstimate({ ...fixture(5n), maxExpectedFeeBps: 1500n }).eligible, true);
  for (const input of [{ ...fixture(), maxExpectedFeeBps: -1n }, { ...fixture(), maxExpectedFeeBps: 10_001n },
    { ...fixture(), investmentUsdcBaseUnits: 0n }, { ...fixture(), investmentUsdcBaseUnits: 10 as unknown as bigint }]) assert.throws(() => createFeeEstimate(input));
  assert.doesNotThrow(() => createFeeEstimate({ ...fixture(), investmentUsdcBaseUnits: 1n }));
});
test("missing, zero or unverified conversions fail closed", () => {
  const input = fixture();
  for (const rates of [undefined, { ETH: input.rates.ETH }, { ...input.rates, NEAR: { ...input.rates.NEAR, usdNumerator: 0n } },
    { ...input.rates, ETH: { ...input.rates.ETH, usdDenominator: 0n } }, { ...input.rates, NEAR: { ...input.rates.NEAR, evidence: "unverified" } },
    { ...input.rates, ETH: { ...input.rates.ETH, sourceUrl: "" } }]) {
    assert.throws(() => createFeeEstimate({ ...input, rates: rates as FeeEstimateInput["rates"] }));
  }
});
test("missing or duplicate estimates and swapped fee payers are rejected", () => {
  const input = fixture();
  assert.throws(() => createFeeEstimate({ ...input, evm: input.evm.slice(1) }), /all three/);
  assert.throws(() => createFeeEstimate({ ...input, near: [input.near[0]!, input.near[0]!, input.near[2]!] }), /missing or duplicate/);
  assert.throws(() => createFeeEstimate({ ...input, evm: input.evm.map(value => ({ ...value, payer: "investor" })) }), /payer/);
  assert.throws(() => createFeeEstimate({ ...input, near: input.near.map(value => ({ ...value, assumedGasPriceYoctoNear: undefined as unknown as bigint })) }), /gas price/);
});
test("stale, expired, future and wrong-network observations are rejected", () => {
  const input = fixture();
  for (const changed of [{ ...input, chainId: 1n }, { ...input, quoteTermsHash: "missing" },
    { ...input, asOf: "2026-11-05T20:02:00.000Z" }, { ...input, sampledAt: "2026-11-05T20:00:01.000Z" }, { ...input, expiresAt: AT },
    { ...input, rates: { ...input.rates, NEAR: { ...input.rates.NEAR, expiresAt: AT } } },
    { ...input, rates: { ...input.rates, ETH: { ...input.rates.ETH, observedAt: EXPIRY } } }]) assert.throws(() => createFeeEstimate(changed));
});
test("buffered gas, assumed prices and priority fees cannot exceed protective caps", () => {
  const input = fixture();
  for (const evm of [input.evm.map(value => ({ ...value, gasLimitCap: 110_000n })), input.evm.map(value => ({ ...value, maxFeePerGasWei: 1n })),
    input.evm.map(value => ({ ...value, maxPriorityFeePerGasWei: 1n })), input.evm.map(value => ({ ...value, maxTotalFeeWei: 1n }))]) assert.throws(() => createFeeEstimate({ ...input, evm }), /caps/);
  assert.throws(() => createFeeEstimate({ ...input, near: input.near.map(value => ({ ...value, attachedGas: 10_000_000_000_000n })) }), /attachment/);
});
test("expected EVM and NEAR costs retain a minimum 20% conservative gas buffer", () => {
  const input = fixture();
  for (const gasBufferBps of [0n, 1999n]) {
    assert.throws(() => createFeeEstimate({ ...input, evm: input.evm.map(value => ({ ...value, gasBufferBps })) }), /at least the 20%/);
    assert.throws(() => createFeeEstimate({ ...input, near: input.near.map(value => ({ ...value, gasBufferBps })) }), /at least the 20%/);
  }
  for (const gasBufferBps of [2000n, 2500n]) {
    assert.doesNotThrow(() => createFeeEstimate({ ...input, evm: input.evm.map(value => ({ ...value, gasBufferBps })), near: input.near.map(value => ({ ...value, gasBufferBps })) }));
  }
});
test("NEAR deposits and explicit transaction overhead are included", () => {
  const input = fixture();
  const result = createFeeEstimate({ ...input, near: input.near.map(value => ({ ...value, transactionOverheadGas: 1_000_000_000_000n, attachedDepositYoctoNear: 1n })) });
  assert.equal(result.expectedCosts[3]!.bufferedGas, 13_200_000_000_000n);
  assert.equal(result.expectedCosts[3]!.expectedNativeBaseUnits, 132_000_000_000_000_000_000_001n);
  assert.equal(result.totalExpectedUsdcBaseUnitsCeil, 756_001n);
});
test("rational conversion and hashes preserve immutable fee assumptions", () => {
  const input = fixture();
  const result = createFeeEstimate({ ...input, rates: { ...input.rates, ETH: { ...input.rates.ETH, usdNumerator: 1n, usdDenominator: 3n } } });
  assert.deepEqual(result.expectedCosts[0]!.expectedUsdcExact, { numerator: 40n, denominator: 1n });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.snapshot.evm)); assert.ok(Object.isFrozen(result.snapshot.rates.NEAR));
  assert.notEqual(result.feeAssessmentHash, createFeeEstimate(fixture()).feeAssessmentHash);
  assert.equal(createFeeEstimate({ ...fixture(), evm: [...fixture().evm].reverse() }).feeAssessmentHash, createFeeEstimate(fixture()).feeAssessmentHash);
  assert.throws(() => assertFeeEligible({ ...result, eligible: false }), /integrity/);
});
test("assessment integrity rejects BigInt-to-string changes even when serialized hashes collide", () => {
  const assessment = createFeeEstimate(fixture());
  assert.throws(() => assertFeeEligible({ ...assessment, expectedFeeBpsCeil: "720" } as unknown as typeof assessment), /integrity/);
  assert.throws(() => assertFeeEligible({ ...assessment, expectedCosts: assessment.expectedCosts.map(value => ({ ...value, bufferedGas: String(value.bufferedGas) })) } as unknown as typeof assessment), /integrity/);
  assert.throws(() => assertFeeEligible({ ...assessment, totalExpectedUsdcExact: { numerator: "720000", denominator: "1" } } as unknown as typeof assessment), /integrity/);
});
test("offline fixtures may calculate eligibility but never authorize live payment", () => {
  const input = fixture(), assessment = createFeeEstimate(input);
  assert.equal(assessment.eligible, true);
  assert.throws(() => revalidateFeeEligibilityBeforePayment(assessment, input), /Offline assessments/);
  assert.throws(() => createFeeEstimate({ ...input, mode: "live" }), /Offline price fixtures/);
  assert.throws(() => createFeeEstimate({ ...fixture(), rates: { ...input.rates, NEAR: { ...input.rates.NEAR, evidence: "approved-demonstration" } } }), /approval/);
});
test("fresh pre-payment eligibility binds amount, terms, policy and original expiration", () => {
  const input = fixture(10n, "live"), approved = createFeeEstimate(input);
  const fresh = { ...input, asOf: "2026-11-05T20:05:00.000Z", sampledAt: "2026-11-05T20:05:00.000Z", estimateReference: "fixed-second-snapshot" };
  assert.equal(revalidateFeeEligibilityBeforePayment(approved, fresh).eligible, true);
  for (const changed of [{ ...fresh, quoteTermsHash: `0x${"b".repeat(64)}` }, { ...fresh, investmentUsdcBaseUnits: 20_000_000n },
    { ...fresh, maxExpectedFeeBps: 2000n }, { ...fresh, sampledAt: AT },
    { ...fresh, sampledAt: "2026-11-05T20:31:00.000Z", asOf: "2026-11-05T20:31:00.000Z", expiresAt: "2026-11-05T21:00:00.000Z" }]) {
    assert.throws(() => revalidateFeeEligibilityBeforePayment(approved, changed));
  }
});
test("fee increases block unpaid authorization without mutating the immutable approved quote", () => {
  const input = fixture(10n, "live"), approved = createFeeEstimate(input);
  const hashBefore = approved.feeAssessmentHash;
  assert.throws(() => revalidateFeeEligibilityBeforePayment(approved, withExtraDeposit(input, 1_000_000_000_000_000_000_000_000n)), /exceed/);
  assert.equal(approved.feeAssessmentHash, hashBefore); assert.equal(approved.totalExpectedUsdcBaseUnitsCeil, 720_000n);
});
test("payment revalidation cannot extend quote expiration or relax estimate freshness", () => {
  const input = fixture(10n, "live");
  const approved = createFeeEstimate({ ...input, expiresAt: "2026-11-05T20:10:00.000Z" });
  assert.throws(() => revalidateFeeEligibilityBeforePayment(approved, input), /cannot extend/);
  assert.throws(() => revalidateFeeEligibilityBeforePayment(createFeeEstimate(input), { ...input, maxEstimateAgeMs: 3_600_000 }), /cannot extend/);
});
test("payment revalidation rejects a backwards assessment clock with the same sampled data", () => {
  const input = fixture(10n, "live");
  const approved = createFeeEstimate({ ...input, asOf: "2026-11-05T20:00:30.000Z" });
  assert.throws(() => revalidateFeeEligibilityBeforePayment(approved, input), /moved backwards/);
});
test("actual costs use EVM receipts and NEAR tokens burnt, excluding refunded deposits", () => {
  const actual = recordActualExecutionFees(actualFixture());
  assert.equal(actual.totalActualUsdcBaseUnitsCeil, 600_000n);
  assert.equal(actual.realizedFeeBpsCeil, 600n);
  assert.equal(actual.costs.length, 6);
  assert.equal(actual.settlementObligation, "unchanged-by-accounting");
});
test("actual overruns and additional failed attempts are recorded without canceling settlement", () => {
  const input = actualFixture();
  const extra = { ...input.evm[0]!, transactionHash: `0x${"f".repeat(64)}`, executionStatus: "failed" as const, gasUsed: 1_000_000n };
  const result = recordActualExecutionFees({ ...input, evm: [...input.evm, extra] });
  assert.equal(result.totalActualUsdcBaseUnitsCeil, 1_600_000n);
  assert.equal(result.exceedsOriginalFeePolicy, true); assert.equal(result.realizedFeeBpsCeil, 1600n);
  assert.equal(result.settlementObligation, "unchanged-by-accounting");
});
test("actual missing fees, duplicate receipt costs and impossible deposit refunds are rejected", () => {
  const input = actualFixture();
  assert.throws(() => recordActualExecutionFees({ ...input, evm: input.evm.slice(1) }), /all three/);
  assert.throws(() => recordActualExecutionFees({ ...input, evm: [...input.evm, input.evm[0]!] }), /duplicate EVM/);
  assert.throws(() => recordActualExecutionFees({ ...input, near: [...input.near, input.near[0]!] }), /duplicate NEAR transaction/);
  assert.throws(() => recordActualExecutionFees({ ...input, near: input.near.map(value => ({ ...value, receiptOutcomes: [input.near[0]!.receiptOutcomes[0]!] })) }), /Duplicate NEAR receipt/);
  assert.throws(() => recordActualExecutionFees({ ...input, near: input.near.map(value => ({ ...value, receiptOutcomes: [] })) }), /Complete NEAR/);
  assert.throws(() => recordActualExecutionFees({ ...input, near: input.near.map(value => ({ ...value, refundedDepositYoctoNear: 2n })) }), /refund exceeds/);
  assert.throws(() => recordActualExecutionFees({ ...input, evm: input.evm.map(value => ({ ...value, effectiveGasPriceWei: undefined as unknown as bigint })) }), /gas price/);
});
