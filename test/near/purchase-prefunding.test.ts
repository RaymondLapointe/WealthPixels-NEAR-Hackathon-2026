import assert from "node:assert/strict";
import test from "node:test";
import { calculateExperimentBFeeModel } from "../../src/near/experiment-b-fees.js";
import { assertMpcFundingModel, calculateMpcFundingModel, mpcFundingInputsFromProtocolConfig, MPC_SIGN_REQUEST_BYTES,
  purchaseMpcFundingModel } from "../../src/near/mpc-funding.js";
import { normalizePurchaseCostObservations } from "../../src/purchase/costs.js";
import { assertPrepaymentFunding, type InventoryReservation } from "../../src/purchase/journal.js";
import { collectPurchaseCosts, RECORDED_MPC_SIGNING_ASSUMPTIONS } from "../../src/purchase/readiness.js";
import { createPurchaseQuote } from "../../src/purchase/quote.js";
import { valueExecutionCosts } from "../../src/purchase/fee-eligibility.js";
import { createPurchaseCoordinator } from "../../src/purchase/coordinator.js";
import type { PurchaseLeg } from "../../src/purchase/legs.js";
import type { MpcFundingInputs } from "../../src/near/mpc-funding.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { AT, costs, fixtureQuote, fundingInputs, inventory, prices, termsFor } from "./fixtures/purchase-quote.js";
import { readinessFixture, READINESS_OPTIONS } from "./fixtures/purchase-readiness.js";
import { createPurchaseExecutionFixture } from "./fixtures/purchase-execution.js";

// Synthetic public protocol and balance observations only. No live reads or transaction capabilities.
test("shared MPC prefunding preserves the Experiment B fee model and prices send and execution separately", () => {
  const input = { ...fundingInputs(), receiptSendGas: "11", receiptExecutionGas: "13", functionCallSendGas: "17",
    functionCallExecutionGas: "19", functionCallByteSendGas: "23", functionCallByteExecutionGas: "29" };
  const model = calculateMpcFundingModel(input), send = 11n + 17n + 154n * 23n;
  const receipt = 13n + 19n + 154n * 29n + 100_000_000_000_000n;
  assert.equal(MPC_SIGN_REQUEST_BYTES, 154);
  assert.equal(model.sendGas, String(send)); assert.equal(model.receiptGas, String(receipt));
  assert.equal(model.upfrontGasYocto, String(send * 200_000_000n + receipt * 1_000_000_000n));
  assert.equal(model.estimatedFullAttachmentBurnYocto, String((send + receipt) * 200_000_000n));
  assert.equal(model.requiredSpendableYocto, String(send * 200_000_000n + receipt * 1_000_000_000n + 1n));
  assert.deepEqual(calculateExperimentBFeeModel(input), model);
});

test("receipt purchase floor and doubled block price reserve the full attachment before anticipated refunds", () => {
  const input = fundingInputs(), model = purchaseMpcFundingModel(input, 100_000_000n);
  assert.equal(model.receiptPurchasePriceYocto, "1000000000");
  assert.equal(model.requiredSpendableYocto, "102913918400603200000001");
  const oldReserve = 101_000_000_000_000n * 100_000_000n + 1n;
  assert.ok(BigInt(model.requiredSpendableYocto) > oldReserve * 10n);
  assert.ok(BigInt(model.requiredSpendableYocto) > BigInt(model.estimatedFullAttachmentBurnYocto) + 1n);
  const high = purchaseMpcFundingModel(fundingInputs(1_000_000_000n), 1_000_000_000n);
  assert.equal(high.receiptPurchasePriceYocto, "2000000000");
  assert.equal(BigInt(high.requiredSpendableYocto), (BigInt(high.sendGas) + BigInt(high.receiptGas)) * 2_000_000_000n + 1n);
});

