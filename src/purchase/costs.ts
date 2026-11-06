import { baseDecode } from "near-api-js";
import { VERIFIED_IDENTITIES } from "../near/identities.js";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID } from "../near/config.js";
import { DEFAULT_NATIVE_DELIVERY_POLICY, estimateNativeDeliveryFees, type NativeDeliveryPolicy } from "../evm/sepolia-native.js";
import { SEPOLIA_ASSETS } from "./config.js";
import { requireUint256 } from "./amounts.js";
import { assertPurchaseTerms, type PurchaseTerms } from "./terms.js";
import { createFeeEstimate, PURCHASE_FEE_LEGS, type EvmFeeEstimate, type FeeAssessment, type NearFeeEstimate, type PurchaseFeeLeg } from "./fee-eligibility.js";
import { toFeePriceRates, type PriceSet, type PricingPurpose } from "./prices.js";
import { check, hexHash, label, publicSource, purchaseId, utc } from "./integrity.js";

export interface EvmLegCostObservation {
  readonly leg: PurchaseFeeLeg; readonly payer: "investor" | "treasury";
  readonly senderAddress: string; readonly recipientAddress: string; readonly asset: "USDC" | "LINK" | "ETH";
  readonly tokenAddress: string | null; readonly decimals: number; readonly amountBaseUnits: bigint;
  readonly estimatedGas: bigint; readonly observedBaseFeePerGasWei: bigint; readonly assumedBaseFeePerGasWei: bigint;
  readonly maxFeePerGasWei: bigint; readonly maxPriorityFeePerGasWei: bigint;
}
export interface NearLegCostObservation {
  readonly leg: PurchaseFeeLeg; readonly payer: "investor" | "treasury"; readonly accountId: string;
  readonly contractId: string; readonly domainId: number; readonly derivationPath: string;
  readonly estimatedExecutionGas: bigint; readonly transactionOverheadGas: bigint;
  readonly attachedGas: bigint; readonly attachedDepositYoctoNear: bigint; readonly executionAssumptionReference: string;
}
/** Caller-supplied public observations, not an authenticated RPC result or transaction preparation. */
export interface CompletePurchaseCosts {
  readonly schemaVersion: 1; readonly kind: "six-cost-observations"; readonly purchaseId: string; readonly termsHash: string;
  readonly mode: "offline" | "live"; readonly sampledAt: string; readonly expiresAt: string; readonly reference: string;
  readonly evmObservation: { readonly chainId: bigint; readonly blockNumber: bigint; readonly blockHash: string; readonly sourceUrl: string; readonly reference: string };
  readonly nearObservation: { readonly networkId: "testnet"; readonly blockHeight: bigint; readonly blockHash: string;
    readonly sourceUrl: string; readonly reference: string; readonly gasPriceYoctoNear: bigint };
  readonly evm: readonly EvmLegCostObservation[]; readonly near: readonly NearLegCostObservation[];
}
export interface CostAssessmentOptions {
  readonly asOf: string; readonly purpose: PricingPurpose; readonly maxExpectedFeeBps: bigint;
  readonly maxEstimateAgeMs: number; readonly expiresAt?: string; readonly executionPolicy?: NativeDeliveryPolicy;
}
function keys(value: unknown, names: string[]): void {
  check(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === names.sort().join(), "Missing or unexpected cost-observation fields.");
}
export function costObservationDeadline(costs: CompletePurchaseCosts, maximumAgeMs = 60_000): string {
  check(Number.isSafeInteger(maximumAgeMs) && maximumAgeMs > 0 && maximumAgeMs <= 60_000, "Fee observation maximum age cannot exceed 60 seconds.");
  return new Date(Math.min(utc(costs.expiresAt), utc(costs.sampledAt) + maximumAgeMs)).toISOString();
}
export function createPurchaseFeeEstimate(terms: PurchaseTerms, prices: PriceSet, costs: CompletePurchaseCosts,
  options: CostAssessmentOptions): FeeAssessment {
  assertPurchaseTerms(terms);
  const rates = toFeePriceRates(prices, { purchaseId: prices.purchaseId, asOf: options.asOf, purpose: options.purpose });
  keys(costs, ["schemaVersion", "kind", "purchaseId", "termsHash", "mode", "sampledAt", "expiresAt", "reference", "evmObservation", "nearObservation", "evm", "near"]);
  check(costs.schemaVersion === 1 && costs.kind === "six-cost-observations" && purchaseId(costs.purchaseId) === prices.purchaseId &&
    hexHash(costs.termsHash) === terms.termsHash, "Cost observations belong to another purchase or allocation.");
  check(costs.mode === "offline" || costs.mode === "live", "Explicit cost observation mode is required.");
  if (options.purpose === "prepayment") check(costs.mode === "live", "Offline cost fixtures cannot authorize prepayment eligibility.");
  const asOf = utc(options.asOf), sampled = utc(costs.sampledAt), deadline = utc(costObservationDeadline(costs, options.maxEstimateAgeMs));
  check(sampled <= asOf && asOf < deadline, "Cost observations are missing, stale, expired or from the future.");
  label(costs.reference, "Six-cost observation reference");
  keys(costs.evmObservation, ["chainId", "blockNumber", "blockHash", "sourceUrl", "reference"]);
  check(costs.evmObservation.chainId === 11155111n, "Cost observations require Ethereum Sepolia.");
  requireUint256(costs.evmObservation.blockNumber, "EVM cost observation block", true); hexHash(costs.evmObservation.blockHash);
  publicSource(costs.evmObservation.sourceUrl); label(costs.evmObservation.reference, "EVM observation reference");
  keys(costs.nearObservation, ["networkId", "blockHeight", "blockHash", "sourceUrl", "reference", "gasPriceYoctoNear"]);
  check(costs.nearObservation.networkId === "testnet", "Signing cost observations require NEAR testnet.");
  requireUint256(costs.nearObservation.blockHeight, "NEAR cost observation block", true);
  check(typeof costs.nearObservation.blockHash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(costs.nearObservation.blockHash) &&
    baseDecode(costs.nearObservation.blockHash).length === 32, "A complete public NEAR block hash is required.");
  publicSource(costs.nearObservation.sourceUrl); label(costs.nearObservation.reference, "NEAR gas-price observation reference");
  const nearGasPrice = requireUint256(costs.nearObservation.gasPriceYoctoNear, "Observed NEAR gas price", true);
  check(Array.isArray(costs.evm) && costs.evm.length === 3 && Array.isArray(costs.near) && costs.near.length === 3, "All three EVM and three NEAR costs are mandatory.");
  const limits = options.executionPolicy ?? DEFAULT_NATIVE_DELIVERY_POLICY;
  const evm: EvmFeeEstimate[] = [], near: NearFeeEstimate[] = [];
  for (const leg of PURCHASE_FEE_LEGS) {
    const candidates = costs.evm.filter(item => item.leg === leg), signings = costs.near.filter(item => item.leg === leg);
    check(candidates.length === 1 && signings.length === 1, "Missing or duplicate execution-cost leg.");
    const item = candidates[0]!, signing = signings[0]!, payer = leg === "investor-usdc-payment" ? "investor" : "treasury";
    const other = payer === "investor" ? "treasury" : "investor";
    const asset = leg === "investor-usdc-payment" ? "USDC" : leg === "treasury-link-delivery" ? "LINK" : "ETH";
    const token = asset === "ETH" ? null : SEPOLIA_ASSETS[asset].address;
    const quantity = asset === "USDC" ? terms.investmentUsdcBaseUnits : asset === "LINK" ? terms.quantities.linkBaseUnits : terms.quantities.ethWei;
    keys(item, ["leg", "payer", "senderAddress", "recipientAddress", "asset", "tokenAddress", "decimals", "amountBaseUnits", "estimatedGas", "observedBaseFeePerGasWei", "assumedBaseFeePerGasWei", "maxFeePerGasWei", "maxPriorityFeePerGasWei"]);
    check(item.payer === payer && item.senderAddress === VERIFIED_IDENTITIES[payer].evmAddress && item.recipientAddress === VERIFIED_IDENTITIES[other].evmAddress &&
      item.asset === asset && item.tokenAddress === token && item.decimals === (asset === "USDC" ? 6 : 18) && item.amountBaseUnits === quantity,
      "Cost observation role, asset, recipient, decimals or quantity differs from the approved allocation.");
    requireUint256(item.observedBaseFeePerGasWei, "Observed EVM base fee");
    requireUint256(item.assumedBaseFeePerGasWei, "Assumed EVM base fee");
    check(item.estimatedGas >= 21_000n && item.assumedBaseFeePerGasWei >= item.observedBaseFeePerGasWei, "Gas/base-fee assumption is missing or below observed requirements.");
    const native = estimateNativeDeliveryFees({ estimatedGas: item.estimatedGas, baseFeePerGas: item.observedBaseFeePerGasWei },
      { maxFeePerGas: item.maxFeePerGasWei, maxPriorityFeePerGas: item.maxPriorityFeePerGasWei },
      { assumedBaseFeePerGasWei: item.assumedBaseFeePerGasWei, assumedPriorityFeePerGasWei: item.maxPriorityFeePerGasWei }, limits);
    evm.push({ ...native, leg, payer });
    keys(signing, ["leg", "payer", "accountId", "contractId", "domainId", "derivationPath", "estimatedExecutionGas", "transactionOverheadGas", "attachedGas", "attachedDepositYoctoNear", "executionAssumptionReference"]);
    check(signing.payer === payer && signing.accountId === VERIFIED_IDENTITIES[payer].accountId && signing.contractId === MPC_CONTRACT_ID &&
      signing.domainId === ECDSA_DOMAIN_ID && signing.derivationPath === DERIVATION_PATH && signing.attachedGas === 100_000_000_000_000n &&
      signing.attachedDepositYoctoNear === 1n, "NEAR signing cost authority, domain, path, attachment or deposit differs from reviewed signing configuration.");
    requireUint256(signing.transactionOverheadGas, "Explicit NEAR transaction overhead", true);
    requireUint256(signing.estimatedExecutionGas, "Estimated NEAR signing gas", true);
    check(signing.estimatedExecutionGas <= signing.attachedGas && signing.transactionOverheadGas <= signing.attachedGas,
      "NEAR signing execution/overhead assumptions exceed supported attachment bounds.");
    label(signing.executionAssumptionReference, "NEAR signing execution-cost assumption reference");
    near.push({ leg, payer, estimatedExecutionGas: signing.estimatedExecutionGas, transactionOverheadGas: signing.transactionOverheadGas,
      gasBufferBps: limits.gasBufferBps, assumedGasPriceYoctoNear: nearGasPrice, attachedGas: signing.attachedGas, attachedDepositYoctoNear: signing.attachedDepositYoctoNear });
  }
  const expiresAt = new Date(Math.min(deadline, utc(prices.expiresAt), options.expiresAt === undefined ? deadline : utc(options.expiresAt))).toISOString();
  return createFeeEstimate({ chainId: 11155111n, quoteTermsHash: terms.termsHash, investmentUsdcBaseUnits: terms.investmentUsdcBaseUnits,
    mode: costs.mode, sampledAt: costs.sampledAt, asOf: options.asOf, expiresAt, estimateReference: costs.reference,
    maxExpectedFeeBps: options.maxExpectedFeeBps, maxEstimateAgeMs: options.maxEstimateAgeMs, rates, evm, near });
}
