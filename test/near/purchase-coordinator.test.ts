import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createPurchaseCoordinator, type PurchaseBroadcastApproval } from "../../src/purchase/coordinator.js";
import type { PurchaseLeg } from "../../src/purchase/legs.js";
import type { PurchaseJournal } from "../../src/purchase/journal.js";
import type { CompletePurchaseCosts } from "../../src/purchase/costs.js";
import type { AuthorizedActualCosts } from "../../src/purchase/authorized-costs.js";
import { sealExecution } from "../../src/purchase/settlement.js";
import { encodeState } from "../../src/execution/state.js";
import { createPurchaseExecutionFixture, type FixtureOptions, type PurchaseExecutionFixture } from "./fixtures/purchase-execution.js";

type Coordinator = ReturnType<typeof createPurchaseCoordinator>;
async function sandbox(action: (fixture: PurchaseExecutionFixture, coordinator: Coordinator) => Promise<void>, options: FixtureOptions = {}) {
  const fixture = await createPurchaseExecutionFixture(options);
  try { await fixture.setup(); await action(fixture, createPurchaseCoordinator(fixture.driver, { root: fixture.root })); }
  finally { await fixture.cleanup(); }
}
const step = (f: PurchaseExecutionFixture, leg: PurchaseLeg) => ({ quoteHash: f.quote.quoteHash, leg, role: leg === "usdc-payment" ? "investor" as const : "treasury" as const });
async function prepare(f: PurchaseExecutionFixture, c: Coordinator, leg: PurchaseLeg) {
  return c.prepare({ ...step(f, leg), reference: "SIMULATED offline prepare approval" });
}
async function sign(f: PurchaseExecutionFixture, c: Coordinator, leg: PurchaseLeg) {
  const entry = (await c.inspect()).active!.execution!.legs[leg]!;
  return c.sign({ ...step(f, leg), approval: entry.prepared.prepared.unsignedHash,
    reference: "SIMULATED exact-digest signing approval; no human/live authorization", credentialPath: f.rolePaths[step(f, leg).role] });
}
async function signAndReconcile(f: PurchaseExecutionFixture, c: Coordinator, leg: PurchaseLeg) {
  await sign(f, c, leg); return c.reconcileSigning(step(f, leg));
}
async function broadcastInput(f: PurchaseExecutionFixture, c: Coordinator, leg: PurchaseLeg, recovery = false): Promise<PurchaseBroadcastApproval> {
  const e = (await c.inspect()).active!.execution!, entry = e.legs[leg]!;
  return { ...step(f, leg), approval: entry.signed!.hash, paymentAuthorizationHash: e.paymentAuthorization!.authorizationHash,
    ...(recovery ? { recovery: true, expiredPreparationAcknowledgment: entry.preparedAt } : {}) };
}
async function deliver(f: PurchaseExecutionFixture, c: Coordinator, leg: PurchaseLeg) {
  await prepare(f, c, leg); await signAndReconcile(f, c, leg);
  await c.broadcast(await broadcastInput(f, c, leg)); return c.reconcile(step(f, leg));
}
async function paid(f: PurchaseExecutionFixture, c: Coordinator) { return deliver(f, c, "usdc-payment"); }
function current(journal: PurchaseJournal) { return journal.active ?? journal.archive.at(-1)!; }

