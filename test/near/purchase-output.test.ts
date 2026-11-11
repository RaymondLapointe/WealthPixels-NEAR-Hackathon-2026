import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compactPurchaseOutput, commandFailure, commandTiming, priceCommandOutput } from "../../src/purchase/operator-output.js";
import { createPurchaseCoordinator } from "../../src/purchase/coordinator.js";
import { readPurchaseJournal, reservePurchaseQuote } from "../../src/purchase/journal.js";
import { prepareDemonstrationPrices } from "../../src/purchase/prices.js";
import { createPurchaseExecutionFixture, type PurchaseExecutionFixture } from "./fixtures/purchase-execution.js";
import { AT, priceInput, seconds } from "./fixtures/purchase-quote.js";

const json = (value: unknown) => JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry);
async function sandbox(action: (f: PurchaseExecutionFixture) => Promise<void>) {
  const f = await createPurchaseExecutionFixture();
  try { await action(f); } finally { await f.cleanup(); }
}
test("compact quote output preserves six costs, exact terms, approval hash and independently labelled deadlines", async () => sandbox(async f => {
  const j = await reservePurchaseQuote({ quote: f.quote, expectedQuoteHash: f.quote.quoteHash,
    inventory: (await f.driver.funding(f.quote)).inventory, asOf: f.clock.iso() }, f.root);
  const result = compactPurchaseOutput(j, { command: "quote", startedAt: f.clock.iso(), outputAt: seconds(2) });
  const output = json(result);
  assert.equal(result.active!.quoteHash, f.quote.quoteHash);
  assert.equal(result.active!.quotePolicyVersion, f.quote.schemaVersion);
  assert.equal(result.active!.investmentUsdcBaseUnits, f.quote.terms.investmentUsdcBaseUnits);
  assert.equal(result.active!.quantities.ethWei, f.quote.terms.quantities.ethWei);
  assert.equal(result.active!.quantities.linkBaseUnits, f.quote.terms.quantities.linkBaseUnits);
  assert.equal(result.active!.expectedFees.components.length, 6);
  assert.equal(result.active!.expectedFees.originalExpiresAt, f.quote.feeAssessment.expiresAt);
  assert.equal(result.active!.quoteExpiresAt, f.quote.expiresAt);
  assert.equal(result.active!.remainingPurchaseValiditySecondsAtOutput, (Date.parse(f.quote.expiresAt) - Date.parse(seconds(2))) / 1000);
  assert.equal(result.copyApproval, "APPROVE QUOTE " + f.quote.quoteHash);
  assert.match(result.operatorActionRequired!, /^OPERATOR ACTION REQUIRED/);
  assert.equal(result.approvalInstruction, "COPY THIS APPROVAL INTO CODEX CHAT");
  assert.equal(result.active!.expectedFees.platformFee, false);
  assert.equal(result.active!.priceSetHash, f.quote.prices.setHash);
  assert.ok(output.length < 9000, "Compact quote must not repeat full cost snapshots, authority state or history.");
  assert.doesNotMatch(output, /fundingModel|originalObservedAt.*originalObservedAt|unsignedSerialized|rawBody/);
}));

test("output-time clocks never invent operator presentation or approval receipt timestamps", () => {
  const result = commandTiming({ command: "quote", startedAt: AT, outputAt: seconds(2) });
  assert.equal(result.elapsedMs, 2000);
  assert.equal(result.commandOutputAt, seconds(2));
  assert.equal(result.operatorPresentedAt, null); assert.equal(result.operatorApprovalReceivedAt, null);
  assert.match(result.timingMeaning, /UI delivery and human response times are unavailable/);
});

test("price proposal output includes original provenance, exact prices and only its actual approval digest", () => {
  const packet = prepareDemonstrationPrices(priceInput());
  const result = priceCommandOutput(packet, { command: "propose-prices", startedAt: AT, outputAt: seconds(3) });
  assert.equal(result.copyApproval, "APPROVE DEMONSTRATION PRICES " + packet.approvalDigest);
  assert.equal(result.displayPricesUsd.ETH, "2500");
  assert.deepEqual(result.prices, packet.prices);
  assert.equal(result.remainingPriceValiditySecondsAtOutput, 297);
});

test("expired quote output retains its identity but does not solicit an invalid approval", async () => sandbox(async f => {
  await f.setup(); const j = await readPurchaseJournal(f.root);
  const quoted = { ...j, active: { ...j.active!, status: "quoted" as const, approval: null } };
  const result = compactPurchaseOutput(quoted, { command: "quote", startedAt: f.clock.iso(), outputAt: f.quote.expiresAt });
  assert.equal(result.active!.remainingPurchaseValiditySecondsAtOutput, 0);
  assert.equal(result.active!.quoteHash, f.quote.quoteHash); assert.equal(result.copyApproval, undefined);
}));

