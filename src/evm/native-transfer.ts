import { isDeepStrictEqual } from "node:util";
import { SigningKey, Transaction, ZeroAddress, computeAddress, getAddress, keccak256 } from "ethers";
import { DERIVATION_PATH } from "../near/config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { deriveEvmPublicKey } from "../near/mpc.js";
import { requireUint256 } from "../purchase/amounts.js";
import { normalizeMpcSignature, SEPOLIA_CHAIN_ID } from "./erc20-transfer.js";

export interface NativeTransferInput {
  readonly chainId: bigint;
  readonly senderAddress: string;
  readonly recipientAddress: string;
  readonly amountWei: bigint;
  readonly nonce: number;
  readonly gasLimit: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}
export interface PreparedNativeTransfer extends NativeTransferInput {
  readonly type: 2;
  readonly value: bigint;
  readonly data: "0x";
  readonly maximumFeeWei: bigint;
  readonly unsignedSerialized: string;
  readonly unsignedHash: string;
}
export interface AssembledNativeTransfer {
  readonly serialized: string;
  readonly hash: string;
  readonly senderAddress: string;
}

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function address(value: unknown, label: string): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), `${label} must be an EVM address.`);
  let result: string;
  try { result = getAddress(value); } catch { throw new Error(`${label} has an invalid checksum.`); }
  check(result !== ZeroAddress, `${label} cannot be the zero address.`);
  return result;
}
function publicKey(value: unknown): string {
  check(typeof value === "string" && /^0x(?:04[0-9a-fA-F]{128}|0[23][0-9a-fA-F]{64})$/.test(value),
    "Expected a complete SEC1 public key, never private key material.");
  try { return SigningKey.computePublicKey(value, false); }
  catch { throw new Error("Expected public key is not a secp256k1 point."); }
}

/** Pure EIP-1559 builder: no provider, key, signing operation or broadcast capability. */
export function buildUnsignedNativeTransfer(input: NativeTransferInput): PreparedNativeTransfer {
  check(input && input.chainId === SEPOLIA_CHAIN_ID, "Native transfer requires Ethereum Sepolia chain ID 11155111n.");
  const senderAddress = address(input.senderAddress, "Sender"), recipientAddress = address(input.recipientAddress, "Recipient");
  check(senderAddress !== recipientAddress, "Native sender and recipient must be distinct.");
  const amountWei = requireUint256(input.amountWei, "Native delivery wei", true);
  check(Number.isSafeInteger(input.nonce) && input.nonce >= 0, "Native nonce must be a nonnegative safe integer.");
  const gasLimit = requireUint256(input.gasLimit, "Gas limit", true);
  check(gasLimit >= 21_000n, "Native gas limit cannot be below the intrinsic transaction gas minimum.");
  const maxFeePerGas = requireUint256(input.maxFeePerGas, "Maximum fee per gas", true);
  const maxPriorityFeePerGas = requireUint256(input.maxPriorityFeePerGas, "Maximum priority fee per gas");
  check(maxPriorityFeePerGas <= maxFeePerGas, "Priority fee cannot exceed the maximum fee per gas.");
  check(!("data" in input) || input.data === "0x", "Native delivery requires empty calldata.");
  check(!("value" in input) || input.value === amountWei, "Native transaction value must equal the approved wei amount.");
  const maximumFeeWei = requireUint256(gasLimit * maxFeePerGas, "Maximum transaction fee", true);
  const tx = Transaction.from({ type: 2, chainId: SEPOLIA_CHAIN_ID, to: recipientAddress, value: amountWei,
    data: "0x", nonce: input.nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas, accessList: [] });
  return Object.freeze({ chainId: SEPOLIA_CHAIN_ID, senderAddress, recipientAddress, amountWei, nonce: input.nonce,
    gasLimit, maxFeePerGas, maxPriorityFeePerGas, type: 2 as const, value: amountWei, data: "0x" as const,
    maximumFeeWei, unsignedSerialized: tx.unsignedSerialized, unsignedHash: tx.unsignedHash });
}