test("credential-free fixture completes durable 10-USDC payment, LINK delivery and native ETH settlement", async () => sandbox(async (f, c) => {
  const q = f.quote, opening = structuredClone(f.ledger);
  assert.equal((await prepare(f, c, "usdc-payment")).active!.execution!.legs["usdc-payment"]!.status, "prepared");
  assert.equal((await sign(f, c, "usdc-payment")).active!.execution!.legs["usdc-payment"]!.status, "near-submitted");
  assert.equal((await c.reconcileSigning(step(f, "usdc-payment"))).active!.execution!.legs["usdc-payment"]!.status, "signed");
  await c.broadcast(await broadcastInput(f, c, "usdc-payment"));
  assert.equal((await c.reconcile(step(f, "usdc-payment"))).active!.status, "settling");
  f.clock.advance(120_000); // Finality/operator work does not need to finish within the original 60 seconds.
  assert.equal((await deliver(f, c, "link-delivery")).active!.status, "partially-delivered");
  const finished = await deliver(f, c, "eth-delivery"), execution = finished.archive[0]!.execution!;
  assert.equal(finished.active, null); assert.equal(finished.archive[0]!.status, "completed");
  assert.equal(execution.mode, "offline-fixtures"); assert.equal(execution.actualCosts.evm.length, 3); assert.equal(execution.actualCosts.near.length, 3);
  assert.ok(execution.realizedCosts); assert.equal(finished.paymentClaims.length, 1);
  assert.equal(f.ledger.investorUsdc, opening.investorUsdc - q.terms.investmentUsdcBaseUnits);
  assert.equal(f.ledger.treasuryUsdc, q.terms.investmentUsdcBaseUnits);
  assert.equal(f.ledger.investorLink, opening.investorLink + q.terms.quantities.linkBaseUnits);
  assert.equal(f.ledger.treasuryLink, opening.treasuryLink - q.terms.quantities.linkBaseUnits);
  const investorGas = execution.actualCosts.evm.filter(v => v.payer === "investor").reduce((sum, v) => sum + v.gasUsed * v.effectiveGasPriceWei, 0n);
  const treasuryGas = execution.actualCosts.evm.filter(v => v.payer === "treasury").reduce((sum, v) => sum + v.gasUsed * v.effectiveGasPriceWei, 0n);
  assert.equal(f.ledger.investorEth, opening.investorEth + q.terms.quantities.ethWei - investorGas);
  assert.equal(f.ledger.treasuryEth, opening.treasuryEth - q.terms.quantities.ethWei - treasuryGas);
  assert.equal(f.ledger.investorNonce, 2); assert.equal(f.ledger.treasuryNonce, 3);
  for (const leg of ["usdc-payment", "link-delivery", "eth-delivery"] as const) {
    assert.equal(f.count("nearSubmit", leg), 1); assert.equal(f.count("evmSubmit", leg), 1);
    assert.equal((execution.legs[leg]!.nearOutcome as { kind: string }).kind, "OFFLINE-SIMULATED-MPC-RESULT-NOT-LIVE");
  }
  const persisted = await readFile(f.journalFile, "utf8"); assert.match(persisted, /OFFLINE-SIMULATED/); assert.match(persisted, /\$bigint/);
  const restarted = createPurchaseCoordinator(f.driver, { root: f.root }); assert.deepEqual(await restarted.inspect(), finished);
  assert.equal(f.calls.filter(call => call.operation === "prepareSigning" && call.role === "investor")[0]!.credentialPath, f.rolePaths.investor);
  assert.notEqual(f.rolePaths.investor, f.rolePaths.treasury);
}));

test("complete purchase quantities stay configurable for 1, 5, 20 and 100 USDC", async () => {
  for (const amount of ["1", "5", "20", "100"]) await sandbox(async (f, c) => {
    await paid(f, c); await deliver(f, c, "link-delivery"); const journal = await deliver(f, c, "eth-delivery");
    assert.equal(journal.archive[0]!.quote.terms.investmentUsdcBaseUnits, BigInt(amount) * 1_000_000n);
    assert.equal(f.ledger.treasuryUsdc, BigInt(amount) * 1_000_000n);
    assert.equal(f.ledger.investorLink, 900_000_000_000_000_000n + f.quote.terms.quantities.linkBaseUnits);
    assert.equal(journal.archive[0]!.execution!.legs["eth-delivery"]!.prepared.prepared.nonce, 2);
  }, { amount, investorUsdc: 200_000_000n });
});

test("Treasury delivery is blocked before finalized payment, and native ETH must follow confirmed LINK", async () => sandbox(async (f, c) => {
  const original = await readFile(f.journalFile, "utf8");
  await assert.rejects(prepare(f, c, "link-delivery"), /Finalized/); assert.equal(await readFile(f.journalFile, "utf8"), original);
  await paid(f, c);
  await assert.rejects(prepare(f, c, "eth-delivery"), /Confirm LINK/);
  await deliver(f, c, "link-delivery"); const native = await prepare(f, c, "eth-delivery");
  assert.equal(native.active!.execution!.legs["link-delivery"]!.prepared.prepared.nonce, 1);
  assert.equal(native.active!.execution!.legs["eth-delivery"]!.prepared.prepared.nonce, 2);
}));

test("quote expiry blocks a new payment signature while a valid authorization permits later payment broadcast", async () => {
  await sandbox(async (f, c) => {
    await prepare(f, c, "usdc-payment"); const original = await readFile(f.journalFile, "utf8");
    f.clock.advance(60_000);
    await assert.rejects(sign(f, c, "usdc-payment"), /NEW payment|expired/);
    assert.equal(f.count("nearSubmit"), 0); assert.equal(await readFile(f.journalFile, "utf8"), original);
  });
  await sandbox(async (f, c) => {
    await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment");
    const authorization = (await c.inspect()).active!.execution!.paymentAuthorization!;
    f.clock.advance(120_000);
    await c.broadcast(await broadcastInput(f, c, "usdc-payment")); const result = await c.reconcile(step(f, "usdc-payment"));
    assert.equal(result.active!.status, "settling"); assert.deepEqual(result.active!.execution!.paymentAuthorization, authorization);
    assert.equal(result.active!.quote.expiresAt, f.quote.expiresAt); assert.equal(f.count("nearSubmit"), 1);
  });
});

test("shorter fee observation expiry is checked after signing preparation, before any MPC submission", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment");
  f.controls.costTransform = value => ({ ...value, expiresAt: new Date(f.clock.now() + 1000).toISOString() });
  f.controls.prepareSigningDelayMs = 1001;
  const before = await readFile(f.journalFile, "utf8");
  await assert.rejects(sign(f, c, "usdc-payment"), /fee|eligib|expired/i);
  assert.equal(f.count("prepareSigning"), 1); assert.equal(f.count("nearSubmit"), 0);
  assert.equal(await readFile(f.journalFile, "utf8"), before);
}));

