import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { open, readFile, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPurchaseCoordinator } from "../../src/purchase/coordinator.js";
import { authorizeReservedPayment, readPurchaseJournal, reservePurchaseQuote } from "../../src/purchase/journal.js";
import type { PurchaseLeg } from "../../src/purchase/legs.js";
import { createPurchaseExecutionFixture, type PurchaseExecutionFixture } from "./fixtures/purchase-execution.js";

const script = fileURLToPath(new URL("../../scripts/purchase.ts", import.meta.url));
const otherHash = `0x${"99".repeat(32)}`;
// Every command runs in a generated temporary root. The preload fixes the child
// clock and traps network, credential access and any project runtime-state I/O.
function run(f: PurchaseExecutionFixture, args: string[], at = f.clock.iso(), denyState = false) {
  const preload = "data:text/javascript," + encodeURIComponent(`
    import fs from 'node:fs';
    import promises from 'node:fs/promises';
    import http from 'node:http';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';
    const originalDate = Date, fixed = originalDate.parse(${JSON.stringify(at)});
    globalThis.Date = class extends originalDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
    const noNetwork = () => { process.stderr.write('UNEXPECTED_EXPIRY_NETWORK'); throw new Error('offline network trap'); };
    globalThis.fetch = async () => noNetwork();
    for (const transport of [http, https]) { transport.request = noNetwork; transport.get = noNetwork; }
    const root = ${JSON.stringify(f.root)}.replaceAll('\\\\', '/').toLowerCase() + '/';
    function guard(value) {
      const path = String(value).replaceAll('\\\\', '/').toLowerCase();
      if (/never_open_protected_role|not-a-credential/.test(path) || path.includes('/.near-credentials/') || path.endsWith('/.env') ||
          (path.includes('/.local/transfers') && (${denyState} || !path.startsWith(root)))) {
        process.stderr.write('UNEXPECTED_EXPIRY_FILE_ACCESS'); throw new Error('offline protected file trap');
      }
    }
    for (const method of ['readFile', 'writeFile', 'open', 'mkdir', 'stat', 'lstat', 'realpath', 'rename', 'unlink']) {
      const original = promises[method];
      promises[method] = async (path, ...args) => { guard(path); return original.call(promises, path, ...args); };
    }
    for (const method of ['readFileSync', 'writeFileSync', 'openSync', 'statSync', 'lstatSync', 'realpathSync']) {
      const original = fs[method];
      fs[method] = (path, ...args) => { guard(path); return original.call(fs, path, ...args); };
    }
    syncBuiltinESMExports();
  `);
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", preload, script, ...args], {
    cwd: f.root, encoding: "utf8", timeout: 20_000,
  });
}
const expiryArgs = (hash: string) => ["expire-unpaid", "--quote-hash", hash, "--approve", hash];
const expiredAt = (f: PurchaseExecutionFixture) => new Date(Date.parse(f.quote.expiresAt) + 1000).toISOString();
function safeResult(result: ReturnType<typeof run>, status: number) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, status, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr + result.stdout, /UNEXPECTED_EXPIRY_/);
}
async function sandbox(action: (f: PurchaseExecutionFixture) => Promise<void>) {
  const f = await createPurchaseExecutionFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No network permitted in expiry fixture tests."); };
  try { await action(f); }
  finally { globalThis.fetch = originalFetch; await f.cleanup(); }
}
async function unchangedFailure(f: PurchaseExecutionFixture, args = expiryArgs(f.quote.quoteHash), pattern = /retain reservation/) {
  const before = await readFile(f.journalFile, "utf8"), result = run(f, args, expiredAt(f));
  safeResult(result, 1); assert.match(result.stderr, pattern);
  assert.equal(await readFile(f.journalFile, "utf8"), before);
}

