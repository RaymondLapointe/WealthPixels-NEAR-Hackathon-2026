import { isDeepStrictEqual } from "node:util";
import { Interface, Signature, SigningKey, Transaction, computeAddress, getAddress, keccak256, toBeHex } from "ethers";
import { DERIVATION_PATH, type AuthorityRole } from "../near/config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { deriveEvmPublicKey } from "../near/mpc.js";
import { normalizeEvmSignatureScalar } from "../evidence/verify.js";
import { assertPreparedAssetTransfer, buildErc20AssetTransfer, createErc20AssetIntent, validateAssetTransferPreflight,
  type AssetPreflightSnapshot, type Erc20PurchaseLeg, type PreparedAssetTransfer } from "../evm/asset-intent.js";
import { buildUnsignedErc20Transfer, type PreparedErc20Transfer } from "../evm/erc20-transfer.js";
import { assertTreasuryNativeSignedTransfer, type PreparedNativeTransfer } from "../evm/native-transfer.js";
import { assertNativeDelivery, observeNativeDelivery, prepareNativeDelivery, recheckNativeDelivery, verifyNativeDeliveryReceipt,
  type NativeDeliveryPreflight, type NativeDeliverySnapshot } from "../evm/sepolia-native.js";
import type { SepoliaReadMethod, SepoliaReadRpc } from "../evm/sepolia-link.js";
import { SEPOLIA_ASSETS, purchaseExecutionPolicyForLeg } from "./config.js";
import type { PaymentClaim } from "./claims.js";
import type { ActualEvmCost, PurchaseFeeLeg } from "./fee-eligibility.js";
import { check, frozen, hexHash } from "./integrity.js";
import { requireUint256 } from "./amounts.js";
import { assertPurchaseQuote, type PurchaseQuote } from "./quote.js";

export type PurchaseLeg = Erc20PurchaseLeg | "eth-delivery";
export interface UsdcImplementationPin { readonly address: string; readonly codeHash: string }
export interface PurchaseLegFees {
  readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint;
  /** Reviewed proxy implementation, bound to the approved quote by the coordinator. No automatic discovery approval. */
  readonly usdcImplementationPin?: UsdcImplementationPin;
}
export interface PurchaseAssetSnapshot extends AssetPreflightSnapshot {
  readonly confirmedNonce: number; readonly recipientTokenBalance: bigint; readonly recipientNativeBalance: bigint;
  readonly simulationResult: string; readonly blockNumber: bigint; readonly blockHash: string;
  readonly usdcImplementation?: UsdcImplementationPin;
}
interface LegBinding {
  readonly kind: "prepared-purchase-leg"; readonly purchaseId: string; readonly quoteHash: string;
  readonly referenceBlockNumber: bigint; readonly referenceBlockHash: string;
}
export interface PreparedPurchaseErc20Leg extends LegBinding {
  readonly leg: Erc20PurchaseLeg; readonly role: AuthorityRole; readonly prepared: PreparedErc20Transfer;
  readonly preflight: PreparedAssetTransfer; readonly snapshot: PurchaseAssetSnapshot;
}
export interface PreparedPurchaseNativeLeg extends LegBinding {
  readonly leg: "eth-delivery"; readonly role: "treasury"; readonly prepared: PreparedNativeTransfer;
  readonly preflight: NativeDeliveryPreflight;
}
export type PreparedPurchaseLeg = PreparedPurchaseErc20Leg | PreparedPurchaseNativeLeg;
export interface PurchaseLegSigned { readonly serialized: string; readonly hash: string; readonly senderAddress: string }
export interface PublicLegObservation { readonly method: SepoliaReadMethod; readonly params: readonly unknown[]; readonly result: unknown }
export interface LegBalances {
  readonly senderEth: bigint; readonly recipientEth: bigint;
  readonly senderToken?: bigint; readonly recipientToken?: bigint;
}
export interface VerifiedPurchaseLeg {
  readonly kind: "verified-purchase-leg"; readonly purchaseId: string; readonly quoteHash: string;
  readonly leg: PurchaseLeg; readonly role: AuthorityRole; readonly unsignedHash: string; readonly transactionHash: string;
  readonly blockNumber: bigint; readonly blockHash: string; readonly confirmations: bigint;
  readonly finality: "awaiting-finality" | "finalized" | "two-confirmations";
  readonly gasUsed: bigint; readonly effectiveGasPriceWei: bigint; readonly actualFeeWei: bigint;
  readonly before: LegBalances; readonly after: LegBalances;
  readonly tokenDeltas?: Readonly<{ sender: bigint; recipient: bigint }>;
  readonly nativeDeltas?: Readonly<{ sender: bigint; recipient: bigint }>;
  readonly paymentClaim?: PaymentClaim; readonly feeObservation: ActualEvmCost;
  readonly publicObservations: readonly PublicLegObservation[];
}
export interface FailedPurchaseLegProof extends Omit<VerifiedPurchaseLeg, "kind" | "before" | "after" | "paymentClaim" | "tokenDeltas" | "nativeDeltas"> {
  readonly kind: "failed-purchase-leg";
}
export type PurchaseLegReceiptResult =
  | Readonly<{ status: "not-mined"; publicObservations: readonly PublicLegObservation[] }>
  | Readonly<{ status: "failed"; proof: FailedPurchaseLegProof }>
  | Readonly<{ status: "awaiting-finality" | "confirmed"; proof: VerifiedPurchaseLeg }>;
