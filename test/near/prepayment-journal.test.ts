import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { mkdtemp, readFile, writeFile, rm, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { encodeState } from "../../src/execution/state.js";
import { reservePurchaseQuote, approveReservedPurchase, authorizeReservedPayment, expireUnpaidPurchase, readPurchaseJournal,
  type FundingInventorySnapshot } from "../../src/purchase/journal.js";
import { fixtureQuote, inventory, AT, seconds } from "./fixtures/purchase-quote.js";

// Each test uses an isolated temporary project root, synthetic observations,
// simulated approvals and a fixed trusted clock. No real project journal exists.
const originalNow = Date.now;
let clockMs = Date.parse(AT);
beforeEach(() => { clockMs = Date.parse(AT); Date.now = () => clockMs; });
afterEach(() => { Date.now = originalNow; });
const clock = (s: number) => { clockMs = Date.parse(seconds(s)); };
async function sandbox(action: (root: string, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "wealthpixels-prepayment-offline-"));
  try { await action(root, join(root, ".local", "transfers", "purchase-journal.json")); }
  finally {
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-prepayment-offline-"))), "Cleanup must remain in the generated test root.");
    await rm(root, { recursive: true, force: true });
  }
}
async function setup(root: string, approve = false) {
  const quote = fixtureQuote("10", true);
  await reservePurchaseQuote({ quote, expectedQuoteHash: quote.quoteHash, inventory: inventory(), asOf: AT }, root);
  if (approve) await approveReservedPurchase({ expectedQuoteHash: quote.quoteHash, role: "investor", approval: quote.quoteHash,
    reference: "SIMULATED offline investor approval", approvedAt: AT }, root);
  return quote;
}

test("journal reserves exact portfolio inventory, both Treasury EVM fee ceilings and operating funds across restarts", async () => sandbox(async (root, file) => {
  const q = await setup(root), journal = await readPurchaseJournal(root);
  assert.equal(journal.revision, 1); assert.equal(journal.active!.status, "quoted");
  assert.equal(journal.active!.reservation.linkBaseUnits, 500_000_000_000_000_000n);
  assert.equal(journal.active!.reservation.treasuryEthWei, 3_486_000_000_000_000n);
  assert.equal(journal.active!.reservation.investorMaxEvmFeeWei, 300_000_000_000_000n);
  assert.equal(journal.active!.reservation.investorMaxNearYocto, 102_913_918_400_603_200_000_001n);
  assert.equal(journal.active!.reservation.treasuryMaxNearYocto, 205_827_836_801_206_400_000_002n);
  assert.equal(journal.active!.quote.quoteHash, q.quoteHash); assert.equal(journal.paymentClaims.length, 0);
  assert.ok((await readFile(file, "utf8")).includes('"$bigint"'));
  const restarted = await readPurchaseJournal(root);
  assert.deepEqual(restarted, journal); assert.ok(Object.isFrozen(restarted.active!.quote));
}));

test("a second active purchase and reused purchase IDs are rejected without changing saved state", async () => sandbox(async (root, file) => {
  const q = await setup(root), before = await readFile(file, "utf8");
  await assert.rejects(reservePurchaseQuote({ quote: fixtureQuote("10", true, "second-order"),
    expectedQuoteHash: fixtureQuote("10", true, "second-order").quoteHash, inventory: inventory(), asOf: AT }, root), /active purchase/);
  assert.equal(await readFile(file, "utf8"), before);
  clock(60); await expireUnpaidPurchase({ expectedQuoteHash: q.quoteHash, asOf: seconds(60) }, root);
  // A historical ID remains consumed even when its unpaid reservation is released.
  clock(0);
  await assert.rejects(reservePurchaseQuote({ quote: q, expectedQuoteHash: q.quoteHash, inventory: inventory(), asOf: AT }, root), /reused/);
}));

test("missing, stale, wrong-network/token/role and insufficient Treasury inventory fail before reservation", async () => sandbox(async root => {
  const q = fixtureQuote("10", true), funds = inventory();
  for (const change of [{ chainId: 1n }, { treasuryAddress: funds.investorAddress }, { usdcTokenAddress: funds.linkTokenAddress },
    { treasuryNearAccountId: funds.investorNearAccountId },
    { treasuryEthWei: 3_486_000_000_000_000n - 1n }, { treasuryLinkBaseUnits: 499_999_999_999_999_999n },
    { observedAt: seconds(-60) }, { observedAt: seconds(1) }, { mode: "offline" },
    { blockHash: `0x${"99".repeat(32)}` }, { nearBlockHash: "invalid" }]) {
    await assert.rejects(reservePurchaseQuote({ quote: q, expectedQuoteHash: q.quoteHash, inventory: { ...funds, ...change } as FundingInventorySnapshot, asOf: AT }, root));
    assert.equal((await readPurchaseJournal(root)).active, null);
  }
}));

