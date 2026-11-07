import assert from "node:assert/strict";
import test from "node:test";
import { Transaction } from "ethers";
import { createStandaloneNativeIntent, assertStandaloneNativeIntent, prepareStandaloneNative, assertStandaloneNativePreflight,
  observeStandaloneNative, recheckStandaloneNative } from "../../src/evm/standalone-native.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { nativeSnapshot, nativeObservationRpc, NATIVE_FEES } from "./fixtures/native-delivery.js";

// Fixed public observation fixtures only. No purchase terms helper, USDC
// quotation, credential, signature request or network service is invoked.
const amount = 1_000_000_000_000n;
const intent = () => createStandaloneNativeIntent({ testId: "offline-standalone-native", role: "treasury", amountWei: amount });

test("standalone native intent binds exact wei and public authorities without a purchase or USDC quote", () => {
  const value = intent();
  assert.equal(value.kind, "standalone-native-eth-test"); assert.equal(value.role, "treasury");
  assert.equal(value.chainId, 11155111n); assert.equal(value.amountWei, amount);
  assert.equal(value.senderAddress, VERIFIED_IDENTITIES.treasury.evmAddress);
  assert.equal(value.recipientAddress, VERIFIED_IDENTITIES.investor.evmAddress);
  for (const forbidden of ["terms", "quote", "investmentUsdcBaseUnits", "paymentClaim", "allocationBps", "prices"]) assert.equal(forbidden in value, false);
  assert.match(value.intentHash, /^0x[0-9a-f]{64}$/); assert.ok(Object.isFrozen(value));
  assertStandaloneNativeIntent(value, value.intentHash);
});
test("standalone exact amounts are configurable, including one wei without an arbitrary minimum", () => {
  for (const amountWei of [1n, amount, 1_000_000_000_000_000n]) {
    const value = createStandaloneNativeIntent({ testId: "offline-variable-native", role: "treasury", amountWei });
    const preflight = prepareStandaloneNative(value, NATIVE_FEES, nativeSnapshot());
    assert.equal(preflight.prepared.amountWei, amountWei); assert.equal(preflight.prepared.value, amountWei);
  }
});
test("standalone intent rejects unsupported role, invalid identity and invalid exact amount", () => {
  const input = { testId: "offline-native-validation", role: "treasury" as const, amountWei: amount };
  for (const changed of [{ role: "investor" }, { role: undefined }, { testId: "" }, { testId: "../other" },
    { amountWei: 0n }, { amountWei: -1n }, { amountWei: 1 }, { amountWei: "1" }, { amountWei: 1n << 256n }]) {
    assert.throws(() => createStandaloneNativeIntent({ ...input, ...changed } as typeof input));
  }
});
test("standalone intent integrity prevents changing amount, roles, network or approval hash", () => {
  const value = intent();
  for (const patch of [{ amountWei: amount + 1n }, { role: "investor" }, { chainId: 1n },
    { senderAddress: value.recipientAddress }, { recipientAddress: value.senderAddress }, { testId: "other-test" }]) {
    assert.throws(() => assertStandaloneNativeIntent({ ...value, ...patch } as typeof value, value.intentHash));
  }
  assert.throws(() => assertStandaloneNativeIntent(value, `0x${"00".repeat(32)}`));
});
test("standalone public NEAR authority, MPC root, domain, path and attachment cannot be substituted", () => {
  const value = intent();
  for (const patch of [{ accountId: VERIFIED_IDENTITIES.investor.accountId }, { rootPublicKey: value.near.rootPublicKey + "X" },
    { contractId: "other.testnet" }, { domainId: 1 }, { path: "other-path" }, { gasTgas: 99 }, { depositYocto: "0" }]) {
    assert.throws(() => assertStandaloneNativeIntent({ ...value, near: { ...value.near, ...patch } } as typeof value, value.intentHash));
  }
});
test("standalone preparation uses native EIP-1559 value, empty calldata and a buffered25200 gas limit", () => {
  const value = intent(), before = nativeSnapshot(), result = prepareStandaloneNative(value, NATIVE_FEES, before);
  assert.equal(result.kind, "standalone-native-eth-preflight"); assert.deepEqual(result.intent, value);
  assert.equal(result.prepared.gasLimit, 25_200n); assert.equal(result.prepared.data, "0x");
  assert.equal(result.prepared.value, amount); assert.equal(result.prepared.amountWei, amount);
  assert.equal(result.prepared.nonce, before.confirmedNonce);
  const tx = Transaction.from(result.prepared.unsignedSerialized);
  assert.equal(tx.chainId, 11155111n); assert.equal(tx.type, 2); assert.equal(tx.to, value.recipientAddress);
  assert.equal(tx.value, amount); assert.equal(tx.data, "0x"); assert.deepEqual(tx.accessList, []);
  assert.equal(tx.unsignedHash, result.prepared.unsignedHash); assert.equal(tx.signature, null);
  assertStandaloneNativePreflight(result, value.intentHash);
});
test("the minimum20% gas buffer rounds up using exact integers and never selects the gas ceiling automatically", () => {
  const value = intent(), result = prepareStandaloneNative(value, NATIVE_FEES, nativeSnapshot({ estimatedGas: 21_001n }));
  assert.equal(result.prepared.gasLimit, 25_202n); assert.ok(result.prepared.gasLimit < value.policy.gasLimitCap);
  assert.throws(() => createStandaloneNativeIntent({ testId: "offline-buffer", role: "treasury", amountWei: amount,
    policy: { ...value.policy, gasBufferBps: 1999n } }));
});
test("Treasury balance must cover value, full maximum transaction fee and the remaining operating reserve", () => {
  const value = intent(), maximumFee = 25_200n * NATIVE_FEES.maxFeePerGas;
  const required = amount + maximumFee + value.policy.operatingReserveWei;
  const exact = prepareStandaloneNative(value, NATIVE_FEES, nativeSnapshot({ treasuryBalanceWei: required }));
  assert.equal(exact.prepared.maximumFeeWei, maximumFee);
  assert.throws(() => prepareStandaloneNative(value, NATIVE_FEES, nativeSnapshot({ treasuryBalanceWei: required - 1n })));
});
test("standalone preparation fails closed for wrong network, account, pending nonce, code or simulation", () => {
  const value = intent();
  for (const patch of [{ chainId: 1n }, { senderAddress: value.recipientAddress }, { recipientAddress: value.senderAddress },
    { confirmedNonce: 0 }, { pendingNonce: 2 }, { senderCode: "0x00" }, { recipientCode: "0x00" },
    { simulationResult: "0x00" }, { estimatedGas: 20_999n }, { baseFeePerGas: 4001n }]) {
    assert.throws(() => prepareStandaloneNative(value, NATIVE_FEES, nativeSnapshot(patch)));
  }
});
test("approved protective gas, priority, maximum-price and total-fee caps remain enforced", () => {
  const value = intent();
  for (const [fees, snapshot] of [
    [{ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }, nativeSnapshot()],
    [{ maxFeePerGas: 1000n, maxPriorityFeePerGas: 1001n }, nativeSnapshot()],
    [{ maxFeePerGas: value.policy.maxFeePerGasCap + 1n, maxPriorityFeePerGas: 1n }, nativeSnapshot()],
    [NATIVE_FEES, nativeSnapshot({ estimatedGas: value.policy.gasLimitCap })],
  ] as const) assert.throws(() => prepareStandaloneNative(value, fees, snapshot));
  const tight = createStandaloneNativeIntent({ testId: "offline-total-cap", role: "treasury", amountWei: amount,
    policy: { ...value.policy, maxTotalFeeWei: 25_200n * NATIVE_FEES.maxFeePerGas - 1n } });
  assert.throws(() => prepareStandaloneNative(tight, NATIVE_FEES, nativeSnapshot()));
});
test("preflight changes cannot replace original intent, gas, value, nonce or unsigned transaction bytes", () => {
  const value = intent(), result = prepareStandaloneNative(value, NATIVE_FEES, nativeSnapshot());
  for (const patch of [{ amountWei: amount + 1n }, { value: amount + 1n }, { nonce: 2 }, { gasLimit: 25_201n },
    { unsignedHash: `0x${"00".repeat(32)}` }, { unsignedSerialized: "0x00" }, { data: "0x00" }]) {
    assert.throws(() => assertStandaloneNativePreflight({ ...result, prepared: { ...result.prepared, ...patch } } as typeof result, value.intentHash));
  }
  assert.throws(() => assertStandaloneNativePreflight(result, `0x${"00".repeat(32)}`));
});
test("standalone observation uses only native account reads and exact value simulation with no token ABI calls", async () => {
  const value = intent(), fixture = nativeObservationRpc(), result = await observeStandaloneNative(value, fixture.rpc);
  assert.equal(result.confirmedNonce, 1); assert.equal(result.chainId, 11155111n); assert.equal(result.estimatedGas, 21_000n);
  for (const method of ["eth_call", "eth_estimateGas"]) {
    const call = fixture.calls.find(item => item.method === method)!;
    assert.deepEqual(call.params[0], { from: value.senderAddress, to: value.recipientAddress, value: `0x${amount.toString(16)}`, data: "0x" });
  }
  assert.equal(fixture.calls.filter(call => call.method === "eth_call").length, 1);
  assert.equal(fixture.calls.some(call => JSON.stringify(call.params).includes("balanceOf")), false);
});
test("public RPC failures expose safe diagnostics and make no automatic retry", async () => {
  const fixture = nativeObservationRpc({}, "eth_chainId");
  await assert.rejects(observeStandaloneNative(intent(), fixture.rpc), error => error instanceof Error &&
    !error.message.includes("fixture-provider") && /read|RPC|network/i.test(error.message));
  assert.equal(fixture.calls.length, 1);
});
test("observation rejects a changed canonical block and an unexpected network", async () => {
  const value = intent(), original = nativeObservationRpc();
  await assert.rejects(observeStandaloneNative(value, { async request(method, params) {
    const result = await original.rpc.request(method, params);
    return method === "eth_getBlockByNumber" && params[0] !== "latest" ? { ...result as object, hash: `0x${"ff".repeat(32)}` } : result;
  } }));
  await assert.rejects(observeStandaloneNative(value, nativeObservationRpc({ chainId: 1n }).rpc));
});
test("fresh recheck preserves original unsigned bytes and rejects stale nonce, gas, fee or inventory observations", async () => {
  const value = intent(), original = prepareStandaloneNative(value, NATIVE_FEES, nativeSnapshot()), before = structuredClone(original);
  const fresh = await recheckStandaloneNative(original, nativeObservationRpc().rpc, value.intentHash);
  assert.equal(fresh.blockNumber, 101n); assert.deepEqual(original, before);
  for (const patch of [{ confirmedNonce: 2, pendingNonce: 2 }, { estimatedGas: 21_001n }, { baseFeePerGas: 4001n },
    { treasuryBalanceWei: 1n }, { blockNumber: 99n }, { blockNumber: 100n, blockHash: `0x${"ff".repeat(32)}` }]) {
    await assert.rejects(recheckStandaloneNative(original, nativeObservationRpc(patch).rpc, value.intentHash));
    assert.deepEqual(original, before);
  }
});
