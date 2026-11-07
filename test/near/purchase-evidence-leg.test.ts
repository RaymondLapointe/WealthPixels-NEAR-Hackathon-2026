import assert from "node:assert/strict";
import test from "node:test";
import { Transaction } from "ethers";
import { PurchaseEvidenceLegError, assertPublicNativeReceiptAvailability, reconstructPublicPurchaseTransaction, verifyPublicPurchaseLeg } from "../../src/evidence/purchase-leg.js";
import { assertErc20SignedBytes, verifyErc20TransferReceipt } from "../../src/purchase/legs.js";
import { assertSignedNativeTransfer } from "../../src/evm/native-transfer.js";
import { verifyNativeTransferReceipt } from "../../src/evm/sepolia-native.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { SEPOLIA_ASSETS } from "../../src/purchase/config.js";
import { RECORDED_EVM_HASH, RECORDED_NEAR_HASH, RECORDED_UNSIGNED_HASH } from "./fixtures/recorded-mpc.js";
import { nativeReceiptRpc } from "./fixtures/native-delivery.js";
import { IMPLEMENTATION_PIN, purchaseReceiptRpc, type ReceiptOptions } from "./fixtures/purchase-legs.js";
import { algebraicQuotedTransaction, authenticPublicLegFixture, publicLegQuote } from "./fixtures/purchase-evidence-leg.js";

test("public reconstruction accepts the authentic Treasury LINK signature without any local preflight or saved bytes", () => {
  const f = authenticPublicLegFixture();
  const transaction = reconstructPublicPurchaseTransaction(f.quote, "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw);
  assert.deepEqual(transaction.prepared, f.prepared); assert.deepEqual(transaction.signed, f.signed);
  assert.equal(transaction.signed.senderAddress, VERIFIED_IDENTITIES.treasury.evmAddress);
  assert.equal("snapshot" in transaction, false); assert.equal("preflight" in transaction, false);
  assert.ok(Object.isFrozen(transaction));
  const signature = JSON.parse(Buffer.from(f.outcome.status.SuccessValue, "base64").toString("utf8"));
  assert.equal(signature.big_r.affine_point.slice(0, 2), "03"); assert.equal(signature.recovery_id, 0);
});

test("reconstruction rejects altered network, role, token, calldata, amount, recipient, nonce and access list", () => {
  const f = authenticPublicLegFixture();
  for (const change of [{ type: "0x0" }, { chainId: "0x1" }, { from: VERIFIED_IDENTITIES.investor.evmAddress },
    { to: SEPOLIA_ASSETS.USDC.address }, { value: "0x1" }, { input: "0x" }, { nonce: "0x1" },
    { nonce: "0x20000000000000" }, { accessList: [{ address: f.prepared.tokenAddress, storageKeys: [] }] },
    { input: f.raw.input + "00" }]) {
    assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, { ...f.raw, ...change }));
  }
  assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "usdc-payment", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw));
  assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "eth-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw));
  assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "unsupported" as any, RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw));
});

test("original quoted EIP1559 fees and protective caps cannot be changed during public reconstruction", () => {
  const f = authenticPublicLegFixture();
  for (const change of [{ gas: "0x2bf21" }, { gas: "0x1" }, { maxFeePerGas: "0x1388" }, { maxPriorityFeePerGas: "0x1" }]) {
    assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, { ...f.raw, ...change }));
  }
  const changedQuote = publicLegQuote("20", 5000n, 1000n);
  assert.throws(() => reconstructPublicPurchaseTransaction(changedQuote, "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw), /fees/);
});

test("public raw signature scalars and parity must reconstruct both original signed and unsigned hashes", () => {
  const f = authenticPublicLegFixture(), wrong = `0x${"00".repeat(32)}`;
  assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "link-delivery", wrong, RECORDED_UNSIGNED_HASH, f.raw));
  assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "link-delivery", RECORDED_EVM_HASH, wrong, f.raw));
  for (const change of [{ v: "0x1" }, { v: "0x2" }, { yParity: "0x1" }, { r: "0x0" }, { s: "0x0" }, { s: "0x2" }, { r: "0x" + "ff".repeat(32) }]) {
    assert.throws(() => reconstructPublicPurchaseTransaction(f.quote, "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, { ...f.raw, ...change }));
  }
});

