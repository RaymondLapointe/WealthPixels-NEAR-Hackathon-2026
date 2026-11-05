import { buildUnsignedNativeTransfer, assembleSignedNativeTransfer } from "../../../src/evm/native-transfer.js";

// Synthetic public algebraic fixture. R=generator, s=1, recovery=0; the public
// key was recovered from the fixed unsigned digest. No private key, Wallet,
// key generation, MPC signing call, RPC or blockchain execution is involved.
// This identity is NOT the WealthPixels Treasury and proves no live execution.
export const NATIVE_FIXTURE_INPUT = Object.freeze({ chainId: 11155111n,
  senderAddress: "0xB4aBa840f6667F4B3b413D8f38d2DBeA65732764",
  recipientAddress: "0x2222222222222222222222222222222222222222", amountWei: 2_000_000_000_000_000n,
  nonce: 1, gasLimit: 25_200n, maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n });
export const NATIVE_FIXTURE_PUBLIC_KEY = "0x0415f0d54a608bf318ef62529da6c0c089213100540de7b278dfbd08c0d5e1abcc128d687190ac6a932ca0298f93efe84859debcc410efa8a5322236aaef9904e7";
export const NATIVE_FIXTURE_SIGNATURE = Object.freeze({
  big_r: Object.freeze({ affine_point: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" }),
  s: Object.freeze({ scalar: "1".padStart(64, "0") }), recovery_id: 0 as const });
export const NATIVE_FIXTURE_UNSIGNED_HASH = "0x2dbaee8bea5463425f9dadd643ee2cb3353a5be1897ed2871ec6c7dbcb7af200";
export const NATIVE_FIXTURE_SIGNED_HASH = "0xb394afaa81c415352680df9304e5b557d64f76c7b1a9f79e0d8ff3c9a90c59de";
export function nativeFixturePrepared() { return buildUnsignedNativeTransfer(NATIVE_FIXTURE_INPUT); }
export function nativeFixtureSigned() {
  return assembleSignedNativeTransfer(nativeFixturePrepared(), NATIVE_FIXTURE_SIGNATURE,
    NATIVE_FIXTURE_INPUT.senderAddress, NATIVE_FIXTURE_PUBLIC_KEY);
}
