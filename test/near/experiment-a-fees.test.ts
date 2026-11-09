import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateExperimentAFeeModel, type ExperimentAFeeInputs,
} from "../../src/near/experiment-a-fees.js";

// Recorded public inputs at FINAL block 276963528, replayed offline. These tests
// neither query a network nor demonstrate a submitted or executed transaction.
const captured: ExperimentAFeeInputs = {
  protocolVersion: 88,
  sendGas: "223182562500",
  executionGas: "223182562500",
  blockGasPriceYocto: "100000000",
  receiptPurchaseFloorYocto: "1000000000",
};
const feeBudgetYocto = 100000000000000000000n;

test("recorded offline fee inputs separate expected burn from receipt purchase funding", () => {
  const fee = calculateExperimentAFeeModel(captured);
  assert.equal(fee.assumedBlockGasPriceYocto, "200000000");
  assert.equal(fee.receiptPurchasePriceYocto, "1000000000");
  assert.equal(fee.receiptBurnPriceYocto, "200000000");
  assert.equal(fee.estimatedSendBurnYocto, "44636512500000000000");
  assert.equal(fee.estimatedReceiptBurnYocto, "44636512500000000000");
  assert.equal(fee.estimatedExecutionFeeYocto, "89273025000000000000");
  assert.equal(fee.upfrontGasYocto, "267819075000000000000");
  assert.equal(fee.requiredSpendableYocto, "267819075000000000001");
  assert.equal(fee.estimatedRefundYocto, "178546050000000000000");
  assert.equal(fee.estimatedRefundFeeYocto, "0");
});

test("expected fee budget eligibility does not remove the larger upfront funding requirement", () => {
  const fee = calculateExperimentAFeeModel(captured);
  assert.ok(BigInt(fee.estimatedExecutionFeeYocto) <= feeBudgetYocto);
  assert.ok(BigInt(fee.requiredSpendableYocto) > feeBudgetYocto);
  const balanceThatCoversBurnOnly = BigInt(fee.estimatedExecutionFeeYocto) + 1n;
  assert.ok(balanceThatCoversBurnOnly < BigInt(fee.requiredSpendableYocto));
  assert.equal(BigInt(fee.upfrontGasYocto) - BigInt(fee.estimatedRefundYocto), BigInt(fee.estimatedExecutionFeeYocto));
});

test("a purchase floor below the buffered block price creates no assumed refund", () => {
  const fee = calculateExperimentAFeeModel({ ...captured, sendGas: "10", executionGas: "20",
    blockGasPriceYocto: "101", receiptPurchaseFloorYocto: "150" });
  assert.equal(fee.assumedBlockGasPriceYocto, "202");
  assert.equal(fee.receiptPurchasePriceYocto, "202");
  assert.equal(fee.receiptBurnPriceYocto, "202");
  assert.equal(fee.estimatedSendBurnYocto, "2020");
  assert.equal(fee.estimatedReceiptBurnYocto, "4040");
  assert.equal(fee.estimatedExecutionFeeYocto, "6060");
  assert.equal(fee.upfrontGasYocto, "6060");
  assert.equal(fee.requiredSpendableYocto, "6061");
  assert.equal(fee.estimatedRefundYocto, "0");
});

test("unequal send and receipt gas use their distinct prices without dividing a combined fee by ten", () => {
  const fee = calculateExperimentAFeeModel({ ...captured, sendGas: "3", executionGas: "7",
    blockGasPriceYocto: "11", receiptPurchaseFloorYocto: "99" });
  assert.equal(fee.estimatedSendBurnYocto, "66");
  assert.equal(fee.estimatedReceiptBurnYocto, "154");
  assert.equal(fee.estimatedExecutionFeeYocto, "220");
  assert.equal(fee.upfrontGasYocto, "759");
  assert.equal(fee.requiredSpendableYocto, "760");
  assert.equal(fee.estimatedRefundYocto, "539");
  assert.notEqual(BigInt(fee.estimatedExecutionFeeYocto), ((3n + 7n) * 99n) / 10n);
});

