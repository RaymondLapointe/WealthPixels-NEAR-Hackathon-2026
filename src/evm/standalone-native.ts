import { isDeepStrictEqual } from "node:util";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID } from "../near/config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { requireUint256 } from "../purchase/amounts.js";
import { check, fingerprint, frozen, hexHash, purchaseId } from "../purchase/integrity.js";
import { buildUnsignedNativeTransfer, type PreparedNativeTransfer } from "./native-transfer.js";
import { DEFAULT_NATIVE_DELIVERY_POLICY, estimateNativeDeliveryFees, observeNativeTransferAmount, validateNativeTransferObservation,
  type NativeDeliveryPolicy, type NativeDeliverySnapshot } from "./sepolia-native.js";
import type { SepoliaReadRpc } from "./sepolia-link.js";

export interface StandaloneNativeIntent {
  readonly schemaVersion: 1; readonly kind: "standalone-native-eth-test"; readonly testId: string; readonly role: "treasury";
  readonly chainId: 11155111n; readonly senderAddress: string; readonly recipientAddress: string; readonly amountWei: bigint;
  readonly near: { readonly accountId: string; readonly contractId: string; readonly domainId: 0; readonly path: string;
    readonly rootPublicKey: string; readonly gasTgas: 100; readonly depositYocto: "1" };
  readonly policy: NativeDeliveryPolicy; readonly intentHash: string;
}
export interface StandaloneNativePreflight {
  readonly kind: "standalone-native-eth-preflight"; readonly intent: StandaloneNativeIntent;
  readonly prepared: PreparedNativeTransfer; readonly snapshot: NativeDeliverySnapshot;
}
function policy(value: NativeDeliveryPolicy): NativeDeliveryPolicy {
  const expected = DEFAULT_NATIVE_DELIVERY_POLICY;
  check(value && Object.keys(value).sort().join() === Object.keys(expected).sort().join(), "Unsupported standalone native policy fields.");
  for (const key of ["gasLimitCap", "maxFeePerGasCap", "maxTotalFeeWei", "gasBufferBps", "operatingReserveWei"] as const)
    requireUint256(value[key], key, true);
  check(value.gasLimitCap <= expected.gasLimitCap && value.maxFeePerGasCap <= expected.maxFeePerGasCap &&
    value.maxTotalFeeWei <= expected.maxTotalFeeWei && value.gasBufferBps >= expected.gasBufferBps && value.gasBufferBps <= 10_000n &&
    value.operatingReserveWei >= expected.operatingReserveWei, "Standalone tests cannot weaken protective gas/fee caps, the 20% buffer or operating reserve.");
  return frozen(value);
}
/** An amount-bound test instruction, with no USDC quote, payment or portfolio state. */
export function createStandaloneNativeIntent(input: { readonly testId: string; readonly role: "treasury";
  readonly amountWei: bigint; readonly policy?: NativeDeliveryPolicy }): StandaloneNativeIntent {
  check(input.role === "treasury", "Select the Treasury role explicitly for the standalone ETH test.");
  check(ECDSA_DOMAIN_ID === 0, "The standalone test supports only the verified ECDSA domain0.");
  const body = { schemaVersion: 1 as const, kind: "standalone-native-eth-test" as const,
    testId: purchaseId(input.testId), role: "treasury" as const, chainId: 11155111n as const,
    senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress, recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress,
    amountWei: requireUint256(input.amountWei, "Explicit native test amount in wei", true),
    near: { accountId: VERIFIED_IDENTITIES.treasury.accountId, contractId: MPC_CONTRACT_ID, domainId: ECDSA_DOMAIN_ID as 0,
      path: DERIVATION_PATH, rootPublicKey: VERIFIED_MPC_ROOT, gasTgas: 100 as const, depositYocto: "1" as const },
    policy: policy(input.policy ?? DEFAULT_NATIVE_DELIVERY_POLICY) };
  return frozen({ ...body, intentHash: fingerprint("standalone-native-test-intent-v1", body) });
}
export function assertStandaloneNativeIntent(value: StandaloneNativeIntent, expectedIntentHash = value?.intentHash): void {
  check(value && typeof value === "object", "A standalone native test intent is required.");
  const rebuilt = createStandaloneNativeIntent({ testId: value.testId, role: value.role, amountWei: value.amountWei, policy: value.policy });
  check(hexHash(expectedIntentHash) === rebuilt.intentHash && isDeepStrictEqual(value, rebuilt), "Standalone native amount, role, policy, authority or intent hash changed.");
}
export function prepareStandaloneNative(intent: StandaloneNativeIntent,
  fees: { readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint }, observed: NativeDeliverySnapshot): StandaloneNativePreflight {
  assertStandaloneNativeIntent(intent);
  estimateNativeDeliveryFees(observed, fees, { assumedBaseFeePerGasWei: observed.baseFeePerGas,
    assumedPriorityFeePerGasWei: fees.maxPriorityFeePerGas }, intent.policy);
  const gasLimit = (requireUint256(observed.estimatedGas, "Native gas estimate", true) * (10_000n + intent.policy.gasBufferBps) + 9999n) / 10_000n;
  const prepared = buildUnsignedNativeTransfer({ chainId: intent.chainId, senderAddress: intent.senderAddress,
    recipientAddress: intent.recipientAddress, amountWei: intent.amountWei, nonce: observed.confirmedNonce, gasLimit,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  validateNativeTransferObservation(prepared, observed, intent.policy);
  return frozen({ kind: "standalone-native-eth-preflight", intent, prepared, snapshot: observed });
}
export function assertStandaloneNativePreflight(value: StandaloneNativePreflight, expectedIntentHash: string): void {
  check(value && value.kind === "standalone-native-eth-preflight", "This file is not a standalone native ETH preflight.");
  assertStandaloneNativeIntent(value.intent, expectedIntentHash);
  const rebuilt = prepareStandaloneNative(value.intent, { maxFeePerGas: value.prepared.maxFeePerGas,
    maxPriorityFeePerGas: value.prepared.maxPriorityFeePerGas }, value.snapshot);
  check(isDeepStrictEqual(value, rebuilt), "Standalone native transaction, observation or original intent changed.");
}
export async function observeStandaloneNative(intent: StandaloneNativeIntent, rpc: SepoliaReadRpc): Promise<NativeDeliverySnapshot> {
  assertStandaloneNativeIntent(intent); return observeNativeTransferAmount(intent.amountWei, rpc);
}
export async function recheckStandaloneNative(value: StandaloneNativePreflight, rpc: SepoliaReadRpc,
  expectedIntentHash: string): Promise<NativeDeliverySnapshot> {
  assertStandaloneNativePreflight(value, expectedIntentHash);
  const fresh = await observeStandaloneNative(value.intent, rpc);
  check(fresh.blockNumber >= value.snapshot.blockNumber && (fresh.blockNumber !== value.snapshot.blockNumber || fresh.blockHash === value.snapshot.blockHash),
    "Native test recheck returned an older or conflicting observation block.");
  validateNativeTransferObservation(value.prepared, fresh, value.intent.policy); return fresh;
}