test("missing, unsupported, mismatched and altered public prefunding inputs fail closed", async () => {
  const input = fundingInputs(), model = calculateMpcFundingModel(input);
  assert.throws(() => purchaseMpcFundingModel(undefined), /prefunding inputs/);
  for (const patch of [{ protocolVersion: 89 }, { requestBytes: 153 }, { receiptPurchaseFloorYocto: "0" },
    { functionCallByteExecutionGas: "" }, { gasRefundPenalty: { numerator: "1", denominator: "100" } }]) {
    assert.throws(() => purchaseMpcFundingModel({ ...input, ...patch }));
  }
  assert.throws(() => purchaseMpcFundingModel(input, 200_000_000n), /observed NEAR gas price/);
  assert.throws(() => assertMpcFundingModel({ ...model, requiredSpendableYocto: "1" }), /integrity/);
  const fixture = readinessFixture();
  const config = await fixture.ports.near.request("EXPERIMENTAL_protocol_config", {});
  assert.deepEqual(mpcFundingInputsFromProtocolConfig(config, 100_000_000n), input);
  for (const change of [
    (p: any) => { delete p.runtime_config.min_gas_purchase_price; },
    (p: any) => { delete p.runtime_config.transaction_costs.action_creation_config.function_call_cost_per_byte; },
    (p: any) => { p.protocol_version = 89; },
    (p: any) => { p.runtime_config.gas_refund_penalty = { numerator: 1, denominator: 100 }; },
  ]) {
    const changed = structuredClone(config); change(changed);
    assert.throws(() => mpcFundingInputsFromProtocolConfig(changed, 100_000_000n));
  }
});

test("immutable six-cost observations bind full prefunding while leaving expected fee eligibility separate", () => {
  const q = fixtureQuote(), p = prices(), c = costs(p), options = { purchaseId: p.purchaseId, asOf: AT,
    purpose: "offline" as const, maxEstimateAgeMs: 60_000 };
  assert.throws(() => normalizePurchaseCostObservations(q.terms, { ...c,
    nearObservation: { ...c.nearObservation, fundingInputs: undefined } }, options), /prefunding inputs/);
  const higher = createPurchaseQuote({ purchaseId: q.purchaseId, purpose: "offline", investmentUsdcBaseUnits: q.terms.investmentUsdcBaseUnits,
    prices: q.prices, createdAt: AT, costs: { ...q.costs, nearObservation: { ...q.costs.nearObservation,
      fundingInputs: { ...fundingInputs(), receiptPurchaseFloorYocto: "2000000000" } } } });
  assert.notEqual(q.quoteHash, higher.quoteHash);
  assert.equal(q.feeAssessment.totalExpectedUsdcBaseUnitsCeil, higher.feeAssessment.totalExpectedUsdcBaseUnitsCeil);
  assert.equal(q.feeAssessment.eligible, higher.feeAssessment.eligible);
  assert.ok(higher.feeAssessment.totalMaximumReserveUsdcBaseUnitsCeil > q.feeAssessment.totalMaximumReserveUsdcBaseUnitsCeil);
  assert.ok(Object.isFrozen(q.feeAssessment.snapshot.near[0]!.fundingModel));
  const snapshot = q.feeAssessment.snapshot;
  const zeroDepositAccounting = valueExecutionCosts(snapshot.evm,
    snapshot.near.map(item => ({ ...item, attachedDepositYoctoNear: 0n })),
    { ETH: { numerator: 2500n, denominator: 1n }, NEAR: { numerator: 1n, denominator: 1n } }, 10_000_000n);
  for (const entry of zeroDepositAccounting.expectedCosts.filter(item => item.asset === "NEAR")) {
    assert.equal(entry.maximumNativeReserveBaseUnits, BigInt(snapshot.near[0]!.fundingModel!.requiredSpendableYocto));
  }
  assert.throws(() => normalizePurchaseCostObservations(q.terms,
    { ...c, near: c.near.map(item => ({ ...item, attachedDepositYoctoNear: 0n })) }, options), /attachment or deposit/);
});

