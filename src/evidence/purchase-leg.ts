import { Interface, Signature, Transaction, getAddress, keccak256 } from "ethers";
import { DERIVATION_PATH } from "../near/config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { deriveEvmPublicKey } from "../near/mpc.js";
import { normalizeMpcOutcome } from "../near/signing.js";
import { assembleSignedErc20Transfer, buildUnsignedErc20Transfer, type PreparedErc20Transfer } from "../evm/erc20-transfer.js";
import { assembleTreasuryNativeTransfer, assertTreasuryNativeSignedTransfer, buildUnsignedNativeTransfer,
  type PreparedNativeTransfer } from "../evm/native-transfer.js";
import { verifyNativeTransferReceipt } from "../evm/sepolia-native.js";
import type { SepoliaReadMethod, SepoliaReadRpc } from "../evm/sepolia-link.js";
import { createErc20AssetIntent } from "../evm/asset-intent.js";
import { assertErc20SignedBytes, verifyErc20TransferReceipt, type PublicLegObservation, type PurchaseLeg,
  type PurchaseLegSigned, type VerifiedPurchaseLeg } from "../purchase/legs.js";
import type { ActualNearCost, PurchaseFeeLeg } from "../purchase/fee-eligibility.js";
import { assertPurchaseQuote, type PurchaseQuote } from "../purchase/quote.js";
import { observeNearExecutionCost } from "../purchase/services.js";
import { frozen, hexHash } from "../purchase/integrity.js";
import { requireUint256 } from "../purchase/amounts.js";
import { purchaseExecutionPolicyForLeg } from "../purchase/config.js";
import { normalizeEvmSignatureScalar } from "./verify.js";

export interface PublicPurchaseTransaction {
  readonly prepared: PreparedErc20Transfer | PreparedNativeTransfer;
  readonly signed: PurchaseLegSigned;
}
export interface PublicPurchaseLegInput {
  readonly quote: PurchaseQuote; readonly leg: PurchaseLeg;
  readonly nearTransactionHash: string; readonly evmTransactionHash: string; readonly unsignedHash: string;
  readonly referenceBlockNumber: bigint;
}
export interface PublicPurchaseLegVerification {
  readonly transaction: PublicPurchaseTransaction; readonly proof: VerifiedPurchaseLeg; readonly nearCost: ActualNearCost;
}
export class PurchaseEvidenceLegError extends Error {
  constructor(readonly code: "INVALID_EVIDENCE" | "PENDING" | "ONCHAIN_FAILED" | "RPC_FAILED", message: string) {
    super(message); this.name = "PurchaseEvidenceLegError";
  }
}
const feeLegs: Record<PurchaseLeg, PurchaseFeeLeg> = { "usdc-payment": "investor-usdc-payment", "link-delivery": "treasury-link-delivery", "eth-delivery": "treasury-eth-delivery" };
const erc20 = new Interface(["function transfer(address,uint256) returns (bool)"]);
function check(value: unknown, message: string): asserts value {
  if (!value) throw new PurchaseEvidenceLegError("INVALID_EVIDENCE", message);
}
function object(value: unknown): Record<string, any> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Missing public Ethereum transaction.");
  return value as Record<string, any>;
}
function quantity(value: unknown): bigint {
  check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid public Ethereum quantity.");
  return requireUint256(BigInt(value), "Public Ethereum quantity");
}
function address(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), "Invalid public Ethereum address.");
  try { return getAddress(value); } catch { throw new PurchaseEvidenceLegError("INVALID_EVIDENCE", "Invalid public Ethereum address checksum."); }
}
function hash(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "Invalid public Ethereum hash."); return value.toLowerCase();
}
function checkedLeg(leg: PurchaseLeg): void {
  check(leg === "usdc-payment" || leg === "link-delivery" || leg === "eth-delivery", "Unsupported public purchase leg.");
}
async function read(rpc: SepoliaReadRpc, method: SepoliaReadMethod, params: readonly unknown[]): Promise<unknown> {
  try { return await rpc.request(method, params); }
  catch { throw new PurchaseEvidenceLegError("RPC_FAILED", `Public purchase verification read failed (${method}); provider details suppressed. No retry was attempted.`); }
}