function tenPercentCosts(value: CompletePurchaseCosts): CompletePurchaseCosts {
  // At ETH=2500 and 1.1gwei, the three buffered EVM estimates cost exactly
  // 0.4323 nominal USDC. With NEAR=1, the following gas observations cost
  // 0.5677 NEAR plus three1yocto deposits. The explicitly synthetic rational
  // NEAR rate below includes those deposits and yields exactly0.5677USDC.
  return { ...value, nearObservation: { ...value.nearObservation, gasPriceYoctoNear: 10_000_000_000n },
    near: value.near.map((leg, index) => index === 2 ? { ...leg, estimatedExecutionGas: 28_308_333_333_333n } : leg) };
}
test("fresh complete six-cost eligibility accepts below and exactly10%, and rejects even a rational increment above10%", async () => {
  const nearGasOnlyYocto = 567_700_000_000_000_000_000_000n;
  const options = { baseFeePerGas: 1_000_000_000n, maxFeePerGas: 5_000_000_000n, maxPriorityFeePerGas: 100_000_000n,
    nearUsd: { numerator: nearGasOnlyYocto, denominator: nearGasOnlyYocto + 3n }, initialCostTransform: tenPercentCosts };
  for (const delta of [-1n, 0n, 1n]) await sandbox(async (f, c) => {
    assert.equal(f.quote.feeAssessment.totalExpectedUsdcExact.numerator, f.quote.feeAssessment.totalExpectedUsdcExact.denominator * 1_000_000n);
    f.controls.costTransform = value => ({ ...value, near: value.near.map((leg, index) => index === 2 ? { ...leg, estimatedExecutionGas: leg.estimatedExecutionGas + delta } : leg) });
    const before = await readFile(f.journalFile, "utf8");
    if (delta > 0n) { await assert.rejects(prepare(f, c, "usdc-payment"), /fee ratio|exceed/i); assert.equal(await readFile(f.journalFile, "utf8"), before); }
    else { const result = await prepare(f, c, "usdc-payment"); assert.equal(result.active!.execution!.legs["usdc-payment"]!.status, "prepared"); }
    assert.equal(f.count("nearSubmit"), 0); assert.equal(f.count("evmSubmit"), 0);
  }, options);
});

test("stale or incomplete economic inputs never authorize a payment", async () => sandbox(async (f, c) => {
  for (const change of [
    (value: CompletePurchaseCosts) => ({ ...value, sampledAt: new Date(f.clock.now() - 60_000).toISOString() }),
    (value: CompletePurchaseCosts) => ({ ...value, near: value.near.slice(1) }),
    (value: CompletePurchaseCosts) => ({ ...value, assetIdentity: { usdcImplementation: { ...value.assetIdentity!.usdcImplementation, codeHash: `0x${"00".repeat(32)}` } } }),
  ]) {
    f.controls.costTransform = change; const before = await readFile(f.journalFile, "utf8");
    await assert.rejects(prepare(f, c, "usdc-payment")); assert.equal(await readFile(f.journalFile, "utf8"), before);
  }
  assert.equal(f.count("nearSubmit"), 0);
}));

test("fresh prepayment funding rejects insufficient Investor funds, Treasury inventory and either NEAR role", async () => sandbox(async (f, c) => {
  for (const change of [{ investorUsdcBaseUnits: 1n }, { investorEthWei: 1n }, { treasuryLinkBaseUnits: 1n },
    { treasuryEthWei: 1n }, { investorSpendableNearYocto: 1n }, { treasurySpendableNearYocto: 1n }]) {
    f.controls.fundingTransform = value => ({ ...value, ...change }); const before = await readFile(f.journalFile, "utf8");
    await assert.rejects(prepare(f, c, "usdc-payment"), /fund|inventory|insufficient/i);
    assert.equal(await readFile(f.journalFile, "utf8"), before);
  }
  assert.equal(f.count("nearSubmit"), 0); assert.equal(f.count("evmSubmit"), 0);
}));

test("explicit independent role, unsigned hash and signed hash approvals cannot be substituted", async () => sandbox(async (f, c) => {
  await assert.rejects(c.prepare({ ...step(f, "usdc-payment"), role: "treasury", reference: "wrong role" }), /role/i);
  await prepare(f, c, "usdc-payment");
  await assert.rejects(c.sign({ ...step(f, "usdc-payment"), approval: `0x${"00".repeat(32)}`, credentialPath: f.rolePaths.investor, reference: "wrong digest" }), /digest/);
  const unsigned = (await c.inspect()).active!.execution!.legs["usdc-payment"]!.prepared.prepared.unsignedHash;
  await assert.rejects(c.sign({ ...step(f, "usdc-payment"), approval: unsigned, credentialPath: f.rolePaths.treasury, reference: "wrong role credential" }), /credential path/);
  assert.equal(f.count("nearSubmit"), 0);
  await signAndReconcile(f, c, "usdc-payment"); const input = await broadcastInput(f, c, "usdc-payment");
  await assert.rejects(c.broadcast({ ...input, approval: `0x${"00".repeat(32)}` }), /exact signed hash/);
  await assert.rejects(c.broadcast({ ...input, paymentAuthorizationHash: `0x${"00".repeat(32)}` }), /payment authorization/);
  assert.equal(f.count("evmSubmit"), 0);
}));