export class PurchaseLegError extends Error {
  constructor(readonly code: "RPC_FAILED" | "INVALID_STATE" | "RECEIPT_FAILED", message: string) {
    super(message); this.name = "PurchaseLegError";
  }
}
const abi = new Interface([
  "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)", "function paused() view returns (bool)",
  "function isBlacklisted(address) view returns (bool)", "function implementation() view returns (address)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const transferTopic = abi.getEvent("Transfer")!.topicHash;
const feeLegs: Record<PurchaseLeg, PurchaseFeeLeg> = { "usdc-payment": "investor-usdc-payment", "link-delivery": "treasury-link-delivery", "eth-delivery": "treasury-eth-delivery" };
function record(value: unknown): Record<string, any> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Invalid purchase public RPC object.");
  return value as Record<string, any>;
}
function quantity(value: unknown): bigint {
  check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid purchase RPC quantity.");
  return requireUint256(BigInt(value), "RPC quantity");
}
function tag(value: bigint): string { return `0x${requireUint256(value, "Block number").toString(16)}`; }
function hash(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "Invalid public transaction or block hash.");
  return value.toLowerCase();
}
function address(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), "Invalid public EVM address.");
  return getAddress(value);
}
function pin(value: UsdcImplementationPin | undefined): UsdcImplementationPin {
  check(value !== undefined, "USDC requires an explicitly reviewed implementation pin.");
  return { address: address(value.address), codeHash: hexHash(value.codeHash) };
}
function uintNonce(value: unknown): number {
  const n = quantity(value); check(n <= BigInt(Number.MAX_SAFE_INTEGER), "Unsupported purchase account nonce."); return Number(n);
}
async function read(rpc: SepoliaReadRpc, method: SepoliaReadMethod, params: readonly unknown[]): Promise<unknown> {
  try { return await rpc.request(method, params); }
  catch { throw new PurchaseLegError("RPC_FAILED", `Purchase public RPC read failed (${method}); details suppressed. No retry was attempted.`); }
}
function decode(method: string, value: unknown): unknown {
  check(typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value), `Invalid ${method} response.`);
  try { return abi.decodeFunctionResult(method, value)[0]; }
  catch { throw new PurchaseLegError("RPC_FAILED", `Malformed ${method} public response.`); }
}
async function call(rpc: SepoliaReadRpc, token: string, method: string, args: readonly unknown[], blockTag: string): Promise<unknown> {
  return decode(method, await read(rpc, "eth_call", [{ to: token, data: abi.encodeFunctionData(method, args) }, blockTag]));
}
async function balance(rpc: SepoliaReadRpc, token: string, owner: string, blockTag: string): Promise<bigint> {
  return requireUint256(await call(rpc, token, "balanceOf", [owner], blockTag) as bigint, "Token balance");
}
function assertQuote(quote: PurchaseQuote, approvedQuoteHash: string): void {
  assertPurchaseQuote(quote, approvedQuoteHash, quote.policy);
}
function snapshotIntegrity(value: PurchaseAssetSnapshot): void {
  check(Number.isSafeInteger(value.confirmedNonce) && value.confirmedNonce >= 0 && value.confirmedNonce === value.pendingNonce,
    "Confirmed and pending purchase nonces must match; reconcile existing activity first.");
  requireUint256(value.recipientTokenBalance, "Recipient token balance"); requireUint256(value.recipientNativeBalance, "Recipient ETH balance");
  requireUint256(value.blockNumber, "Purchase observation block", true); hash(value.blockHash);
  check(decode("transfer", value.simulationResult) === true, "ERC-20 transfer simulation must return true.");
  if (value.tokenAddress === SEPOLIA_ASSETS.USDC.address) pin(value.usdcImplementation);
  else check(value.usdcImplementation === undefined, "LINK observations cannot contain USDC implementation metadata.");
}
function checkTreasuryReserve(value: PreparedPurchaseErc20Leg, quote: PurchaseQuote): void {
  if (value.leg !== "link-delivery") return;
  const nativeReserve = quote.feeAssessment.expectedCosts.find(cost => cost.leg === "treasury-eth-delivery" && cost.asset === "ETH");
  check(nativeReserve, "Missing native delivery fee reserve.");
  check(value.snapshot.nativeBalance >= value.prepared.maximumFeeWei + quote.terms.quantities.ethWei +
    nativeReserve.maximumNativeReserveBaseUnits + quote.policy.execution.operatingReserveWei,
  "Treasury ETH must preserve native delivery value, its fee reserve and the operating reserve after LINK delivery.");
}