test("quote integrity is historical and rejects changed allocations without extending validity", () => {
  const f = authenticPublicLegFixture(), originalClock = Date.now;
  Date.now = () => Date.parse("2030-01-01T00:00:00.000Z");
  try { assert.equal(reconstructPublicPurchaseTransaction(f.quote, "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw).signed.hash, RECORDED_EVM_HASH); }
  finally { Date.now = originalClock; }
  assert.throws(() => reconstructPublicPurchaseTransaction({ ...f.quote, terms: { ...f.quote.terms, investmentUsdcBaseUnits: 10_000_000n } },
    "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw));
  assert.throws(() => reconstructPublicPurchaseTransaction(publicLegQuote("10"), "link-delivery", RECORDED_EVM_HASH, RECORDED_UNSIGNED_HASH, f.raw));
});

test("USDC and native public algebraic fixtures remain valid generic proofs but cannot impersonate NEAR-derived purchase roles", async () => {
  const usdc = algebraicQuotedTransaction("usdc-payment"); assert.ok("amount" in usdc.genericPrepared);
  assertErc20SignedBytes(usdc.genericPrepared, usdc.signed, usdc.publicKey);
  const receipt = await verifyErc20TransferReceipt(usdc.genericPrepared, usdc.signed,
    purchaseReceiptRpc(usdc.genericPrepared, usdc.signed).rpc, { purchaseId: "synthetic-public-receipt", quoteHash: usdc.quote.quoteHash,
      leg: "usdc-payment", role: "investor", expectedFullPublicKey: usdc.publicKey, referenceBlockNumber: 100n, usdcImplementationPin: IMPLEMENTATION_PIN });
  assert.equal(receipt.status, "confirmed");
  const native = algebraicQuotedTransaction("eth-delivery"); assert.ok("amountWei" in native.genericPrepared);
  assertSignedNativeTransfer(native.genericPrepared, native.signed, native.signed.senderAddress, native.publicKey);
  assert.equal((await verifyNativeTransferReceipt(native.genericPrepared, native.signed,
    nativeReceiptRpc(native.genericPrepared, native.signed).rpc, 100n)).transactionHash, native.signed.hash);
  for (const f of [usdc, native]) assert.throws(() => reconstructPublicPurchaseTransaction(f.quote,
    "amountWei" in f.intended ? "eth-delivery" : "usdc-payment", f.signed.hash, f.intended.unsignedHash, f.raw), /signature/);
});

test("public LINK verification binds final MPC result, canonical movements and actual costs with read-only injected ports", async () => {
  const f = authenticPublicLegFixture(), originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No live fetch is allowed in this fixture"); };
  try {
    const result = await verifyPublicPurchaseLeg(f.input, f.outcome, f.rpc);
    assert.equal(result.transaction.signed.hash, RECORDED_EVM_HASH); assert.equal(result.proof.finality, "two-confirmations");
    assert.deepEqual(result.proof.tokenDeltas, { sender: -1_000_000_000_000_000_000n, recipient: 1_000_000_000_000_000_000n });
    assert.equal(result.proof.actualFeeWei, 50_700_000n); assert.equal(result.proof.paymentClaim, undefined);
    assert.equal(result.nearCost.transactionHash, RECORDED_NEAR_HASH); assert.ok(result.nearCost.receiptOutcomes.length > 0);
    assert.ok(result.proof.publicObservations.some(o => o.method === "eth_getTransactionByHash"));
    assert.ok(f.rpcFixture.calls.every(o => !/send|sign|broadcast/i.test(o.method)));
    assert.equal(result.proof.before.recipientEth, result.proof.after.recipientEth);
  } finally { globalThis.fetch = originalFetch; }
});

test("MPC role, direct request, digest, path, gas, deposit and recovery ID cannot be substituted", async () => {
  const f = authenticPublicLegFixture();
  const changes = [
    (value: any) => { value.transaction.signer_id = VERIFIED_IDENTITIES.investor.accountId; },
    (value: any) => { value.transaction.public_key = VERIFIED_IDENTITIES.investor.accessPublicKey; },
    (value: any) => { value.final_execution_status = "EXECUTED"; },
    (value: any) => { value.transaction.actions[0].FunctionCall.gas = 99_000_000_000_000; },
    (value: any) => { value.transaction.actions[0].FunctionCall.deposit = "0"; },
    (value: any) => { const action = value.transaction.actions[0].FunctionCall, args = JSON.parse(Buffer.from(action.args, "base64").toString("utf8"));
      args.request.path = "another/path"; action.args = Buffer.from(JSON.stringify(args)).toString("base64"); },
    (value: any) => { const action = value.transaction.actions[0].FunctionCall, args = JSON.parse(Buffer.from(action.args, "base64").toString("utf8"));
      args.request.domain_id = 1; action.args = Buffer.from(JSON.stringify(args)).toString("base64"); },
    (value: any) => { const signature = JSON.parse(Buffer.from(value.status.SuccessValue, "base64").toString("utf8"));
      signature.recovery_id = 1; value.status.SuccessValue = Buffer.from(JSON.stringify(signature)).toString("base64"); },
  ];
  for (const change of changes) { const outcome = structuredClone(f.outcome); change(outcome);
    await assert.rejects(verifyPublicPurchaseLeg(f.input, outcome, f.rpc)); }
  await assert.rejects(verifyPublicPurchaseLeg({ ...f.input, unsignedHash: `0x${"11".repeat(32)}` }, f.outcome, f.rpc));
});

test("incomplete public NEAR receipt costs are rejected without inventing actual signing costs", async () => {
  const f = authenticPublicLegFixture(), outcome = structuredClone(f.outcome) as any;
  outcome.receipts_outcome.pop(); await assert.rejects(verifyPublicPurchaseLeg(f.input, outcome, f.rpc), /omits an emitted receipt/);
});

test("public receipt verification fails closed on reorged or ambiguous movements and inconsistent gas accounting", async () => {
  for (const options of [{ reorg: true }, { senderTokenDelta: -1n }, { recipientTokenDelta: 1n }, { recipientEthDelta: 1n },
    { senderEthDelta: -1n }, { receipt: { effectiveGasPrice: "0x1" } }, { logs: [] }] as ReceiptOptions[]) {
    const f = authenticPublicLegFixture(options); await assert.rejects(verifyPublicPurchaseLeg(f.input, f.outcome, f.rpc));
  }
});

test("unavailable or insufficiently confirmed transactions are pending and canonical onchain failure is explicit", async () => {
  const absent = authenticPublicLegFixture({ missingTransaction: true });
  await assert.rejects(verifyPublicPurchaseLeg(absent.input, absent.outcome, absent.rpc), error => error instanceof PurchaseEvidenceLegError && error.code === "PENDING");
  const unconfirmed = authenticPublicLegFixture({ head: 102n });
  await assert.rejects(verifyPublicPurchaseLeg(unconfirmed.input, unconfirmed.outcome, unconfirmed.rpc), error => error instanceof PurchaseEvidenceLegError && error.code === "PENDING");
  const failed = authenticPublicLegFixture({ receipt: { status: "0x0" } });
  await assert.rejects(verifyPublicPurchaseLeg(failed.input, failed.outcome, failed.rpc), error => error instanceof PurchaseEvidenceLegError && error.code === "ONCHAIN_FAILED");
});

test("public RPC errors suppress provider details, never retry and expose no mutation capability", async () => {
  const f = authenticPublicLegFixture(); let reads = 0;
  await assert.rejects(verifyPublicPurchaseLeg(f.input, f.outcome, { async request() { reads++; throw new Error("provider-secret-detail"); } }),
    error => error instanceof PurchaseEvidenceLegError && error.code === "RPC_FAILED" && !/secret-detail/.test(error.message));
  assert.equal(reads, 1); assert.equal("broadcast" in f.input, false); assert.equal("credentialPath" in f.input, false);
  await assert.rejects(verifyPublicPurchaseLeg({ ...f.input, referenceBlockNumber: 99n }, f.outcome, f.rpc), /predates/);
  assert.equal(Transaction.from(f.signed.serialized).unsignedHash, RECORDED_UNSIGNED_HASH);
});

test("native receipt availability distinguishes missing, one-confirmation and failed observations without claiming authorization", () => {
  // Public algebraic fixture only. This pure classifier makes no signature,
  // MPC authority, canonicality, gas accounting or asset-delivery claim.
  const f = algebraicQuotedTransaction("eth-delivery"), blockHash = `0x${"33".repeat(32)}`;
  const raw = { ...f.raw, blockNumber: "0x66", blockHash };
  const receipt = { transactionHash: f.signed.hash, from: raw.from, to: raw.to, blockNumber: "0x66", blockHash, status: "0x1" };
  const expected = (code: string) => (error: unknown) => error instanceof PurchaseEvidenceLegError && error.code === code;
  assert.throws(() => assertPublicNativeReceiptAvailability(null, undefined, raw, f.signed.hash), expected("PENDING"));
  assert.throws(() => assertPublicNativeReceiptAvailability(receipt, "0x66", raw, f.signed.hash), expected("PENDING"));
  assert.doesNotThrow(() => assertPublicNativeReceiptAvailability(receipt, "0x67", raw, f.signed.hash));
  assert.throws(() => assertPublicNativeReceiptAvailability({ ...receipt, status: "0x0" }, "0x67", raw, f.signed.hash), expected("ONCHAIN_FAILED"));
});

test("malformed or contradictory native receipt identities remain invalid rather than pending", () => {
  const f = algebraicQuotedTransaction("eth-delivery"), blockHash = `0x${"33".repeat(32)}`;
  const raw = { ...f.raw, blockNumber: "0x66", blockHash };
  const receipt = { transactionHash: f.signed.hash, from: raw.from, to: raw.to, blockNumber: "0x66", blockHash, status: "0x1" };
  const invalid = (error: unknown) => error instanceof PurchaseEvidenceLegError && error.code === "INVALID_EVIDENCE";
  for (const changes of [{ transactionHash: `0x${"00".repeat(32)}` }, { blockHash: `0x${"00".repeat(32)}` },
    { blockNumber: "0x65" }, { from: VERIFIED_IDENTITIES.investor.evmAddress }, { to: VERIFIED_IDENTITIES.treasury.evmAddress },
    { status: "0x2" }, { blockNumber: "malformed" }]) {
    // Even at one confirmation an inconsistent receipt is not treated as merely pending.
    assert.throws(() => assertPublicNativeReceiptAvailability({ ...receipt, ...changes }, "0x66", raw, f.signed.hash), invalid);
  }
  assert.throws(() => assertPublicNativeReceiptAvailability(receipt, "0x65", raw, f.signed.hash), invalid);
  assert.throws(() => assertPublicNativeReceiptAvailability({}, "0x67", raw, f.signed.hash), invalid);
});