test("unfinalized payment cannot claim or release Treasury inventory; later finality claims exactly once", async () => sandbox(async (f, c) => {
  f.controls.receipt["usdc-payment"] = "unfinalized";
  const observed = await paid(f, c);
  assert.equal(observed.active!.execution!.legs["usdc-payment"]!.status, "observed"); assert.equal(observed.paymentClaims.length, 0);
  assert.equal(observed.active!.execution!.paidAt, null);
  await assert.rejects(prepare(f, c, "link-delivery"), /Finalized/);
  delete f.controls.receipt["usdc-payment"];
  const confirmed = await c.reconcile(step(f, "usdc-payment")); assert.equal(confirmed.paymentClaims.length, 1);
  const again = await c.reconcile(step(f, "usdc-payment")); assert.deepEqual(again, confirmed);
  assert.equal(f.count("evmSubmit", "usdc-payment"), 1);
}));

test("a reorged accepted payment blocks asset release while preserving its durable settlement record", async () => sandbox(async (f, c) => {
  await paid(f, c); const before = await readFile(f.journalFile, "utf8");
  f.controls.receipt["usdc-payment"] = "reorg";
  await assert.rejects(prepare(f, c, "link-delivery"), /reorg/i);
  assert.equal(await readFile(f.journalFile, "utf8"), before); assert.equal(f.count("evmSubmit", "link-delivery"), 0);
  delete f.controls.receipt["usdc-payment"];
  assert.equal((await c.inspect()).active!.execution!.paymentClaim !== null, true);
}));

test("wrong payment token, amount, recipient or transaction proof cannot be atomically claimed", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment"); await c.broadcast(await broadcastInput(f, c, "usdc-payment"));
  const before = await readFile(f.journalFile, "utf8");
  for (const invalid of ["wrong-token", "wrong-amount", "wrong-recipient", "wrong-transaction"] as const) {
    f.controls.receipt["usdc-payment"] = invalid; await assert.rejects(c.reconcile(step(f, "usdc-payment")), /verification rejected/);
    assert.equal(await readFile(f.journalFile, "utf8"), before);
  }
  delete f.controls.receipt["usdc-payment"];
  assert.equal((await c.reconcile(step(f, "usdc-payment"))).paymentClaims.length, 1);
}));

test("NEAR timeout preserves one recorded hash and restart reconciliation recovers without another submission", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); f.controls.nearSubmit["usdc-payment"] = "timeout-after";
  const uncertain = await sign(f, c, "usdc-payment"); const entry = uncertain.active!.execution!.legs["usdc-payment"]!;
  assert.equal(entry.status, "near-uncertain"); assert.ok(entry.nearTransactionHash); assert.equal(f.count("nearSubmit"), 1);
  const restarted = createPurchaseCoordinator(f.driver, { root: f.root });
  await assert.rejects(sign(f, restarted, "usdc-payment"), /unattempted/);
  const reconciled = await restarted.reconcileSigning(step(f, "usdc-payment"));
  assert.equal(reconciled.active!.execution!.legs["usdc-payment"]!.status, "signed");
  assert.equal(reconciled.active!.execution!.legs["usdc-payment"]!.nearTransactionHash, entry.nearTransactionHash);
  assert.equal(f.count("nearSubmit"), 1);
}));

test("invalid MPC signature recovery leaves the original NEAR attempt intact and forbids re-signing", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await sign(f, c, "usdc-payment"); f.controls.invalidMpc = "usdc-payment";
  const before = await readFile(f.journalFile, "utf8"); await assert.rejects(c.reconcileSigning(step(f, "usdc-payment")), /verification failed/);
  assert.equal(await readFile(f.journalFile, "utf8"), before); assert.equal(f.count("nearSubmit"), 1);
  await assert.rejects(sign(f, c, "usdc-payment"), /unattempted/);
}));

test("Ethereum timeout after acceptance is reconciled after restart without a duplicate broadcast", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment"); f.controls.broadcast["usdc-payment"] = "timeout-after";
  const input = await broadcastInput(f, c, "usdc-payment"), uncertain = await c.broadcast(input);
  assert.equal(uncertain.active!.execution!.legs["usdc-payment"]!.status, "evm-uncertain");
  const restarted = createPurchaseCoordinator(f.driver, { root: f.root });
  await assert.rejects(restarted.broadcast(input), /reconcile prior attempts/);
  assert.equal((await restarted.reconcile(step(f, "usdc-payment"))).active!.status, "settling");
  assert.equal(f.count("evmSubmit", "usdc-payment"), 1); assert.equal(f.count("nearSubmit", "usdc-payment"), 1);
}));