/** Read-only exact-intent observation. This grants no payment, signing or broadcast authorization. */
export async function observePurchaseErc20Leg(quote: PurchaseQuote, approvedQuoteHash: string, leg: Erc20PurchaseLeg,
  rpc: SepoliaReadRpc, expectedUsdcImplementation?: UsdcImplementationPin): Promise<PurchaseAssetSnapshot> {
  assertQuote(quote, approvedQuoteHash);
  const intent = createErc20AssetIntent(quote.terms, leg, quote.terms.termsHash);
  const approvedImplementation = leg === "usdc-payment" ? pin(expectedUsdcImplementation) : undefined;
  check(quantity(await read(rpc, "eth_chainId", [])) === 11155111n, "Purchase requires Ethereum Sepolia.");
  const block = record(await read(rpc, "eth_getBlockByNumber", ["latest", false]));
  const blockNumber = quantity(block.number), blockHash = hash(block.hash), blockTag = tag(blockNumber);
  const transfer = { from: intent.senderAddress, to: intent.tokenAddress, value: "0x0", data: abi.encodeFunctionData("transfer", [intent.recipientAddress, intent.amountBaseUnits]) };
  const [tokenCode, senderCode, recipientCode, decimals, senderToken, recipientToken, senderEth, recipientEth, confirmed, pending, simulation, estimate] = await Promise.all([
    read(rpc, "eth_getCode", [intent.tokenAddress, blockTag]), read(rpc, "eth_getCode", [intent.senderAddress, blockTag]),
    read(rpc, "eth_getCode", [intent.recipientAddress, blockTag]), call(rpc, intent.tokenAddress, "decimals", [], blockTag),
    balance(rpc, intent.tokenAddress, intent.senderAddress, blockTag), balance(rpc, intent.tokenAddress, intent.recipientAddress, blockTag),
    read(rpc, "eth_getBalance", [intent.senderAddress, blockTag]), read(rpc, "eth_getBalance", [intent.recipientAddress, blockTag]),
    read(rpc, "eth_getTransactionCount", [intent.senderAddress, blockTag]), read(rpc, "eth_getTransactionCount", [intent.senderAddress, "pending"]),
    read(rpc, "eth_call", [transfer, blockTag]), read(rpc, "eth_estimateGas", [transfer, blockTag]),
  ]);
  let usdc: Pick<PurchaseAssetSnapshot, "usdcPaused" | "senderBlacklisted" | "recipientBlacklisted" | "usdcImplementation"> = {};
  if (approvedImplementation) {
    const [paused, senderBlacklisted, recipientBlacklisted, implementation] = await Promise.all([
      call(rpc, intent.tokenAddress, "paused", [], blockTag), call(rpc, intent.tokenAddress, "isBlacklisted", [intent.senderAddress], blockTag),
      call(rpc, intent.tokenAddress, "isBlacklisted", [intent.recipientAddress], blockTag), call(rpc, intent.tokenAddress, "implementation", [], blockTag),
    ]);
    const implementationAddress = address(implementation);
    const implementationCode = await read(rpc, "eth_getCode", [implementationAddress, blockTag]);
    check(typeof implementationCode === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(implementationCode), "USDC implementation must have deployed code.");
    const observed = { address: implementationAddress, codeHash: keccak256(implementationCode) };
    check(isDeepStrictEqual(observed, approvedImplementation), "USDC implementation differs from the explicitly reviewed pin.");
    usdc = { usdcPaused: paused as boolean, senderBlacklisted: senderBlacklisted as boolean,
      recipientBlacklisted: recipientBlacklisted as boolean, usdcImplementation: observed };
  }
  const observed: PurchaseAssetSnapshot = { chainId: 11155111n, senderAddress: intent.senderAddress, tokenAddress: intent.tokenAddress,
    tokenCode: tokenCode as string, tokenDecimals: Number(decimals), senderCode: senderCode as string, recipientCode: recipientCode as string,
    confirmedNonce: uintNonce(confirmed), pendingNonce: uintNonce(pending), estimatedGas: quantity(estimate), tokenBalance: senderToken,
    recipientTokenBalance: recipientToken, nativeBalance: quantity(senderEth), recipientNativeBalance: quantity(recipientEth),
    baseFeePerGas: quantity(block.baseFeePerGas), simulationResult: simulation as string, blockNumber, blockHash, ...usdc };
  snapshotIntegrity(observed);
  const canonical = record(await read(rpc, "eth_getBlockByNumber", [blockTag, false]));
  check(quantity(canonical.number) === blockNumber && hash(canonical.hash) === blockHash, "Purchase observation block changed during public reads.");
  return frozen(observed);
}
function wrapErc20(quote: PurchaseQuote, leg: Erc20PurchaseLeg, fees: PurchaseLegFees, observed: PurchaseAssetSnapshot): PreparedPurchaseErc20Leg {
  snapshotIntegrity(observed);
  const intent = createErc20AssetIntent(quote.terms, leg, quote.terms.termsHash);
  const preflight = buildErc20AssetTransfer(intent, quote.terms, { nonce: observed.confirmedNonce, estimatedGas: observed.estimatedGas,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }, purchaseExecutionPolicyForLeg(quote.policy.execution, leg));
  validateAssetTransferPreflight(preflight, quote.terms, observed, purchaseExecutionPolicyForLeg(quote.policy.execution, leg));
  const value: PreparedPurchaseErc20Leg = { kind: "prepared-purchase-leg", purchaseId: quote.purchaseId, quoteHash: quote.quoteHash,
    leg, role: intent.role, prepared: preflight.prepared, preflight, snapshot: observed,
    referenceBlockNumber: observed.blockNumber, referenceBlockHash: observed.blockHash };
  checkTreasuryReserve(value, quote); return frozen(value);
}
/** Explicit library operation only; the coordinator enforces payment timing, settlement order and approvals. */
export async function preparePurchaseLeg(quote: PurchaseQuote, approvedQuoteHash: string, leg: PurchaseLeg,
  fees: PurchaseLegFees, rpc: SepoliaReadRpc): Promise<PreparedPurchaseLeg> {
  assertQuote(quote, approvedQuoteHash);
  if (leg === "eth-delivery") {
    const observed = await observeNativeDelivery(quote.terms, quote.terms.termsHash, rpc);
    const preflight = prepareNativeDelivery(quote.terms, quote.terms.termsHash, fees, observed, quote.policy.execution);
    return frozen({ kind: "prepared-purchase-leg", purchaseId: quote.purchaseId, quoteHash: quote.quoteHash, leg, role: "treasury",
      preflight, prepared: preflight.prepared, referenceBlockNumber: observed.blockNumber, referenceBlockHash: observed.blockHash });
  }
  return wrapErc20(quote, leg, fees, await observePurchaseErc20Leg(quote, approvedQuoteHash, leg, rpc, fees.usdcImplementationPin));
}
export function assertPreparedPurchaseLeg(value: PreparedPurchaseLeg, quote: PurchaseQuote, approvedQuoteHash: string): void {
  assertQuote(quote, approvedQuoteHash);
  check(value.kind === "prepared-purchase-leg" && value.purchaseId === quote.purchaseId && value.quoteHash === quote.quoteHash,
    "Prepared leg does not belong to the approved immutable purchase.");
  if (value.leg === "eth-delivery") {
    assertNativeDelivery(value.preflight, quote.terms.termsHash, quote.policy.execution);
    check(isDeepStrictEqual(value.preflight.terms, quote.terms), "Native delivery terms differ from the quote.");
    const expected = { kind: "prepared-purchase-leg", purchaseId: quote.purchaseId, quoteHash: quote.quoteHash, leg: value.leg,
      role: "treasury", preflight: value.preflight, prepared: value.preflight.prepared,
      referenceBlockNumber: value.preflight.snapshot.blockNumber, referenceBlockHash: value.preflight.snapshot.blockHash };
    check(isDeepStrictEqual(value, expected), "Native purchase leg binding changed."); return;
  }
  assertPreparedAssetTransfer(value.preflight, quote.terms, quote.terms.termsHash, purchaseExecutionPolicyForLeg(quote.policy.execution, value.leg));
  const expected = wrapErc20(quote, value.leg, value.prepared, value.snapshot);
  check(isDeepStrictEqual(value, expected), "ERC-20 purchase leg transaction, policy or observation changed.");
}
/** Recheck exact existing bytes against fresh nonce, inventory, gas, network and implementation state. */
export async function recheckPurchaseLeg(value: PreparedPurchaseLeg, quote: PurchaseQuote, approvedQuoteHash: string,
  rpc: SepoliaReadRpc): Promise<PurchaseAssetSnapshot | NativeDeliverySnapshot> {
  assertPreparedPurchaseLeg(value, quote, approvedQuoteHash);
  if (value.leg === "eth-delivery") return recheckNativeDelivery(value.preflight, rpc, quote.terms.termsHash, quote.policy.execution);
  const fresh = await observePurchaseErc20Leg(quote, approvedQuoteHash, value.leg, rpc, value.snapshot.usdcImplementation);
  check(fresh.blockNumber >= value.referenceBlockNumber && (fresh.blockNumber !== value.referenceBlockNumber || fresh.blockHash === value.referenceBlockHash),
    "Purchase recheck returned an older or conflicting block.");
  validateAssetTransferPreflight(value.preflight, quote.terms, fresh, purchaseExecutionPolicyForLeg(quote.policy.execution, value.leg));
  checkTreasuryReserve({ ...value, snapshot: fresh }, quote); return fresh;
}