test("expire-unpaid help and invalid acknowledgments do not access state, credentials or RPC", async () => sandbox(async f => {
  const help = run(f, ["--help"], f.clock.iso(), true);
  safeResult(help, 0); assert.match(help.stdout, /expire-unpaid: --quote-hash HASH --approve HASH/);
  const hash = f.quote.quoteHash;
  for (const args of [
    ["expire-unpaid"], ["expire-unpaid", "--quote-hash", hash], ["expire-unpaid", "--approve", hash],
    ["expire-unpaid", "--quote-hash", "malformed", "--approve", hash],
    ["expire-unpaid", "--quote-hash", hash, "--approve", "malformed"],
    ["expire-unpaid", "--quote-hash", hash, "--approve", otherHash],
    ["expire-unpaid", "--quote-hash", hash.toUpperCase(), "--approve", hash],
    [...expiryArgs(hash), "--quote-hash", hash],
    ...["near-rpc", "evm-rpc", "credential", "reference", "as-of", "force"].map(flag => [...expiryArgs(hash), `--${flag}`, "NEVER_OPEN_PROTECTED_ROLE"]),
  ]) {
    safeResult(run(f, args, f.clock.iso(), true), 1);
    assert.deepEqual(await readdir(f.root), []);
  }
}));

test("expire-unpaid releases a quoted reservation once and preserves its accepted quote and inventory", async () => sandbox(async f => {
  await reservePurchaseQuote({ quote: f.quote, expectedQuoteHash: f.quote.quoteHash,
    inventory: (await f.driver.funding(f.quote)).inventory, asOf: f.clock.iso() }, f.root);
  const original = (await readPurchaseJournal(f.root)).active!;
  safeResult(run(f, expiryArgs(f.quote.quoteHash), expiredAt(f)), 0);
  const expired = await readPurchaseJournal(f.root), record = expired.archive[0]!;
  assert.equal(expired.revision, 2); assert.equal(expired.active, null); assert.equal(expired.archive.length, 1);
  assert.deepEqual(record, { ...original, status: "expired-unpaid", updatedAt: expiredAt(f), releasedAt: expiredAt(f) });
  assert.deepEqual(expired.paymentClaims, []);
  const before = await readFile(f.journalFile, "utf8");
  safeResult(run(f, expiryArgs(f.quote.quoteHash), expiredAt(f)), 1);
  assert.equal(await readFile(f.journalFile, "utf8"), before);
  assert.deepEqual(await readPurchaseJournal(f.root), expired);
}));

test("expire-unpaid preserves approval and historical records while allowing a new purchase ID", async () => sandbox(async f => {
  await f.setup();
  const original = (await readPurchaseJournal(f.root)).active!;
  safeResult(run(f, expiryArgs(f.quote.quoteHash), expiredAt(f)), 0);
  const first = (await readPurchaseJournal(f.root)).archive[0]!;
  assert.deepEqual(first.approval, original.approval);
  f.clock.set(expiredAt(f));
  const next = f.makeQuote("10", "offline-expiry-following-purchase");
  await f.setup(next);
  const result = run(f, expiryArgs(next.quoteHash), new Date(Date.parse(next.expiresAt) + 1000).toISOString());
  safeResult(result, 0);
  const journal = await readPurchaseJournal(f.root);
  assert.equal(journal.active, null); assert.equal(journal.archive.length, 2);
  assert.deepEqual(journal.archive[0], first); assert.equal(journal.archive[1]!.quote.quoteHash, next.quoteHash);
  assert.deepEqual(journal.paymentClaims, []);
}));

test("expire-unpaid rejects an unexpired quote, a wrong hash and a held journal lock without changing bytes", async () => sandbox(async f => {
  await f.setup();
  const before = await readFile(f.journalFile, "utf8"), result = run(f, expiryArgs(f.quote.quoteHash));
  safeResult(result, 1); assert.match(result.stderr, /Current clock/);
  assert.equal(await readFile(f.journalFile, "utf8"), before);
  await unchangedFailure(f, expiryArgs(otherHash), /No matching active purchase/);
  const lock = await open(f.journalFile + ".lock", "wx");
  try { await unchangedFailure(f, expiryArgs(f.quote.quoteHash), /locked/); }
  finally { await lock.close(); await unlink(f.journalFile + ".lock"); }
}));

