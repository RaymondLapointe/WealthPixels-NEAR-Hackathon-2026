import {
  Interface,
  Signature,
  SigningKey,
  Transaction,
  ZeroAddress,
  getAddress,
  recoverAddress,
  toBeHex,
} from "ethers";

export const SEPOLIA_CHAIN_ID = 11155111n;
const MAX_UINT256 = (1n << 256n) - 1n;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const erc20 = new Interface([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export interface Erc20TransferInput {
  readonly chainId: bigint;
  readonly senderAddress: string;
  readonly tokenAddress: string;
  readonly recipientAddress: string;
  /** Exact token base units; never a JavaScript floating-point amount. */
  readonly amount: bigint;
  readonly nonce: number;
  readonly gasLimit: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface PreparedErc20Transfer extends Erc20TransferInput {
  readonly type: 2;
  readonly value: 0n;
  readonly data: string;
  readonly maximumFeeWei: bigint;
  readonly unsignedSerialized: string;
  readonly unsignedHash: string;
}

/** Caller-supplied observations; this module never fetches or verifies live state. */
export interface TransferPreflightSnapshot {
  readonly chainId: bigint;
  readonly senderAddress: string;
  readonly tokenAddress: string;
  readonly tokenCode: string;
  readonly pendingNonce: number;
  readonly estimatedGas: bigint;
  readonly tokenBalance: bigint;
  readonly nativeBalance: bigint;
  readonly baseFeePerGas: bigint;
}

export interface TransferPreflightResult {
  readonly checkedNonce: number;
  readonly maximumFeeWei: bigint;
  readonly remainingTokenBalance: bigint;
  readonly remainingNativeBalanceAtMaxFee: bigint;
}

export interface MpcEcdsaSignature {
  readonly big_r: { readonly affine_point: string };
  readonly s: { readonly scalar: string };
  readonly recovery_id: 0 | 1;
}

export interface AssembledErc20Transfer {
  readonly serialized: string;
  readonly hash: string;
  readonly senderAddress: string;
}

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be a hexadecimal EVM address`);
  }
  let normalized: string;
  try {
    normalized = getAddress(value);
  } catch {
    throw new Error(`${label} has an invalid address checksum`);
  }
  if (normalized === ZeroAddress) {
    throw new Error(`${label} must not be the zero address`);
  }
  return normalized;
}

function uint256(value: unknown, label: string, positive = false): bigint {
  if (
    typeof value !== "bigint" ||
    value < (positive ? 1n : 0n) ||
    value > MAX_UINT256
  ) {
    throw new Error(`${label} must be ${positive ? "a positive" : "a nonnegative"} uint256 bigint`);
  }
  return value;
}

function nonce(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

/** Pure builder: no provider, signer, network request, or submission capability. */
export function buildUnsignedErc20Transfer(
  input: Erc20TransferInput,
): PreparedErc20Transfer {
  if (input.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("chainId must be Ethereum Sepolia (11155111n)");
  }
  const senderAddress = address(input.senderAddress, "senderAddress");
  const tokenAddress = address(input.tokenAddress, "tokenAddress");
  const recipientAddress = address(input.recipientAddress, "recipientAddress");
  if (senderAddress === recipientAddress) {
    throw new Error("senderAddress and recipientAddress must be distinct");
  }
  const amount = uint256(input.amount, "amount", true);
  const transactionNonce = nonce(input.nonce, "nonce");
  const gasLimit = uint256(input.gasLimit, "gasLimit", true);
  const maxFeePerGas = uint256(input.maxFeePerGas, "maxFeePerGas", true);
  const maxPriorityFeePerGas = uint256(input.maxPriorityFeePerGas, "maxPriorityFeePerGas");
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error("maxPriorityFeePerGas must not exceed maxFeePerGas");
  }
  const maximumFeeWei = uint256(gasLimit * maxFeePerGas, "maximumFeeWei", true);
  const data = erc20.encodeFunctionData("transfer", [recipientAddress, amount]);
  const transaction = Transaction.from({
    type: 2,
    chainId: SEPOLIA_CHAIN_ID,
    to: tokenAddress,
    value: 0n,
    data,
    nonce: transactionNonce,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    accessList: [],
  });
  return Object.freeze({
    chainId: SEPOLIA_CHAIN_ID,
    senderAddress,
    tokenAddress,
    recipientAddress,
    amount,
    nonce: transactionNonce,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    type: 2 as const,
    value: 0n as const,
    data,
    maximumFeeWei,
    unsignedSerialized: transaction.unsignedSerialized,
    unsignedHash: transaction.unsignedHash,
  });
}

function checkedPrepared(prepared: PreparedErc20Transfer): PreparedErc20Transfer {
  const rebuilt = buildUnsignedErc20Transfer(prepared);
  if (
    prepared.type !== rebuilt.type ||
    prepared.value !== rebuilt.value ||
    prepared.data !== rebuilt.data ||
    prepared.maximumFeeWei !== rebuilt.maximumFeeWei ||
    prepared.unsignedSerialized !== rebuilt.unsignedSerialized ||
    prepared.unsignedHash !== rebuilt.unsignedHash
  ) {
    throw new Error("prepared transfer metadata does not match its transaction fields");
  }
  return rebuilt;
}

/** Validate an explicitly supplied snapshot. A successful result is not a live preflight. */
export function validateTransferPreflight(
  prepared: PreparedErc20Transfer,
  snapshot: TransferPreflightSnapshot,
): TransferPreflightResult {
  const transfer = checkedPrepared(prepared);
  if (snapshot.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("snapshot chainId must be Ethereum Sepolia");
  }
  if (address(snapshot.senderAddress, "snapshot senderAddress") !== transfer.senderAddress) {
    throw new Error("snapshot senderAddress does not match the prepared sender");
  }
  if (address(snapshot.tokenAddress, "snapshot tokenAddress") !== transfer.tokenAddress) {
    throw new Error("snapshot tokenAddress does not match the prepared token");
  }
  if (
    typeof snapshot.tokenCode !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(snapshot.tokenCode)
  ) {
    throw new Error("snapshot tokenCode must contain contract bytecode");
  }
  if (nonce(snapshot.pendingNonce, "snapshot pendingNonce") !== transfer.nonce) {
    throw new Error("snapshot pendingNonce does not match the prepared nonce");
  }
  if (uint256(snapshot.estimatedGas, "snapshot estimatedGas", true) > transfer.gasLimit) {
    throw new Error("gasLimit is below the snapshot gas estimate");
  }
  const tokenBalance = uint256(snapshot.tokenBalance, "snapshot tokenBalance");
  const nativeBalance = uint256(snapshot.nativeBalance, "snapshot nativeBalance");
  const baseFeePerGas = uint256(snapshot.baseFeePerGas, "snapshot baseFeePerGas");
  if (tokenBalance < transfer.amount) {
    throw new Error("snapshot token inventory is insufficient");
  }
  if (nativeBalance < transfer.maximumFeeWei) {
    throw new Error("snapshot native balance cannot cover the maximum fee");
  }
  if (baseFeePerGas + transfer.maxPriorityFeePerGas > transfer.maxFeePerGas) {
    throw new Error("maxFeePerGas cannot cover the snapshot base fee plus priority fee");
  }
  return Object.freeze({
    checkedNonce: transfer.nonce,
    maximumFeeWei: transfer.maximumFeeWei,
    remainingTokenBalance: tokenBalance - transfer.amount,
    remainingNativeBalanceAtMaxFee: nativeBalance - transfer.maximumFeeWei,
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hex(value: unknown, digits: number, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be hexadecimal`);
  }
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (normalized.length !== digits || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`${label} has an invalid hexadecimal encoding`);
  }
  return normalized.toLowerCase();
}

