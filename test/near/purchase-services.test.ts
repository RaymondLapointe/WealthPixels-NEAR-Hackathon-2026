import assert from "node:assert/strict";
import test from "node:test";
import { createPurchaseExecutionServices, observeNearExecutionCost, replayPurchaseReceipt } from "../../src/purchase/services.js";
import { createPurchaseQuote } from "../../src/purchase/quote.js";
import { buildErc20AssetTransfer, createErc20AssetIntent } from "../../src/evm/asset-intent.js";
import { assembleSignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { normalizeMpcOutcome } from "../../src/near/signing.js";
import { verifyMinedPurchaseLeg, type PreparedPurchaseErc20Leg, type PurchaseLegReceiptResult } from "../../src/purchase/legs.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { AT, costs, prices } from "./fixtures/purchase-quote.js";
import { recordedOutcome, recordedState, RECORDED_NEAR_HASH, RECORDED_EVM_HASH } from "./fixtures/recorded-mpc.js";
import { recordedInvestorOutcome, INVESTOR_NEAR_HASH } from "./fixtures/recorded-investor-mpc.js";
import { IMPLEMENTATION_PIN, purchaseObservationRpc, purchaseReceiptRpc, abi } from "./fixtures/purchase-legs.js";
import { READINESS_OPTIONS, READINESS_IMPLEMENTATION, READINESS_IMPLEMENTATION_CODE, readinessFixture } from "./fixtures/purchase-readiness.js";
import { keccak256 } from "ethers";

const now = () => Date.parse(AT);
function lowFeeQuote(amount = "10", maximum = 5000n, priority = 1000n, pin = IMPLEMENTATION_PIN) {
  const p = prices(), observation = costs(p, amount);
  return createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "offline", createdAt: AT, prices: p,
    investmentUsdcBaseUnits: BigInt(amount) * 1_000_000n, costs: { ...observation,
      assetIdentity: { usdcImplementation: pin }, evm: observation.evm.map(leg => ({ ...leg, observedBaseFeePerGasWei: 14n,
        assumedBaseFeePerGasWei: 14n, maxFeePerGasWei: maximum, maxPriorityFeePerGasWei: priority })) } });
}
function authenticSignatureFixture() {
  const state = recordedState(), original = state.preflight.prepared, quote = lowFeeQuote("20", original.maxFeePerGas, original.maxPriorityFeePerGas);
  // Original public signature, synthetic purchase association/canonical RPC observations only.
  // It is never represented as a real USDC purchase or a new signing operation.
  const snapshot = { ...state.preflight.snapshot, confirmedNonce: original.nonce, tokenDecimals: 18, senderCode: "0x", recipientCode: "0x",
    recipientTokenBalance: 0n, recipientNativeBalance: 50_000_000_000_000_000n,
    simulationResult: abi.encodeFunctionResult("transfer", [true]), blockNumber: 100n, blockHash: "0x" + "11".repeat(32) };
  const preflight = buildErc20AssetTransfer(createErc20AssetIntent(quote.terms, "link-delivery", quote.terms.termsHash), quote.terms,
    { nonce: original.nonce, estimatedGas: snapshot.estimatedGas, maxFeePerGas: original.maxFeePerGas, maxPriorityFeePerGas: original.maxPriorityFeePerGas }, quote.policy.execution);
  const prepared: PreparedPurchaseErc20Leg = { kind: "prepared-purchase-leg", purchaseId: quote.purchaseId, quoteHash: quote.quoteHash, leg: "link-delivery", role: "treasury",
    preflight, prepared: preflight.prepared, snapshot, referenceBlockNumber: 100n, referenceBlockHash: snapshot.blockHash };
  const outcome = recordedOutcome(), signature = normalizeMpcOutcome(outcome, "treasury", RECORDED_NEAR_HASH, original.unsignedHash);
  const signed = assembleSignedErc20Transfer(original, signature, original.senderAddress);
  return { quote, prepared, signed, outcome };
}
test("production service composition is inert and keeps real validation with trusted readonly mock ports", async () => {
  const observation = purchaseObservationRpc("usdc-payment"), ready = readinessFixture();
  const broadcast = { async sendRawTransaction() { throw new Error("must remain unreachable in this fixture"); } };
  const driver = createPurchaseExecutionServices(READINESS_OPTIONS, { evm: observation.rpc, readinessPorts: ready.ports, now, broadcast });
  assert.equal(driver.mode, "live"); assert.equal(driver.broadcast, broadcast); assert.equal(observation.calls.length, 0); assert.equal(ready.requests.length, 0);
  for (const leg of ["usdc-payment", "link-delivery", "eth-delivery"] as const) {
    const rpc = purchaseObservationRpc(leg), service = createPurchaseExecutionServices(READINESS_OPTIONS, { evm: rpc.rpc, now });
    const quote = lowFeeQuote(), prepared = await service.prepare(quote, leg);
    service.assertPrepared(quote, prepared); await service.recheck(quote, prepared);
    assert.equal(prepared.prepared.maxFeePerGas, 5000n); assert.equal(prepared.prepared.maxPriorityFeePerGas, 1000n);
    assert.ok(rpc.calls.every(item => !/send|broadcast|sign/i.test(item.method)));
  }
});
test("production factory refuses credential-bearing RPC configuration", () => {
  assert.throws(() => createPurchaseExecutionServices({ ...READINESS_OPTIONS, nearRpcUrl: "https://user:password@example.invalid/" }), /public HTTPS/);
  assert.throws(() => createPurchaseExecutionServices({ ...READINESS_OPTIONS, evmRpcUrl: "https://example.invalid/?api_key=secret" }), /public HTTPS/);
});
test("production preparation requires reviewed implementation identity in the immutable quote", async () => {
  const { fixtureQuote } = await import("./fixtures/purchase-quote.js");
  const observations = purchaseObservationRpc("usdc-payment"), driver = createPurchaseExecutionServices(READINESS_OPTIONS, { evm: observations.rpc });
  await assert.rejects(driver.prepare(fixtureQuote(), "usdc-payment"), /reviewed USDC implementation/);
  assert.equal(observations.calls.length, 0);
});
test("public role authority checks load no credentials and use no Ethereum transaction simulation", async () => {
  const ready = readinessFixture(), driver = createPurchaseExecutionServices(READINESS_OPTIONS, { readinessPorts: ready.ports, now });
  const authority = await driver.verifyAuthority("investor") as any;
  assert.equal(authority.accessPublicKey, VERIFIED_IDENTITIES.investor.accessPublicKey);
  assert.ok(ready.requests.every(item => item.chain === "near" && !/send|broadcast/i.test(item.method)));
});
test("postpayment funding collection does not require the Investor to still own its spent USDC", async () => {
  const ready = readinessFixture({ usdcBalance: 0n }), pin = { address: READINESS_IMPLEMENTATION, codeHash: keccak256(READINESS_IMPLEMENTATION_CODE) };
  const driver = createPurchaseExecutionServices(READINESS_OPTIONS, { readinessPorts: ready.ports, now });
  const funding = await driver.funding(lowFeeQuote("10", 5000n, 1000n, pin));
  assert.equal(funding.inventory.investorUsdcBaseUnits, 0n); assert.equal(funding.inventory.mode, "offline");
  assert.equal(funding.gasPriceYoctoNear, 100_000_000n);
  assert.equal(funding.fundingInputs.receiptPurchaseFloorYocto, "1000000000");
  assert.equal(funding.expiresAt, new Date(Date.parse(AT) + 50_000).toISOString());
  assert.equal(ready.requests.some(item => item.method === "eth_estimateGas"), false);
});
test("fresh complete costs preserve independently selected original per-leg fees and offline fixture designation", async () => {
  const ready = readinessFixture(), pin = { address: READINESS_IMPLEMENTATION, codeHash: keccak256(READINESS_IMPLEMENTATION_CODE) };
  const base = lowFeeQuote("10", 5000n, 1000n, pin);
  const quote = createPurchaseQuote({ purchaseId: base.purchaseId, purpose: "offline", createdAt: AT, prices: base.prices,
    investmentUsdcBaseUnits: base.terms.investmentUsdcBaseUnits, costs: { ...base.costs, evm: base.costs.evm.map((item, index) => ({ ...item,
      maxFeePerGasWei: 5000n + BigInt(index) * 1000n, maxPriorityFeePerGasWei: 1000n + BigInt(index) * 100n })) } });
  const driver = createPurchaseExecutionServices(READINESS_OPTIONS, { readinessPorts: ready.ports, now });
  const current = await driver.collectCosts(quote);
  assert.equal(current.costs.mode, "offline"); assert.equal(current.inventory.mode, "offline");
  assert.deepEqual(current.costs.evm.map(item => [item.maxFeePerGasWei, item.maxPriorityFeePerGasWei]), quote.costs.evm.map(item => [item.maxFeePerGasWei, item.maxPriorityFeePerGasWei]));
  assert.deepEqual(current.costs.assetIdentity, quote.costs.assetIdentity);
});
test("real MPC assembly verifies authentic response, full Treasury public key and exact approved fee parameters", () => {
  const { quote, prepared, outcome } = authenticSignatureFixture(), driver = createPurchaseExecutionServices(READINESS_OPTIONS);
  const signed = driver.assemble(quote, prepared, RECORDED_NEAR_HASH, outcome);
  driver.assertSigned(quote, prepared, signed); assert.equal(signed.hash, RECORDED_EVM_HASH);
  assert.equal(signed.senderAddress, VERIFIED_IDENTITIES.treasury.evmAddress);
  const changed = structuredClone(outcome); changed.transaction.signer_id = VERIFIED_IDENTITIES.investor.accountId;
  assert.throws(() => driver.assemble(quote, prepared, RECORDED_NEAR_HASH, changed));
  assert.throws(() => driver.assertSigned(quote, prepared, { ...signed, hash: "0x" + "00".repeat(32) }));
  assert.throws(() => driver.assertPrepared(lowFeeQuote("20", 5000n), prepared));
});
test("receipt replay recomputes full proof with no RPC and rejects altered or extra evidence", async () => {
  const { quote, prepared, signed } = authenticSignatureFixture();
  const observations = purchaseReceiptRpc(prepared.prepared, signed, { senderEthDelta: -50_700_000n,
    receipt: { effectiveGasPrice: "0x3f6" } });
  const rpc = { async request(method: Parameters<typeof observations.rpc.request>[0], params: readonly unknown[]) {
    const value = await observations.rpc.request(method, params);
    return method === "eth_getBlockByNumber" && value && typeof value === "object" ? { ...value, baseFeePerGas: "0xe" } : value;
  } };
  const proof = await verifyMinedPurchaseLeg(prepared, quote, quote.quoteHash, signed, rpc);
  assert.equal(proof.status, "confirmed"); const calls = observations.calls.length;
  await replayPurchaseReceipt(quote, prepared, signed, proof); assert.equal(observations.calls.length, calls);
  const reordered = { ...proof, proof: { ...proof.proof, publicObservations: [...proof.proof.publicObservations].reverse() } };
  await replayPurchaseReceipt(quote, prepared, signed, reordered);
  const changed = { ...proof, proof: { ...proof.proof, actualFeeWei: proof.proof.actualFeeWei + 1n } } as PurchaseLegReceiptResult;
  await assert.rejects(replayPurchaseReceipt(quote, prepared, signed, changed), /differs from the saved result/);
  const extra = { ...proof, proof: { ...proof.proof, publicObservations: [...proof.proof.publicObservations, proof.proof.publicObservations[0]!] } } as PurchaseLegReceiptResult;
  await assert.rejects(replayPurchaseReceipt(quote, prepared, signed, extra), /unused or duplicated/);
  await assert.rejects(replayPurchaseReceipt(quote, prepared, signed, { ...proof, verified: true } as any), /differs from the saved result/);
});
test("lookup verifies current chain, exact known hash and canonical receipt without submitting", async () => {
  const { prepared, signed } = authenticSignatureFixture(); let reads = 0;
  const rpc = { async request(method: string, params: readonly unknown[]) {
    reads++;
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: "0x" + "11".repeat(32) };
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_getTransactionByHash") return { hash: signed.hash, from: prepared.prepared.senderAddress, nonce: "0x0" };
    if (method === "eth_getTransactionReceipt") return { transactionHash: signed.hash, blockHash: "0x" + "11".repeat(32), blockNumber: "0x64" };
    throw new Error("Unexpected or mutating method " + method);
  } };
  const driver = createPurchaseExecutionServices(READINESS_OPTIONS, { evm: rpc });
  assert.deepEqual(await driver.lookup(prepared, signed), { known: true, receipt: true, confirmedNonce: 1, pendingNonce: 1 });
  assert.ok(reads > 0);
  await assert.rejects(driver.lookup(prepared, { ...signed, hash: "0x" + "00".repeat(32) }));
});
test("NEAR actual costs bind finalized authority and leg, preserve unique public receipts and disclosed deposit assumption", () => {
  const outcome = recordedOutcome(), cost = observeNearExecutionCost("treasury", RECORDED_NEAR_HASH, outcome, "link-delivery");
  assert.equal(cost.leg, "treasury-link-delivery"); assert.equal(cost.payer, "treasury"); assert.ok(cost.transactionTokensBurntYoctoNear > 0n);
  assert.equal(new Set(cost.receiptOutcomes.map(item => item.receiptId)).size, cost.receiptOutcomes.length);
  assert.equal(cost.originalAttachedDepositYoctoNear, 1n); assert.equal(cost.refundedDepositYoctoNear, 0n);
  assert.match((cost as any).depositAccounting, /refund-not-proven/);
  assert.equal(observeNearExecutionCost("treasury", RECORDED_NEAR_HASH, outcome, "eth-delivery").leg, "treasury-eth-delivery");
  assert.equal(observeNearExecutionCost("investor", INVESTOR_NEAR_HASH, recordedInvestorOutcome(), "usdc-payment").leg, "investor-usdc-payment");
  assert.throws(() => observeNearExecutionCost("treasury", RECORDED_NEAR_HASH, outcome, "usdc-payment"));
  const duplicate = structuredClone(outcome) as any; duplicate.receipts_outcome.push(duplicate.receipts_outcome[0]);
  assert.throws(() => observeNearExecutionCost("treasury", RECORDED_NEAR_HASH, duplicate, "link-delivery"), /Duplicate/);
  const incomplete = structuredClone(outcome) as any; incomplete.receipts_outcome.pop();
  assert.throws(() => observeNearExecutionCost("treasury", RECORDED_NEAR_HASH, incomplete, "link-delivery"), /omits an emitted receipt/);
  const unfinalized = { ...outcome, final_execution_status: "EXECUTED" };
  assert.throws(() => observeNearExecutionCost("treasury", RECORDED_NEAR_HASH, unfinalized, "link-delivery"), /finalized/);
});