export function assertPreparedNativeTransfer(prepared: PreparedNativeTransfer): void {
  check(prepared && typeof prepared === "object" && isDeepStrictEqual(prepared, buildUnsignedNativeTransfer(prepared)),
    "Native transaction fields, serialization or unsigned digest changed.");
}

/** Verify public signature material and assemble exact bytes. No signature is requested here. */
export function assembleSignedNativeTransfer(prepared: PreparedNativeTransfer, rawSignature: unknown,
  expectedSender: string, expectedFullPublicKey: string): AssembledNativeTransfer {
  assertPreparedNativeTransfer(prepared);
  const sender = address(expectedSender, "Expected sender"), trustedKey = publicKey(expectedFullPublicKey);
  check(sender === prepared.senderAddress && computeAddress(trustedKey) === sender,
    "Expected full public key and sender do not match the native transfer.");
  const signature = normalizeMpcSignature(rawSignature);
  let recovered: string;
  try { recovered = SigningKey.recoverPublicKey(prepared.unsignedHash, signature); }
  catch { throw new Error("Native signature cannot recover a public key for this digest."); }
  check(recovered.toLowerCase() === trustedKey.toLowerCase() && computeAddress(recovered) === sender,
    "Native signature does not recover the complete trusted public key and sender.");
  const tx = Transaction.from(prepared.unsignedSerialized);
  tx.signature = signature;
  check(tx.unsignedHash === prepared.unsignedHash && tx.unsignedSerialized === prepared.unsignedSerialized &&
    tx.from === sender && tx.hash !== null && keccak256(tx.serialized) === tx.hash,
    "Assembled native transaction differs from the verified digest or sender.");
  return Object.freeze({ serialized: tx.serialized, hash: tx.hash, senderAddress: sender });
}

/** Purchase execution always uses the pinned Treasury authority and Investor destination. */
export function assembleTreasuryNativeTransfer(prepared: PreparedNativeTransfer, rawSignature: unknown): AssembledNativeTransfer {
  check(prepared.senderAddress === VERIFIED_IDENTITIES.treasury.evmAddress &&
    prepared.recipientAddress === VERIFIED_IDENTITIES.investor.evmAddress,
    "Native purchase delivery must be Treasury to Investor.");
  const trusted = deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES.treasury.accountId, DERIVATION_PATH);
  return assembleSignedNativeTransfer(prepared, rawSignature, VERIFIED_IDENTITIES.treasury.evmAddress, trusted);
}

/** Reverify existing signed bytes without a new signature request or transaction reconstruction. */
export function assertSignedNativeTransfer(prepared: PreparedNativeTransfer, signed: AssembledNativeTransfer,
  expectedSender: string, expectedFullPublicKey: string): void {
  assertPreparedNativeTransfer(prepared);
  const sender = address(expectedSender, "Expected sender"), trustedKey = publicKey(expectedFullPublicKey);
  check(sender === prepared.senderAddress && computeAddress(trustedKey) === sender && signed.senderAddress === sender,
    "Signed native authority differs from the expected full public key and sender.");
  const tx = Transaction.from(signed.serialized);
  check(tx.signature !== null && tx.hash === signed.hash && keccak256(signed.serialized) === signed.hash &&
    tx.unsignedSerialized === prepared.unsignedSerialized && tx.unsignedHash === prepared.unsignedHash && tx.from === sender,
    "Signed native bytes, hash, digest or sender changed.");
  check(SigningKey.recoverPublicKey(prepared.unsignedHash, tx.signature).toLowerCase() === trustedKey.toLowerCase(),
    "Signed native transaction does not recover the complete trusted public key.");
}

export function assertTreasuryNativeSignedTransfer(prepared: PreparedNativeTransfer, signed: AssembledNativeTransfer): void {
  check(prepared.senderAddress === VERIFIED_IDENTITIES.treasury.evmAddress &&
    prepared.recipientAddress === VERIFIED_IDENTITIES.investor.evmAddress,
    "Native purchase delivery must be Treasury to Investor.");
  const trusted = deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES.treasury.accountId, DERIVATION_PATH);
  assertSignedNativeTransfer(prepared, signed, VERIFIED_IDENTITIES.treasury.evmAddress, trusted);
}