test("unknown Ethereum timeout keeps reservations, original bytes and an irreversible attempt marker", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment"); f.controls.broadcast["usdc-payment"] = "timeout-before";
  const input = await broadcastInput(f, c, "usdc-payment"); const attempted = await c.broadcast(input);
  const before = attempted.active!.execution!.legs["usdc-payment"]!;
  f.clock.advance(1_000_000);
  const restarted = createPurchaseCoordinator(f.driver, { root: f.root }), result = await restarted.reconcile(step(f, "usdc-payment"));
  assert.equal(result.active!.releasedAt, null); assert.equal(result.active!.execution!.legs["usdc-payment"]!.status, "evm-uncertain");
  assert.deepEqual(result.active!.execution!.legs["usdc-payment"]!.signed, before.signed);
  assert.deepEqual(result.active!.execution!.legs["usdc-payment"]!.evmAttempt, before.evmAttempt);
  await assert.rejects(restarted.broadcast(input), /reconcile prior attempts/); assert.equal(f.count("evmSubmit"), 1);
}));

test("LINK completed with ETH pending survives restart and resumes only the outstanding obligation", async () => sandbox(async (f, c) => {
  await paid(f, c); await deliver(f, c, "link-delivery"); f.clock.advance(1_000_000);
  const restarted = createPurchaseCoordinator(f.driver, { root: f.root });
  assert.equal((await restarted.inspect()).active!.status, "partially-delivered");
  await assert.rejects(prepare(f, restarted, "link-delivery"), /already has/);
  const result = await deliver(f, restarted, "eth-delivery"); assert.equal(result.archive[0]!.status, "completed");
  assert.equal(f.count("evmSubmit", "link-delivery"), 1); assert.equal(f.count("evmSubmit", "eth-delivery"), 1);
}));

test("postpayment quote expiry and increased expected fees preserve the accepted inventory obligation", async () => sandbox(async (f, c) => {
  const accepted = await paid(f, c), claim = accepted.active!.execution!.paymentClaim;
  f.clock.advance(1_000_000); f.controls.costTransform = value => ({ ...value, nearObservation: { ...value.nearObservation, gasPriceYoctoNear: 10_000_000_000_000n } });
  f.controls.recheckFailure = "link-delivery";
  await prepare(f, c, "link-delivery"); const before = await readFile(f.journalFile, "utf8");
  await assert.rejects(sign(f, c, "link-delivery"), /fresh nonce/); assert.equal(await readFile(f.journalFile, "utf8"), before);
  assert.equal((await c.inspect()).active!.execution!.paymentClaim, claim);
  delete f.controls.recheckFailure;
  await signAndReconcile(f, c, "link-delivery"); await c.broadcast(await broadcastInput(f, c, "link-delivery")); await c.reconcile(step(f, "link-delivery"));
  assert.equal((await deliver(f, c, "eth-delivery")).archive[0]!.status, "completed");
}));

test("expired signed recovery retains original timestamps and bytes for all three purchase legs", async () => sandbox(async (f, c) => {
  for (const leg of ["usdc-payment", "link-delivery", "eth-delivery"] as const) {
    await prepare(f, c, leg); await signAndReconcile(f, c, leg);
    const original = (await c.inspect()).active!.execution!.legs[leg]!;
    f.clock.advance(900_001);
    await assert.rejects(c.broadcast(await broadcastInput(f, c, leg)), /expired/);
    const recovery = await broadcastInput(f, c, leg, true);
    await assert.rejects(c.auditBroadcast({ ...recovery, expiredPreparationAcknowledgment: "2020-01-01T00:00:00.000Z" }), /acknowledgment/);
    const audit = await c.auditBroadcast(recovery); assert.equal(audit.recovery, true); assert.equal(audit.originalPreparedAt, original.preparedAt);
    const submitted = await c.broadcast(recovery), saved = submitted.active!.execution!.legs[leg]!;
    assert.equal(saved.preparedAt, original.preparedAt); assert.deepEqual(saved.signed, original.signed);
    assert.ok(saved.audit && saved.evmAttempt); await c.reconcile(step(f, leg));
    assert.equal(f.count("nearSubmit", leg), 1); assert.equal(f.count("evmSubmit", leg), 1);
  }
  assert.equal((await c.inspect()).archive[0]!.status, "completed");
}));

test("an expired unsigned payment requires explicit retirement and new quote approvals", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); const original = (await c.inspect()).active!.execution!.legs["usdc-payment"]!;
  f.clock.advance(900_001); await assert.rejects(sign(f, c, "usdc-payment"), /expired/);
  const retired = await c.retireUnsigned({ ...step(f, "usdc-payment"), approval: original.prepared.prepared.unsignedHash,
    originalPreparedAt: original.preparedAt, reference: "SIMULATED explicit unsigned retirement" });
  assert.equal(retired.active, null); assert.equal(retired.archive[0]!.status, "expired-unpaid");
  assert.deepEqual(retired.archive[0]!.execution!.retiredUnsigned[0]!.prepared, original.prepared);
  assert.equal(f.count("nearSubmit"), 0); assert.equal(f.count("evmSubmit"), 0);
}));

