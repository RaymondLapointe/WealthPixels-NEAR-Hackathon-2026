import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Transaction } from "ethers";
import {
  SEPOLIA_CHAIN_ID,
  assembleSignedErc20Transfer,
  buildUnsignedErc20Transfer,
  normalizeMpcSignature,
  validateTransferPreflight,
  type Erc20TransferInput,
  type TransferPreflightSnapshot,
} from "../../src/evm/erc20-transfer.js";
import {
  recordedOutcome, recordedState, RECORDED_EVM_HASH, RECORDED_SENDER, RECORDED_UNSIGNED_HASH,
} from "./fixtures/recorded-mpc.js";

// Public algebraic fixture only: generator R, s=1, parity=0. No private key,
// Wallet, signing call, NEAR account, RPC, or network signature is involved.
const GENERATOR_X = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const FIXTURE_SENDER = "0x3235964C47553b0eA279720Ff40890adDA100755";
const FIXTURE_HASH = "0xcb8589b3525017480a3c8828c5b85eaa932854b02c54976f60cf1e0245323b1b";
const SIGNATURE = {
  big_r: { affine_point: `02${GENERATOR_X}` },
  s: { scalar: "1".padStart(64, "0") },
  recovery_id: 0,
};
const INPUT: Erc20TransferInput = {
  chainId: SEPOLIA_CHAIN_ID,
  senderAddress: FIXTURE_SENDER,
  tokenAddress: "0x1111111111111111111111111111111111111111",
  recipientAddress: "0x2222222222222222222222222222222222222222",
  amount: 1_000_000n,
  nonce: 7,
  gasLimit: 65_000n,
  maxFeePerGas: 3_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
};
function snapshot(overrides: Partial<TransferPreflightSnapshot> = {}): TransferPreflightSnapshot {
  return {
    chainId: SEPOLIA_CHAIN_ID,
    senderAddress: FIXTURE_SENDER,
    tokenAddress: INPUT.tokenAddress,
    tokenCode: "0x60006000",
    pendingNonce: 7,
    estimatedGas: 60_000n,
    tokenBalance: INPUT.amount,
    nativeBalance: INPUT.gasLimit * INPUT.maxFeePerGas,
    baseFeePerGas: 2_000_000_000n,
    ...overrides,
  };
}

test("builds an exact zero-ETH EIP-1559 Sepolia token transfer", () => {
  const prepared = buildUnsignedErc20Transfer(INPUT);
  const tx = Transaction.from(prepared.unsignedSerialized);
  const erc20 = new Interface(["function transfer(address,uint256) returns (bool)"]);
  const decoded = erc20.decodeFunctionData("transfer", tx.data);
  assert.equal(tx.type, 2);
  assert.equal(tx.chainId, 11155111n);
  assert.equal(tx.to, INPUT.tokenAddress);
  assert.equal(tx.value, 0n);
  assert.equal(tx.signature, null);
  assert.equal(decoded[0], INPUT.recipientAddress);
  assert.equal(decoded[1], 1_000_000n);
  assert.equal(prepared.unsignedHash, FIXTURE_HASH);
  assert.equal(prepared.maximumFeeWei, 195_000_000_000_000n);
  assert.ok(Object.isFrozen(prepared));
});

test("rejects other chains and non-bigint chain identifiers", () => {
  for (const chainId of [1n, 11155111 as unknown as bigint]) {
    assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, chainId }), /Sepolia/);
  }
});

test("rejects invalid, zero, bad-checksum and identical destination addresses", () => {
  for (const tokenAddress of ["not-an-address", "0x" + "0".repeat(40), "0x3235964c47553b0eA279720Ff40890adDA100755"]) {
    assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, tokenAddress }), /address|checksum/);
  }
  assert.throws(
    () => buildUnsignedErc20Transfer({ ...INPUT, recipientAddress: INPUT.senderAddress }),
    /distinct/,
  );
});

test("accepts only positive uint256 bigint token base units", () => {
  for (const amount of [0n, -1n, 1n << 256n, 1 as unknown as bigint, "1" as unknown as bigint]) {
    assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, amount }), /amount/);
  }
  const maximum = (1n << 256n) - 1n;
  assert.equal(buildUnsignedErc20Transfer({ ...INPUT, amount: maximum }).amount, maximum);
});