test("approval is a separate Investor hash-bound action and failed validation leaves the journal unchanged", async () => sandbox(async (root, file) => {
  const q = await setup(root), before = await readFile(file, "utf8");
  for (const change of [{ role: "treasury" as "investor" }, { approval: `0x${"00".repeat(32)}` }, { reference: "" }]) {
    await assert.rejects(approveReservedPurchase({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
      reference: "offline", approvedAt: AT, ...change }, root));
    assert.equal(await readFile(file, "utf8"), before);
  }
  const approved = await approveReservedPurchase({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
    reference: "SIMULATED offline approval", approvedAt: AT }, root);
  assert.equal(approved.active!.status, "approved"); assert.equal(approved.revision, 2);
  assert.equal(approved.active!.quote.quoteHash, q.quoteHash);
}));

test("prepayment eligibility records fresh costs and funding but grants no transaction execution permission", async () => sandbox(async root => {
  const q = await setup(root, true); clock(10);
  const result = await authorizeReservedPayment({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
    asOf: seconds(10), freshCosts: { ...q.costs, sampledAt: seconds(10) }, inventory: { ...inventory(), observedAt: seconds(10) } }, root);
  assert.equal(result.active!.status, "payment-authorized"); assert.equal(result.revision, 3);
  assert.equal(result.active!.eligibility!.executionAuthorized, false);
  assert.equal(result.active!.eligibility!.expiresAt, seconds(60));
  assert.equal(result.active!.quote.costs.sampledAt, AT);
  assert.equal(result.active!.eligibility!.freshCosts.sampledAt, seconds(10));
  assert.equal("nearTransactionHash" in result.active!, false); assert.equal("signed" in result.active!, false);
  assert.deepEqual(await readPurchaseJournal(root), result);
}));

test("authorization requires prior approval, fresh complete eligible observations and the Investor role", async () => sandbox(async (root, file) => {
  const q = await setup(root);
  const request = { expectedQuoteHash: q.quoteHash, role: "investor" as const, approval: q.quoteHash, asOf: AT, freshCosts: q.costs, inventory: inventory() };
  await assert.rejects(authorizeReservedPayment(request, root), /approved active/);
  await approveReservedPurchase({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash, reference: "offline", approvedAt: AT }, root);
  const before = await readFile(file, "utf8");
  for (const change of [{ role: "treasury" as "investor" }, { approval: `0x${"00".repeat(32)}` },
    { freshCosts: { ...q.costs, near: q.costs.near.slice(1) } },
    { freshCosts: { ...q.costs, evm: q.costs.evm.map(item => ({ ...item, observedBaseFeePerGasWei: 3_000_000_000n, assumedBaseFeePerGasWei: 3_000_000_000n })) } },
  ]) {
    await assert.rejects(authorizeReservedPayment({ ...request, ...change }, root));
    assert.equal(await readFile(file, "utf8"), before);
  }
}));

test("Investor USDC/gas and both NEAR authority balances must cover their respective maximum reserves", async () => sandbox(async (root, file) => {
  const q = await setup(root, true), before = await readFile(file, "utf8");
  for (const change of [{ investorUsdcBaseUnits: 9_999_999n }, { investorEthWei: 1n },
    { investorSpendableNearYocto: 1n }, { treasurySpendableNearYocto: 1n }, { treasuryEthWei: 1n },
    { treasuryLinkBaseUnits: 1n }, { observedAt: seconds(-60) }]) {
    await assert.rejects(authorizeReservedPayment({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
      asOf: AT, freshCosts: q.costs, inventory: { ...inventory(), ...change } }, root));
    assert.equal(await readFile(file, "utf8"), before);
  }
}));

test("fresh maximum fees cannot silently enlarge an immutable reservation even when expected fees remain eligible", async () => sandbox(async (root, file) => {
  const q = await setup(root, true), before = await readFile(file, "utf8");
  const higherCaps = { ...q.costs, evm: q.costs.evm.map(item => ({ ...item, maxFeePerGasWei: 6_000_000_000n })) };
  await assert.rejects(authorizeReservedPayment({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
    asOf: AT, freshCosts: higherCaps, inventory: inventory() }, root), /immutable reservation/);
  assert.equal(await readFile(file, "utf8"), before);
}));