test("expired unsigned Treasury preparation can be retired without cancelling finalized payment", async () => sandbox(async (f, c) => {
  await paid(f, c); await prepare(f, c, "link-delivery");
  const previous = (await c.inspect()).active!.execution!, entry = previous.legs["link-delivery"]!;
  f.clock.advance(900_001);
  const retired = await c.retireUnsigned({ ...step(f, "link-delivery"), approval: entry.prepared.prepared.unsignedHash,
    originalPreparedAt: entry.preparedAt, reference: "SIMULATED delivery unsigned retirement" });
  assert.equal(retired.active!.execution!.paymentClaim, previous.paymentClaim); assert.equal(retired.active!.execution!.legs["link-delivery"], null);
  assert.equal(retired.active!.releasedAt, null); assert.equal(retired.active!.execution!.retiredUnsigned.length, 1);
  assert.equal((await prepare(f, c, "link-delivery")).active!.status, "settling");
}));

test("the30-second read-only recovery audit fails closed without changing state or submitting", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment"); f.clock.advance(900_001);
  const input = await broadcastInput(f, c, "usdc-payment", true), before = await readFile(f.journalFile, "utf8");
  f.controls.lookupDelayMs = 30_001;
  await assert.rejects(c.auditBroadcast(input), /30 seconds/);
  assert.equal(await readFile(f.journalFile, "utf8"), before); assert.equal(f.count("evmSubmit"), 0);
}));

test("audit expiry after a durable submission marker never sends and cannot be retried automatically", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment");
  const approval = await broadcastInput(f, c, "usdc-payment"); let advanced = false;
  const controlled = createPurchaseCoordinator({ ...f.driver, now() {
    if (!advanced && /"status":\s*"evm-submitting"/.test(readFileSync(f.journalFile, "utf8"))) { advanced = true; f.clock.advance(30_001); }
    return f.clock.now();
  } }, { root: f.root });
  const result = await controlled.broadcast(approval), entry = result.active!.execution!.legs["usdc-payment"]!;
  assert.equal(entry.status, "evm-uncertain"); assert.ok(entry.evmAttempt); assert.equal(f.count("evmSubmit"), 0);
  await assert.rejects(c.broadcast(approval), /reconcile prior attempts/);
  const reconciled = await c.reconcile(step(f, "usdc-payment")); assert.equal(reconciled.active!.execution!.legs["usdc-payment"]!.status, "evm-uncertain");
}));

test("a shorter payment-fee deadline is rechecked after the durable EVM marker within the30-second audit window", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment");
  f.controls.costTransform = value => ({ ...value, expiresAt: new Date(f.clock.now() + 1000).toISOString() });
  const approval = await broadcastInput(f, c, "usdc-payment"); let advanced = false;
  const controlled = createPurchaseCoordinator({ ...f.driver, now() {
    if (!advanced && /"status":\s*"evm-submitting"/.test(readFileSync(f.journalFile, "utf8"))) { advanced = true; f.clock.advance(1001); }
    return f.clock.now();
  } }, { root: f.root });
  const result = await controlled.broadcast(approval);
  assert.equal(result.active!.execution!.legs["usdc-payment"]!.status, "evm-uncertain"); assert.equal(f.count("evmSubmit"), 0);
  assert.equal(f.clock.now() - Date.parse(result.active!.execution!.legs["usdc-payment"]!.audit!.checkedAt), 1001);
}));

test("fresh nonce mismatch, known hash or RPC timeout blocks broadcast without creating an attempt", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment"); const input = await broadcastInput(f, c, "usdc-payment");
  const before = await readFile(f.journalFile, "utf8");
  f.ledger.investorNonce++; await assert.rejects(c.auditBroadcast(input), /nonce/i); f.ledger.investorNonce--;
  f.controls.knownLookup = "usdc-payment"; await assert.rejects(c.auditBroadcast(input), /already known/); delete f.controls.knownLookup;
  f.controls.lookupFailure = "usdc-payment"; await assert.rejects(c.auditBroadcast(input), /timeout/); delete f.controls.lookupFailure;
  assert.equal(await readFile(f.journalFile, "utf8"), before); assert.equal(f.count("evmSubmit"), 0);
}));

test("a reverted delivery records gas and an attention-required outstanding obligation without automatic refund", async () => sandbox(async (f, c) => {
  await paid(f, c); f.controls.receipt["link-delivery"] = "failed";
  const result = await deliver(f, c, "link-delivery"), e = result.active!.execution!;
  assert.equal(result.active!.status, "attention-required"); assert.equal(e.legs["link-delivery"]!.status, "failed");
  assert.ok(e.paymentClaim && e.paidAt); assert.equal(e.actualCosts.evm[1]!.executionStatus, "failed");
  assert.equal(f.ledger.treasuryUsdc, 10_000_000n); assert.equal(f.ledger.investorLink, 900_000_000_000_000_000n);
  await assert.rejects(prepare(f, c, "link-delivery"), /already has/); await assert.rejects(prepare(f, c, "eth-delivery"), /Confirm LINK/);
  assert.equal(f.count("evmSubmit", "link-delivery"), 1); assert.equal(f.count("evmSubmit", "eth-delivery"), 0);
}));