test("a changed block gas price changes expected burn and upfront funding before and above the floor", () => {
  const common = { ...captured, sendGas: "3", executionGas: "7", receiptPurchaseFloorYocto: "1000" };
  const lower = calculateExperimentAFeeModel({ ...common, blockGasPriceYocto: "100" });
  const higher = calculateExperimentAFeeModel({ ...common, blockGasPriceYocto: "600" });
  assert.equal(lower.estimatedExecutionFeeYocto, "2000");
  assert.equal(lower.upfrontGasYocto, "7600");
  assert.equal(lower.estimatedRefundYocto, "5600");
  assert.equal(higher.estimatedExecutionFeeYocto, "12000");
  assert.equal(higher.upfrontGasYocto, "12000");
  assert.equal(higher.estimatedRefundYocto, "0");
});

test("gas quantities beyond Number precision retain exact integer fee and one-yocto affordability values", () => {
  const fee = calculateExperimentAFeeModel({ ...captured, sendGas: "9007199254740993", executionGas: "1",
    blockGasPriceYocto: "3", receiptPurchaseFloorYocto: "10" });
  assert.equal(fee.estimatedSendBurnYocto, "54043195528445958");
  assert.equal(fee.estimatedExecutionFeeYocto, "54043195528445964");
  assert.equal(fee.upfrontGasYocto, "54043195528445968");
  assert.equal(fee.requiredSpendableYocto, "54043195528445969");
  assert.equal(fee.estimatedRefundYocto, "4");
});

test("odd gas prices beyond Number precision apply the disclosed growth assumption exactly", () => {
  const fee = calculateExperimentAFeeModel({ ...captured, sendGas: "1", executionGas: "1",
    blockGasPriceYocto: "9007199254740993", receiptPurchaseFloorYocto: "1" });
  assert.equal(fee.assumedBlockGasPriceYocto, "18014398509481986");
  assert.equal(fee.estimatedExecutionFeeYocto, "36028797018963972");
  assert.equal(fee.requiredSpendableYocto, "36028797018963973");
});

test("public diagnostics preserve exact source values and explicit versioned pricing/refund assumptions", () => {
  const fee = calculateExperimentAFeeModel(captured);
  for (const [name, value] of Object.entries(captured)) assert.equal(fee[name as keyof typeof fee], value);
  assert.equal(fee.pricingPolicy, "near-protocol-88-self-transfer-v1");
  assert.equal(fee.priceGrowthNumerator, "2");
  assert.equal(fee.priceGrowthDenominator, "1");
  assert.equal(fee.refundPolicy, "near-protocol-88-zero-refund-penalty");
  const serializable = JSON.parse(JSON.stringify(fee));
  assert.equal(serializable.estimatedExecutionFeeYocto, "89273025000000000000");
  assert.equal(serializable.requiredSpendableYocto, "267819075000000000001");
});

test("fee calculation leaves its immutable recorded inputs unchanged", () => {
  const input = Object.freeze({ ...captured });
  const before = JSON.stringify(input);
  const fee = calculateExperimentAFeeModel(input);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(fee, input);
  assert.equal(Object.isFrozen(fee), true);
});

test("unsupported protocol schedules fail closed instead of assuming refund or pricing rules", () => {
  for (const protocolVersion of [0, 87, 89, 88.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calculateExperimentAFeeModel({ ...captured, protocolVersion }));
  }
});

test("missing, nonpositive and malformed mandatory gas or price inputs fail closed", () => {
  const fields = ["sendGas", "executionGas", "blockGasPriceYocto", "receiptPurchaseFloorYocto"] as const;
  for (const field of fields) {
    for (const invalid of [undefined, null, 0, 1, "", " ", "0", "-1", "1.5", "1e3", "0x10", "01", "1".repeat(79)]) {
      assert.throws(() => calculateExperimentAFeeModel({ ...captured, [field]: invalid } as unknown as ExperimentAFeeInputs),
        `${field} must reject ${String(invalid)}`);
    }
  }
  assert.throws(() => calculateExperimentAFeeModel(undefined as unknown as ExperimentAFeeInputs));
  assert.throws(() => calculateExperimentAFeeModel({ ...captured, protocolVersion: undefined } as unknown as ExperimentAFeeInputs));
});

test("an expensive observation is reported exactly for the caller's unchanged budget guard", () => {
  const fee = calculateExperimentAFeeModel({ ...captured, blockGasPriceYocto: "1000000000" });
  assert.equal(fee.estimatedExecutionFeeYocto, "892730250000000000000");
  assert.ok(BigInt(fee.estimatedExecutionFeeYocto) > feeBudgetYocto);
  assert.equal(fee.estimatedRefundYocto, "0");
});
