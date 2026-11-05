import assert from "node:assert/strict";
import test from "node:test";
import { SigningKey, Transaction } from "ethers";
import { buildUnsignedNativeTransfer, assertPreparedNativeTransfer, assembleSignedNativeTransfer,
  assembleTreasuryNativeTransfer, assertSignedNativeTransfer, assertTreasuryNativeSignedTransfer,
  type NativeTransferInput } from "../../src/evm/native-transfer.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { NATIVE_FIXTURE_INPUT as INPUT, NATIVE_FIXTURE_PUBLIC_KEY as PUBLIC_KEY,
  NATIVE_FIXTURE_SIGNATURE as RAW, NATIVE_FIXTURE_UNSIGNED_HASH as DIGEST,
  NATIVE_FIXTURE_SIGNED_HASH as HASH, nativeFixturePrepared, nativeFixtureSigned } from "./fixtures/native-algebraic.js";

test("native fixture uses exact EIP-1559 value, empty calldata and the recorded unsigned digest", () => {
  const value = nativeFixturePrepared(), tx = Transaction.from(value.unsignedSerialized);
  assert.equal(tx.type, 2); assert.equal(tx.chainId, 11155111n); assert.equal(tx.to, INPUT.recipientAddress);
  assert.equal(tx.value, 2_000_000_000_000_000n); assert.equal(tx.data, "0x"); assert.deepEqual(tx.accessList, []);
  assert.equal(tx.signature, null); assert.equal(tx.nonce, 1); assert.equal(tx.gasLimit, 25_200n);
  assert.equal(tx.maxFeePerGas, 5000n); assert.equal(tx.maxPriorityFeePerGas, 1000n);
  assert.equal(value.unsignedHash, DIGEST); assert.equal(value.value, value.amountWei);
  assert.equal(value.maximumFeeWei, 126_000_000n); assert.ok(Object.isFrozen(value));
  assertPreparedNativeTransfer(value);
});

test("native quantities, nonce and fees reject floating point, wrong chain and integer overflow", () => {
  for (const changes of [{ chainId: 1n }, { chainId: 11155111 }, { amountWei: 0n }, { amountWei: -1n },
    { amountWei: 0.002 }, { amountWei: 1n << 256n }, { nonce: -1 }, { nonce: 0.5 }, { nonce: Number.MAX_SAFE_INTEGER + 1 },
    { gasLimit: 0n }, { gasLimit: 1n }, { gasLimit: 20_999n }, { gasLimit: -1n }, { gasLimit: 21000 }, { maxFeePerGas: 0n },
    { maxPriorityFeePerGas: -1n }, { maxPriorityFeePerGas: 5001n }, { gasLimit: 1n << 255n, maxFeePerGas: 2n }]) {
    assert.throws(() => buildUnsignedNativeTransfer({ ...INPUT, ...changes } as NativeTransferInput));
  }
  assert.equal(buildUnsignedNativeTransfer({ ...INPUT, amountWei: 1n }).value, 1n);
  assert.equal(buildUnsignedNativeTransfer({ ...INPUT, amountWei: (1n << 256n) - 1n }).value, (1n << 256n) - 1n);
});

test("native builder requires distinct valid nonzero addresses and empty calldata", () => {
  for (const recipientAddress of ["invalid", "0x" + "0".repeat(40), INPUT.senderAddress,
    INPUT.senderAddress.replace("B4aBa", "b4aBa")]) {
    assert.throws(() => buildUnsignedNativeTransfer({ ...INPUT, recipientAddress }));
  }
  assert.throws(() => buildUnsignedNativeTransfer({ ...INPUT, senderAddress: "invalid" }));
  assert.throws(() => buildUnsignedNativeTransfer({ ...INPUT, data: "0x1234" } as NativeTransferInput));
  assert.throws(() => buildUnsignedNativeTransfer({ ...INPUT, value: 1n } as NativeTransferInput));
});

test("native integrity rejects changed value, fields, serialization, digest and extra metadata", () => {
  const value = nativeFixturePrepared();
  for (const changes of [{ type: 0 }, { chainId: 1n }, { senderAddress: INPUT.recipientAddress },
    { recipientAddress: INPUT.senderAddress }, { value: value.value + 1n }, { amountWei: value.amountWei + 1n },
    { nonce: 2 }, { gasLimit: 25_201n }, { data: "0x1234" }, { maxFeePerGas: 5001n },
    { maxPriorityFeePerGas: 999n }, { maximumFeeWei: 0n }, { unsignedHash: "0x" + "00".repeat(32) },
    { unsignedSerialized: "0x02" }, { unsignedHash: value.unsignedHash.toUpperCase() }, { extra: "unapproved" }]) {
    assert.throws(() => assertPreparedNativeTransfer({ ...value, ...changes } as typeof value));
  }
});