test("an already known signed payment is reconciled read-only without inventing a local broadcast approval", async () => sandbox(async (f, c) => {
  await prepare(f, c, "usdc-payment"); await signAndReconcile(f, c, "usdc-payment");
  const input = await broadcastInput(f, c, "usdc-payment"), externallyKnownHash = f.observeExternal("usdc-payment");
  assert.equal(input.approval, externallyKnownHash); await assert.rejects(c.broadcast(input), /already known|stale confirmed nonce/);
  const result = await c.reconcile(step(f, "usdc-payment")), entry = result.active!.execution!.legs["usdc-payment"]!;
  assert.equal(result.active!.status, "settling"); assert.equal(entry.evmAttempt, null); assert.equal(entry.audit, null);
  assert.ok(entry.externalObservation); assert.equal(f.count("evmSubmit", "usdc-payment"), 0);
  assert.equal(result.paymentClaims.length, 1);
  await assert.rejects(c.broadcast(input), /reconcile prior attempts|signed/);
}));

test("a prior payment identity cannot be claimed by another purchase and failed claiming preserves the journal", async () => sandbox(async (f, c) => {
  await paid(f, c); await deliver(f, c, "link-delivery"); const completed = await deliver(f, c, "eth-delivery");
  const old = completed.archive[0]!.execution!.legs["usdc-payment"]!.proof!;
  const next = f.makeQuote("10", "second-purchase-attempt"), input = { quoteHash: next.quoteHash, leg: "usdc-payment" as const, role: "investor" as const };
  await f.setup(next); let journal = await c.prepare({ ...input, reference: "SIMULATED second order" });
  await c.sign({ ...input, approval: journal.active!.execution!.legs["usdc-payment"]!.prepared.prepared.unsignedHash,
    credentialPath: f.rolePaths.investor, reference: "SIMULATED second digest approval" });
  journal = await c.reconcileSigning(input); const execution = journal.active!.execution!;
  await c.broadcast({ ...input, approval: execution.legs["usdc-payment"]!.signed!.hash, paymentAuthorizationHash: execution.paymentAuthorization!.authorizationHash });
  f.controls.claimOverride = { transactionHash: old.transactionHash, logIndex: 2n };
  const before = await readFile(f.journalFile, "utf8"); await assert.rejects(c.reconcile(input));
  assert.equal(await readFile(f.journalFile, "utf8"), before);
  const unchanged = await c.inspect(); assert.equal(unchanged.paymentClaims.length, 1); assert.equal(unchanged.active!.execution!.paidAt, null);
}));

for (const stage of ["prepare", "sign", "audit", "complete"] as const) {
  test(`fresh LINK canonicality is required at ETH ${stage}, preserving the paid obligation without resending`, async () => sandbox(async (f, c) => {
    await paid(f, c); await deliver(f, c, "link-delivery");
    if (stage !== "prepare") await prepare(f, c, "eth-delivery");
    if (stage === "audit" || stage === "complete") await signAndReconcile(f, c, "eth-delivery");
    const approval = stage === "audit" || stage === "complete" ? await broadcastInput(f, c, "eth-delivery") : null;
    if (stage === "complete") await c.broadcast(approval!);
    const before = await readFile(f.journalFile, "utf8"), previous = (await c.inspect()).active!;
    const counts = { near: f.count("nearSubmit"), evm: f.count("evmSubmit") };
    // Keep historical proof replay valid. Only the NEW public canonicality read
    // reports the simulated reorg, proving that cached evidence cannot authorize ETH.
    let freshLinkReads = 0;
    const guarded = createPurchaseCoordinator({ ...f.driver, async inspectReceipt(q, prepared, signed) {
      if (prepared.leg === "link-delivery") {
        freshLinkReads++; throw new Error("SIMULATED fresh LINK canonicality failed after reorg");
      }
      return f.driver.inspectReceipt(q, prepared, signed);
    } }, { root: f.root });
    const action = stage === "prepare" ? () => prepare(f, guarded, "eth-delivery") :
      stage === "sign" ? () => sign(f, guarded, "eth-delivery") :
        stage === "audit" ? () => guarded.auditBroadcast(approval!) : () => guarded.reconcile(step(f, "eth-delivery"));
    await assert.rejects(action(), /fresh LINK canonicality/);
    assert.ok(freshLinkReads > 0); assert.equal(await readFile(f.journalFile, "utf8"), before);
    const retained = (await c.inspect()).active!;
    assert.equal(retained.status, "partially-delivered"); assert.equal(retained.releasedAt, null);
    assert.equal(retained.execution!.paidAt, previous.execution!.paidAt);
    assert.equal(retained.execution!.paymentClaim, previous.execution!.paymentClaim);
    assert.equal(f.count("nearSubmit"), counts.near); assert.equal(f.count("evmSubmit"), counts.evm);
    assert.equal(f.count("evmSubmit", "link-delivery"), 1);
    await assert.rejects(prepare(f, guarded, "link-delivery"), /already has/);
    if (stage === "audit") {
      await assert.rejects(guarded.broadcast(approval!), /fresh LINK canonicality/);
      assert.equal(f.count("evmSubmit", "eth-delivery"), 0);
    }
    if (stage === "complete") {
      const completed = await c.reconcile(step(f, "eth-delivery"));
      assert.equal(completed.archive.at(-1)!.status, "completed");
      assert.equal(f.count("evmSubmit", "eth-delivery"), 1);
    }
  }));
}

