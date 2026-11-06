import assert from "node:assert/strict";
import test from "node:test";
import { Transaction } from "ethers";
import { assertErc20SignedBytes, assertPreparedPurchaseLeg, assertPurchaseLegSigned, observePurchaseErc20Leg, preparePurchaseLeg,
  recheckPurchaseLeg, verifyErc20TransferReceipt, verifyMinedPurchaseLeg, type PreparedPurchaseErc20Leg } from "../../src/purchase/legs.js";
import { paymentClaimId } from "../../src/purchase/claims.js";
import { SEPOLIA_ASSETS } from "../../src/purchase/config.js";
import { createPurchaseQuote } from "../../src/purchase/quote.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { normalizeMpcOutcome } from "../../src/near/signing.js";
import { assembleSignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { AT, costs, fixtureQuote, prices } from "./fixtures/purchase-quote.js";
import { RECORDED_NEAR_HASH, recordedOutcome, recordedState } from "./fixtures/recorded-mpc.js";
import { FEES, IMPLEMENTATION_PIN, TOKEN_CODE, abi, algebraicErc20Fixture, purchaseObservationRpc, purchaseReceiptRpc,
  type ObservationOptions, type ReceiptOptions } from "./fixtures/purchase-legs.js";

function lowFeeQuote(amount: string) {
  const p = prices(), observation = costs(p, amount);
  return createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "offline", createdAt: AT, prices: p,
    investmentUsdcBaseUnits: BigInt(amount) * 1_000_000n, costs: { ...observation, evm: observation.evm.map(leg => ({ ...leg,
      observedBaseFeePerGasWei: 1000n, assumedBaseFeePerGasWei: 1000n, maxFeePerGasWei: 5000n, maxPriorityFeePerGasWei: 1000n })) } });
}