/** Parse public MPC response data, producing an EIP-2 canonical low-s signature. */
export function normalizeMpcSignature(raw: unknown): Signature {
  const response = record(raw, "MPC signature");
  const bigR = record(response.big_r, "MPC big_r");
  const scalar = record(response.s, "MPC s");
  const point = hex(bigR.affine_point, 66, "MPC big_r.affine_point");
  if (!point.startsWith("02") && !point.startsWith("03")) {
    throw new Error("MPC big_r.affine_point must be a compressed secp256k1 point");
  }
  try {
    // Static public-point validation only: no private key or signing operation.
    SigningKey.computePublicKey(`0x${point}`, true);
  } catch {
    throw new Error("MPC big_r.affine_point is not on secp256k1");
  }
  const r = BigInt(`0x${point.slice(2)}`);
  let s = BigInt(`0x${hex(scalar.scalar, 64, "MPC s.scalar")}`);
  if (r <= 0n || r >= SECP256K1_ORDER || s <= 0n || s >= SECP256K1_ORDER) {
    throw new Error("MPC r and s must be nonzero scalars below the secp256k1 order");
  }
  if (response.recovery_id !== 0 && response.recovery_id !== 1) {
    throw new Error("MPC recovery_id must be 0 or 1 for an Ethereum signature");
  }
  // MPC may retain the original R point when canonicalizing s. Recovery uses
  // the supplied (r, s, recovery_id); the raw point's y parity may differ.
  let yParity: 0 | 1 = response.recovery_id;
  if (s > SECP256K1_ORDER / 2n) {
    s = SECP256K1_ORDER - s;
    yParity = yParity === 0 ? 1 : 0;
  }
  return Signature.from({ r: toBeHex(r, 32), s: toBeHex(s, 32), yParity });
}

/** Assemble only; this function never requests a signature or broadcasts anything. */
export function assembleSignedErc20Transfer(
  prepared: PreparedErc20Transfer,
  rawSignature: unknown,
  expectedSender: string,
): AssembledErc20Transfer {
  const transfer = checkedPrepared(prepared);
  const expected = address(expectedSender, "expectedSender");
  if (expected !== transfer.senderAddress) {
    throw new Error("expectedSender does not match the prepared senderAddress");
  }
  const signature = normalizeMpcSignature(rawSignature);
  let recovered: string;
  try {
    recovered = recoverAddress(transfer.unsignedHash, signature);
  } catch {
    throw new Error("MPC signature cannot recover a sender for this unsigned hash");
  }
  if (recovered !== expected) {
    throw new Error("MPC signature recovered a sender different from expectedSender");
  }
  const transaction = Transaction.from(transfer.unsignedSerialized);
  transaction.signature = signature;
  if (transaction.from !== expected || transaction.hash === null) {
    throw new Error("assembled transaction sender validation failed");
  }
  return Object.freeze({
    serialized: transaction.serialized,
    hash: transaction.hash,
    senderAddress: recovered,
  });
}
