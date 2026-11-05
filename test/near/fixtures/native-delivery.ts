import { Transaction } from "ethers";
import { VERIFIED_IDENTITIES } from "../../../src/near/identities.js";
import { createPurchaseTerms } from "../../../src/purchase/terms.js";
import { parseUsdcAmount } from "../../../src/purchase/amounts.js";
import { prepareNativeDelivery, type NativeDeliverySnapshot } from "../../../src/evm/sepolia-native.js";
import type { SepoliaReadMethod, SepoliaReadRpc } from "../../../src/evm/sepolia-link.js";

// Entirely synthetic offline observations and prices; no live transaction or delivery proof.
export const NATIVE_FEES = Object.freeze({ maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n });
export const NATIVE_BLOCK_HASH = `0x${"11".repeat(32)}`;
export function nativeTerms(amount = "10") {
  return createPurchaseTerms({ investmentUsdcBaseUnits: parseUsdcAmount(amount),
    ethPrice: { numerator: 2500n, denominator: 1n, source: "synthetic offline ETH price, not current market data" },
    linkPrice: { numerator: 10n, denominator: 1n, source: "synthetic offline LINK price, not current market data" } });
}
export function nativeSnapshot(overrides: Partial<NativeDeliverySnapshot> = {}): NativeDeliverySnapshot {
  return { chainId: 11155111n, senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
    recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress, senderCode: "0x", recipientCode: "0x",
    confirmedNonce: 1, pendingNonce: 1, treasuryBalanceWei: 50_000_000_000_000_000n,
    investorBalanceWei: 49_000_000_000_000_000n, estimatedGas: 21_000n, baseFeePerGas: 1000n,
    simulationResult: "0x", blockNumber: 100n, blockHash: NATIVE_BLOCK_HASH, ...overrides };
}
export function nativePreflight(amount = "10", overrides: Partial<NativeDeliverySnapshot> = {}) {
  const terms = nativeTerms(amount);
  return prepareNativeDelivery(terms, terms.termsHash, NATIVE_FEES, nativeSnapshot(overrides));
}
export function nativeObservationRpc(overrides: Partial<NativeDeliverySnapshot> = {}, failureMethod?: SepoliaReadMethod) {
  const observed = nativeSnapshot({ blockNumber: 101n, blockHash: `0x${"22".repeat(32)}`, ...overrides });
  const calls: { method: SepoliaReadMethod; params: readonly unknown[] }[] = [];
  const hex = (value: bigint | number) => `0x${value.toString(16)}`;
  const rpc: SepoliaReadRpc = { async request(method, params) {
    calls.push({ method, params });
    if (method === failureMethod) throw new Error("fixture-provider error with raw details that must not escape");
    switch (method) {
      case "eth_chainId": return hex(observed.chainId);
      case "eth_getBlockByNumber": return { number: hex(observed.blockNumber), hash: observed.blockHash, baseFeePerGas: hex(observed.baseFeePerGas) };
      case "eth_getCode": return params[0] === VERIFIED_IDENTITIES.treasury.evmAddress ? observed.senderCode : observed.recipientCode;
      case "eth_getBalance": return hex(params[0] === VERIFIED_IDENTITIES.treasury.evmAddress ? observed.treasuryBalanceWei : observed.investorBalanceWei);
      case "eth_getTransactionCount": return hex(params[1] === "pending" ? observed.pendingNonce : observed.confirmedNonce);
      case "eth_call": return observed.simulationResult;
      case "eth_estimateGas": return hex(observed.estimatedGas);
      default: throw new Error(`Unsupported offline observation method: ${method}`);
    }
  } };
  return { rpc, calls, observed };
}

/** Convert a preassembled algebraic fixture into public-RPC-shaped receipt observations. */
export function nativeReceiptRpc(prepared: { senderAddress: string; recipientAddress: string; amountWei: bigint },
  signed: { serialized: string; hash: string }, overrides: {
    raw?: Record<string, unknown>; receipt?: Record<string, unknown>; block?: Record<string, unknown>;
    head?: bigint; beforeTreasury?: bigint; beforeInvestor?: bigint; afterTreasury?: bigint; afterInvestor?: bigint;
    missingTransaction?: boolean; missingReceipt?: boolean; code?: string; failMethod?: SepoliaReadMethod;
    reorg?: boolean;
  } = {}) {
  const tx = Transaction.from(signed.serialized), hex = (value: bigint | number) => `0x${value.toString(16)}`;
  const blockHash = `0x${"33".repeat(32)}`, parentHash = `0x${"44".repeat(32)}`;
  const blockNumber = 102n, gasUsed = 21_000n, price = 2000n, fee = gasUsed * price;
  const beforeTreasury = overrides.beforeTreasury ?? 50_000_000_000_000_000n;
  const beforeInvestor = overrides.beforeInvestor ?? 49_000_000_000_000_000n;
  const raw = { hash: signed.hash, type: "0x2", chainId: "0xaa36a7", from: prepared.senderAddress, to: prepared.recipientAddress,
    value: hex(prepared.amountWei), input: "0x", nonce: hex(tx.nonce), gas: hex(tx.gasLimit), maxFeePerGas: hex(tx.maxFeePerGas!),
    maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas!), accessList: [], r: tx.signature!.r, s: tx.signature!.s,
    v: hex(tx.signature!.yParity), blockNumber: hex(blockNumber), blockHash, ...overrides.raw };
  const receipt = { transactionHash: signed.hash, status: "0x1", from: prepared.senderAddress, to: prepared.recipientAddress,
    blockNumber: hex(blockNumber), blockHash, gasUsed: hex(gasUsed), effectiveGasPrice: hex(price), logs: [], ...overrides.receipt };
  let blockReads = 0;
  const calls: { method: SepoliaReadMethod; params: readonly unknown[] }[] = [];
  const rpc: SepoliaReadRpc = { async request(method, params) {
    calls.push({ method, params });
    if (method === overrides.failMethod) throw new Error("synthetic private provider detail must be suppressed");
    switch (method) {
      case "eth_chainId": return "0xaa36a7";
      case "eth_getTransactionByHash": return overrides.missingTransaction ? null : raw;
      case "eth_getTransactionReceipt": return overrides.missingReceipt ? null : receipt;
      case "eth_blockNumber": return hex(overrides.head ?? 103n);
      case "eth_getCode": return overrides.code ?? "0x";
      case "eth_getBlockByNumber":
        if (params[0] === "0x65") return { number: "0x65", hash: parentHash };
        blockReads++;
        return { number: "0x66", hash: overrides.reorg && blockReads > 1 ? parentHash : blockHash, parentHash, baseFeePerGas: "0x3e8", ...overrides.block };
      case "eth_getBalance": {
        const sender = params[0] === prepared.senderAddress, before = params[1] === "0x65";
        if (sender) return hex(before ? beforeTreasury : overrides.afterTreasury ?? beforeTreasury - prepared.amountWei - fee);
        return hex(before ? beforeInvestor : overrides.afterInvestor ?? beforeInvestor + prepared.amountWei);
      }
      default: throw new Error(`Unsupported offline receipt method: ${method}`);
    }
  } };
  return { rpc, calls, raw, receipt, blockHash, beforeTreasury, beforeInvestor, gasUsed, price, fee };
}