test("rejects invalid nonce, gas and EIP-1559 fee combinations", () => {
  for (const invalidNonce of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, nonce: invalidNonce }), /nonce/);
  }
  assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, gasLimit: 0n }), /gasLimit/);
  assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, maxFeePerGas: 0n }), /maxFeePerGas/);
  assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, maxPriorityFeePerGas: 4_000_000_000n }), /must not exceed/);
  assert.throws(() => buildUnsignedErc20Transfer({ ...INPUT, gasLimit: (1n << 256n) - 1n }), /maximumFeeWei/);
});

test("preflight permits exact inventory and maximum-fee balances", () => {
  const result = validateTransferPreflight(buildUnsignedErc20Transfer(INPUT), snapshot());
  assert.equal(result.checkedNonce, 7);
  assert.equal(result.remainingTokenBalance, 0n);
  assert.equal(result.remainingNativeBalanceAtMaxFee, 0n);
});

test("preflight rejects mismatched chain, address, code, nonce and gas observations", () => {
  const prepared = buildUnsignedErc20Transfer(INPUT);
  const cases: Array<[Partial<TransferPreflightSnapshot>, RegExp]> = [
    [{ chainId: 1n }, /chainId/],
    [{ senderAddress: INPUT.recipientAddress }, /senderAddress/],
    [{ tokenAddress: INPUT.recipientAddress }, /tokenAddress/],
    [{ tokenCode: "0x" }, /bytecode/],
    [{ tokenCode: "0x0" }, /bytecode/],
    [{ pendingNonce: 8 }, /pendingNonce/],
    [{ pendingNonce: -1 }, /pendingNonce/],
    [{ estimatedGas: 65_001n }, /gas estimate/],
    [{ estimatedGas: 0n }, /estimatedGas/],
  ];
  for (const [overrides, message] of cases) {
    assert.throws(() => validateTransferPreflight(prepared, snapshot(overrides)), message);
  }
});

test("preflight rejects insufficient inventory, gas funds and fee coverage", () => {
  const prepared = buildUnsignedErc20Transfer(INPUT);
  assert.throws(() => validateTransferPreflight(prepared, snapshot({ tokenBalance: 999_999n })), /inventory/);
  assert.throws(() => validateTransferPreflight(prepared, snapshot({ nativeBalance: prepared.maximumFeeWei - 1n })), /maximum fee/);
  assert.throws(() => validateTransferPreflight(prepared, snapshot({ baseFeePerGas: 2_000_000_001n })), /base fee/);
});

test("normalizes MPC scalars and preserves recovery when canonicalizing high-s", () => {
  const low = normalizeMpcSignature(SIGNATURE);
  const high = normalizeMpcSignature({
    big_r: { affine_point: `0x03${GENERATOR_X}` },
    s: { scalar: `0x${(ORDER - 1n).toString(16)}` },
    recovery_id: 1,
  });
  assert.equal(low.s, "0x" + "1".padStart(64, "0"));
  assert.equal(low.yParity, 0);
  assert.equal(high.serialized, low.serialized);
});

test("uses the supplied recovery ID independently of raw R parity while preserving high-s canonicalization", () => {
  const original = normalizeMpcSignature(SIGNATURE);
  const oppositeRawPoint = normalizeMpcSignature({ ...SIGNATURE, big_r: { affine_point: `03${GENERATOR_X}` } });
  assert.equal(oppositeRawPoint.serialized, original.serialized);
  const oppositeRecovery = normalizeMpcSignature({ ...SIGNATURE, recovery_id: 1 });
  assert.equal(oppositeRecovery.yParity, 1);
  assert.notEqual(oppositeRecovery.serialized, original.serialized);
  const high = normalizeMpcSignature({ ...SIGNATURE, s: { scalar: (ORDER - 1n).toString(16) }, recovery_id: 1 });
  assert.equal(high.serialized, original.serialized);
  assert.throws(() => assembleSignedErc20Transfer(buildUnsignedErc20Transfer(INPUT),
    { ...SIGNATURE, recovery_id: 1 }, FIXTURE_SENDER), /different from expectedSender/);
});

