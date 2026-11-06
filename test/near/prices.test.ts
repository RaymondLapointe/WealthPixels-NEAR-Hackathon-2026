import assert from "node:assert/strict";
import test from "node:test";
import { prepareDemonstrationPrices, approveDemonstrationPrices, assertPriceSet, createDemonstrationPriceProvider,
  createOfflinePriceProvider, parseExactPriceDecimal, toFeePriceRates, type PriceSet } from "../../src/purchase/prices.js";
import { priceInput, prices, AT, seconds } from "./fixtures/purchase-quote.js";

test("approved demonstration prices preserve historical provenance and have an explicit current assumption validity", () => {
  const set = prices(true);
  assert.equal(set.mode, "approved-demonstration"); assert.ok(set.approval);
  assert.equal(set.prices.ETH.originalObservedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(set.prices.ETH.effectiveAt, AT); assert.equal(set.prices.ETH.numerator, 2500n);
  assertPriceSet(set, { purchaseId: set.purchaseId, asOf: seconds(299), purpose: "prepayment" });
  assert.ok(Object.isFrozen(set)); assert.ok(Object.isFrozen(set.prices.NEAR));
});
test("price approval requires the exact proposal digest, reference and valid approval time", () => {
  const packet = prepareDemonstrationPrices(priceInput());
  for (const input of [
    { approvedDigest: `0x${"00".repeat(32)}`, reference: "offline", approvedAt: AT },
    { approvedDigest: packet.approvalDigest, reference: "", approvedAt: AT },
    { approvedDigest: packet.approvalDigest, reference: "offline", approvedAt: seconds(-1) },
    { approvedDigest: packet.approvalDigest, reference: "offline", approvedAt: seconds(300) },
  ]) assert.throws(() => approveDemonstrationPrices(packet, input));
  assert.throws(() => approveDemonstrationPrices(packet, null as never));
  assert.throws(() => approveDemonstrationPrices({ ...packet, expiresAt: seconds(299) }, {
    approvedDigest: packet.approvalDigest, reference: "offline", approvedAt: AT }));
});
test("demonstration validity cannot exceed five minutes or silently extend past approval", () => {
  for (const changes of [{ expiresAt: seconds(301) }, { expiresAt: AT }, { validFrom: "2026-02-30T00:00:00.000Z" },
    { expiresAt: "invalid" }]) assert.throws(() => prepareDemonstrationPrices({ ...priceInput(), ...changes }));
  const set = prices(true);
  assert.throws(() => assertPriceSet(set, { purchaseId: set.purchaseId, asOf: seconds(300), purpose: "prepayment" }), /expired/);
  assert.throws(() => assertPriceSet(set, { purchaseId: set.purchaseId, asOf: seconds(-1), purpose: "prepayment" }), /not yet valid/);
});
test("all exact asset/USD identities and positive bounded rational values are mandatory", () => {
  const input = priceInput();
  for (const change of [{ numerator: 0n }, { numerator: -1n }, { denominator: 0n }, { numerator: 1n << 256n },
    { numerator: 2500 }, { quoteCurrency: "EUR" }, { asset: "LINK" }, { sourceReference: "" },
    { sourceUrl: "http://example.invalid" }, { sourceUrl: "https://user:placeholder@example.invalid" },
    { originalObservedAt: seconds(1) }]) {
    assert.throws(() => prepareDemonstrationPrices({ ...input, prices: { ...input.prices, ETH: { ...input.prices.ETH, ...change } } } as typeof input));
  }
  const missing = { ...input.prices }; delete (missing as Partial<typeof missing>).NEAR;
  assert.throws(() => prepareDemonstrationPrices({ ...input, prices: missing }));
});
test("decimal prices are parsed lexically with exact integers, never binary floats", () => {
  assert.deepEqual(parseExactPriceDecimal("3.69"), { numerator: 369n, denominator: 100n });
  assert.deepEqual(parseExactPriceDecimal("0.00000001"), { numerator: 1n, denominator: 100_000_000n });
  for (const value of [3.69, "0", "-1", "1e3", " 1", "1.", "0.0000000000000000000000000000000000001", "9".repeat(100)]) {
    assert.throws(() => parseExactPriceDecimal(value));
  }
});
test("price sets cannot be reused for another purchase or substituted under an approved hash", () => {
  const set = prices(true);
  assert.throws(() => assertPriceSet(set, { purchaseId: "another-purchase", asOf: AT, purpose: "prepayment" }));
  assert.throws(() => assertPriceSet(set, { purchaseId: set.purchaseId, asOf: AT, purpose: "prepayment", expectedPriceSetHash: `0x${"00".repeat(32)}` }));
  for (const changed of [{ ...set, mode: "offline-fixture" }, { ...set, providerId: "substitution" },
    { ...set, prices: { ...set.prices, LINK: { ...set.prices.LINK, numerator: 11n } } },
    { ...set, expiresAt: seconds(301) }, { ...set, approval: null }]) {
    assert.throws(() => assertPriceSet(changed as PriceSet, { purchaseId: set.purchaseId, asOf: AT, purpose: "prepayment" }));
  }
});
test("unapproved offline prices cannot authorize payment and are never an automatic fallback", async () => {
  const set = prices(), provider = createOfflinePriceProvider(set);
  assert.equal((await provider.getPrices({ purchaseId: set.purchaseId, asOf: AT, purpose: "offline" })).mode, "offline-fixture");
  await assert.rejects(provider.getPrices({ purchaseId: set.purchaseId, asOf: AT, purpose: "prepayment" }), /Unapproved/);
  assert.throws(() => createDemonstrationPriceProvider(set));
});
test("fee conversion clearly uses the approved assumption epoch while retaining original observation history", () => {
  const set = prices(true), rates = toFeePriceRates(set, { purchaseId: set.purchaseId, asOf: AT, purpose: "prepayment" });
  assert.equal(rates.NEAR.evidence, "approved-demonstration"); assert.equal(rates.NEAR.observedAt, AT);
  assert.match(rates.NEAR.reference, /original=2026-11-01/); assert.ok(rates.NEAR.approvalReference);
  assert.equal(rates.NEAR.expiresAt, seconds(300));
});
test("approved provider has no network access, hidden refresh or mutable aliases", async () => {
  const previous = globalThis.fetch; globalThis.fetch = async () => { throw new Error("No network allowed"); };
  try {
    const input = priceInput(), packet = prepareDemonstrationPrices(input), set = approveDemonstrationPrices(packet, {
      approvedDigest: packet.approvalDigest, reference: "offline simulated approval", approvedAt: AT });
    const provider = createDemonstrationPriceProvider(set);
    const result = await provider.getPrices({ purchaseId: set.purchaseId, asOf: AT, purpose: "prepayment" });
    assert.equal(result.setHash, set.setHash); assert.ok(Object.isFrozen(result.prices.ETH));
    await assert.rejects(provider.getPrices({ purchaseId: set.purchaseId, asOf: seconds(301), purpose: "prepayment" }));
  } finally { globalThis.fetch = previous; }
});