test("expire-unpaid retains a payment-authorized reservation after expiry", async () => sandbox(async f => {
  await f.setup();
  const observations = await f.driver.collectCosts(f.quote);
  await authorizeReservedPayment({ expectedQuoteHash: f.quote.quoteHash, role: "investor", approval: f.quote.quoteHash,
    asOf: f.clock.iso(), freshCosts: observations.costs, inventory: observations.inventory }, f.root);
  await unchangedFailure(f);
  assert.equal((await readPurchaseJournal(f.root)).active!.status, "payment-authorized");
}));

test("expire-unpaid retains prepared, signing, signed, submitted, paid and partially delivered purchases", async () => sandbox(async f => {
  await f.setup();
  const c = createPurchaseCoordinator(f.driver, { root: f.root });
  async function advance(leg: PurchaseLeg) {
    const input = { quoteHash: f.quote.quoteHash, leg, role: leg === "usdc-payment" ? "investor" as const : "treasury" as const };
    let journal = await c.prepare({ ...input, reference: "SIMULATED offline expiry guard preparation" });
    assert.equal(journal.active!.execution!.legs[leg]!.status, "prepared"); await unchangedFailure(f);
    journal = await c.sign({ ...input, approval: journal.active!.execution!.legs[leg]!.prepared.prepared.unsignedHash,
      credentialPath: f.rolePaths[input.role], reference: "SIMULATED offline expiry guard approval" });
    assert.equal(journal.active!.execution!.legs[leg]!.status, "near-submitted"); await unchangedFailure(f);
    journal = await c.reconcileSigning(input);
    assert.equal(journal.active!.execution!.legs[leg]!.status, "signed"); await unchangedFailure(f);
    const execution = journal.active!.execution!;
    journal = await c.broadcast({ ...input, approval: execution.legs[leg]!.signed!.hash,
      paymentAuthorizationHash: execution.paymentAuthorization!.authorizationHash });
    assert.equal(journal.active!.execution!.legs[leg]!.status, "evm-submitted"); await unchangedFailure(f);
    return c.reconcile(input);
  }
  const paid = await advance("usdc-payment");
  assert.ok(paid.active!.execution!.paidAt && paid.active!.execution!.paymentClaim); await unchangedFailure(f);
  const partial = await advance("link-delivery");
  assert.equal(partial.active!.status, "partially-delivered"); await unchangedFailure(f);
  assert.equal(f.count("nearSubmit"), 2); assert.equal(f.count("evmSubmit"), 2);
}));

test("expire-unpaid preserves uncertain NEAR and EVM attempts for reconciliation", async () => sandbox(async f => {
  await f.setup();
  const c = createPurchaseCoordinator(f.driver, { root: f.root });
  const input = { quoteHash: f.quote.quoteHash, leg: "usdc-payment" as const, role: "investor" as const };
  let journal = await c.prepare({ ...input, reference: "SIMULATED offline uncertain expiry guard" });
  f.controls.nearSubmit["usdc-payment"] = "timeout-after";
  journal = await c.sign({ ...input, approval: journal.active!.execution!.legs["usdc-payment"]!.prepared.prepared.unsignedHash,
    credentialPath: f.rolePaths.investor, reference: "SIMULATED offline uncertain approval" });
  assert.equal(journal.active!.execution!.legs["usdc-payment"]!.status, "near-uncertain"); await unchangedFailure(f);
  journal = await c.reconcileSigning(input); const execution = journal.active!.execution!;
  f.controls.broadcast["usdc-payment"] = "timeout-after";
  journal = await c.broadcast({ ...input, approval: execution.legs["usdc-payment"]!.signed!.hash,
    paymentAuthorizationHash: execution.paymentAuthorization!.authorizationHash });
  assert.equal(journal.active!.execution!.legs["usdc-payment"]!.status, "evm-uncertain"); await unchangedFailure(f);
  assert.equal(f.count("nearSubmit"), 1); assert.equal(f.count("evmSubmit"), 1);
}));