test("prepared output requests only the exact digest and never includes transaction bytes", async () => sandbox(async f => {
  await f.setup(); const c = createPurchaseCoordinator(f.driver, { root: f.root });
  const j = await c.prepare({ quoteHash: f.quote.quoteHash, leg: "usdc-payment", role: "investor", reference: "SIMULATED output test" });
  const prepared = j.active!.execution!.legs["usdc-payment"]!.prepared.prepared;
  const result = compactPurchaseOutput(j, { command: "prepare", startedAt: f.clock.iso(), outputAt: f.clock.iso(), leg: "usdc-payment" });
  assert.match(result.copyApproval!, new RegExp(prepared.unsignedHash));
  assert.match(result.copyApproval!, /ONE INVESTOR NEAR MPC/); assert.match(result.copyApproval!, /No Ethereum broadcast/);
  assert.doesNotMatch(json(result), /unsignedSerialized|serialized|not-a-credential|nearOutcome|nearSubmission/i);
}));

test("signing uncertainty preserves status and offers reconciliation without a broadcast approval", async () => sandbox(async f => {
  await f.setup(); const c = createPurchaseCoordinator(f.driver, { root: f.root });
  const input = { quoteHash: f.quote.quoteHash, leg: "usdc-payment" as const, role: "investor" as const };
  let j = await c.prepare({ ...input, reference: "SIMULATED output uncertainty preparation" });
  f.controls.nearSubmit["usdc-payment"] = "timeout-after";
  j = await c.sign({ ...input, approval: j.active!.execution!.legs["usdc-payment"]!.prepared.prepared.unsignedHash,
    credentialPath: f.rolePaths.investor, reference: "SIMULATED output uncertainty signing" });
  const result = compactPurchaseOutput(j, { command: "sign", startedAt: f.clock.iso(), outputAt: f.clock.iso(), leg: input.leg });
  assert.equal(result.active!.legs!["usdc-payment"].status, "near-uncertain");
  assert.equal(result.copyApproval, undefined); assert.match(result.nextCheckpoint, /Reconcile/);
  assert.doesNotMatch(json(result), /serialized|nearOutcome|not-a-credential/i);
}));

test("signed reconciliation asks for a separate exact broadcast hash and preserves recovery acknowledgment", async () => sandbox(async f => {
  await f.setup(); const c = createPurchaseCoordinator(f.driver, { root: f.root });
  const input = { quoteHash: f.quote.quoteHash, leg: "usdc-payment" as const, role: "investor" as const };
  let j = await c.prepare({ ...input, reference: "SIMULATED output signing preparation" });
  j = await c.sign({ ...input, approval: j.active!.execution!.legs["usdc-payment"]!.prepared.prepared.unsignedHash,
    credentialPath: f.rolePaths.investor, reference: "SIMULATED output signing" });
  j = await c.reconcileSigning(input);
  const entry = j.active!.execution!.legs["usdc-payment"]!;
  const outputAt = new Date(Date.parse(entry.preparedAt) + 901_000).toISOString();
  const result = compactPurchaseOutput(j, { command: "reconcile-signing", startedAt: outputAt, outputAt, leg: input.leg });
  assert.match(result.copyApproval!, /BROADCAST RECOVERY ACKNOWLEDGING ORIGINAL PREPARED-AT/);
  assert.ok(result.copyApproval!.includes(entry.signed!.hash));
  assert.ok(result.copyApproval!.includes(j.active!.execution!.paymentAuthorization!.authorizationHash));
  assert.ok(result.copyApproval!.includes(entry.preparedAt));
  assert.doesNotMatch(json(result), /serialized|nearOutcome|not-a-credential/i);
}));

test("failure timestamps preserve safe guard reasons while excluding protected diagnostics", () => {
  const result = commandFailure(new Error("Approved quote expired or fee observations moved backwards"), "approve-quote", AT, seconds(61));
  assert.equal(result.guardRejectedAt, seconds(61)); assert.equal(result.commandFailedAt, seconds(61));
  assert.equal(result.operatorApprovalReceivedAt, null); assert.match(result.error, /quote expired/);
  assert.match(commandFailure(new Error("Payment authorization may be signed/submitted later; retain reservation"), "expire-unpaid", AT, AT).error, /retain reservation/);
  for (const error of ["ENOENT: open 'C:/NEVER_PUBLISH/role.json'", "EACCES: open '/protected/role.json'", "secret_key=NEVER_PUBLISH"]) {
    assert.doesNotMatch(json(commandFailure(new Error(error), "sign", AT, AT)), /NEVER_PUBLISH|protected\/role/);
  }
});

test("CLI guard rejection is one parseable diagnostic with command timestamps and no argument echo", () => {
  const script = fileURLToPath(new URL("../../scripts/purchase.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), script,
    "inspect-networks", "--credential", "C:/NEVER_PUBLISH/role.json"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  const failure = JSON.parse(result.stderr);
  assert.match(failure.error, /Unknown, duplicate or prohibited/);
  assert.ok(Date.parse(failure.commandFailedAt) >= Date.parse(failure.commandStartedAt));
  assert.equal(failure.operatorApprovalReceivedAt, null);
  assert.doesNotMatch(result.stderr, /NEVER_PUBLISH/);
});