test("prepayment funding requires one Investor and two Treasury full upfront reserves at the exact boundary", () => {
  const q = fixtureQuote("10", true), assessment = q.feeAssessment;
  const maximum = (asset: "ETH" | "NEAR", payer: "investor" | "treasury") => assessment.expectedCosts
    .filter(item => item.asset === asset && item.payer === payer).reduce((sum, item) => sum + item.maximumNativeReserveBaseUnits, 0n);
  const one = BigInt(purchaseMpcFundingModel(q.costs.nearObservation.fundingInputs).requiredSpendableYocto);
  const reservation: InventoryReservation = { linkBaseUnits: q.terms.quantities.linkBaseUnits,
    treasuryEthWei: q.terms.quantities.ethWei + maximum("ETH", "treasury") + q.policy.execution.operatingReserveWei,
    investorMaxEvmFeeWei: maximum("ETH", "investor"), investorMaxNearYocto: maximum("NEAR", "investor"),
    treasuryMaxNearYocto: maximum("NEAR", "treasury"), expiresAt: q.expiresAt,
    afterPaymentAuthorization: "retain-until-reconciled", reservationHash: `0x${"11".repeat(32)}` };
  assert.equal(reservation.investorMaxNearYocto, one); assert.equal(reservation.treasuryMaxNearYocto, 2n * one);
  const exact = { ...inventory(), investorSpendableNearYocto: one, treasurySpendableNearYocto: 2n * one };
  assert.doesNotThrow(() => assertPrepaymentFunding(exact, AT, q, reservation, assessment, q.costs));
  for (const patch of [{ investorSpendableNearYocto: one - 1n }, { treasurySpendableNearYocto: 2n * one - 1n }]) {
    assert.throws(() => assertPrepaymentFunding({ ...exact, ...patch }, AT, q, reservation, assessment, q.costs), /funding is insufficient/);
  }
});

test("readiness rejects the previous low reserve and accepts only storage-reserved role funding for one plus two requests", async () => {
  const one = BigInt(purchaseMpcFundingModel(fundingInputs()).requiredSpendableYocto);
  const options = { ...READINESS_OPTIONS, purchaseId: "offline-purchase-10", fees: { maxFeePerGasWei: 5000n, maxPriorityFeePerGasWei: 1000n },
    nearSigningAssumptions: RECORDED_MPC_SIGNING_ASSUMPTIONS };
  async function collect(investor: bigint, treasury: bigint) {
    const fixture = readinessFixture(), near = fixture.ports.near;
    const ports = { ...fixture.ports, near: { async request(method: Parameters<typeof near.request>[0], params: any) {
      const value = await near.request(method, params);
      if (method === "query" && params.request_type === "view_account") {
        const spendable = params.account_id === VERIFIED_IDENTITIES.investor.accountId ? investor : treasury;
        return { ...(value as object), amount: String(1000n * 10_000_000_000_000_000_000n + spendable) };
      }
      return value;
    } } };
    return collectPurchaseCosts(termsFor(prices()), options, ports);
  }
  await assert.rejects(collect(101_000_000_000_000n * 100_000_000n + 1n, 2n * one), /full upfront MPC/);
  await assert.rejects(collect(one - 1n, 2n * one), /full upfront MPC/);
  await assert.rejects(collect(one, 2n * one - 1n), /full upfront MPC/);
  const exact = await collect(one, 2n * one);
  assert.equal(exact.readiness.near.investor.spendableYocto, one);
  assert.equal(exact.readiness.near.treasury.spendableYocto, 2n * one);
  assert.deepEqual(exact.costs.nearObservation.fundingInputs, fundingInputs());
});

