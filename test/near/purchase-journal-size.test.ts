import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { decodeEncodedState, encodeState, saveEncodedState } from "../../src/execution/state.js";
import { reservePurchaseQuote, readPurchaseJournal, withPurchaseExecutionJournal, PURCHASE_JOURNAL_MAX_CHARACTERS,
  type PurchaseJournal, type PrepaymentRecord } from "../../src/purchase/journal.js";
import { DEFAULT_PURCHASE_QUOTE_POLICY } from "../../src/purchase/quote.js";
import { createPurchaseCoordinator } from "../../src/purchase/coordinator.js";
import { sealExecution, assertPurchaseExecution } from "../../src/purchase/settlement.js";
import { createPurchaseExecutionFixture } from "./fixtures/purchase-execution.js";
import { fixtureQuote, inventory, AT } from "./fixtures/purchase-quote.js";

const DEFAULT_LIMIT = 2_000_000;
const originalNow = Date.now, originalFetch = globalThis.fetch;
beforeEach(() => {
  Date.now = () => Date.parse(AT);
  globalThis.fetch = async () => { throw new Error("Network is prohibited in synthetic journal-size tests."); };
});
afterEach(() => { Date.now = originalNow; globalThis.fetch = originalFetch; });
async function sandbox(action: (root: string, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "wealthpixels-journal-size-offline-"));
  try { await action(root, join(root, ".local", "transfers", "purchase-journal.json")); }
  finally {
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-journal-size-offline-"))));
    await rm(root, { recursive: true, force: true });
  }
}
async function absent(path: string) {
  await assert.rejects(access(path), { code: "ENOENT" });
}
async function initial(root: string) {
  const quote = fixtureQuote("10", true, "offline-size-active", 2);
  return reservePurchaseQuote({ quote, expectedQuoteHash: quote.quoteHash, inventory: inventory(), asOf: AT }, root);
}

test("the default 2M decoder bound remains unchanged while the purchase-only bound is explicit", () => {
  const encoded = encodeState({ publicFixture: "offline only", value: 7n });
  const atDefaultLimit = encoded + " ".repeat(DEFAULT_LIMIT - encoded.length);
  assert.deepEqual(decodeEncodedState(atDefaultLimit), { publicFixture: "offline only", value: 7n });
  assert.throws(() => decodeEncodedState(atDefaultLimit + " "), /too large/);
  assert.equal(PURCHASE_JOURNAL_MAX_CHARACTERS, 32_000_000);
  assert.deepEqual(decodeEncodedState(atDefaultLimit + " ", PURCHASE_JOURNAL_MAX_CHARACTERS),
    { publicFixture: "offline only", value: 7n });
});

test("decoder bounds count UTF-16 characters and retain strict limit and bigint validation", () => {
  const text = encodeState({ publicFixture: "é😀", value: 9n });
  assert.ok(Buffer.byteLength(text, "utf8") > text.length);
  assert.deepEqual(decodeEncodedState(text, text.length), { publicFixture: "é😀", value: 9n });
  assert.throws(() => decodeEncodedState(text, text.length - 1), /too large/);
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => decodeEncodedState("{}", invalid), /Invalid runtime state size limit/);
  for (const malformed of ['{"value":{"$bigint":"1","extra":true}}', '{"value":{"$bigint":"01"}}',
    '{"value":{"$bigint":1}}', '{"value":{"$bigint":"' + "1".repeat(79) + '"}}', "{"]) {
    assert.throws(() => decodeEncodedState(malformed, PURCHASE_JOURNAL_MAX_CHARACTERS));
  }
});

test("bounded saves reject before opening a temporary file and preserve the previous committed bytes", async () => sandbox(async (root) => {
  const file = join(root, "synthetic-atomic-state.json"), value = { publicFixture: "é😀", value: 9n };
  const encoded = encodeState(value);
  await saveEncodedState(file, value, encoded.length);
  assert.equal(await readFile(file, "utf8"), encoded); await absent(file + ".tmp");
  await assert.rejects(saveEncodedState(file, { publicFixture: "X".repeat(encoded.length), value: 10n }, encoded.length), /too large/);
  assert.equal(await readFile(file, "utf8"), encoded); await absent(file + ".tmp");
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    await assert.rejects(saveEncodedState(file, value, invalid), /Invalid runtime state size limit/);
  assert.equal(await readFile(file, "utf8"), encoded); await absent(file + ".tmp");
  await writeFile(file + ".tmp", "synthetic interrupted write", { flag: "wx" });
  await assert.rejects(saveEncodedState(file, { oversized: "X".repeat(encoded.length) }, encoded.length), /too large/);
  assert.equal(await readFile(file + ".tmp", "utf8"), "synthetic interrupted write");
  await assert.rejects(saveEncodedState(file, value, encoded.length), { code: "EEXIST" });
  assert.equal(await readFile(file, "utf8"), encoded);
}));

