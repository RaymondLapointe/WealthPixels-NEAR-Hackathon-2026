import { isDeepStrictEqual } from "node:util";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID } from "./config.js";

/** Method bytes plus exact direct-sign arguments; every EVM digest has 64 hex characters. */
export const MPC_SIGN_REQUEST_BYTES = Buffer.byteLength("sign", "utf8") + Buffer.byteLength(JSON.stringify({
  request: { payload_v2: { Ecdsa: "0".repeat(64) }, path: DERIVATION_PATH, domain_id: ECDSA_DOMAIN_ID },
}), "utf8");
/** Fixed protocol-88 direct MPC FunctionCall prefunding; no RPC, signer, or refund credit. */
export interface MpcFundingInputs {
  readonly protocolVersion: number;
  readonly requestBytes: number;
  readonly receiptSendGas: string; readonly receiptExecutionGas: string;
  readonly functionCallSendGas: string; readonly functionCallExecutionGas: string;
  readonly functionCallByteSendGas: string; readonly functionCallByteExecutionGas: string;
  readonly blockGasPriceYocto: string; readonly receiptPurchaseFloorYocto: string;
  readonly gasRefundPenalty: { readonly numerator: string; readonly denominator: string };
  readonly minimumGasRefundPenalty: string;
}
export interface MpcFundingModel extends MpcFundingInputs {
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
export function calculateMpcFundingModel(input: MpcFundingInputs): MpcFundingModel {
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

/** Purchase requests use the reviewed attachment, path, domain and digest encoding. */
export function purchaseMpcFundingModel(input: MpcFundingInputs | undefined, observedGasPriceYocto?: bigint): MpcFundingModel {
  if (!input || input.requestBytes !== MPC_SIGN_REQUEST_BYTES ||
      (observedGasPriceYocto !== undefined && (typeof observedGasPriceYocto !== "bigint" || observedGasPriceYocto <= 0n || input.blockGasPriceYocto !== observedGasPriceYocto.toString()))) {
    throw new Error("Complete public MPC prefunding inputs must match the direct signing request and observed NEAR gas price.");
  }
  return calculateMpcFundingModel(input);
}

/** Recalculate rather than trusting caller supplied derived funding totals. */
export function assertMpcFundingModel(model: MpcFundingModel | undefined, observedGasPriceYocto?: bigint): MpcFundingModel {
  if (!model) throw new Error("A complete public MPC prefunding model is required.");
  const inputs: MpcFundingInputs = {
    protocolVersion: model.protocolVersion, requestBytes: model.requestBytes,
    receiptSendGas: model.receiptSendGas, receiptExecutionGas: model.receiptExecutionGas,
    functionCallSendGas: model.functionCallSendGas, functionCallExecutionGas: model.functionCallExecutionGas,
    functionCallByteSendGas: model.functionCallByteSendGas, functionCallByteExecutionGas: model.functionCallByteExecutionGas,
    blockGasPriceYocto: model.blockGasPriceYocto, receiptPurchaseFloorYocto: model.receiptPurchaseFloorYocto,
    gasRefundPenalty: model.gasRefundPenalty, minimumGasRefundPenalty: model.minimumGasRefundPenalty,
  };
  const calculated = purchaseMpcFundingModel(inputs, observedGasPriceYocto);
  if (!isDeepStrictEqual(model, calculated)) throw new Error("MPC prefunding model integrity verification failed.");
  return calculated;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing public protocol-88 FunctionCall pricing configuration.");
  return value as Record<string, unknown>;
}
function configQuantity(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value.toString();
  quantity(value); return value as string;
}
/** Parse a pinned public protocol configuration; omitted refund fields use the documented v88 schedule. */
export function mpcFundingInputsFromProtocolConfig(config: unknown, gasPriceYocto: bigint): MpcFundingInputs {
  const p = record(config);
  if (p.chain_id !== "testnet" || p.protocol_version !== 88) throw new Error("Only public NEAR testnet protocol-88 MPC prefunding is supported.");
  const runtime = record(p.runtime_config), costs = record(runtime.transaction_costs);
  const receipt = record(costs.action_receipt_creation_config), creation = record(costs.action_creation_config);
  const call = record(creation.function_call_cost), byte = record(creation.function_call_cost_per_byte);
  for (const source of [runtime, costs]) {
    if (Object.hasOwn(source, "gas_refund_penalty")) {
      const penalty = record(source.gas_refund_penalty);
      if (quantity(configQuantity(penalty.numerator)) !== 0n || quantity(configQuantity(penalty.denominator), true) <= 0n) throw new Error("Observed gas refund penalty contradicts the documented protocol-88 schedule.");
    }
    if (Object.hasOwn(source, "min_gas_refund_penalty") && quantity(configQuantity(source.min_gas_refund_penalty)) !== 0n) throw new Error("Observed minimum gas refund penalty contradicts the documented protocol-88 schedule.");
  }
  const input: MpcFundingInputs = {
    protocolVersion: 88, requestBytes: MPC_SIGN_REQUEST_BYTES,
    receiptSendGas: configQuantity(receipt.send_not_sir), receiptExecutionGas: configQuantity(receipt.execution),
    functionCallSendGas: configQuantity(call.send_not_sir), functionCallExecutionGas: configQuantity(call.execution),
    functionCallByteSendGas: configQuantity(byte.send_not_sir), functionCallByteExecutionGas: configQuantity(byte.execution),
    blockGasPriceYocto: gasPriceYocto.toString(), receiptPurchaseFloorYocto: configQuantity(runtime.min_gas_purchase_price),
    gasRefundPenalty: { numerator: "0", denominator: "100" }, minimumGasRefundPenalty: "0",
  };
  purchaseMpcFundingModel(input, gasPriceYocto);
  return Object.freeze({ ...input, gasRefundPenalty: Object.freeze({ ...input.gasRefundPenalty }) });
}