test("paid-order remaining funding requires two Treasury MPC purchases before LINK and one before ETH", async () => {
  const fixture = await createPurchaseExecutionFixture();
  try {
    await fixture.setup();
    const c = createPurchaseCoordinator(fixture.driver, { root: fixture.root });
    const step = (leg: PurchaseLeg) => ({ quoteHash: fixture.quote.quoteHash, leg,
      role: leg === "usdc-payment" ? "investor" as const : "treasury" as const });
    const prepare = (leg: PurchaseLeg) => c.prepare({ ...step(leg), reference: "SIMULATED offline prefunding boundary preparation" });
    async function sign(leg: PurchaseLeg) {
      const entry = (await c.inspect()).active!.execution!.legs[leg]!;
      return c.sign({ ...step(leg), approval: entry.prepared.prepared.unsignedHash,
        reference: "SIMULATED offline exact-digest approval", credentialPath: fixture.rolePaths[step(leg).role] });
    }
    async function broadcastAndConfirm(leg: PurchaseLeg) {
      await c.reconcileSigning(step(leg));
      const execution = (await c.inspect()).active!.execution!;
      await c.broadcast({ ...step(leg), approval: execution.legs[leg]!.signed!.hash,
        paymentAuthorizationHash: execution.paymentAuthorization!.authorizationHash });
      return c.reconcile(step(leg));
    }
    await prepare("usdc-payment"); await sign("usdc-payment"); await broadcastAndConfirm("usdc-payment");
    const one = BigInt(purchaseMpcFundingModel(fixture.quote.costs.nearObservation.fundingInputs).requiredSpendableYocto);
    const old = 101_000_000_000_000n * fixture.quote.costs.nearObservation.gasPriceYoctoNear + 1n;
    for (const balance of [2n * old, 2n * one - 1n]) {
      fixture.ledger.treasuryNear = balance;
      await assert.rejects(prepare("link-delivery"), /Treasury NEAR signing funding is insufficient/);
      assert.equal(fixture.count("prepare", "link-delivery"), 0);
    }
    fixture.ledger.treasuryNear = 2n * one;
    const missing = createPurchaseCoordinator({ ...fixture.driver, async funding(q) {
      return { ...await fixture.driver.funding(q), fundingInputs: undefined as unknown as MpcFundingInputs };
    } }, { root: fixture.root });
    await assert.rejects(missing.prepare({ ...step("link-delivery"), reference: "SIMULATED missing fresh public inputs" }), /prefunding inputs/);
    const higherFloor = createPurchaseCoordinator({ ...fixture.driver, async funding(q) {
      const observed = await fixture.driver.funding(q);
      return { ...observed, fundingInputs: { ...observed.fundingInputs, receiptPurchaseFloorYocto: "2000000000" } };
    } }, { root: fixture.root });
    await assert.rejects(higherFloor.prepare({ ...step("link-delivery"), reference: "SIMULATED higher fresh public floor" }), /Treasury NEAR signing funding is insufficient/);
    await prepare("link-delivery");
    fixture.ledger.treasuryNear = 2n * one - 1n;
    await assert.rejects(sign("link-delivery"), /Treasury NEAR signing funding is insufficient/);
    assert.equal(fixture.count("prepareSigning", "link-delivery"), 0);
    fixture.ledger.treasuryNear = 2n * one;
    await sign("link-delivery"); await broadcastAndConfirm("link-delivery");
    for (const balance of [old, one - 1n]) {
      fixture.ledger.treasuryNear = balance;
      await assert.rejects(prepare("eth-delivery"), /Treasury NEAR signing funding is insufficient/);
      assert.equal(fixture.count("prepare", "eth-delivery"), 0);
    }
    fixture.ledger.treasuryNear = one;
    await prepare("eth-delivery");
    fixture.ledger.treasuryNear = one - 1n;
    await assert.rejects(sign("eth-delivery"), /Treasury NEAR signing funding is insufficient/);
    assert.equal(fixture.count("prepareSigning", "eth-delivery"), 0);
    fixture.ledger.treasuryNear = one;
    const signed = await sign("eth-delivery");
    assert.equal(signed.active!.execution!.legs["eth-delivery"]!.status, "near-submitted");
  } finally { await fixture.cleanup(); }
});