/** Public cryptographic verification only. It has no signing or submission capability. */
export function assertErc20SignedBytes(prepared: PreparedErc20Transfer, signed: PurchaseLegSigned, expectedFullPublicKey: string): void {
  check(isDeepStrictEqual(prepared, buildUnsignedErc20Transfer(prepared)), "Prepared ERC-20 fields or unsigned digest changed.");
  check(typeof expectedFullPublicKey === "string" && /^0x(?:04[0-9a-fA-F]{128}|0[23][0-9a-fA-F]{64})$/.test(expectedFullPublicKey),
    "Expected a complete public SEC1 key, never private material.");
  const trusted = SigningKey.computePublicKey(expectedFullPublicKey, false), tx = Transaction.from(signed.serialized);
  check(tx.signature !== null && computeAddress(trusted) === prepared.senderAddress && signed.senderAddress === prepared.senderAddress &&
    tx.from === prepared.senderAddress && tx.hash === signed.hash && keccak256(signed.serialized) === signed.hash &&
    tx.unsignedHash === prepared.unsignedHash && tx.unsignedSerialized === prepared.unsignedSerialized,
  "Existing signed ERC-20 bytes, sender, full public key, hash or digest mismatch.");
  check(SigningKey.recoverPublicKey(prepared.unsignedHash, tx.signature!).toLowerCase() === trusted.toLowerCase(),
    "ERC-20 signature does not recover the complete trusted public key.");
}
export function assertPurchaseLegSigned(value: PreparedPurchaseLeg, quote: PurchaseQuote, approvedQuoteHash: string, signed: PurchaseLegSigned): void {
  assertPreparedPurchaseLeg(value, quote, approvedQuoteHash);
  if (value.leg === "eth-delivery") { assertTreasuryNativeSignedTransfer(value.prepared, signed); return; }
  const identity = VERIFIED_IDENTITIES[value.role];
  assertErc20SignedBytes(value.prepared, signed, deriveEvmPublicKey(VERIFIED_MPC_ROOT, identity.accountId, DERIVATION_PATH));
}
function recordingRpc(rpc: SepoliaReadRpc, observations: PublicLegObservation[]): SepoliaReadRpc {
  return { async request(method, params) { const result = await read(rpc, method, params);
    observations.push(frozen({ method, params, result })); return result; } };
}
function isolatedTransfer(logs: readonly unknown[], prepared: PreparedErc20Transfer, txHash: string, blockHash: string, blockNumber: bigint): bigint {
  check(Array.isArray(logs), "Canonical Transfer logs are unavailable.");
  const unique = new Map<string, { index: bigint; log: unknown }>();
  for (const item of logs) {
    const log = record(item);
    check(address(log.address) === prepared.tokenAddress && log.removed === false && hash(log.blockHash) === blockHash &&
      quantity(log.blockNumber) === blockNumber && Array.isArray(log.topics) && log.topics[0] === transferTopic,
    "Invalid, removed or reorged canonical Transfer log.");
    const parsed = abi.parseLog({ topics: log.topics, data: log.data }); check(parsed, "Malformed Transfer log.");
    const from = address(parsed.args.from), to = address(parsed.args.to);
    check([from, to].some(who => who === prepared.senderAddress || who === prepared.recipientAddress), "Log does not touch a requested purchase party.");
    check(hash(log.transactionHash) === txHash && from === prepared.senderAddress && to === prepared.recipientAddress && parsed.args.value === prepared.amount,
      "Unexpected or concurrent token movement touches a purchase party.");
    const index = quantity(log.logIndex), key = `${hash(log.transactionHash)}:${index}`;
    const previous = unique.get(key);
    check(!previous || isDeepStrictEqual(previous.log, item), "Canonical role log queries disagree about one event.");
    unique.set(key, { index, log: item });
  }
  check(unique.size === 1, "Exactly one isolated approved Transfer event is required."); return [...unique.values()][0]!.index;
}
export interface Erc20ReceiptContext {
  readonly purchaseId: string; readonly quoteHash: string; readonly leg: Erc20PurchaseLeg; readonly role: AuthorityRole;
  readonly expectedFullPublicKey: string; readonly referenceBlockNumber: bigint;
  readonly usdcImplementationPin?: UsdcImplementationPin;
}
async function failedReceipt(prepared: PreparedErc20Transfer | PreparedNativeTransfer, signed: PurchaseLegSigned,
  context: Pick<VerifiedPurchaseLeg, "purchaseId" | "quoteHash" | "leg" | "role"> & { readonly referenceBlockNumber: bigint },
  raw: Record<string, any>, receipt: Record<string, any>, head: bigint, rpc: SepoliaReadRpc,
  observations: PublicLegObservation[]): Promise<PurchaseLegReceiptResult> {
  const expectedHash = hash(signed.hash), to = "tokenAddress" in prepared ? prepared.tokenAddress : prepared.recipientAddress;
  check(quantity(raw.type) === 2n && quantity(raw.chainId) === 11155111n && hash(raw.hash) === expectedHash &&
    address(raw.from) === prepared.senderAddress && address(raw.to) === to && quantity(raw.value) === prepared.value &&
    raw.input === prepared.data && quantity(raw.nonce) === BigInt(prepared.nonce) && quantity(raw.gas) === prepared.gasLimit &&
    quantity(raw.maxFeePerGas) === prepared.maxFeePerGas && quantity(raw.maxPriorityFeePerGas) === prepared.maxPriorityFeePerGas &&
    Array.isArray(raw.accessList) && raw.accessList.length === 0, "Failed mined transaction differs from the approved signed intent.");
  const parity = quantity(raw.v); check([0n, 1n, 27n, 28n].includes(parity), "Invalid failed transaction signature.");
  const reconstructed = Transaction.from(prepared.unsignedSerialized);
  reconstructed.signature = Signature.from({ r: normalizeEvmSignatureScalar(raw.r), s: normalizeEvmSignatureScalar(raw.s), v: Number(parity) });
  check(reconstructed.serialized === signed.serialized && reconstructed.hash === expectedHash && reconstructed.from === prepared.senderAddress,
    "Failed receipt does not correspond to the exact existing signed bytes.");
  const blockNumber = quantity(receipt.blockNumber), blockHash = hash(receipt.blockHash);
  check(quantity(receipt.status) === 0n && hash(receipt.transactionHash) === expectedHash && address(receipt.from) === prepared.senderAddress &&
    address(receipt.to) === to && quantity(raw.blockNumber) === blockNumber && hash(raw.blockHash) === blockHash &&
    blockNumber > context.referenceBlockNumber && head >= blockNumber + 1n, "Failed receipt needs canonical identity and two confirmations.");
  const gasUsed = quantity(receipt.gasUsed), effectiveGasPriceWei = quantity(receipt.effectiveGasPrice), actualFeeWei = gasUsed * effectiveGasPriceWei;
  check(gasUsed >= 21_000n && gasUsed <= prepared.gasLimit && effectiveGasPriceWei <= prepared.maxFeePerGas && actualFeeWei <= prepared.maximumFeeWei,
    "Failed transaction gas costs exceed original bounds.");
  const [blockValue, parentValue] = await Promise.all([read(rpc, "eth_getBlockByNumber", [tag(blockNumber), false]),
    read(rpc, "eth_getBlockByNumber", [tag(blockNumber - 1n), false])]);
  const block = record(blockValue), parent = record(parentValue), base = quantity(block.baseFeePerGas), uncapped = base + prepared.maxPriorityFeePerGas;
  check(quantity(block.number) === blockNumber && hash(block.hash) === blockHash && quantity(parent.number) === blockNumber - 1n &&
    hash(block.parentHash) === hash(parent.hash) && base <= prepared.maxFeePerGas &&
    effectiveGasPriceWei === (uncapped < prepared.maxFeePerGas ? uncapped : prepared.maxFeePerGas),
  "Failed receipt canonical block or EIP-1559 accounting is inconsistent.");
  const canonical = record(await read(rpc, "eth_getBlockByNumber", [tag(blockNumber), false]));
  check(hash(canonical.hash) === blockHash && quantity(canonical.number) === blockNumber, "Failed receipt block changed during verification.");
  const proof: FailedPurchaseLegProof = { kind: "failed-purchase-leg", purchaseId: context.purchaseId, quoteHash: context.quoteHash,
    leg: context.leg, role: context.role, unsignedHash: prepared.unsignedHash, transactionHash: expectedHash,
    blockNumber, blockHash, confirmations: head - blockNumber + 1n, finality: "two-confirmations", gasUsed, effectiveGasPriceWei, actualFeeWei,
    feeObservation: { leg: feeLegs[context.leg], payer: context.role, transactionHash: expectedHash, executionStatus: "failed", gasUsed, effectiveGasPriceWei },
    publicObservations: observations };
  return frozen({ status: "failed", proof });
}
/** Generic public-signature fixture seam; the purchase wrapper below always pins the real NEAR-derived role key. */
export async function verifyErc20TransferReceipt(prepared: PreparedErc20Transfer, signed: PurchaseLegSigned,
  rpc: SepoliaReadRpc, context: Erc20ReceiptContext): Promise<PurchaseLegReceiptResult> {
  assertErc20SignedBytes(prepared, signed, context.expectedFullPublicKey);
  const asset = context.leg === "usdc-payment" ? SEPOLIA_ASSETS.USDC : SEPOLIA_ASSETS.LINK;
  check(prepared.tokenAddress === asset.address && context.role === (context.leg === "usdc-payment" ? "investor" : "treasury"), "Receipt asset or role mismatch.");
  requireUint256(context.referenceBlockNumber, "Receipt reference block", true);
  const observations: PublicLegObservation[] = [], reader = recordingRpc(rpc, observations), expectedHash = hash(signed.hash);
  check(quantity(await read(reader, "eth_chainId", [])) === 11155111n, "Receipt verification requires Sepolia.");
  const [rawValue, receiptValue, headValue] = await Promise.all([read(reader, "eth_getTransactionByHash", [expectedHash]),
    read(reader, "eth_getTransactionReceipt", [expectedHash]), read(reader, "eth_blockNumber", [])]);
  if (receiptValue === null) return frozen({ status: "not-mined", publicObservations: observations });
  check(rawValue !== null, "Receipt exists without its public transaction; reconcile inconsistent RPC observations.");
  const raw = record(rawValue), receipt = record(receiptValue);
  if (quantity(receipt.status) === 0n) return failedReceipt(prepared, signed, context, raw, receipt, quantity(headValue), reader, observations);
  check(hash(raw.hash) === expectedHash && quantity(raw.type) === 2n && quantity(raw.chainId) === 11155111n &&
    address(raw.from) === prepared.senderAddress && address(raw.to) === prepared.tokenAddress && quantity(raw.value) === 0n &&
    raw.input === prepared.data && quantity(raw.nonce) === BigInt(prepared.nonce) && quantity(raw.gas) === prepared.gasLimit &&
    quantity(raw.maxFeePerGas) === prepared.maxFeePerGas && quantity(raw.maxPriorityFeePerGas) === prepared.maxPriorityFeePerGas &&
    Array.isArray(raw.accessList) && raw.accessList.length === 0, "Mined transaction differs from the approved ERC-20 intent.");
  const parity = quantity(raw.v); check([0n, 1n, 27n, 28n].includes(parity), "Invalid mined signature recovery ID.");
  const tx = Transaction.from(prepared.unsignedSerialized);
  tx.signature = Signature.from({ r: normalizeEvmSignatureScalar(raw.r), s: normalizeEvmSignatureScalar(raw.s), v: Number(parity) });
  check(tx.serialized === signed.serialized && tx.hash === expectedHash && tx.from === prepared.senderAddress,
    "Mined signature differs from the original signed bytes.");
  const blockNumber = quantity(receipt.blockNumber), blockHash = hash(receipt.blockHash), head = quantity(headValue);
  check(quantity(receipt.status) === 1n && hash(receipt.transactionHash) === expectedHash && address(receipt.from) === prepared.senderAddress &&
    address(receipt.to) === prepared.tokenAddress && quantity(raw.blockNumber) === blockNumber && hash(raw.blockHash) === blockHash &&
    blockNumber > context.referenceBlockNumber && head >= blockNumber, "Failed, inconsistent or invalidly dated ERC-20 receipt.");
  const blockTag = tag(blockNumber), parentTag = tag(blockNumber - 1n), gasUsed = quantity(receipt.gasUsed), effectiveGasPriceWei = quantity(receipt.effectiveGasPrice);
  const actualFeeWei = gasUsed * effectiveGasPriceWei;
  check(gasUsed >= 21_000n && gasUsed <= prepared.gasLimit && effectiveGasPriceWei <= prepared.maxFeePerGas && actualFeeWei <= prepared.maximumFeeWei,
    "Receipt gas or actual fee exceeds the original transaction bounds.");
  const topics = [prepared.senderAddress, prepared.recipientAddress].map(who => toBeHex(BigInt(who), 32));
  const [blockValue, parentValue, code, decimals, senderCode, recipientCode, beforeSenderToken, beforeRecipientToken, afterSenderToken, afterRecipientToken,
    beforeSenderEth, beforeRecipientEth, afterSenderEth, afterRecipientEth, fromLogs, toLogs] = await Promise.all([
    read(reader, "eth_getBlockByNumber", [blockTag, false]), read(reader, "eth_getBlockByNumber", [parentTag, false]),
    read(reader, "eth_getCode", [asset.address, blockTag]), call(reader, asset.address, "decimals", [], blockTag),
    read(reader, "eth_getCode", [prepared.senderAddress, blockTag]), read(reader, "eth_getCode", [prepared.recipientAddress, blockTag]),
    balance(reader, asset.address, prepared.senderAddress, parentTag), balance(reader, asset.address, prepared.recipientAddress, parentTag),
    balance(reader, asset.address, prepared.senderAddress, blockTag), balance(reader, asset.address, prepared.recipientAddress, blockTag),
    read(reader, "eth_getBalance", [prepared.senderAddress, parentTag]), read(reader, "eth_getBalance", [prepared.recipientAddress, parentTag]),
    read(reader, "eth_getBalance", [prepared.senderAddress, blockTag]), read(reader, "eth_getBalance", [prepared.recipientAddress, blockTag]),
    read(reader, "eth_getLogs", [{ address: asset.address, fromBlock: blockTag, toBlock: blockTag, topics: [transferTopic, topics] }]),
    read(reader, "eth_getLogs", [{ address: asset.address, fromBlock: blockTag, toBlock: blockTag, topics: [transferTopic, null, topics] }]),
  ]);
  const block = record(blockValue), parent = record(parentValue);
  check(quantity(block.number) === blockNumber && hash(block.hash) === blockHash && quantity(parent.number) === blockNumber - 1n &&
    hash(block.parentHash) === hash(parent.hash), "Receipt block or parent is no longer canonical.");
  check(typeof code === "string" && keccak256(code) === asset.codeHash && decimals === BigInt(asset.decimals) && senderCode === "0x" && recipientCode === "0x",
    "Receipt token identity, decimals or role account code differs from the reviewed configuration.");
  const base = quantity(block.baseFeePerGas), uncapped = base + prepared.maxPriorityFeePerGas;
  check(base <= prepared.maxFeePerGas && effectiveGasPriceWei === (uncapped < prepared.maxFeePerGas ? uncapped : prepared.maxFeePerGas),
    "Receipt effective gas price differs from the EIP-1559 parameters.");
  check(Array.isArray(fromLogs) && Array.isArray(toLogs) && Array.isArray(receipt.logs), "Missing canonical token logs.");
  const logIndex = isolatedTransfer([...fromLogs, ...toLogs], prepared, expectedHash, blockHash, blockNumber);
  const receiptLogs = receipt.logs.filter((item: unknown) => { const log = record(item);
    return address(log.address) === asset.address && Array.isArray(log.topics) && log.topics[0] === transferTopic; });
  check(isolatedTransfer(receiptLogs, prepared, expectedHash, blockHash, blockNumber) === logIndex, "Receipt and canonical block event indexes differ.");
  const before: LegBalances = { senderToken: beforeSenderToken, recipientToken: beforeRecipientToken, senderEth: quantity(beforeSenderEth), recipientEth: quantity(beforeRecipientEth) };
  const after: LegBalances = { senderToken: afterSenderToken, recipientToken: afterRecipientToken, senderEth: quantity(afterSenderEth), recipientEth: quantity(afterRecipientEth) };
  const tokenDeltas = { sender: afterSenderToken - beforeSenderToken, recipient: afterRecipientToken - beforeRecipientToken };
  check(tokenDeltas.sender === -prepared.amount && tokenDeltas.recipient === prepared.amount,
    "Canonical token balance deltas differ from the exact approved payment or delivery.");
  check(after.senderEth - before.senderEth === -actualFeeWei && after.recipientEth === before.recipientEth,
    "Canonical native balance deltas cannot isolate the transaction gas cost; reconcile unrelated activity.");
  let finality: VerifiedPurchaseLeg["finality"] = head - blockNumber + 1n >= 2n ? "two-confirmations" : "awaiting-finality";
  if (context.leg === "usdc-payment") {
    const expected = pin(context.usdcImplementationPin), implementation = address(await call(reader, asset.address, "implementation", [], blockTag));
    const implementationCode = await read(reader, "eth_getCode", [implementation, blockTag]);
    check(typeof implementationCode === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(implementationCode) &&
      implementation === expected.address && keccak256(implementationCode) === expected.codeHash, "Mined USDC implementation differs from the original reviewed identity.");
    const finalized = record(await read(reader, "eth_getBlockByNumber", ["finalized", false]));
    const finalizedNumber = quantity(finalized.number), finalizedHash = hash(finalized.hash);
    check(finalizedNumber <= head, "RPC finalized head exceeds the current chain head.");
    const canonicalFinalized = record(await read(reader, "eth_getBlockByNumber", [tag(finalizedNumber), false]));
    check(quantity(canonicalFinalized.number) === finalizedNumber && hash(canonicalFinalized.hash) === finalizedHash, "Finalized head is no longer canonical.");
    finality = finalizedNumber >= blockNumber ? "finalized" : "awaiting-finality";
  }
  const lastBlock = record(await read(reader, "eth_getBlockByNumber", [blockTag, false]));
  check(quantity(lastBlock.number) === blockNumber && hash(lastBlock.hash) === blockHash, "Receipt block changed during verification.");
  const feeObservation: ActualEvmCost = { leg: feeLegs[context.leg], payer: context.role, transactionHash: expectedHash,
    executionStatus: "success", gasUsed, effectiveGasPriceWei };
  const proof: VerifiedPurchaseLeg = { kind: "verified-purchase-leg", purchaseId: context.purchaseId, quoteHash: context.quoteHash,
    leg: context.leg, role: context.role, unsignedHash: prepared.unsignedHash, transactionHash: expectedHash, blockNumber, blockHash,
    confirmations: head - blockNumber + 1n, finality, gasUsed, effectiveGasPriceWei, actualFeeWei, before, after, tokenDeltas, feeObservation,
    ...(context.leg === "usdc-payment" && finality === "finalized" ? { paymentClaim: { chainId: 11155111n, transactionHash: expectedHash, logIndex } } : {}),
    publicObservations: observations };
  return frozen({ status: finality === "awaiting-finality" ? "awaiting-finality" : "confirmed", proof });
}
/** No polling, re-signing, state mutation or broadcasting: reconcile the one recorded signed hash only. */
export async function verifyMinedPurchaseLeg(value: PreparedPurchaseLeg, quote: PurchaseQuote, approvedQuoteHash: string,
  signed: PurchaseLegSigned, rpc: SepoliaReadRpc): Promise<PurchaseLegReceiptResult> {
  assertPurchaseLegSigned(value, quote, approvedQuoteHash, signed);
  if (value.leg !== "eth-delivery") return verifyErc20TransferReceipt(value.prepared, signed, rpc, {
    purchaseId: value.purchaseId, quoteHash: value.quoteHash, leg: value.leg, role: value.role,
    expectedFullPublicKey: deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES[value.role].accountId, DERIVATION_PATH),
    referenceBlockNumber: value.referenceBlockNumber, ...(value.snapshot.usdcImplementation ? { usdcImplementationPin: value.snapshot.usdcImplementation } : {}),
  });
  const observations: PublicLegObservation[] = [], reader = recordingRpc(rpc, observations);
  const receiptValue = await read(reader, "eth_getTransactionReceipt", [signed.hash]);
  if (receiptValue === null) return frozen({ status: "not-mined", publicObservations: observations });
  const receipt = record(receiptValue), head = quantity(await read(reader, "eth_blockNumber", []));
  if (quantity(receipt.status) === 0n) return failedReceipt(value.prepared, signed, { purchaseId: value.purchaseId,
    quoteHash: value.quoteHash, leg: value.leg, role: value.role, referenceBlockNumber: value.referenceBlockNumber },
    record(await read(reader, "eth_getTransactionByHash", [signed.hash])), receipt, head, reader, observations);
  if (head < quantity(receipt.blockNumber) + 1n) {
    // Preserve the observed canonical evidence; the native verifier still runs before any confirmed transition.
    throw new PurchaseLegError("RECEIPT_FAILED", "Native receipt awaits two confirmations; reconcile later without resubmission.");
  }
  const proof = await verifyNativeDeliveryReceipt(value.preflight, signed, reader, quote.terms.termsHash, quote.policy.execution);
  return frozen({ status: "confirmed", proof: { kind: "verified-purchase-leg", purchaseId: value.purchaseId, quoteHash: value.quoteHash,
    leg: value.leg, role: value.role, unsignedHash: value.prepared.unsignedHash, transactionHash: proof.transactionHash,
    blockNumber: proof.blockNumber, blockHash: proof.blockHash, confirmations: proof.confirmations, finality: "two-confirmations",
    gasUsed: proof.gasUsed, effectiveGasPriceWei: proof.effectiveGasPriceWei, actualFeeWei: proof.actualFeeWei,
    before: { senderEth: proof.before.treasuryEth, recipientEth: proof.before.investorEth },
    after: { senderEth: proof.after.treasuryEth, recipientEth: proof.after.investorEth },
    nativeDeltas: { sender: proof.nativeDeltas.treasury, recipient: proof.nativeDeltas.investor }, feeObservation: proof.feeObservation,
    publicObservations: observations } });
}