test("public algebraic signature fixture reconstructs exact native bytes, sender and full public key", () => {
  const signed = nativeFixtureSigned(), tx = Transaction.from(signed.serialized);
  assert.equal(signed.hash, HASH); assert.equal(signed.senderAddress, INPUT.senderAddress);
  assert.equal(tx.from, INPUT.senderAddress); assert.equal(tx.unsignedHash, DIGEST);
  assert.equal(SigningKey.recoverPublicKey(DIGEST, tx.signature!), PUBLIC_KEY);
  assert.equal(tx.value, INPUT.amountWei); assert.equal(tx.data, "0x");
  const compressed = SigningKey.computePublicKey(PUBLIC_KEY, true);
  assert.deepEqual(assembleSignedNativeTransfer(nativeFixturePrepared(), RAW, INPUT.senderAddress, compressed), signed);
});

test("native assembly reuses low-S normalization without changing the approved digest or signed hash", () => {
  // Full secp256k1 order; this is a public scalar constant, never a private credential.
  const fullOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const equivalent = { ...RAW, s: { scalar: (fullOrder - 1n).toString(16) }, recovery_id: 1 };
  assert.deepEqual(assembleSignedNativeTransfer(nativeFixturePrepared(), equivalent, INPUT.senderAddress, PUBLIC_KEY), nativeFixtureSigned());
});

test("native signature verification rejects wrong full key, sender, recovery ID and altered approved transaction", () => {
  const value = nativeFixturePrepared();
  assert.throws(() => assembleSignedNativeTransfer(value, RAW, INPUT.recipientAddress, PUBLIC_KEY));
  assert.throws(() => assembleSignedNativeTransfer(value, RAW, INPUT.senderAddress, "0x04" + "00".repeat(64)));
  assert.throws(() => assembleSignedNativeTransfer(value, RAW, INPUT.senderAddress, "0x" + "01".repeat(32)));
  for (const recovery_id of [1, 2, -1]) {
    assert.throws(() => assembleSignedNativeTransfer(value, { ...RAW, recovery_id }, INPUT.senderAddress, PUBLIC_KEY));
  }
  for (const changes of [{ amountWei: INPUT.amountWei + 1n }, { nonce: 2 }, { maxFeePerGas: 5001n },
    { recipientAddress: "0x3333333333333333333333333333333333333333" }]) {
    const changed = buildUnsignedNativeTransfer({ ...INPUT, ...changes });
    assert.notEqual(changed.unsignedHash, DIGEST);
    assert.throws(() => assembleSignedNativeTransfer(changed, RAW, INPUT.senderAddress, PUBLIC_KEY));
  }
});

test("native assembly preserves MPC point, scalar and encoding checks", () => {
  for (const signature of [null, {}, { ...RAW, big_r: { affine_point: "04" + "00".repeat(32) } },
    { ...RAW, big_r: { affine_point: "02" + "ff".repeat(32) } }, { ...RAW, s: { scalar: "0".repeat(64) } },
    { ...RAW, s: { scalar: "ff".repeat(32) } }, { ...RAW, s: { scalar: "1" } }]) {
    assert.throws(() => assembleSignedNativeTransfer(nativeFixturePrepared(), signature, INPUT.senderAddress, PUBLIC_KEY));
  }
});

test("Treasury native assembly pins its real NEAR-derived authority and rejects synthetic or wrong-role signatures", () => {
  assert.throws(() => assembleTreasuryNativeTransfer(nativeFixturePrepared(), RAW), /Treasury to Investor/);
  const treasury = buildUnsignedNativeTransfer({ ...INPUT, senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
    recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress });
  assert.throws(() => assembleTreasuryNativeTransfer(treasury, RAW), /trusted public key/);
  const investor = buildUnsignedNativeTransfer({ ...INPUT, senderAddress: VERIFIED_IDENTITIES.investor.evmAddress,
    recipientAddress: VERIFIED_IDENTITIES.treasury.evmAddress });
  assert.throws(() => assembleTreasuryNativeTransfer(investor, RAW), /Treasury to Investor/);
});

test("native construction and public signature verification have no network or submission capability", () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Offline native fixture cannot fetch"); };
  try {
    assert.equal(nativeFixtureSigned().hash, HASH); assert.equal(calls, 0);
    assert.equal("sign" in nativeFixturePrepared(), false); assert.equal("broadcast" in nativeFixturePrepared(), false);
  } finally { globalThis.fetch = previous; }
});

test("existing signed native bytes require the original digest, hash, full public key and sender", () => {
  const prepared = nativeFixturePrepared(), signed = nativeFixtureSigned();
  assertSignedNativeTransfer(prepared, signed, INPUT.senderAddress, PUBLIC_KEY);
  for (const changes of [{ hash: "0x" + "00".repeat(32) }, { serialized: "0x02" }, { senderAddress: INPUT.recipientAddress }]) {
    assert.throws(() => assertSignedNativeTransfer(prepared, { ...signed, ...changes }, INPUT.senderAddress, PUBLIC_KEY));
  }
  assert.throws(() => assertSignedNativeTransfer(buildUnsignedNativeTransfer({ ...INPUT, amountWei: 1n }), signed, INPUT.senderAddress, PUBLIC_KEY));
  assert.throws(() => assertSignedNativeTransfer(prepared, signed, INPUT.recipientAddress, PUBLIC_KEY));
  assert.throws(() => assertTreasuryNativeSignedTransfer(prepared, signed), /Treasury to Investor/);
});