/** Reconstruct exact public bytes from a quote and the mined RPC transaction.
 * No execution preflight is fabricated: historical estimates and human approvals
 * remain separate provenance records, not facts proved by transaction signatures.
 */
export function reconstructPublicPurchaseTransaction(quote: PurchaseQuote, leg: PurchaseLeg, expectedEvmHash: string,
  expectedUnsignedHash: string, rawRpcTx: unknown): PublicPurchaseTransaction {
  assertPurchaseQuote(quote, quote.quoteHash, quote.policy); checkedLeg(leg);
  const expectedHash = hexHash(expectedEvmHash), unsignedHash = hexHash(expectedUnsignedHash), raw = object(rawRpcTx);
  const role = leg === "usdc-payment" ? "investor" : "treasury", identity = VERIFIED_IDENTITIES[role];
  const fee = quote.costs.evm.find(item => item.leg === feeLegs[leg]); check(fee, "Missing approved fee selection for this purchase leg.");
  check(quantity(raw.type) === 2n && quantity(raw.chainId) === 11155111n && hash(raw.hash) === expectedHash &&
    address(raw.from) === identity.evmAddress && Array.isArray(raw.accessList) && raw.accessList.length === 0,
  "Public transaction type, network, hash, sender or access list differs from the purchase.");
  const nonceValue = quantity(raw.nonce); check(nonceValue <= BigInt(Number.MAX_SAFE_INTEGER), "Public transaction nonce exceeds the supported range.");
  const gasLimit = quantity(raw.gas), maxFeePerGas = quantity(raw.maxFeePerGas), maxPriorityFeePerGas = quantity(raw.maxPriorityFeePerGas);
  check(gasLimit >= 21_000n && gasLimit <= purchaseExecutionPolicyForLeg(quote.policy.execution, leg).gasLimitCap && maxFeePerGas === fee.maxFeePerGasWei &&
    maxPriorityFeePerGas === fee.maxPriorityFeePerGasWei && maxFeePerGas <= quote.policy.execution.maxFeePerGasCap &&
    gasLimit * maxFeePerGas <= quote.policy.execution.maxTotalFeeWei,
  "Public transaction fees differ from the approved selection or exceed protective limits.");
  let prepared: PreparedErc20Transfer | PreparedNativeTransfer;
  if (leg === "eth-delivery") {
    prepared = buildUnsignedNativeTransfer({ chainId: 11155111n, senderAddress: identity.evmAddress,
      recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress, amountWei: quote.terms.quantities.ethWei,
      nonce: Number(nonceValue), gasLimit, maxFeePerGas, maxPriorityFeePerGas });
    check(address(raw.to) === prepared.recipientAddress && quantity(raw.value) === prepared.value && raw.input === "0x",
      "Public native delivery recipient, exact wei value or calldata differs from the quote.");
  } else {
    const intent = createErc20AssetIntent(quote.terms, leg, quote.terms.termsHash);
    prepared = buildUnsignedErc20Transfer({ chainId: 11155111n, senderAddress: identity.evmAddress,
      tokenAddress: intent.tokenAddress, recipientAddress: intent.recipientAddress, amount: intent.amountBaseUnits,
      nonce: Number(nonceValue), gasLimit, maxFeePerGas, maxPriorityFeePerGas });
    check(address(raw.to) === intent.tokenAddress && quantity(raw.value) === 0n && raw.input === prepared.data &&
      raw.input === erc20.encodeFunctionData("transfer", [intent.recipientAddress, intent.amountBaseUnits]),
    "Public ERC-20 token, recipient, exact amount or ETH value differs from the quote.");
  }
  check(prepared.unsignedHash === unsignedHash, "Reconstructed unsigned digest differs from the declared approved digest.");
  const parity = quantity(raw.v); check([0n, 1n, 27n, 28n].includes(parity), "Unsupported public EIP-1559 signature recovery ID.");
  const signature = Signature.from({ r: normalizeEvmSignatureScalar(raw.r), s: normalizeEvmSignatureScalar(raw.s), v: Number(parity) });
  if (raw.yParity !== undefined) check(quantity(raw.yParity) === BigInt(signature.yParity), "Public signature parity fields disagree.");
  const tx = Transaction.from(prepared.unsignedSerialized); tx.signature = signature;
  check(tx.hash === expectedHash && keccak256(tx.serialized) === expectedHash && tx.from === identity.evmAddress,
    "Public signature does not reconstruct the exact expected Ethereum hash and role.");
  const signed: PurchaseLegSigned = { serialized: tx.serialized, hash: expectedHash, senderAddress: identity.evmAddress };
  if (leg === "eth-delivery") assertTreasuryNativeSignedTransfer(prepared as PreparedNativeTransfer, signed);
  else assertErc20SignedBytes(prepared as PreparedErc20Transfer, signed,
    deriveEvmPublicKey(VERIFIED_MPC_ROOT, identity.accountId, DERIVATION_PATH));
  return frozen({ prepared, signed });
}

