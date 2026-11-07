import assert from "node:assert/strict";
import test, { before } from "node:test";
import { exportCompletedPurchaseEvidence, assertPurchaseEvidenceManifest, encodePurchaseEvidenceManifest, decodePurchaseEvidenceManifest,
  type PurchaseEvidenceManifest } from "../../src/evidence/purchase-manifest.js";
import { sealExecution } from "../../src/purchase/settlement.js";
import { fingerprint } from "../../src/purchase/integrity.js";
import { completedPurchaseManifestFixture } from "./fixtures/purchase-manifest.js";

let fixture: Awaited<ReturnType<typeof completedPurchaseManifestFixture>>, manifest: PurchaseEvidenceManifest;
before(async () => { fixture = await completedPurchaseManifestFixture(); manifest = exportCompletedPurchaseEvidence(fixture.record, fixture.recordedAt); });
function reseal(change: (value: any) => void): PurchaseEvidenceManifest {
  const value = structuredClone(manifest); change(value);
  const { manifestHash: _old, ...body } = value;
  return { ...body, manifestHash: fingerprint("wealthpixels-portfolio-purchase-v1", body) };
}

test("completed offline purchase exports all three legs, six costs and exact historical assumptions without live claims", () => {
  assert.equal(manifest.mode, "offline-fixture"); assert.equal(manifest.status, "complete");
  assert.equal(manifest.quote.terms.investmentUsdcBaseUnits, 10_000_000n);
  assert.equal(manifest.quote.terms.quantities.ethWei, 2_000_000_000_000_000n);
  assert.equal(manifest.quote.terms.quantities.linkBaseUnits, 500_000_000_000_000_000n);
  assert.equal(manifest.quote.feeAssessment.expectedCosts.length, 6);
  assert.equal(manifest.actualCosts.evm.length, 3); assert.equal(manifest.actualCosts.near.length, 3);
  assert.deepEqual(manifest.quote.prices, fixture.record.quote.prices);
  assert.equal(manifest.settlement.status, "completed"); assert.deepEqual(manifest.settlement.outstandingObligations, []);
  assert.match(manifest.disclosures.fixture, /no real onchain/); assert.match(manifest.disclosures.quoteAssociation, /operator-recorded/);
  assert.ok(Date.parse(manifest.recordedAt) > Date.parse(manifest.quote.expiresAt));
  assertPurchaseEvidenceManifest(manifest); assert.ok(Object.isFrozen(manifest.legs));
});
test("public purchase evidence preserves configurable 1,5,20 and100 USDC allocations", async () => {
  for (const amount of ["1", "5", "20", "100"]) {
    const sample = await completedPurchaseManifestFixture(amount), result = exportCompletedPurchaseEvidence(sample.record, sample.recordedAt);
    assert.equal(result.quote.terms.investmentUsdcBaseUnits, BigInt(amount) * 1_000_000n);
    assert.equal(result.legs[2]!.transaction.value, sample.record.quote.terms.quantities.ethWei);
    assert.deepEqual(decodePurchaseEvidenceManifest(encodePurchaseEvidenceManifest(result)), result);
  }
});
test("public extraction omits executable bytes, credential paths, raw RPC observations and local state", () => {
  const text = encodePurchaseEvidenceManifest(manifest);
  for (const forbidden of ["unsignedSerialized", '"serialized"', "credentialPath", "nearOutcome", "publicObservations", "readEvidence", "retiredUnsigned", ".local/", "purchase-journal.json"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  for (const leg of fixture.record.execution!.legs ? Object.values(fixture.record.execution!.legs) : []) {
    assert.equal(text.includes(leg!.signed!.serialized), false);
    assert.equal(text.includes(leg!.prepared.prepared.unsignedSerialized), false);
  }
  assert.ok(text.length < 200_000); assert.deepEqual(decodePurchaseEvidenceManifest(text), manifest);
});
test("export has no mode override and rejects a fixture record forged into live execution", () => {
  const record = structuredClone(fixture.record);
  assert.throws(() => exportCompletedPurchaseEvidence({ ...record,
    execution: sealExecution({ ...record.execution!, mode: "live" }) }, fixture.recordedAt));
  assert.throws(() => assertPurchaseEvidenceManifest(reseal(m => {
    m.mode = "live"; m.disclosures.fixture = "Live execution claims require independent public NEAR and Sepolia verification; local validation alone is not blockchain proof.";
  })), /Fixture provenance/);
});
test("only complete reconciled purchases with all independent human approval records can be exported", () => {
  const source = fixture.record;
  for (const change of [{ status: "partially-delivered" }, { status: "attention-required" }, { releasedAt: null }, { approval: null }]) {
    assert.throws(() => exportCompletedPurchaseEvidence({ ...source, ...change } as typeof source, fixture.recordedAt));
  }
  const leg = source.execution!.legs["eth-delivery"]!;
  assert.throws(() => exportCompletedPurchaseEvidence({ ...source, execution: sealExecution({ ...source.execution!, legs: {
    ...source.execution!.legs, "eth-delivery": { ...leg, audit: null, evmAttempt: null, externalObservation: { signedHash: leg.signed!.hash, at: leg.preparedAt } },
  } }) }, fixture.recordedAt), /approvals/);
});
test("manifest and nested quote, authorization, quantities and cost integrity cannot be altered", () => {
  for (const change of [(m: any) => m.quote.terms.investmentUsdcBaseUnits++, (m: any) => m.quote.prices.prices.ETH.numerator++,
    (m: any) => m.quote.feeAssessment.expectedFeeBpsCeil++, (m: any) => m.paymentAuthorization.eligibility.checkedAt = m.recordedAt,
    (m: any) => m.realizedCosts.totalActualUsdcBaseUnitsCeil++, (m: any) => m.actualCosts.near[0].transactionTokensBurntYoctoNear++]) {
    assert.throws(() => assertPurchaseEvidenceManifest(reseal(change)));
  }
  const changed = structuredClone(manifest); (changed as any).recordedAt = "2030-01-01T00:00:00.000Z";
  assert.throws(() => assertPurchaseEvidenceManifest(changed), /integrity/);
});
test("strict public schema rejects extra local/credential/executable keys and malformed public provenance", () => {
  for (const change of [(m: any) => m.private_key = "suppressed-test-placeholder", (m: any) => m.legs[0].transaction.serialized = "0x00",
    (m: any) => m.legs[0].receipt.localFile = "synthetic-local-file", (m: any) => m.legs[0].broadcast.extra = true,
    (m: any) => m.actualCosts.evm[0].extra = true, (m: any) => m.quote.policy.execution.extra = true,
    (m: any) => m.legs[0].signingApproval.reference = "C:\\Users\\operator\\credentials.json",
    (m: any) => m.legs[0].signingApproval.reference = "https://user:placeholder@example.invalid/reference"]) {
    assert.throws(() => assertPurchaseEvidenceManifest(reseal(change)));
  }
});
test("transaction identity binds chain, role, asset, recipient, exact amount, calldata and unsigned digest", () => {
  for (const change of [(m: any) => m.legs[0].role = "treasury", (m: any) => m.legs[0].transaction.chainId = 1n,
    (m: any) => m.legs[0].transaction.to = m.legs[1].transaction.to, (m: any) => m.legs[0].transaction.data = "0x",
    (m: any) => m.legs[2].transaction.value++, (m: any) => m.legs[2].transaction.data = "0x00",
    (m: any) => m.legs[0].transaction.nonce++, (m: any) => m.legs[0].unsignedHash = m.legs[1].unsignedHash,
    (m: any) => m.legs[0].transaction.gasLimit = 180_001n, (m: any) => m.legs[0].transaction.maxFeePerGas++]) {
    assert.throws(() => assertPurchaseEvidenceManifest(reseal(change)));
  }
});
test("hash uniqueness, sequential Treasury nonces and payment/LINK/ETH execution order are mandatory", () => {
  for (const change of [(m: any) => m.legs.reverse(), (m: any) => m.legs[1].nearTransactionHash = m.legs[0].nearTransactionHash,
    (m: any) => m.legs[1].evmTransactionHash = m.legs[0].evmTransactionHash,
    (m: any) => m.legs[2].transaction.nonce = m.legs[1].transaction.nonce,
    (m: any) => m.legs[1].receipt.blockNumber = m.legs[0].receipt.blockNumber,
    (m: any) => m.legs[2].receipt.blockNumber = m.legs[1].receipt.blockNumber]) {
    assert.throws(() => assertPurchaseEvidenceManifest(reseal(change)));
  }
});
test("payment finality, exact Transfer identity, settlement chronology and empty obligations are required", () => {
  for (const change of [(m: any) => m.legs[0].receipt.finality = "two-confirmations", (m: any) => m.legs[2].receipt.finality = "awaiting-finality",
    (m: any) => m.legs[0].receipt.paymentClaim.transactionHash = m.legs[1].evmTransactionHash,
    (m: any) => m.legs[0].receipt.paymentClaim.logIndex++, (m: any) => m.settlement.paymentClaim = "wrong-claim",
    (m: any) => m.settlement.paidAt = m.recordedAt, (m: any) => m.settlement.outstandingObligations = ["missing ETH"],
    (m: any) => m.recordedAt = m.quote.createdAt]) {
    assert.throws(() => assertPurchaseEvidenceManifest(reseal(change)));
  }
});
test("receipt gas, balance movements and actual cost attribution are recomputed rather than trusted", () => {
  for (const change of [(m: any) => m.legs[0].receipt.gasUsed++, (m: any) => m.legs[0].receipt.actualFeeWei++,
    (m: any) => m.legs[1].receipt.after.recipientToken++, (m: any) => m.legs[2].receipt.after.recipientEth++,
    (m: any) => m.legs[2].receipt.nativeDeltas.recipient++, (m: any) => m.actualCosts.evm[0].payer = "treasury",
    (m: any) => m.actualCosts.near[1].transactionHash = m.actualCosts.near[0].transactionHash,
    (m: any) => m.actualCosts.near[1].receiptOutcomes[0].receiptId = m.actualCosts.near[0].receiptOutcomes[0].receiptId,
    (m: any) => m.actualCosts.near[0].receiptOutcomes[0].receiptId = "malformed-public-receipt",
    (m: any) => m.actualCosts.near[0].originalAttachedDepositYoctoNear = 2n]) {
    assert.throws(() => assertPurchaseEvidenceManifest(reseal(change)));
  }
});
test("original expired-preparation recovery acknowledgment is preserved and cannot become a generic force flag", () => {
  assert.throws(() => assertPurchaseEvidenceManifest(reseal(m => { m.legs[0].broadcast.recovery = true; })), /acknowledgment/);
  assert.throws(() => assertPurchaseEvidenceManifest(reseal(m => { m.legs[0].broadcast.expiredPreparationAcknowledgment = m.legs[0].preparedAt; })), /acknowledgment/);
});
test("completed controlled recovery exports original preparation times without renewing historical pricing", async () => {
  const sample = await completedPurchaseManifestFixture("10", true), result = exportCompletedPurchaseEvidence(sample.record, sample.recordedAt);
  for (const leg of result.legs) {
    assert.equal(leg.broadcast.recovery, true); assert.equal(leg.broadcast.expiredPreparationAcknowledgment, leg.preparedAt);
    assert.ok(Date.parse(leg.broadcast.at) - Date.parse(leg.preparedAt) > 900_000);
    assert.equal(leg.preparedAt, sample.record.execution!.legs[leg.leg]!.preparedAt);
  }
  assert.deepEqual(result.quote.prices, sample.record.quote.prices);
  assertPurchaseEvidenceManifest(result);
});
test("bounded exact bigint codec rejects invalid encodings and never mutates the source record", () => {
  const before = structuredClone(fixture.record), text = encodePurchaseEvidenceManifest(manifest);
  for (const bad of [text.replace('"$bigint": "11155111"', '"$bigint": "011155111"'),
    text.replace('"$bigint": "11155111"', '"$bigint": 11155111'), " ".repeat(2_000_001)]) {
    assert.throws(() => decodePurchaseEvidenceManifest(bad));
  }
  assert.deepEqual(fixture.record, before);
});
