import { readFileSync } from "node:fs";
import { Interface, Signature, SigningKey, Transaction, computeAddress, keccak256 } from "ethers";
import { SEPOLIA_ASSETS } from "../../../src/purchase/config.js";
import type { Erc20ReceiptContext, PurchaseLeg, UsdcImplementationPin } from "../../../src/purchase/legs.js";
import { buildUnsignedErc20Transfer, type PreparedErc20Transfer } from "../../../src/evm/erc20-transfer.js";
import type { SepoliaReadMethod, SepoliaReadRpc } from "../../../src/evm/sepolia-link.js";
import { VERIFIED_IDENTITIES } from "../../../src/near/identities.js";
import { recordedState } from "./recorded-mpc.js";

// Fixed public bytecode, algebraic signatures and synthetic RPC observations.
// No fixture is a live purchase, network observation, private key or MPC request.
export const abi = new Interface(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)", "function paused() view returns (bool)",
  "function isBlacklisted(address) view returns (bool)", "function implementation() view returns (address)",
  "event Transfer(address indexed from,address indexed to,uint256 value)"]);
const usdc = JSON.parse(readFileSync(new URL("./sepolia-usdc.json", import.meta.url), "utf8")) as { tokenCode: string };
export const TOKEN_CODE = { USDC: usdc.tokenCode, LINK: recordedState().preflight.snapshot.tokenCode };
const implementationCode = "0x60006000";
export const IMPLEMENTATION_PIN: UsdcImplementationPin = { address: "0x3333333333333333333333333333333333333333", codeHash: keccak256(implementationCode) };
export const FEES = { maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n, usdcImplementationPin: IMPLEMENTATION_PIN };
export const BLOCK_HASH = `0x${"11".repeat(32)}`;
const hex = (value: number | bigint) => `0x${value.toString(16)}`;
export interface ObservationOptions {
  chain?: bigint; confirmedNonce?: bigint; pendingNonce?: bigint; gas?: bigint; baseFee?: bigint; code?: string;
  decimals?: bigint; paused?: boolean; blacklisted?: boolean; simulation?: boolean; reorg?: boolean;
  senderBalance?: bigint; recipientBalance?: bigint; nativeBalance?: bigint; failMethod?: SepoliaReadMethod;
  blockNumber?: bigint; implementationAddress?: string; implementationCode?: string;
  blockHash?: string;
}
export function purchaseObservationRpc(leg: PurchaseLeg, options: ObservationOptions = {}) {
  const calls: { method: SepoliaReadMethod; params: readonly unknown[] }[] = [];
  const asset = leg === "usdc-payment" ? SEPOLIA_ASSETS.USDC : SEPOLIA_ASSETS.LINK;
  const role = leg === "usdc-payment" ? "investor" : "treasury", sender = VERIFIED_IDENTITIES[role].evmAddress;
  const block = options.blockNumber ?? 100n;
  const rpc: SepoliaReadRpc = { async request(method, params) {
    calls.push({ method, params });
    if (method === options.failMethod) throw new Error("Synthetic sensitive provider details must not appear in errors");
    switch (method) {
      case "eth_chainId": return hex(options.chain ?? 11155111n);
      case "eth_getBlockByNumber": return { number: hex(block), hash: options.reorg && params[0] !== "latest" ? `0x${"22".repeat(32)}` : options.blockHash ?? BLOCK_HASH,
        baseFeePerGas: hex(options.baseFee ?? 1000n) };
      case "eth_getCode":
        if (params[0] === IMPLEMENTATION_PIN.address || params[0] === options.implementationAddress) return options.implementationCode ?? implementationCode;
        return params[0] === asset.address ? options.code ?? TOKEN_CODE[asset.symbol] : "0x";
      case "eth_getBalance": return hex(options.nativeBalance ?? 50_000_000_000_000_000n);
      case "eth_getTransactionCount": return hex(params[1] === "pending" ? options.pendingNonce ?? options.confirmedNonce ?? 0n : options.confirmedNonce ?? 0n);
      case "eth_estimateGas": return hex(options.gas ?? (leg === "eth-delivery" ? 21_000n : leg === "usdc-payment" ? 50_000n : 60_000n));
      case "eth_call": {
        const call = params[0] as { data: string; value?: string };
        if (call.data === "0x") return "0x";
        const parsed = abi.parseTransaction({ data: call.data })!;
        if (parsed.name === "decimals") return abi.encodeFunctionResult("decimals", [options.decimals ?? BigInt(asset.decimals)]);
        if (parsed.name === "transfer") return abi.encodeFunctionResult("transfer", [options.simulation ?? true]);
        if (parsed.name === "paused") return abi.encodeFunctionResult("paused", [options.paused ?? false]);
        if (parsed.name === "isBlacklisted") return abi.encodeFunctionResult("isBlacklisted", [options.blacklisted ?? false]);
        if (parsed.name === "implementation") return abi.encodeFunctionResult("implementation", [options.implementationAddress ?? IMPLEMENTATION_PIN.address]);
        const isSender = parsed.args[0] === sender;
        return abi.encodeFunctionResult("balanceOf", [isSender ? options.senderBalance ?? (leg === "usdc-payment" ? 200_000_000n : 30n * 10n ** 18n) : options.recipientBalance ?? 0n]);
      }
      default: throw new Error(`Unexpected synthetic observation method ${method}`);
    }
  } };
  return { rpc, calls };
}
export function algebraicErc20Fixture(leg: "usdc-payment" | "link-delivery" = "usdc-payment") {
  // Fixed public r=generator-x, s=1, recovery=0. Recovering its public key for a
  // fixed digest is public arithmetic, not private-key generation or signing.
  const signature = Signature.from({ r: "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", s: "0x" + "1".padStart(64, "0"), yParity: 0 });
  const asset = leg === "usdc-payment" ? SEPOLIA_ASSETS.USDC : SEPOLIA_ASSETS.LINK;
  const input = { chainId: 11155111n, senderAddress: "0x1111111111111111111111111111111111111111", recipientAddress: "0x2222222222222222222222222222222222222222",
    tokenAddress: asset.address, amount: leg === "usdc-payment" ? 10_000_000n : 1_000_000_000_000_000_000n,
    nonce: 0, gasLimit: 60_000n, maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n };
  const digest = buildUnsignedErc20Transfer(input).unsignedHash;
  const publicKey = SigningKey.recoverPublicKey(digest, signature), senderAddress = computeAddress(publicKey);
  const prepared = buildUnsignedErc20Transfer({ ...input, senderAddress }), tx = Transaction.from(prepared.unsignedSerialized); tx.signature = signature;
  const signed = { serialized: tx.serialized, hash: tx.hash!, senderAddress };
  const context: Erc20ReceiptContext = { purchaseId: "synthetic-receipt", quoteHash: `0x${"aa".repeat(32)}`, leg,
    role: leg === "usdc-payment" ? "investor" : "treasury", expectedFullPublicKey: publicKey, referenceBlockNumber: 100n,
    ...(leg === "usdc-payment" ? { usdcImplementationPin: IMPLEMENTATION_PIN } : {}) };
  return { prepared, signed, context, publicKey };
}
export interface ReceiptOptions {
  raw?: Record<string, unknown>; receipt?: Record<string, unknown>; block?: Record<string, unknown>;
  head?: bigint; finalized?: bigint; reorg?: boolean; missingTransaction?: boolean; missingReceipt?: boolean;
  senderTokenDelta?: bigint; recipientTokenDelta?: bigint; senderEthDelta?: bigint; recipientEthDelta?: bigint;
  logs?: readonly unknown[]; receiptLogs?: readonly unknown[]; failMethod?: SepoliaReadMethod;
  implementationAddress?: string; implementationCode?: string; code?: string;
}
export function purchaseReceiptRpc(prepared: PreparedErc20Transfer, signed: { serialized: string; hash: string }, options: ReceiptOptions = {}) {
  const tx = Transaction.from(signed.serialized), blockNumber = 102n, blockHash = `0x${"33".repeat(32)}`, parentHash = `0x${"44".repeat(32)}`;
  const gasUsed = 50_000n, price = prepared.maxPriorityFeePerGas + 1000n, fee = gasUsed * price;
  const log = { ...abi.encodeEventLog(abi.getEvent("Transfer")!, [prepared.senderAddress, prepared.recipientAddress, prepared.amount]),
    address: prepared.tokenAddress, removed: false, transactionHash: signed.hash, blockHash, blockNumber: hex(blockNumber), logIndex: "0x2" };
  const raw = { hash: signed.hash, type: "0x2", chainId: "0xaa36a7", from: prepared.senderAddress, to: prepared.tokenAddress, value: "0x0", input: prepared.data,
    nonce: hex(tx.nonce), gas: hex(tx.gasLimit), maxFeePerGas: hex(tx.maxFeePerGas!), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas!), accessList: [],
    r: tx.signature!.r, s: tx.signature!.s, v: hex(tx.signature!.yParity), blockNumber: hex(blockNumber), blockHash, ...options.raw };
  const receipt = { transactionHash: signed.hash, status: "0x1", from: prepared.senderAddress, to: prepared.tokenAddress, blockNumber: hex(blockNumber), blockHash,
    gasUsed: hex(gasUsed), effectiveGasPrice: hex(price), logs: options.receiptLogs ?? [log], ...options.receipt };
  const beforeSender = 200n * 10n ** 18n, beforeRecipient = 1n * 10n ** 18n, beforeNative = 50_000_000_000_000_000n;
  let canonicalReads = 0;
  const calls: { method: SepoliaReadMethod; params: readonly unknown[] }[] = [];
  const rpc: SepoliaReadRpc = { async request(method, params) {
    calls.push({ method, params }); if (method === options.failMethod) throw new Error("Synthetic provider secret must be suppressed");
    switch (method) {
      case "eth_chainId": return "0xaa36a7";
      case "eth_getTransactionByHash": return options.missingTransaction ? null : raw;
      case "eth_getTransactionReceipt": return options.missingReceipt ? null : receipt;
      case "eth_blockNumber": return hex(options.head ?? 110n);
      case "eth_getBlockByNumber": {
        if (params[0] === "finalized") {
          const n = options.finalized ?? 102n; return { number: hex(n), hash: n === 102n ? blockHash : n === 101n ? parentHash : `0x${"55".repeat(32)}` };
        }
        if (params[0] === "0x65") return { number: "0x65", hash: parentHash };
        if (params[0] !== "0x66") return { number: params[0], hash: `0x${"55".repeat(32)}` };
        canonicalReads++; return { number: "0x66", hash: options.reorg && canonicalReads > 1 ? parentHash : blockHash, parentHash,
          baseFeePerGas: "0x3e8", ...options.block };
      }
      case "eth_getCode": {
        if (params[0] === IMPLEMENTATION_PIN.address || params[0] === options.implementationAddress) return options.implementationCode ?? implementationCode;
        const symbol = prepared.tokenAddress === SEPOLIA_ASSETS.USDC.address ? "USDC" : "LINK";
        return params[0] === prepared.tokenAddress ? options.code ?? TOKEN_CODE[symbol] : "0x";
      }
      case "eth_getBalance": {
        const sender = params[0] === prepared.senderAddress, before = params[1] === "0x65";
        return hex(beforeNative + (before ? 0n : sender ? options.senderEthDelta ?? -fee : options.recipientEthDelta ?? 0n));
      }
      case "eth_call": {
        const call = params[0] as { data: string }, parsed = abi.parseTransaction({ data: call.data })!;
        if (parsed.name === "decimals") return abi.encodeFunctionResult("decimals", [prepared.tokenAddress === SEPOLIA_ASSETS.USDC.address ? 6 : 18]);
        if (parsed.name === "implementation") return abi.encodeFunctionResult("implementation", [options.implementationAddress ?? IMPLEMENTATION_PIN.address]);
        const sender = parsed.args[0] === prepared.senderAddress, before = params[1] === "0x65";
        return abi.encodeFunctionResult("balanceOf", [sender ? beforeSender + (before ? 0n : options.senderTokenDelta ?? -prepared.amount)
          : beforeRecipient + (before ? 0n : options.recipientTokenDelta ?? prepared.amount)]);
      }
      case "eth_getLogs": return options.logs ?? [log];
      default: throw new Error(`Unexpected synthetic receipt method ${method}`);
    }
  } };
  return { rpc, calls, raw, receipt, log, gasUsed, price, fee };
}