test("completed realized-cost tampering is rejected even when the outer execution hash is resealed", async () => sandbox(async (f, c) => {
  await paid(f, c); await deliver(f, c, "link-delivery"); const completed = await deliver(f, c, "eth-delivery");
  const record = completed.archive.at(-1)!, execution = record.execution!, original = await readFile(f.journalFile, "utf8");
  const costs = execution.realizedCosts as AuthorizedActualCosts, counts = { near: f.count("nearSubmit"), evm: f.count("evmSubmit") };
  try {
    for (const patch of [{ totalActualUsdcBaseUnitsCeil: costs.totalActualUsdcBaseUnitsCeil + 1n },
      { realizedFeeBpsCeil: costs.realizedFeeBpsCeil + 1n }, { asOf: new Date(f.clock.now() + 1).toISOString() }]) {
      const altered = sealExecution({ ...execution, realizedCosts: { ...costs, ...patch } });
      await writeFile(f.journalFile, encodeState({ ...completed,
        archive: completed.archive.map(item => item === record ? { ...item, execution: altered } : item) }));
      await assert.rejects(c.inspect(), /Realized purchase costs/);
      assert.equal(f.count("nearSubmit"), counts.near); assert.equal(f.count("evmSubmit"), counts.evm);
    }
  } finally { await writeFile(f.journalFile, original); }
  assert.deepEqual(await c.inspect(), completed);
}));

test("short Treasury funding validity is checked after signing preparation before any MPC submission", async () => sandbox(async (f, c) => {
  await paid(f, c); await prepare(f, c, "link-delivery");
  const before = await readFile(f.journalFile, "utf8"), paidClaim = (await c.inspect()).active!.execution!.paymentClaim;
  const guarded = createPurchaseCoordinator({ ...f.driver, async funding(q) {
    const result = await f.driver.funding(q); return { ...result, expiresAt: new Date(f.clock.now() + 1000).toISOString() };
  } }, { root: f.root });
  f.controls.prepareSigningDelayMs = 1001;
  await assert.rejects(sign(f, guarded, "link-delivery"), /funding observations expired/);
  assert.equal(await readFile(f.journalFile, "utf8"), before);
  assert.equal(f.count("prepareSigning", "link-delivery"), 1); assert.equal(f.count("nearSubmit", "link-delivery"), 0);
  assert.equal(f.count("evmSubmit", "link-delivery"), 0);
  assert.equal((await c.inspect()).active!.execution!.paymentClaim, paidClaim);
}));

test("short Treasury funding validity after the durable EVM marker prevents sending and preserves uncertainty", async () => sandbox(async (f, c) => {
  await paid(f, c); await prepare(f, c, "link-delivery"); await signAndReconcile(f, c, "link-delivery");
  const approval = await broadcastInput(f, c, "link-delivery"); let advanced = false;
  const guarded = createPurchaseCoordinator({ ...f.driver,
    async funding(q) { const result = await f.driver.funding(q); return { ...result, expiresAt: new Date(f.clock.now() + 1000).toISOString() }; },
    now() {
      if (!advanced && /"status":\s*"evm-submitting"/.test(readFileSync(f.journalFile, "utf8"))) { advanced = true; f.clock.advance(1001); }
      return f.clock.now();
    },
  }, { root: f.root });
  const journal = await guarded.broadcast(approval), entry = journal.active!.execution!.legs["link-delivery"]!;
  assert.equal(entry.status, "evm-uncertain"); assert.ok(entry.evmAttempt); assert.equal(f.count("evmSubmit", "link-delivery"), 0);
  assert.equal(f.clock.now() - Date.parse(entry.audit!.checkedAt), 1001);
  assert.ok(f.clock.now() < Date.parse(entry.audit!.expiresAt), "Funding expires inside the unchanged 30-second audit.");
  assert.equal(journal.active!.releasedAt, null); assert.ok(journal.active!.execution!.paidAt && journal.active!.execution!.paymentClaim);
  await assert.rejects(c.broadcast(approval), /reconcile prior attempts/);
  const reconciled = await c.reconcile(step(f, "link-delivery"));
  assert.equal(reconciled.active!.execution!.legs["link-delivery"]!.status, "evm-uncertain");
  assert.deepEqual(reconciled.active!.execution!.legs["link-delivery"]!.evmAttempt, entry.evmAttempt);
  assert.equal(f.count("nearSubmit", "link-delivery"), 1); assert.equal(f.count("evmSubmit", "link-delivery"), 0);
}));
