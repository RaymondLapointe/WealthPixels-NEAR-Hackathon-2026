import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface, keccak256 } from "ethers";
import { createNearReadRpc, inspectReadiness, collectPurchaseCosts, RECORDED_MPC_SIGNING_ASSUMPTIONS } from "../../src/purchase/readiness.js";
import { createPurchaseFeeEstimate } from "../../src/purchase/costs.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { AT, prices, termsFor } from "./fixtures/purchase-quote.js";
import { readinessFixture, READINESS_OPTIONS, READINESS_IMPLEMENTATION, READINESS_IMPLEMENTATION_CODE, type FakeReadinessOptions } from "./fixtures/purchase-readiness.js";
import { recordedOutcome } from "./fixtures/recorded-mpc.js";
import { recordedInvestorOutcome } from "./fixtures/recorded-investor-mpc.js";

const costOptions = { ...READINESS_OPTIONS, purchaseId: "offline-purchase-10", fees: { maxFeePerGasWei: 5000n, maxPriorityFeePerGasWei: 1000n },
  nearSigningAssumptions: RECORDED_MPC_SIGNING_ASSUMPTIONS };
test("readiness inspects real collector interfaces using labelled fixtures without preparing or simulating a transfer", async () => {
  const fixture = readinessFixture(), result = await inspectReadiness(READINESS_OPTIONS, fixture.ports);
  assert.equal(result.mode, "offline"); assert.equal(result.inventory.mode, "offline");
  assert.equal(result.evm.usdcDecimals, 6); assert.equal(result.evm.linkDecimals, 18);
  assert.equal(result.evm.investor.address, VERIFIED_IDENTITIES.investor.evmAddress);
  assert.equal(result.near.investor.authority.accessPublicKey, VERIFIED_IDENTITIES.investor.accessPublicKey);
  assert.notEqual(result.near.treasury.authority.accessPublicKey, result.near.investor.authority.accessPublicKey);
  assert.equal(result.near.treasury.storageReserveYocto, 10_000_000_000_000_000_000_000n);
  assert.equal(result.near.treasury.spendableYocto, 8_990_000_000_000_000_000_000_000n);
  assert.equal(result.near.fundingInputs.receiptPurchaseFloorYocto, "1000000000");
  assert.equal(result.near.fundingModel.requiredSpendableYocto, "102913918400603200000001");
  assert.equal(result.evm.usdcImplementationAddress, READINESS_IMPLEMENTATION);
  assert.equal(result.evm.usdcImplementationCodeHash, keccak256(READINESS_IMPLEMENTATION_CODE));
  assert.match(result.inventory.reference, /OFFLINE FIXTURES/);
  assert.equal(fixture.requests.some(item => item.method === "eth_estimateGas"), false);
  const transferSelector = new Interface(["function transfer(address,uint256) returns(bool)"]).getFunction("transfer")!.selector;
  assert.equal(fixture.requests.some(item => item.method === "eth_call" && item.params[0].data.startsWith(transferSelector)), false);
  assert.equal(fixture.requests.some(item => /send|broadcast|sign/i.test(item.method)), false);
  assert.ok(Object.isFrozen(result.near.treasury.authority));
});
for (const [name, options, pattern] of [
  ["wrong chain", { chainId: "0x1" }, /Sepolia/], ["wrong token code", { wrongCode: true }, /code identity/],
  ["wrong decimals", { wrongDecimals: true }, /decimals/], ["paused USDC", { paused: true }, /paused/],
  ["blacklisted role", { blacklisted: true }, /blacklisted/], ["contract role", { wrongRoleCode: true }, /code-free/],
  ["pending nonce", { pendingNonce: "0x2" }, /pending/], ["reorganized observation", { canonicalChanged: true }, /block changed/],
  ["changed MPC root", { rootChanged: true }, /MPC version, root/], ["wrong registered key", { wrongNearKey: true }, /FullAccess/],
  ["wrong NEAR network", { wrongNearNetwork: true }, /MPC inspection/], ["stale block", { stale: true }, /stale/],
  ["slow collection", { clockAdvances: true }, /freshness/], ["missing protocol storage price", { storagePrice: "" }, /NEAR RPC integer/],
] as const) test(`readiness rejects ${name}`, async () => {
  const fixture = readinessFixture(options as FakeReadinessOptions);
  await assert.rejects(inspectReadiness(READINESS_OPTIONS, fixture.ports), pattern);
});
test("readiness requires a reviewed USDC implementation pin to match rather than trusting an upgrade silently", async () => {
  await assert.rejects(inspectReadiness({ ...READINESS_OPTIONS, usdcImplementationPin: { address: READINESS_IMPLEMENTATION, codeHash: "0x" + "33".repeat(32) } }, readinessFixture().ports), /reviewed public pin/);
});
test("read-only RPC errors identify their operation and suppress provider material without retry", async () => {
  const fixture = readinessFixture({ failMethod: "eth_getCode" });
  await assert.rejects(inspectReadiness(READINESS_OPTIONS, fixture.ports), error => {
    assert.match(String(error), /eth_getCode/); assert.doesNotMatch(String(error), /secret.invalid|DO-NOT-LEAK/); return true;
  });
  // Each address is independently read once; no retry of the failed request is scheduled.
  const codeReads = fixture.requests.filter(item => item.method === "eth_getCode");
  assert.equal(new Set(codeReads.map(item => item.params[0])).size, codeReads.length);
});
test("NEAR read capability refuses transaction submission and unsafe endpoints before any fetch", async () => {
  assert.throws(() => createNearReadRpc("https://example.invalid/?api_key=secret"), /public HTTPS/);
  await assert.rejects(createNearReadRpc(READINESS_OPTIONS.nearRpcUrl).request("send_tx" as any, {}), /allowlist/);
  await assert.rejects(createNearReadRpc(READINESS_OPTIONS.nearRpcUrl).request("query", { request_type: "call_function", account_id: "v1.signer-prod.testnet", method_name: "sign" }), /signature requests are unavailable/);
});
for (const amount of ["1", "5", "10", "20", "100"]) test(`six-cost collector supports exact configurable ${amount} USDC with offline public-state fixtures`, async () => {
  const fixture = readinessFixture(), p = prices(), terms = termsFor(p, amount), output = await collectPurchaseCosts(terms, costOptions, fixture.ports);
  assert.equal(output.costs.mode, "offline"); assert.equal(output.costs.evm.length, 3); assert.equal(output.costs.near.length, 3);
  assert.equal(output.costs.evm[0]!.amountBaseUnits, BigInt(amount) * 1_000_000n);
  assert.equal(output.costs.evm[1]!.amountBaseUnits, terms.quantities.linkBaseUnits); assert.equal(output.costs.evm[2]!.amountBaseUnits, terms.quantities.ethWei);
  assert.equal(output.costs.near[0]!.accountId, VERIFIED_IDENTITIES.investor.accountId);
  assert.equal(output.costs.near[1]!.accountId, VERIFIED_IDENTITIES.treasury.accountId);
  assert.equal(output.costs.near[2]!.attachedGas, 100_000_000_000_000n);
  assert.deepEqual(output.costs.nearObservation.fundingInputs, output.readiness.near.fundingInputs);
  assert.equal(output.costs.evm[2]!.estimatedGas, 21_000n);
  assert.equal(output.nativeSnapshot.confirmedNonce, 1); // Observation only, not predicted future ETH execution nonce.
  assert.equal(fixture.requests.filter(item => item.method === "eth_estimateGas").length, 3);
  const assessed = createPurchaseFeeEstimate(terms, p, output.costs, { asOf: AT, purpose: "offline", maxExpectedFeeBps: 1000n, maxEstimateAgeMs: 60_000 });
  assert.equal(assessed.eligible, true);
});
for (const [name, options, pattern] of [
  ["insufficient USDC", { usdcBalance: 9_000_000n }, /inventory is insufficient/],
  ["insufficient ETH", { ethBalance: "0x1" }, /ETH funding/],
  ["insufficient storage-reserved NEAR", { nearAmount: "1" }, /NEAR funding/],
  ["failed transfer simulation", { simulationFails: true }, /simulation failed/],
  ["buffered gas above ceiling", { gasEstimate: "0x24dd8" }, /protective transaction limits/],
] as const) test(`six-cost collector rejects ${name}`, async () => {
  const fixture = readinessFixture(options as FakeReadinessOptions);
  await assert.rejects(collectPurchaseCosts(termsFor(prices()), costOptions, fixture.ports), pattern);
});
test("cost observations never silently raise selected fees or use missing signing assumptions", async () => {
  await assert.rejects(collectPurchaseCosts(termsFor(prices()), { ...costOptions, fees: { maxFeePerGasWei: 1028n, maxPriorityFeePerGasWei: 1000n } }, readinessFixture().ports), /twice-base-fee/);
  await assert.rejects(collectPurchaseCosts(termsFor(prices()), { ...costOptions, nearSigningAssumptions: undefined as any }, readinessFixture().ports), /Explicit bounded NEAR/);
});
test("documented signing assumptions conservatively cover recorded public gas without calling MPC", () => {
  for (const outcome of [recordedOutcome(), recordedInvestorOutcome()]) {
    const o = outcome as any;
    const receiptGas = o.receipts_outcome.reduce((sum: bigint, entry: any) => sum + BigInt(entry.outcome.gas_burnt), 0n);
    assert.ok(receiptGas <= RECORDED_MPC_SIGNING_ASSUMPTIONS.estimatedExecutionGas);
    assert.ok(BigInt(o.transaction_outcome.outcome.gas_burnt) <= RECORDED_MPC_SIGNING_ASSUMPTIONS.transactionOverheadGas);
  }
  assert.notEqual(RECORDED_MPC_SIGNING_ASSUMPTIONS.estimatedExecutionGas, 100_000_000_000_000n);
});