test("replays the recorded public MPC response with opposite raw R parity and assembles the independently verified hash", () => {
  const outcome = recordedOutcome(), state = recordedState();
  const signature = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"));
  assert.equal(signature.big_r.affine_point.slice(0, 2), "03");
  assert.equal(signature.recovery_id, 0);
  assert.ok(BigInt("0x" + signature.s.scalar) <= ORDER / 2n);
  const normalized = normalizeMpcSignature(signature);
  assert.equal(normalized.yParity, 0);
  const assembled = assembleSignedErc20Transfer(state.preflight.prepared, signature, RECORDED_SENDER);
  assert.equal(assembled.hash, RECORDED_EVM_HASH);
  assert.equal(assembled.senderAddress, RECORDED_SENDER);
  assert.equal(Transaction.from(assembled.serialized).unsignedHash, RECORDED_UNSIGNED_HASH);
  assert.throws(() => assembleSignedErc20Transfer(state.preflight.prepared,
    { ...signature, recovery_id: 1 }, RECORDED_SENDER), /different from expectedSender/);
});

test("rejects malformed MPC responses, invalid points, scalars and recovery identifiers", () => {
  const invalid = [
    null,
    [],
    {},
    { ...SIGNATURE, big_r: { affine_point: `04${GENERATOR_X}` } },
    { ...SIGNATURE, big_r: { affine_point: `02${"ff".repeat(32)}` } },
    { ...SIGNATURE, big_r: { affine_point: "02" } },
    { ...SIGNATURE, s: { scalar: "0".repeat(64) } },
    { ...SIGNATURE, s: { scalar: ORDER.toString(16) } },
    { ...SIGNATURE, s: { scalar: "1" } },
    { ...SIGNATURE, s: { scalar: 1 } },
    { ...SIGNATURE, recovery_id: 2 },
    { ...SIGNATURE, recovery_id: "0" },
  ];
  for (const signature of invalid) {
    assert.throws(() => normalizeMpcSignature(signature), /MPC/);
  }
});

test("assembles the public fixture and verifies the recovered sender", () => {
  const prepared = buildUnsignedErc20Transfer(INPUT);
  const result = assembleSignedErc20Transfer(prepared, SIGNATURE, FIXTURE_SENDER);
  const tx = Transaction.from(result.serialized);
  assert.equal(tx.from, FIXTURE_SENDER);
  assert.equal(tx.unsignedHash, FIXTURE_HASH);
  assert.equal(tx.hash, result.hash);
  assert.equal(tx.chainId, SEPOLIA_CHAIN_ID);
});

test("rejects expected-sender mismatches, wrong signatures and tampered prepared metadata", () => {
  const prepared = buildUnsignedErc20Transfer(INPUT);
  assert.throws(() => assembleSignedErc20Transfer(prepared, SIGNATURE, INPUT.recipientAddress), /prepared senderAddress/);
  assert.throws(() => assembleSignedErc20Transfer(prepared, { ...SIGNATURE, big_r: { affine_point: `03${GENERATOR_X}` }, recovery_id: 1 }, FIXTURE_SENDER), /different from expectedSender/);
  assert.throws(() => assembleSignedErc20Transfer({ ...prepared, senderAddress: INPUT.tokenAddress }, SIGNATURE, FIXTURE_SENDER), /prepared senderAddress/);
  for (const altered of [
    { ...prepared, amount: 1n },
    { ...prepared, data: "0x" },
    { ...prepared, unsignedHash: "0x" + "00".repeat(32) },
    { ...prepared, unsignedSerialized: "0x02" },
    { ...prepared, maximumFeeWei: 1n },
  ]) {
    assert.throws(() => assembleSignedErc20Transfer(altered, SIGNATURE, FIXTURE_SENDER), /metadata/);
    assert.throws(() => validateTransferPreflight(altered, snapshot()), /metadata/);
  }
});

test("offline dry-run construction never invokes network or signer hooks", () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("network access is forbidden in this offline test");
  };
  const input = {
    ...INPUT,
    get sign() { throw new Error("signing must not be requested"); },
    get broadcast() { throw new Error("broadcasting must not be requested"); },
  };
  try {
    const first = buildUnsignedErc20Transfer(input);
    const second = buildUnsignedErc20Transfer(input);
    assert.deepEqual(first, second);
    validateTransferPreflight(first, snapshot());
    assert.equal(Transaction.from(first.unsignedSerialized).signature, null);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