test("unbounded legacy writer callers keep their prior behavior without enlarging default decoder limits", async () => sandbox(async root => {
  const file = join(root, "synthetic-legacy-writer.json"), value = { publicFixture: "X".repeat(DEFAULT_LIMIT), value: 3n };
  await saveEncodedState(file, value);
  const encoded = await readFile(file, "utf8");
  assert.throws(() => decodeEncodedState(encoded), /too large/);
  assert.deepEqual(decodeEncodedState(encoded, PURCHASE_JOURNAL_MAX_CHARACTERS), value);
  await absent(file + ".tmp");
}));

test("both purchase journal mutation paths read and save a valid >2M archive without changing V1/V2 history", async () => sandbox(async (root, file) => {
  await initial(root);
  const templates = new Map<1 | 2, PrepaymentRecord>();
  for (const version of [1, 2] as const) {
    const quote = fixtureQuote("10", true, "offline-size-template-" + version, version);
    // Obtain the exact version-bound reservation from the real pure journal workflow in another temporary root.
    await sandbox(async templateRoot => {
      const journal = await reservePurchaseQuote({ quote, expectedQuoteHash: quote.quoteHash, inventory: inventory(), asOf: AT }, templateRoot);
      templates.set(version, journal.active!);
    });
  }
  const estimate = Math.min(...[...templates.values()].map(record => encodeState(record).length));
  const count = Math.ceil(DEFAULT_LIMIT / estimate) + 8;
  const archive: PrepaymentRecord[] = Array.from({ length: count }, (_, index) => {
    const version: 1 | 2 = index % 2 === 0 ? 1 : 2;
    const quote = fixtureQuote("10", true, "offline-size-history-" + index, version), template = templates.get(version)!;
    return { ...template, quote, status: "expired-unpaid", updatedAt: quote.expiresAt, releasedAt: quote.expiresAt };
  });
  const synthetic: PurchaseJournal = { schemaVersion: 1, kind: "purchase-prepayment-journal",
    revision: count * 2, active: null, archive, paymentClaims: [] };
  const encoded = encodeState(synthetic);
  assert.ok(encoded.length > DEFAULT_LIMIT); assert.ok(encoded.length < PURCHASE_JOURNAL_MAX_CHARACTERS);
  await writeFile(file, encoded);
  assert.throws(() => decodeEncodedState(encoded), /too large/);
  assert.deepEqual(await readPurchaseJournal(root), synthetic);
  const nextQuote = fixtureQuote("10", true, "offline-size-following-purchase", 2);
  const reserved = await reservePurchaseQuote({ quote: nextQuote, expectedQuoteHash: nextQuote.quoteHash,
    inventory: inventory(), asOf: AT }, root);
  assert.deepEqual(reserved.archive, archive);
  assert.ok((await readFile(file, "utf8")).length > DEFAULT_LIMIT);
  const committed = await withPurchaseExecutionJournal(root, DEFAULT_PURCHASE_QUOTE_POLICY, async store => {
    const current = store.current(), next = { ...current, revision: current.revision + 1 };
    await store.commit(next);
    return store.current();
  });
  assert.deepEqual(committed.archive, archive);
  assert.equal(committed.active!.quote.quoteHash, nextQuote.quoteHash);
  assert.deepEqual(await readPurchaseJournal(root), committed);
  assert.ok((await readFile(file, "utf8")).length > DEFAULT_LIMIT);
  assert.equal(committed.archive[0]!.quote.schemaVersion, 1);
  assert.equal(committed.archive[1]!.quote.schemaVersion, 2);
  assert.equal(committed.archive[0]!.quote.expiresAt, templates.get(1)!.quote.expiresAt);
  assert.equal(committed.archive[1]!.quote.expiresAt, templates.get(2)!.quote.expiresAt);
  await absent(file + ".tmp"); await absent(file + ".lock");
}));

