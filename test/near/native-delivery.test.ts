import assert from "node:assert/strict";
import test from "node:test";
import { Transaction } from "ethers";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { buildUnsignedNativeTransfer } from "../../src/evm/native-transfer.js";
import {
  DEFAULT_NATIVE_DELIVERY_POLICY, assertNativeBalanceDeltas, assertNativeDelivery, nativeDeliveryFeeEstimate,
  observeNativeDelivery, prepareNativeDelivery, recheckNativeDelivery, verifyNativeDeliveryReceipt,
  verifyNativeTransferReceipt, type NativeDeliverySnapshot,
} from "../../src/evm/sepolia-native.js";
import { nativeFixturePrepared, nativeFixtureSigned } from "./fixtures/native-algebraic.js";
import {
  NATIVE_FEES, nativeObservationRpc, nativePreflight, nativeReceiptRpc, nativeSnapshot, nativeTerms,
} from "./fixtures/native-delivery.js";

// Every test uses synthetic, explicitly labelled fixture data and mock public RPCs.
// None requests a signature, reads credentials or invokes an EVM send method.
test("native allocation intents support 1, 5, 10, 20 and 100 USDC using exact quote-sized wei", () => {
  for (const amount of ["1", "5", "10", "20", "100"]) {
    const value = nativePreflight(amount), tx = Transaction.from(value.prepared.unsignedSerialized);
    assert.equal(value.role, "treasury");
    assert.equal(value.prepared.senderAddress, VERIFIED_IDENTITIES.treasury.evmAddress);
    assert.equal(tx.to, VERIFIED_IDENTITIES.investor.evmAddress);
    assert.equal(tx.chainId, 11155111n);
    assert.equal(tx.value, BigInt(amount) * 200_000_000_000_000n);
    assert.equal(tx.value, value.terms.quantities.ethWei);
    assert.equal(tx.data, "0x");
    assert.equal(tx.type, 2);
    assert.equal(tx.signature, null);
    assertNativeDelivery(value, value.terms.termsHash);
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.snapshot));
    assert.ok(Object.isFrozen(value.policy));
  }
});

test("native gas limits use rounded-up 20% estimates rather than a fixed 21000 gas limit", () => {
  const value = nativePreflight("10", { estimatedGas: 21_001n });
  assert.equal(value.prepared.gasLimit, 25_202n);
  assert.equal(value.prepared.maximumFeeWei, 126_010_000n);
  assert.equal(value.snapshot.estimatedGas, 21_001n);
  assert.equal(nativePreflight("10", { estimatedGas: 25_000n }).prepared.gasLimit, 30_000n);
});

test("native delivery preserves exact value plus maximum transaction fee plus positive operating reserve", () => {
  const initial = nativePreflight();
  const required = initial.prepared.amountWei + initial.prepared.maximumFeeWei + initial.policy.operatingReserveWei;
  const exact = nativePreflight("10", { treasuryBalanceWei: required });
  assert.equal(exact.snapshot.treasuryBalanceWei, required);
  assert.throws(() => nativePreflight("10", { treasuryBalanceWei: required - 1n }), /reserve/);
  assert.throws(() => nativePreflight("10", { treasuryBalanceWei: initial.prepared.amountWei }), /reserve/);
  assert.equal(initial.policy.operatingReserveWei, 1_000_000_000_000_000n);
});

test("native snapshots reject wrong network, wrong roles, contracts, pending nonce and failed simulation", () => {
  const invalid: Partial<NativeDeliverySnapshot>[] = [
    { chainId: 1n }, { chainId: 11155111 as unknown as bigint },
    { senderAddress: VERIFIED_IDENTITIES.investor.evmAddress }, { recipientAddress: VERIFIED_IDENTITIES.treasury.evmAddress },
    { senderCode: "0x6000" }, { recipientCode: "0xef0100" },
    { confirmedNonce: 0, pendingNonce: 1 }, { confirmedNonce: -1 }, { pendingNonce: 0.5 },
    { estimatedGas: 0n }, { simulationResult: "0x01" }, { blockNumber: 0n }, { blockHash: "invalid" },
    { treasuryBalanceWei: -1n }, { investorBalanceWei: -1n }, { baseFeePerGas: 4001n },
  ];
  for (const overrides of invalid) assert.throws(() => nativePreflight("10", overrides));
});

