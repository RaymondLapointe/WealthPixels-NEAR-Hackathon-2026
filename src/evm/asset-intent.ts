import { isDeepStrictEqual } from "node:util";
import { keccak256 } from "ethers";
import { VERIFIED_IDENTITIES, type requireRole } from "../near/identities.js";
import { DEFAULT_EXECUTION_LIMITS, DEFAULT_GAS_BUFFER_BPS, SEPOLIA_ASSETS, BPS_DENOMINATOR } from "../purchase/config.js";
import { requireUint256 } from "../purchase/amounts.js";
import { assertPurchaseTerms, type PurchaseTerms } from "../purchase/terms.js";
import { buildUnsignedErc20Transfer, validateTransferPreflight, type PreparedErc20Transfer, type TransferPreflightSnapshot } from "./erc20-transfer.js";

export type Erc20PurchaseLeg = "usdc-payment" | "link-delivery";
export interface Erc20AssetIntent {
  readonly schemaVersion: 1; readonly kind: "erc20-asset-intent"; readonly leg: Erc20PurchaseLeg;
  readonly termsHash: string; readonly chainId: 11155111n; readonly role: ReturnType<typeof requireRole>;
  readonly senderAddress: string; readonly recipientAddress: string; readonly tokenAddress: string;
  readonly tokenDecimals: number; readonly amountBaseUnits: bigint;
}
export interface AssetExecutionPolicy {
  readonly gasLimitCap: bigint; readonly maxFeePerGasCap: bigint; readonly maxTotalFeeWei: bigint; readonly gasBufferBps: bigint;
}
export interface AssetTransferParameters {
  readonly nonce: number; readonly estimatedGas: bigint; readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint;
}
export interface PreparedAssetTransfer {
  readonly kind: "prepared-erc20-asset-intent"; readonly intent: Erc20AssetIntent;
  readonly prepared: PreparedErc20Transfer; readonly estimatedGas: bigint; readonly policy: AssetExecutionPolicy;
}
export interface AssetPreflightSnapshot extends TransferPreflightSnapshot {
  readonly tokenDecimals: number; readonly senderCode: string; readonly recipientCode: string;
  readonly usdcPaused?: boolean; readonly senderBlacklisted?: boolean; readonly recipientBlacklisted?: boolean;
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function policy(value: AssetExecutionPolicy): AssetExecutionPolicy {
  check(value && typeof value === "object", "Execution policy is required.");
  const result = { gasLimitCap: requireUint256(value.gasLimitCap, "Gas limit cap", true),
    maxFeePerGasCap: requireUint256(value.maxFeePerGasCap, "Maximum fee per gas cap", true),
    maxTotalFeeWei: requireUint256(value.maxTotalFeeWei, "Total fee cap", true), gasBufferBps: requireUint256(value.gasBufferBps, "Gas buffer") };
  check(result.gasBufferBps >= DEFAULT_GAS_BUFFER_BPS && result.gasBufferBps <= BPS_DENOMINATOR,
    "Gas buffer must preserve at least 20% and cannot exceed 10000 basis points.");
  return Object.freeze(result);
}
function assertCaps(prepared: PreparedErc20Transfer, caps: AssetExecutionPolicy): void {
  check(prepared.gasLimit <= caps.gasLimitCap, "Buffered gas exceeds the approved gas limit cap.");
  check(prepared.maxFeePerGas <= caps.maxFeePerGasCap, "Selected fee exceeds the approved fee per gas cap.");
  check(prepared.maximumFeeWei <= caps.maxTotalFeeWei, "Maximum transaction fee exceeds the approved total fee cap.");
}

/** Pure intent construction only. Hash consistency is not a substitute for human quote approval. */
export function createErc20AssetIntent(terms: PurchaseTerms, leg: Erc20PurchaseLeg, approvedTermsHash: string): Erc20AssetIntent {
  check(typeof approvedTermsHash === "string" && /^0x[0-9a-f]{64}$/.test(approvedTermsHash), "An exact approved terms hash is required.");
  assertPurchaseTerms(terms, approvedTermsHash);
  check(leg === "usdc-payment" || leg === "link-delivery", "Unsupported purchase ERC-20 leg.");
  const role = leg === "usdc-payment" ? "investor" : "treasury";
  const recipient = role === "investor" ? "treasury" : "investor";
  const asset = leg === "usdc-payment" ? SEPOLIA_ASSETS.USDC : SEPOLIA_ASSETS.LINK;
  return Object.freeze({ schemaVersion: 1, kind: "erc20-asset-intent", leg, termsHash: terms.termsHash,
    chainId: 11155111n, role, senderAddress: VERIFIED_IDENTITIES[role].evmAddress,
    recipientAddress: VERIFIED_IDENTITIES[recipient].evmAddress, tokenAddress: asset.address, tokenDecimals: asset.decimals,
    amountBaseUnits: leg === "usdc-payment" ? terms.investmentUsdcBaseUnits : terms.quantities.linkBaseUnits });
}
export function assertErc20AssetIntent(value: Erc20AssetIntent, terms: PurchaseTerms, approvedTermsHash: string): void {
  check(value && typeof value === "object", "ERC-20 asset intent is required.");
  const expected = createErc20AssetIntent(terms, value.leg, approvedTermsHash);
  check(isDeepStrictEqual(value, expected), "ERC-20 intent token, role, recipient, amount or terms hash mismatch.");
}

/** Pure builder for fixtures/future approved preflight. It never fetches, persists, signs or broadcasts. */
export function buildErc20AssetTransfer(intent: Erc20AssetIntent, terms: PurchaseTerms,
  input: AssetTransferParameters, limits: AssetExecutionPolicy = DEFAULT_EXECUTION_LIMITS): PreparedAssetTransfer {
  assertErc20AssetIntent(intent, terms, intent.termsHash);
  const caps = policy(limits), estimate = requireUint256(input.estimatedGas, "Gas estimate", true);
  const gasLimit = (estimate * (BPS_DENOMINATOR + caps.gasBufferBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
  const prepared = buildUnsignedErc20Transfer({ chainId: intent.chainId, senderAddress: intent.senderAddress,
    tokenAddress: intent.tokenAddress, recipientAddress: intent.recipientAddress, amount: intent.amountBaseUnits,
    nonce: input.nonce, gasLimit, maxFeePerGas: input.maxFeePerGas, maxPriorityFeePerGas: input.maxPriorityFeePerGas });
  assertCaps(prepared, caps);
  const result: PreparedAssetTransfer = Object.freeze({ kind: "prepared-erc20-asset-intent", intent: Object.freeze({ ...intent }),
    prepared, estimatedGas: estimate, policy: caps });
  return result;
}

export function assertPreparedAssetTransfer(value: PreparedAssetTransfer, terms: PurchaseTerms, approvedTermsHash: string,
  expectedPolicy: AssetExecutionPolicy = DEFAULT_EXECUTION_LIMITS): void {
  check(value && value.kind === "prepared-erc20-asset-intent", "Unsupported prepared asset intent.");
  assertErc20AssetIntent(value.intent, terms, approvedTermsHash);
  const expected = buildErc20AssetTransfer(value.intent, terms, { nonce: value.prepared.nonce, estimatedGas: value.estimatedGas,
    maxFeePerGas: value.prepared.maxFeePerGas, maxPriorityFeePerGas: value.prepared.maxPriorityFeePerGas }, expectedPolicy);
  check(isDeepStrictEqual(value, expected), "Prepared transaction, gas buffer, fee policy or intent mismatch.");
}

/** Snapshot validation only. Live retrieval, receipt verification and payment acceptance remain Task 03D work. */
export function validateAssetTransferPreflight(value: PreparedAssetTransfer, terms: PurchaseTerms,
  snapshot: AssetPreflightSnapshot, expectedPolicy: AssetExecutionPolicy = DEFAULT_EXECUTION_LIMITS) {
  assertPreparedAssetTransfer(value, terms, value.intent.termsHash, expectedPolicy);
  const freshEstimate = requireUint256(snapshot.estimatedGas, "Fresh gas estimate", true);
  const freshBufferedGas = (freshEstimate * (BPS_DENOMINATOR + expectedPolicy.gasBufferBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
  check(freshBufferedGas <= value.prepared.gasLimit, "Fresh gas estimate no longer preserves the approved gas buffer.");
  const asset = value.intent.leg === "usdc-payment" ? SEPOLIA_ASSETS.USDC : SEPOLIA_ASSETS.LINK;
  check(snapshot.tokenDecimals === asset.decimals, "Token decimals differ from the approved asset configuration.");
  check(snapshot.senderCode === "0x" && snapshot.recipientCode === "0x", "Both derived role addresses must remain EOAs.");
  check(typeof snapshot.tokenCode === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(snapshot.tokenCode) &&
    keccak256(snapshot.tokenCode) === asset.codeHash, "Token code differs from the reviewed asset configuration.");
  if (value.intent.leg === "usdc-payment") {
    check(snapshot.usdcPaused === false && snapshot.senderBlacklisted === false && snapshot.recipientBlacklisted === false,
      "USDC pause and blacklist checks must be present and false.");
  }
  return validateTransferPreflight(value.prepared, snapshot);
}