test("purchase leg preparation uses immutable configurable USDC, LINK and native quantities and distinct roles", async () => {
  for (const amount of ["1", "5", "10", "20", "100"]) {
    const quote = lowFeeQuote(amount);
    for (const leg of ["usdc-payment", "link-delivery", "eth-delivery"] as const) {
      const observations = purchaseObservationRpc(leg), value = await preparePurchaseLeg(quote, quote.quoteHash, leg, FEES, observations.rpc);
      const tx = Transaction.from(value.prepared.unsignedSerialized);
      assertPreparedPurchaseLeg(value, quote, quote.quoteHash);
      assert.equal(value.role, leg === "usdc-payment" ? "investor" : "treasury");
      assert.equal(value.prepared.senderAddress, VERIFIED_IDENTITIES[value.role].evmAddress);
      assert.equal(tx.chainId, 11155111n); assert.equal(tx.signature, null);
      assert.equal(value.prepared.gasLimit, leg === "eth-delivery" ? 25_200n : leg === "usdc-payment" ? 60_000n : 72_000n);
      if (leg === "eth-delivery") { assert.equal(tx.value, quote.terms.quantities.ethWei); assert.equal(tx.data, "0x"); }
      else { const transfer = abi.decodeFunctionData("transfer", tx.data);
        assert.equal(transfer[1], leg === "usdc-payment" ? quote.terms.investmentUsdcBaseUnits : quote.terms.quantities.linkBaseUnits);
        assert.equal(tx.value, 0n); }
      assert.ok(observations.calls.every(call => !/send|broadcast|sign/i.test(call.method)));
      assert.ok(Object.isFrozen(value));
    }
  }
});
test("USDC requires a reviewed implementation pin before reading, and pins pause/blacklist/code/decimals", async () => {
  const quote = fixtureQuote(), missing = purchaseObservationRpc("usdc-payment");
  await assert.rejects(preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", { maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n }, missing.rpc), /reviewed implementation/);
  assert.equal(missing.calls.length, 0);
  for (const options of [{ paused: true }, { blacklisted: true }, { code: "0x6000" }, { decimals: 18n },
    { implementationCode: "0x6001" }, { implementationAddress: "0x4444444444444444444444444444444444444444" }] as ObservationOptions[]) {
    await assert.rejects(preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, purchaseObservationRpc("usdc-payment", options).rpc));
  }
});
test("read-only observers pin all account and token state to a canonical block", async () => {
  const quote = fixtureQuote(), fixture = purchaseObservationRpc("usdc-payment");
  const observed = await observePurchaseErc20Leg(quote, quote.quoteHash, "usdc-payment", fixture.rpc, IMPLEMENTATION_PIN);
  assert.equal(observed.tokenCode, TOKEN_CODE.USDC); assert.equal(observed.tokenDecimals, 6);
  assert.deepEqual(observed.usdcImplementation, IMPLEMENTATION_PIN);
  assert.equal(observed.confirmedNonce, observed.pendingNonce);
  assert.ok(fixture.calls.filter(c => ["eth_call", "eth_getCode", "eth_getBalance"].includes(c.method)).every(c => c.params[1] === "0x64"));
  await assert.rejects(preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, purchaseObservationRpc("usdc-payment", { reorg: true }).rpc), /block changed/);
});
test("preflight rejects network, nonce, simulation, asset inventory and gas funding failures", async () => {
  const quote = fixtureQuote();
  for (const options of [{ chain: 1n }, { pendingNonce: 1n }, { simulation: false }, { senderBalance: 0n }, { nativeBalance: 1n },
    { gas: 180_001n }, { baseFee: 5000n }] as ObservationOptions[]) {
    await assert.rejects(preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, purchaseObservationRpc("usdc-payment", options).rpc));
  }
  const requiredValue = quote.terms.quantities.ethWei;
  await assert.rejects(preparePurchaseLeg(quote, quote.quoteHash, "link-delivery", FEES,
    purchaseObservationRpc("link-delivery", { nativeBalance: requiredValue }).rpc), /preserve native delivery/);
});
test("fresh Treasury native preparation obtains the post-LINK nonce rather than reusing LINK nonce", async () => {
  const quote = fixtureQuote();
  const link = await preparePurchaseLeg(quote, quote.quoteHash, "link-delivery", FEES, purchaseObservationRpc("link-delivery", { confirmedNonce: 1n }).rpc);
  const eth = await preparePurchaseLeg(quote, quote.quoteHash, "eth-delivery", FEES, purchaseObservationRpc("eth-delivery", { confirmedNonce: 2n }).rpc);
  assert.equal(link.prepared.nonce, 1); assert.equal(eth.prepared.nonce, 2);
  await assert.rejects(recheckPurchaseLeg(eth, quote, quote.quoteHash, purchaseObservationRpc("eth-delivery", { confirmedNonce: 3n }).rpc), /nonce/);
});
test("prepared leg integrity rejects altered purchase, role, token, allocation, digest and fee fields", async () => {
  const quote = fixtureQuote(), value = await preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, purchaseObservationRpc("usdc-payment").rpc);
  for (const change of [{ purchaseId: "other" }, { quoteHash: `0x${"00".repeat(32)}` }, { role: "treasury" }, { leg: "link-delivery" },
    { prepared: { ...value.prepared, nonce: 1 } }, { prepared: { ...value.prepared, unsignedHash: `0x${"00".repeat(32)}` } }]) {
    assert.throws(() => assertPreparedPurchaseLeg({ ...value, ...change } as typeof value, quote, quote.quoteHash));
  }
  await assert.rejects(preparePurchaseLeg(quote, `0x${"00".repeat(32)}`, "usdc-payment", FEES, purchaseObservationRpc("usdc-payment").rpc));
  await assert.rejects(preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", { ...FEES, maxFeePerGas: 31_000_000_000n }, purchaseObservationRpc("usdc-payment").rpc));
});
test("recheck keeps exact bytes and rejects changed nonce, gas, fees, token implementation and older observations", async () => {
  const quote = fixtureQuote(), value = await preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, purchaseObservationRpc("usdc-payment").rpc);
  const digest = value.prepared.unsignedHash;
  await recheckPurchaseLeg(value, quote, quote.quoteHash, purchaseObservationRpc("usdc-payment").rpc);
  assert.equal(value.prepared.unsignedHash, digest);
  for (const options of [{ confirmedNonce: 1n }, { gas: 50_001n }, { baseFee: 5000n }, { implementationCode: "0x6001" },
    { blockNumber: 99n }] as ObservationOptions[]) await assert.rejects(recheckPurchaseLeg(value, quote, quote.quoteHash, purchaseObservationRpc("usdc-payment", options).rpc));
});
test("RPC errors suppress provider details, fail closed and never retry", async () => {
  const quote = fixtureQuote(), fixture = purchaseObservationRpc("usdc-payment", { failMethod: "eth_chainId" });
  await assert.rejects(preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, fixture.rpc), error =>
    error instanceof Error && /eth_chainId/.test(error.message) && !/sensitive/.test(error.message));
  assert.equal(fixture.calls.length, 1);
});
test("public algebraic ERC-20 fixtures verify full public keys without private keys, signing or live execution", () => {
  const fixture = algebraicErc20Fixture();
  assertErc20SignedBytes(fixture.prepared, fixture.signed, fixture.publicKey);
  for (const changes of [{ hash: `0x${"00".repeat(32)}` }, { senderAddress: VERIFIED_IDENTITIES.investor.evmAddress }, { serialized: "0x02" }]) {
    assert.throws(() => assertErc20SignedBytes(fixture.prepared, { ...fixture.signed, ...changes }, fixture.publicKey));
  }
  assert.throws(() => assertErc20SignedBytes(fixture.prepared, fixture.signed, `0x${"01".repeat(32)}`), /public SEC1/);
  assert.throws(() => assertErc20SignedBytes({ ...fixture.prepared, amount: fixture.prepared.amount + 1n }, fixture.signed, fixture.publicKey));
});
test("finalized USDC receipt yields exact payment identity, movements and actual Ethereum gas cost", async () => {
  const fixture = algebraicErc20Fixture(), rpc = purchaseReceiptRpc(fixture.prepared, fixture.signed);
  const result = await verifyErc20TransferReceipt(fixture.prepared, fixture.signed, rpc.rpc, fixture.context);
  assert.equal(result.status, "confirmed"); assert.ok(result.status === "confirmed");
  const proof = result.proof; assert.equal(proof.finality, "finalized");
  assert.equal(paymentClaimId(proof.paymentClaim!), `11155111:${fixture.signed.hash}:2`);
  assert.deepEqual(proof.tokenDeltas, { sender: -10_000_000n, recipient: 10_000_000n });
  assert.equal(proof.actualFeeWei, rpc.fee); assert.equal(proof.feeObservation.leg, "investor-usdc-payment");
  assert.equal(proof.feeObservation.payer, "investor"); assert.equal(proof.before.recipientEth, proof.after.recipientEth);
  assert.ok(proof.publicObservations.some(o => o.method === "eth_getBlockByNumber" && o.params[0] === "finalized"));
  assert.ok(proof.publicObservations.some(o => o.method === "eth_getTransactionByHash" && o.result !== null));
});
test("USDC receipt observed before finalized head preserves evidence without claiming payment", async () => {
  const fixture = algebraicErc20Fixture();
  const result = await verifyErc20TransferReceipt(fixture.prepared, fixture.signed, purchaseReceiptRpc(fixture.prepared, fixture.signed, { finalized: 101n }).rpc, fixture.context);
  assert.equal(result.status, "awaiting-finality"); assert.ok(result.status === "awaiting-finality");
  assert.equal(result.proof.paymentClaim, undefined); assert.equal(result.proof.finality, "awaiting-finality");
});
test("LINK delivery requires two confirmations and never creates a payment claim", async () => {
  const fixture = algebraicErc20Fixture("link-delivery");
  const pending = await verifyErc20TransferReceipt(fixture.prepared, fixture.signed, purchaseReceiptRpc(fixture.prepared, fixture.signed, { head: 102n }).rpc, fixture.context);
  assert.equal(pending.status, "awaiting-finality");
  const confirmed = await verifyErc20TransferReceipt(fixture.prepared, fixture.signed, purchaseReceiptRpc(fixture.prepared, fixture.signed).rpc, fixture.context);
  assert.equal(confirmed.status, "confirmed"); assert.ok(confirmed.status === "confirmed");
  assert.equal(confirmed.proof.paymentClaim, undefined); assert.equal(confirmed.proof.finality, "two-confirmations");
});
test("a missing receipt is not a failed payment and invokes only read methods", async () => {
  const fixture = algebraicErc20Fixture(), rpc = purchaseReceiptRpc(fixture.prepared, fixture.signed, { missingReceipt: true });
  const result = await verifyErc20TransferReceipt(fixture.prepared, fixture.signed, rpc.rpc, fixture.context);
  assert.equal(result.status, "not-mined"); assert.ok(rpc.calls.every(c => !/send|sign|broadcast/i.test(c.method)));
});
test("mismatched mined fields, signatures, receipt identity and effective fee fail closed", async () => {
  const fixture = algebraicErc20Fixture();
  for (const options of [{ raw: { nonce: "0x1" } }, { raw: { to: SEPOLIA_ASSETS.LINK.address } }, { raw: { value: "0x1" } },
    { raw: { input: "0x" } }, { raw: { maxFeePerGas: "0x1" } }, { raw: { v: "0x1" } }, { raw: { s: "0x02" } },
    { raw: { from: VERIFIED_IDENTITIES.investor.evmAddress } }, { receipt: { effectiveGasPrice: "0x1" } }, { receipt: { gasUsed: "0xf0000" } },
    { receipt: { transactionHash: `0x${"00".repeat(32)}` } }, { missingTransaction: true }, { code: "0x6000" }] as ReceiptOptions[]) {
    await assert.rejects(verifyErc20TransferReceipt(fixture.prepared, fixture.signed, purchaseReceiptRpc(fixture.prepared, fixture.signed, options).rpc, fixture.context));
  }
});
test("payment proof rejects reorgs, concurrent movements, wrong event amount/index and ambiguous gas deltas", async () => {
  const fixture = algebraicErc20Fixture(), baseline = purchaseReceiptRpc(fixture.prepared, fixture.signed);
  const wrongAmount = { ...baseline.log, ...abi.encodeEventLog(abi.getEvent("Transfer")!, [fixture.prepared.senderAddress, fixture.prepared.recipientAddress, 1n]) };
  for (const options of [{ reorg: true }, { senderTokenDelta: -1n }, { recipientTokenDelta: 1n }, { senderEthDelta: -1n }, { recipientEthDelta: 1n },
    { logs: [] }, { logs: [wrongAmount] }, { logs: [baseline.log, { ...baseline.log, logIndex: "0x3" }] },
    { receiptLogs: [{ ...baseline.log, logIndex: "0x3" }] }, { logs: [{ ...baseline.log, removed: true }] },
    { block: { parentHash: `0x${"00".repeat(32)}` } }, { implementationCode: "0x6001" }] as ReceiptOptions[]) {
    await assert.rejects(verifyErc20TransferReceipt(fixture.prepared, fixture.signed, purchaseReceiptRpc(fixture.prepared, fixture.signed, options).rpc, fixture.context));
  }
});
test("canonical failed transactions preserve actual gas evidence without claiming or asserting asset delivery", async () => {
  for (const leg of ["usdc-payment", "link-delivery"] as const) {
    const fixture = algebraicErc20Fixture(leg), rpc = purchaseReceiptRpc(fixture.prepared, fixture.signed, { receipt: { status: "0x0", logs: [] } });
    const result = await verifyErc20TransferReceipt(fixture.prepared, fixture.signed, rpc.rpc, fixture.context);
    assert.equal(result.status, "failed"); assert.ok(result.status === "failed");
    assert.equal(result.proof.feeObservation.executionStatus, "failed"); assert.equal(result.proof.actualFeeWei, rpc.fee);
    assert.equal("paymentClaim" in result.proof, false); assert.equal("tokenDeltas" in result.proof, false);
  }
});
test("real-role wrappers reject algebraic signatures even when the generic receipt fixture is valid", async () => {
  const fixture = algebraicErc20Fixture(), quote = fixtureQuote();
  const value = await preparePurchaseLeg(quote, quote.quoteHash, "usdc-payment", FEES, purchaseObservationRpc("usdc-payment").rpc);
  assert.throws(() => assertPurchaseLegSigned(value, quote, quote.quoteHash, fixture.signed));
  await assert.rejects(verifyMinedPurchaseLeg(value, quote, quote.quoteHash, fixture.signed, purchaseReceiptRpc(fixture.prepared, fixture.signed).rpc));
});
test("authentic recorded Treasury signature passes full trusted-key purchase binding for exact one-LINK intent", async () => {
  const state = recordedState(), prepared = state.preflight.prepared;
  const signature = normalizeMpcOutcome(recordedOutcome(), "treasury", RECORDED_NEAR_HASH, prepared.unsignedHash);
  const signed = assembleSignedErc20Transfer(prepared, signature, prepared.senderAddress), quote = fixtureQuote("20");
  // The historical signed payload predates purchase coordination. This fixture only
  // tests identical mathematical intent/key binding, never claims it paid this quote.
  const snapshot = { ...state.preflight.snapshot, confirmedNonce: prepared.nonce, tokenDecimals: 18, senderCode: "0x", recipientCode: "0x",
    recipientTokenBalance: 0n, recipientNativeBalance: 50_000_000_000_000_000n,
    simulationResult: abi.encodeFunctionResult("transfer", [true]), blockNumber: state.preflight.blockNumber, blockHash: state.preflight.blockHash };
  const { buildErc20AssetTransfer, createErc20AssetIntent } = await import("../../src/evm/asset-intent.js");
  const asset = buildErc20AssetTransfer(createErc20AssetIntent(quote.terms, "link-delivery", quote.terms.termsHash), quote.terms,
    { nonce: prepared.nonce, estimatedGas: snapshot.estimatedGas, maxFeePerGas: prepared.maxFeePerGas, maxPriorityFeePerGas: prepared.maxPriorityFeePerGas }, quote.policy.execution);
  assert.equal(asset.prepared.unsignedHash, prepared.unsignedHash);
  const value: PreparedPurchaseErc20Leg = { kind: "prepared-purchase-leg", purchaseId: quote.purchaseId, quoteHash: quote.quoteHash, leg: "link-delivery", role: "treasury",
    preflight: asset, prepared: asset.prepared, snapshot, referenceBlockNumber: snapshot.blockNumber, referenceBlockHash: snapshot.blockHash };
  assertPurchaseLegSigned(value, quote, quote.quoteHash, signed);
  assert.throws(() => assertPurchaseLegSigned(value, fixtureQuote("10"), quote.quoteHash, signed));
});