test("native gas and fee policies cannot weaken 20% buffering or exceed approved protective limits", () => {
  const terms = nativeTerms();
  for (const limits of [
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, gasBufferBps: 1999n },
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, gasBufferBps: 0n },
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, gasBufferBps: 10001n },
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, operatingReserveWei: 0n },
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, operatingReserveWei: -1n },
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, gasLimitCap: 25_199n },
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, maxFeePerGasCap: 4999n },
    { ...DEFAULT_NATIVE_DELIVERY_POLICY, maxTotalFeeWei: 125_999_999n },
  ]) assert.throws(() => prepareNativeDelivery(terms, terms.termsHash, NATIVE_FEES, nativeSnapshot(), limits));
  const value = prepareNativeDelivery(terms, terms.termsHash, NATIVE_FEES, nativeSnapshot(), { ...DEFAULT_NATIVE_DELIVERY_POLICY, gasBufferBps: 2500n });
  assert.equal(value.prepared.gasLimit, 26_250n);
});

test("native preflight integrity rejects changed quote, value, recipient, nonce, bytes and trusted policy", () => {
  const value = nativePreflight(), termsHash = value.terms.termsHash;
  assert.throws(() => assertNativeDelivery(value, nativeTerms("5").termsHash));
  for (const missing of [undefined, null, "", "not-a-hash", 123]) {
    assert.throws(() => prepareNativeDelivery(value.terms, missing as string, NATIVE_FEES, nativeSnapshot()));
    assert.throws(() => assertNativeDelivery(value, missing as string));
  }
  const changedAmount = buildUnsignedNativeTransfer({ ...value.prepared, amountWei: value.prepared.amountWei + 1n, value: value.prepared.value + 1n } as typeof value.prepared);
  const changedRecipient = buildUnsignedNativeTransfer({ ...value.prepared, recipientAddress: "0x2222222222222222222222222222222222222222" });
  const changedNonce = buildUnsignedNativeTransfer({ ...value.prepared, nonce: value.prepared.nonce + 1 });
  for (const changed of [
    { ...value, prepared: changedAmount }, { ...value, prepared: changedRecipient }, { ...value, prepared: changedNonce },
    { ...value, prepared: { ...value.prepared, data: "0x01" } },
    { ...value, prepared: { ...value.prepared, unsignedHash: `0x${"00".repeat(32)}` } },
    { ...value, prepared: { ...value.prepared, unsignedSerialized: "0x02" } },
    { ...value, policy: { ...value.policy, operatingReserveWei: value.policy.operatingReserveWei - 1n } },
    { ...value, approvedTermsHash: nativeTerms("5").termsHash },
  ]) assert.throws(() => assertNativeDelivery(changed as typeof value, termsHash));
});

test("native observation uses only pinned public reads and exact value/calldata without mutation capabilities", async () => {
  const terms = nativeTerms(), fixture = nativeObservationRpc();
  const observed = await observeNativeDelivery(terms, terms.termsHash, fixture.rpc);
  assert.equal(observed.blockNumber, 101n);
  assert.equal(observed.confirmedNonce, 1);
  assert.equal(observed.pendingNonce, 1);
  for (const call of fixture.calls.filter(value => ["eth_call", "eth_estimateGas"].includes(value.method))) {
    assert.deepEqual(call.params[0], { from: VERIFIED_IDENTITIES.treasury.evmAddress, to: VERIFIED_IDENTITIES.investor.evmAddress,
      value: `0x${terms.quantities.ethWei.toString(16)}`, data: "0x" });
    assert.equal(call.params[1], "0x65");
  }
  assert.equal(fixture.calls.some(value => String(value.method).includes("send")), false);
});

test("native rechecks retain the complete gas buffer and reject nonce, balance, fee and block drift without rebuilding", async () => {
  const value = nativePreflight(), originalBytes = value.prepared.unsignedSerialized, originalHash = value.prepared.unsignedHash;
  for (const estimatedGas of [21_000n]) {
    const fixture = nativeObservationRpc({ estimatedGas });
    assert.equal((await recheckNativeDelivery(value, fixture.rpc, value.terms.termsHash)).estimatedGas, estimatedGas);
  }
  for (const overrides of [
    { estimatedGas: 21_001n }, { estimatedGas: 25_000n }, { confirmedNonce: 2, pendingNonce: 2 },
    { pendingNonce: 2 }, { treasuryBalanceWei: value.prepared.amountWei }, { baseFeePerGas: 4001n },
    { blockNumber: 99n }, { blockNumber: 100n, blockHash: `0x${"99".repeat(32)}` },
    { estimatedGas: 20_999n }, { senderCode: "0x6000" }, { simulationResult: "0x01" },
  ]) {
    const fixture = nativeObservationRpc(overrides);
    await assert.rejects(() => recheckNativeDelivery(value, fixture.rpc, value.terms.termsHash));
  }
  assert.equal(value.prepared.unsignedSerialized, originalBytes);
  assert.equal(value.prepared.unsignedHash, originalHash);
});