test("an expired quote cannot be approved or authorized by backdating the supplied timestamp", async () => sandbox(async (root, file) => {
  const q = await setup(root), before = await readFile(file, "utf8"); clock(61);
  await assert.rejects(approveReservedPurchase({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
    reference: "offline", approvedAt: seconds(59) }, root), /Current clock/);
  assert.equal(await readFile(file, "utf8"), before);
  clock(0); await approveReservedPurchase({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash, reference: "offline", approvedAt: AT }, root);
  clock(61);
  await assert.rejects(authorizeReservedPayment({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
    asOf: seconds(59), freshCosts: { ...q.costs, sampledAt: seconds(59) }, inventory: { ...inventory(), observedAt: seconds(59) } }, root), /Current clock/);
}));

test("only explicitly expired unpaid quotes release reservations, while historical quotes remain unchanged", async () => sandbox(async root => {
  const q = await setup(root, true);
  await assert.rejects(expireUnpaidPurchase({ expectedQuoteHash: q.quoteHash, asOf: AT }, root));
  clock(60); const journal = await expireUnpaidPurchase({ expectedQuoteHash: q.quoteHash, asOf: seconds(60) }, root);
  assert.equal(journal.active, null); assert.equal(journal.archive.length, 1); assert.equal(journal.archive[0]!.status, "expired-unpaid");
  assert.equal(journal.archive[0]!.quote.quoteHash, q.quoteHash); assert.equal(journal.archive[0]!.releasedAt, seconds(60));
  assert.equal(journal.archive[0]!.quote.createdAt, AT); assert.equal(journal.archive[0]!.quote.expiresAt, seconds(60));
}));

test("authorized payment reservations survive expiry and restart until future reconciliation, blocking duplicate purchases", async () => sandbox(async (root, file) => {
  const q = await setup(root, true);
  await authorizeReservedPayment({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash, asOf: AT, freshCosts: q.costs, inventory: inventory() }, root);
  const before = await readFile(file, "utf8"); clock(300);
  await assert.rejects(expireUnpaidPurchase({ expectedQuoteHash: q.quoteHash, asOf: seconds(300) }, root), /retain reservation/);
  assert.equal(await readFile(file, "utf8"), before);
  const reloaded = await readPurchaseJournal(root); assert.equal(reloaded.active!.status, "payment-authorized");
  assert.equal(reloaded.active!.releasedAt, null); assert.equal(reloaded.active!.quote.quoteHash, q.quoteHash);
  clock(0);
  await assert.rejects(reservePurchaseQuote({ quote: q, expectedQuoteHash: q.quoteHash, inventory: inventory(), asOf: AT }, root), /active purchase/);
  await assert.rejects(authorizeReservedPayment({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash, asOf: AT, freshCosts: q.costs, inventory: inventory() }, root), /cannot be repeated/);
}));

test("exclusive journal locking and durable-write failures preserve the previous committed state", async () => sandbox(async (root, file) => {
  const q = await setup(root), before = await readFile(file, "utf8"), lock = await open(file + ".lock", "wx");
  try { await assert.rejects(readPurchaseJournal(root), /locked/); }
  finally { await lock.close(); await unlink(file + ".lock"); }
  await writeFile(file + ".tmp", "synthetic interrupted write", { flag: "wx" });
  await assert.rejects(approveReservedPurchase({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
    reference: "offline", approvedAt: AT }, root));
  assert.equal(await readFile(file, "utf8"), before); await unlink(file + ".tmp");
  assert.equal((await readPurchaseJournal(root)).active!.status, "quoted");
}));

test("journal corruption cannot reset an active purchase, forge paid status, inject claims or change quote/reservation data", async () => sandbox(async (root, file) => {
  await setup(root); const journal = await readPurchaseJournal(root), original = await readFile(file, "utf8");
  for (const changed of [{ ...journal, active: 0 }, { ...journal, paymentClaims: ["forged-paid-claim"] },
    { ...journal, active: { ...journal.active!, status: "paid" } },
    { ...journal, active: { ...journal.active!, reservation: { ...journal.active!.reservation, treasuryEthWei: 1n } } },
    { ...journal, active: { ...journal.active!, quote: { ...journal.active!.quote, expiresAt: seconds(300) } } },
    { ...journal, active: { ...journal.active!, nearTransactionHash: "forged" } },
  ]) {
    await writeFile(file, encodeState(changed)); await assert.rejects(readPurchaseJournal(root));
    await writeFile(file, original);
  }
  assert.deepEqual(await readPurchaseJournal(root), journal);
}));

test("offline journal computations require no network, credentials, signing or broadcasting ports", async () => sandbox(async root => {
  const previous = globalThis.fetch; globalThis.fetch = async () => { throw new Error("No network permitted"); };
  try {
    const q = await setup(root, true);
    const result = await authorizeReservedPayment({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash, asOf: AT, freshCosts: q.costs, inventory: inventory() }, root);
    assert.equal(result.active!.eligibility!.executionAuthorized, false);
  } finally { globalThis.fetch = previous; }
}));
