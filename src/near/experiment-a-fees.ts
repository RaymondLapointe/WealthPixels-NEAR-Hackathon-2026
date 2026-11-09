/** Fixed named-account Transfer pricing only. No RPC, transaction construction or signer. */
export interface ExperimentAFeeInputs {
  readonly protocolVersion: number;
  readonly sendGas: string;
  readonly executionGas: string;
  readonly blockGasPriceYocto: string;
  readonly receiptPurchaseFloorYocto: string;
}
export interface ExperimentAFeeModel extends ExperimentAFeeInputs {
  readonly pricingPolicy: "near-protocol-88-self-transfer-v1";
  readonly priceGrowthNumerator: "2"; readonly priceGrowthDenominator: "1";
  readonly assumedBlockGasPriceYocto: string;
  readonly receiptPurchasePriceYocto: string; readonly receiptBurnPriceYocto: string;
  readonly estimatedSendBurnYocto: string; readonly estimatedReceiptBurnYocto: string;
  readonly estimatedRefundFeeYocto: "0"; readonly estimatedExecutionFeeYocto: string;
  readonly upfrontGasYocto: string; readonly requiredSpendableYocto: string; readonly estimatedRefundYocto: string;
  readonly refundPolicy: "near-protocol-88-zero-refund-penalty";
}
function positive(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/.test(value)) throw new Error("Missing or unsupported exact pricing input.");
  return BigInt(value);
}
export function calculateExperimentAFeeModel(input: ExperimentAFeeInputs): ExperimentAFeeModel {
  if (!input || input.protocolVersion !== 88) throw new Error("Only the documented protocol-88 Transfer pricing schedule is supported.");
  const send = positive(input.sendGas), execution = positive(input.executionGas);
  const blockPrice = positive(input.blockGasPriceYocto), floor = positive(input.receiptPurchaseFloorYocto);
  // Application estimate allowance, not the deprecated protocol pessimistic-price mechanism or a fee cap.
  const assumedPrice = blockPrice * 2n;
  const purchasePrice = assumedPrice > floor ? assumedPrice : floor;
  const burnPrice = purchasePrice < assumedPrice ? purchasePrice : assumedPrice;
  const sendBurn = send * assumedPrice, receiptBurn = execution * burnPrice;
  // nearcore 2.14.0 parameters + protocol 85/88 deltas: penalty 0/100, minimum penalty 0 Gas.
  // This is an explicit versioned schedule, not a default inferred from an absent RPC field.
  const estimatedFee = sendBurn + receiptBurn;
  const upfront = sendBurn + execution * purchasePrice;
  return Object.freeze({ protocolVersion: input.protocolVersion, sendGas: input.sendGas, executionGas: input.executionGas,
    blockGasPriceYocto: input.blockGasPriceYocto, receiptPurchaseFloorYocto: input.receiptPurchaseFloorYocto,
    pricingPolicy: "near-protocol-88-self-transfer-v1", priceGrowthNumerator: "2", priceGrowthDenominator: "1",
    assumedBlockGasPriceYocto: assumedPrice.toString(), receiptPurchasePriceYocto: purchasePrice.toString(), receiptBurnPriceYocto: burnPrice.toString(),
    estimatedSendBurnYocto: sendBurn.toString(), estimatedReceiptBurnYocto: receiptBurn.toString(), estimatedRefundFeeYocto: "0",
    estimatedExecutionFeeYocto: estimatedFee.toString(), upfrontGasYocto: upfront.toString(), requiredSpendableYocto: (upfront + 1n).toString(),
    estimatedRefundYocto: (upfront - estimatedFee).toString(), refundPolicy: "near-protocol-88-zero-refund-penalty" });
}