test("native public reads fail closed on a changed canonical observation block", async () => {
  const fixture = nativeObservationRpc(), request = fixture.rpc.request.bind(fixture.rpc), terms = nativeTerms();
  fixture.rpc.request = async (method, params) => method === "eth_getBlockByNumber" && params[0] === "0x65"
    ? { number: "0x65", hash: `0x${"99".repeat(32)}` } : request(method, params);
  await assert.rejects(() => observeNativeDelivery(terms, terms.termsHash, fixture.rpc), /block changed/);
});

test("native RPC failures identify the operation without retrying or leaking provider details", async () => {
  const terms = nativeTerms(), fixture = nativeObservationRpc({}, "eth_estimateGas");
  await assert.rejects(() => observeNativeDelivery(terms, terms.termsHash, fixture.rpc), error => {
    assert.match((error as Error).message, /eth_estimateGas/);
    assert.doesNotMatch((error as Error).message, /fixture-provider/);
    return true;
  });
  assert.equal(fixture.calls.filter(value => value.method === "eth_estimateGas").length, 1);
});

test("native expected-fee observations match Task03B interfaces without treating fee caps as expected costs", () => {
  const value = nativePreflight();
  const observation = nativeDeliveryFeeEstimate(value, value.terms.termsHash, { assumedBaseFeePerGasWei: 1000n, assumedPriorityFeePerGasWei: 1000n });
  assert.equal(observation.leg, "treasury-eth-delivery");
  assert.equal(observation.payer, "treasury");
  assert.equal(observation.estimatedGas, 21_000n);
  assert.equal(observation.gasBufferBps, 2000n);
  assert.equal(observation.maxFeePerGasWei, 5000n);
  assert.equal(observation.assumedBaseFeePerGasWei + observation.assumedPriorityFeePerGasWei, 2000n);
  for (const assumptions of [
    { assumedBaseFeePerGasWei: 999n, assumedPriorityFeePerGasWei: 1000n },
    { assumedBaseFeePerGasWei: 1000n, assumedPriorityFeePerGasWei: 999n },
    { assumedBaseFeePerGasWei: 4001n, assumedPriorityFeePerGasWei: 1000n },
  ]) assert.throws(() => nativeDeliveryFeeEstimate(value, value.terms.termsHash, assumptions));
});

test("native balance delta validation preserves prior Investor ETH and accounts separately for actual Treasury gas", () => {
  const amount = 2_000_000_000_000_000n, fee = 42_000_000n;
  const before = { treasuryEth: 50_000_000_000_000_000n, investorEth: 49_000_000_000_000_000n };
  const after = { treasuryEth: before.treasuryEth - amount - fee, investorEth: before.investorEth + amount };
  assert.deepEqual(assertNativeBalanceDeltas(amount, fee, before, after), { treasury: -(amount + fee), investor: amount });
  assert.throws(() => assertNativeBalanceDeltas(amount, fee, before, { ...after, investorEth: amount }));
  assert.throws(() => assertNativeBalanceDeltas(amount, fee, before, { ...after, treasuryEth: before.treasuryEth - amount }));
});

test("synthetic native receipt validates exact signed bytes, canonical value delivery and receipt-derived gas cost", async () => {
  const prepared = nativeFixturePrepared(), signed = nativeFixtureSigned(), fixture = nativeReceiptRpc(prepared, signed);
  const result = await verifyNativeTransferReceipt(prepared, signed, fixture.rpc, 100n);
  assert.equal(result.transactionHash, signed.hash);
  assert.equal(result.confirmations, 2n);
  assert.equal(result.gasUsed, 21_000n);
  assert.equal(result.effectiveGasPriceWei, 2000n);
  assert.equal(result.actualFeeWei, 42_000_000n);
  assert.equal(result.nativeDeltas.investor, prepared.amountWei);
  assert.equal(result.after.investorEth, result.before.investorEth + prepared.amountWei);
  assert.equal(result.after.treasuryEth, result.before.treasuryEth - prepared.amountWei - result.actualFeeWei);
  assert.deepEqual(result.feeObservation, { leg: "treasury-eth-delivery", payer: "treasury", transactionHash: signed.hash,
    executionStatus: "success", gasUsed: 21_000n, effectiveGasPriceWei: 2000n });
  assert.equal(fixture.calls.some(value => String(value.method).includes("send")), false);
});

