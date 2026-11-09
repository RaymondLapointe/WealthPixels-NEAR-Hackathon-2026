/** Fixed protocol-88 direct MPC FunctionCall planning; no RPC, signer, or Transfer pricing. */
export interface ExperimentBFeeInputs {
  readonly protocolVersion: number;
  readonly requestBytes: number;
  readonly receiptSendGas: string; readonly receiptExecutionGas: string;
  readonly functionCallSendGas: string; readonly functionCallExecutionGas: string;
  readonly functionCallByteSendGas: string; readonly functionCallByteExecutionGas: string;
  readonly blockGasPriceYocto: string; readonly receiptPurchaseFloorYocto: string;
  readonly gasRefundPenalty: { readonly numerator: string; readonly denominator: string };
  readonly minimumGasRefundPenalty: string;
}
export interface ExperimentBFeeModel extends ExperimentBFeeInputs {
  readonly pricingPolicy: "near-protocol-88-mpc-function-call-v1";
  readonly attachedGas: "100000000000000"; readonly depositYocto: "1";
  readonly priceGrowthNumerator: "2"; readonly priceGrowthDenominator: "1";
  readonly sendGas: string; readonly receiptGas: string;
  readonly assumedBlockGasPriceYocto: string; readonly receiptPurchasePriceYocto: string;
  readonly receiptBurnPriceYocto: string; readonly estimatedFullAttachmentBurnYocto: string;
  readonly upfrontGasYocto: string; readonly requiredSpendableYocto: string;
  readonly estimatedRefundFeeYocto: "0";
  readonly refundScheduleSource: "nearcore-2.14.0-parameters-and-protocol-85-88-zero-penalty";
  readonly refundPolicy: "near-protocol-88-explicit-zero-refund-penalty";
}
function quantity(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || (positive && BigInt(value) === 0n)) {
    throw new Error("Missing or unsupported exact FunctionCall pricing input.");
  }
  return BigInt(value);
}
export function calculateExperimentBFeeModel(input: ExperimentBFeeInputs): ExperimentBFeeModel {
  if (!input || input.protocolVersion !== 88 || !Number.isSafeInteger(input.requestBytes) || input.requestBytes < 1 || input.requestBytes > 4096) {
    throw new Error("Only the documented protocol-88 diagnostic FunctionCall pricing schedule is supported.");
  }
  const receiptSend = quantity(input.receiptSendGas, true), receiptExecution = quantity(input.receiptExecutionGas, true);
  const callSend = quantity(input.functionCallSendGas, true), callExecution = quantity(input.functionCallExecutionGas, true);
  const byteSend = quantity(input.functionCallByteSendGas, true), byteExecution = quantity(input.functionCallByteExecutionGas, true);
  const price = quantity(input.blockGasPriceYocto, true), floor = quantity(input.receiptPurchaseFloorYocto, true);
  if (!input.gasRefundPenalty || quantity(input.gasRefundPenalty.numerator) !== 0n ||
      quantity(input.gasRefundPenalty.denominator, true) <= 0n || quantity(input.minimumGasRefundPenalty) !== 0n) {
    throw new Error("Require the explicit protocol-88 zero refund penalty schedule.");
  }
  const bytes = BigInt(input.requestBytes), attachedGas = 100_000_000_000_000n;
  const sendGas = receiptSend + callSend + bytes * byteSend;
  const receiptGas = receiptExecution + callExecution + bytes * byteExecution + attachedGas;
  const assumedPrice = price * 2n, purchasePrice = assumedPrice > floor ? assumedPrice : floor;
  const burnPrice = purchasePrice < assumedPrice ? purchasePrice : assumedPrice;
  const sendBurn = sendGas * assumedPrice, estimate = sendBurn + receiptGas * burnPrice;
  const upfront = sendBurn + receiptGas * purchasePrice;
  return Object.freeze({ ...input, gasRefundPenalty: Object.freeze({ ...input.gasRefundPenalty }),
    pricingPolicy: "near-protocol-88-mpc-function-call-v1", attachedGas: "100000000000000", depositYocto: "1",
    priceGrowthNumerator: "2", priceGrowthDenominator: "1", sendGas: sendGas.toString(), receiptGas: receiptGas.toString(),
    assumedBlockGasPriceYocto: assumedPrice.toString(), receiptPurchasePriceYocto: purchasePrice.toString(), receiptBurnPriceYocto: burnPrice.toString(),
    estimatedFullAttachmentBurnYocto: estimate.toString(), upfrontGasYocto: upfront.toString(), requiredSpendableYocto: (upfront + 1n).toString(),
    estimatedRefundFeeYocto: "0", refundScheduleSource: "nearcore-2.14.0-parameters-and-protocol-85-88-zero-penalty",
    refundPolicy: "near-protocol-88-explicit-zero-refund-penalty" });
}