test("larger purchase capacity does not accept malformed JSON, corrupt bigint encodings or forged journal states", async () => sandbox(async (root, file) => {
  const valid = await initial(root), original = await readFile(file, "utf8");
  const malformed = [
    "{", '{"value":{"$bigint":"1","extra":true}}',
    encodeState({ ...valid, revision: -1 }),
    encodeState({ ...valid, active: { ...valid.active!, quote: { ...valid.active!.quote, quoteHash: "0x" + "00".repeat(32) } } }),
    encodeState({ ...valid, active: { ...valid.active!, status: "completed" } }),
  ];
  for (const text of malformed) {
    await writeFile(file, text);
    await assert.rejects(readPurchaseJournal(root));
    let reachedAction = false;
    await assert.rejects(withPurchaseExecutionJournal(root, DEFAULT_PURCHASE_QUOTE_POLICY, async () => { reachedAction = true; }));
    assert.equal(reachedAction, false);
    assert.equal(await readFile(file, "utf8"), text);
    await absent(file + ".tmp"); await absent(file + ".lock");
  }
  await writeFile(file, original);
  assert.deepEqual(await readPurchaseJournal(root), valid);
}));

test("purchase journal capacity remains bounded and rejects oversize input through both readers without rewriting it", async () => sandbox(async (root, file) => {
  await initial(root);
  const valid = await readFile(file, "utf8");
  const oversized = valid + " ".repeat(PURCHASE_JOURNAL_MAX_CHARACTERS + 1 - valid.length);
  await writeFile(file, oversized);
  await assert.rejects(readPurchaseJournal(root), /too large/);
  let reachedAction = false;
  await assert.rejects(withPurchaseExecutionJournal(root, DEFAULT_PURCHASE_QUOTE_POLICY, async () => { reachedAction = true; }), /too large/);
  assert.equal(reachedAction, false);
  assert.equal(await readFile(file, "utf8"), oversized);
  await absent(file + ".tmp"); await absent(file + ".lock");
}));


test("an oversized structurally valid purchase execution commit fails before replacing its signed fixture journal", async () => {
  const f = await createPurchaseExecutionFixture();
  try {
    await f.setup();
    const coordinator = createPurchaseCoordinator(f.driver, { root: f.root });
    const input = { quoteHash: f.quote.quoteHash, leg: "usdc-payment" as const, role: "investor" as const };
    let journal = await coordinator.prepare({ ...input, reference: "SIMULATED size-guard preparation" });
    journal = await coordinator.sign({ ...input,
      approval: journal.active!.execution!.legs["usdc-payment"]!.prepared.prepared.unsignedHash,
      reference: "SIMULATED size-guard signing", credentialPath: f.rolePaths.investor });
    journal = await coordinator.reconcileSigning(input);
    const previous = journal.active!, execution = previous.execution!, leg = execution.legs["usdc-payment"]!;
    assert.equal(leg.status, "signed");
    const outcome = leg.nearOutcome as Record<string, unknown>;
    const oversizedExecution = sealExecution({ ...execution, legs: { ...execution.legs,
      "usdc-payment": { ...leg, nearOutcome: { ...outcome, offlineSizeFixturePadding: "X".repeat(PURCHASE_JOURNAL_MAX_CHARACTERS) } } } });
    // The failure must be the storage bound, not an invalid hash, status, approval or transaction binding.
    assertPurchaseExecution(previous.quote, previous.approval, oversizedExecution);
    const next: PurchaseJournal = { ...journal, revision: journal.revision + 1,
      active: { ...previous, execution: oversizedExecution } };
    assert.ok(encodeState(next).length > PURCHASE_JOURNAL_MAX_CHARACTERS);
    const before = await readFile(f.journalFile, "utf8");
    await assert.rejects(withPurchaseExecutionJournal(f.root, DEFAULT_PURCHASE_QUOTE_POLICY,
      async store => { await store.commit(next); }), /Transfer state is too large/);
    assert.equal(await readFile(f.journalFile, "utf8"), before);
    assert.deepEqual(await readPurchaseJournal(f.root), journal);
    await absent(f.journalFile + ".tmp"); await absent(f.journalFile + ".lock");
    assert.equal(f.count("nearSubmit"), 1); assert.equal(f.count("evmSubmit"), 0);
  } finally { await f.cleanup(); }
});