/** Availability classification only, never an authorization or canonical receipt
 * proof. The caller must verify the MPC/signed transaction first and still run
 * the complete canonical native receipt verifier after this check succeeds.
 */
export function assertPublicNativeReceiptAvailability(receiptValue: unknown, headValue: unknown,
  rawRpcTx: unknown, expectedEvmHash: string): void {
  if (receiptValue === null) throw new PurchaseEvidenceLegError("PENDING", "Public native receipt is unavailable; no transaction was submitted.");
  const receipt = object(receiptValue), raw = object(rawRpcTx), expectedHash = hexHash(expectedEvmHash);
  const blockNumber = quantity(receipt.blockNumber), receiptStatus = quantity(receipt.status), head = quantity(headValue);
  check(blockNumber > 0n && hash(receipt.transactionHash) === expectedHash && hash(raw.hash) === expectedHash &&
    quantity(raw.blockNumber) === blockNumber && hash(raw.blockHash) === hash(receipt.blockHash) &&
    address(receipt.from) === address(raw.from) && address(receipt.to) === address(raw.to) && head >= blockNumber,
  "Public native receipt identity or mined block contradicts its signed transaction and current head.");
  check(receiptStatus === 0n || receiptStatus === 1n, "Unsupported public native receipt execution status.");
  if (receiptStatus === 0n) throw new PurchaseEvidenceLegError("ONCHAIN_FAILED", "The public native purchase transaction failed onchain; it does not prove delivery.");
  if (head === blockNumber) throw new PurchaseEvidenceLegError("PENDING", "Public native receipt awaits its required second confirmation.");
}

/** Credential-free public verification only. The ports expose no signing,
 * broadcasting, state journal or credential capability and are never retried.
 */