test("native receipt rejects wrong chain/value/sender/recipient/calldata/nonce/fees and signature fields", async () => {
  const prepared = nativeFixturePrepared(), signed = nativeFixtureSigned();
  for (const raw of [
    { chainId: "0x1" }, { value: "0x1" }, { from: VERIFIED_IDENTITIES.treasury.evmAddress },
    { to: VERIFIED_IDENTITIES.investor.evmAddress }, { input: "0x01" }, { nonce: "0x2" },
    { gas: "0x6271" }, { maxFeePerGas: "0x1389" }, { maxPriorityFeePerGas: "0x3e9" },
    { r: "0x0" }, { s: "0x0" }, { v: "0x2" }, { accessList: [{ address: prepared.recipientAddress, storageKeys: [] }] },
  ]) {
    const fixture = nativeReceiptRpc(prepared, signed, { raw });
    await assert.rejects(() => verifyNativeTransferReceipt(prepared, signed, fixture.rpc, 100n));
  }
});

test("native receipt rejects failed/noncanonical/premature execution, excessive gas and inconsistent fee accounting", async () => {
  const prepared = nativeFixturePrepared(), signed = nativeFixtureSigned();
  for (const overrides of [
    { receipt: { status: "0x0" } }, { receipt: { gasUsed: "0x0" } }, { receipt: { gasUsed: "0x5207" } }, { receipt: { gasUsed: "0x6271" } },
    { receipt: { effectiveGasPrice: "0x1389" } }, { receipt: { effectiveGasPrice: "0x7cf" } },
    { receipt: { blockHash: `0x${"99".repeat(32)}` } }, { head: 102n },
    { block: { parentHash: `0x${"99".repeat(32)}` } }, { block: { baseFeePerGas: "0x1389" } },
    { reorg: true }, { code: "0x6000" },
  ]) {
    const fixture = nativeReceiptRpc(prepared, signed, overrides);
    await assert.rejects(() => verifyNativeTransferReceipt(prepared, signed, fixture.rpc, 100n));
  }
  await assert.rejects(() => verifyNativeTransferReceipt(prepared, signed, nativeReceiptRpc(prepared, signed).rpc, 102n));
});

test("missing native receipt and ambiguous same-block balances require reconciliation without another send", async () => {
  const prepared = nativeFixturePrepared(), signed = nativeFixtureSigned();
  for (const overrides of [
    { missingTransaction: true }, { missingReceipt: true },
    { afterInvestor: 1n }, { afterTreasury: 1n },
  ]) {
    const fixture = nativeReceiptRpc(prepared, signed, overrides);
    await assert.rejects(() => verifyNativeTransferReceipt(prepared, signed, fixture.rpc, 100n));
    assert.equal(fixture.calls.some(value => String(value.method).includes("send")), false);
  }
});

test("native receipt read uncertainty is sanitized, single attempt and cannot mutate the original signed bytes", async () => {
  const prepared = nativeFixturePrepared(), signed = nativeFixtureSigned(), bytes = signed.serialized;
  const fixture = nativeReceiptRpc(prepared, signed, { failMethod: "eth_getTransactionReceipt" });
  await assert.rejects(() => verifyNativeTransferReceipt(prepared, signed, fixture.rpc, 100n), error => {
    assert.match((error as Error).message, /eth_getTransactionReceipt/);
    assert.doesNotMatch((error as Error).message, /synthetic private provider/);
    return true;
  });
  assert.equal(fixture.calls.filter(value => value.method === "eth_getTransactionReceipt").length, 1);
  assert.equal(signed.serialized, bytes);
});

test("synthetic receipt fixtures cannot masquerade as the real Treasury authority or approved purchase intent", async () => {
  const value = nativePreflight(), signed = nativeFixtureSigned(), fixture = nativeReceiptRpc(nativeFixturePrepared(), signed);
  await assert.rejects(() => verifyNativeDeliveryReceipt(value, signed, fixture.rpc, value.terms.termsHash), /authority|mismatch/);
  assert.equal(fixture.calls.length, 0);
});