export async function verifyPublicPurchaseLeg(input: PublicPurchaseLegInput, nearOutcome: unknown,
  rpc: SepoliaReadRpc): Promise<PublicPurchaseLegVerification> {
  const { quote, leg } = input; checkedLeg(leg);
  assertPurchaseQuote(quote, quote.quoteHash, quote.policy);
  requireUint256(input.referenceBlockNumber, "Public purchase reference block", true);
  check(input.referenceBlockNumber >= quote.costs.evmObservation.blockNumber, "Public leg reference predates its quote observations.");
  const observations: PublicLegObservation[] = [];
  const reader: SepoliaReadRpc = { async request(method, params) {
    const result = await read(rpc, method, params); observations.push(frozen({ method, params, result })); return result;
  } };
  const raw = await read(reader, "eth_getTransactionByHash", [hexHash(input.evmTransactionHash)]);
  if (raw === null) throw new PurchaseEvidenceLegError("PENDING", "Public Ethereum transaction is unavailable; no transaction was submitted.");
  const transaction = reconstructPublicPurchaseTransaction(quote, leg, input.evmTransactionHash, input.unsignedHash, raw);
  const role = leg === "usdc-payment" ? "investor" : "treasury";
  const signature = normalizeMpcOutcome(nearOutcome, role, input.nearTransactionHash, input.unsignedHash);
  const fromMpc = leg === "eth-delivery" ? assembleTreasuryNativeTransfer(transaction.prepared as PreparedNativeTransfer, signature) :
    assembleSignedErc20Transfer(transaction.prepared as PreparedErc20Transfer, signature, VERIFIED_IDENTITIES[role].evmAddress);
  check(fromMpc.serialized === transaction.signed.serialized && fromMpc.hash === transaction.signed.hash,
    "Finalized MPC signature differs from the executed Ethereum signature and exact bytes.");
  const nearCost = observeNearExecutionCost(role, input.nearTransactionHash, nearOutcome, leg);
  if (leg !== "eth-delivery") {
    const pin = quote.costs.assetIdentity?.usdcImplementation;
    if (leg === "usdc-payment") check(pin, "Public USDC payment verification requires the approved implementation identity.");
    const receipt = await verifyErc20TransferReceipt(transaction.prepared as PreparedErc20Transfer, transaction.signed, reader,
      { purchaseId: quote.purchaseId, quoteHash: quote.quoteHash, leg, role,
        expectedFullPublicKey: deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES[role].accountId, DERIVATION_PATH),
        referenceBlockNumber: input.referenceBlockNumber, ...(pin && leg === "usdc-payment" ? { usdcImplementationPin: pin } : {}) });
    if (receipt.status === "failed") throw new PurchaseEvidenceLegError("ONCHAIN_FAILED", "The public purchase transaction failed onchain; it does not prove delivery.");
    if (receipt.status !== "confirmed") throw new PurchaseEvidenceLegError("PENDING", "Public purchase receipt is missing or awaits required canonical finality.");
    return frozen({ transaction, proof: receipt.proof, nearCost });
  }
  const nativeReceipt = await read(reader, "eth_getTransactionReceipt", [input.evmTransactionHash]);
  if (nativeReceipt === null) assertPublicNativeReceiptAvailability(nativeReceipt, undefined, raw, input.evmTransactionHash);
  const nativeHead = await read(reader, "eth_blockNumber", []);
  assertPublicNativeReceiptAvailability(nativeReceipt, nativeHead, raw, input.evmTransactionHash);
  const receipt = await verifyNativeTransferReceipt(transaction.prepared as PreparedNativeTransfer, transaction.signed, reader, input.referenceBlockNumber);
  const proof: VerifiedPurchaseLeg = { kind: "verified-purchase-leg", purchaseId: quote.purchaseId, quoteHash: quote.quoteHash, leg, role,
    unsignedHash: transaction.prepared.unsignedHash, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash, confirmations: receipt.confirmations, finality: "two-confirmations", gasUsed: receipt.gasUsed,
    effectiveGasPriceWei: receipt.effectiveGasPriceWei, actualFeeWei: receipt.actualFeeWei,
    before: { senderEth: receipt.before.treasuryEth, recipientEth: receipt.before.investorEth },
    after: { senderEth: receipt.after.treasuryEth, recipientEth: receipt.after.investorEth },
    nativeDeltas: { sender: receipt.nativeDeltas.treasury, recipient: receipt.nativeDeltas.investor },
    feeObservation: receipt.feeObservation, publicObservations: observations };
  return frozen({ transaction, proof, nearCost });
}
