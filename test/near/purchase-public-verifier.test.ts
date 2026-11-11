import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Interface } from "ethers";
import { reconcilePurchasePublicObservations } from "../../src/evidence/purchase-reconcile.js";
import { verifyPurchaseEvidence } from "../../src/evidence/purchase-verify.js";
import { exportCompletedPurchaseEvidence, assertPurchaseEvidenceManifest, encodePurchaseEvidenceManifest, decodePurchaseEvidenceManifest,
  type PurchaseEvidenceManifest } from "../../src/evidence/purchase-manifest.js";
import type { PublicPurchaseLegVerification } from "../../src/evidence/purchase-leg.js";
import { PURCHASE_LEGS } from "../../src/purchase/settlement.js";
import { fingerprint } from "../../src/purchase/integrity.js";
import { completedPurchaseManifestFixture } from "./fixtures/purchase-manifest.js";

// This seam checks mathematical consistency ONLY. All three signatures,
// receipts, approvals and ledger movements below are explicitly simulated.
// Production verification retains real full-key/signature/RPC checks and never
// accepts this observation-injection seam as blockchain evidence.
let manifest: PurchaseEvidenceManifest, observations: readonly PublicPurchaseLegVerification[];
const abi = new Interface(["function transfer(address,uint256) returns(bool)"]);
before(async () => {
  const fixture = await completedPurchaseManifestFixture();
  manifest = exportCompletedPurchaseEvidence(fixture.record, fixture.recordedAt);
  observations = PURCHASE_LEGS.map(leg => {
    const entry = fixture.record.execution!.legs[leg]!;
    assert.equal(entry.proof!.kind, "verified-purchase-leg");
    return { transaction: { prepared: entry.prepared.prepared, signed: entry.signed! },
      proof: entry.proof, nearCost: entry.nearCost! } as PublicPurchaseLegVerification;
  });
});
const changed = (mutate: (values: any[]) => void) => { const values = structuredClone(observations) as any[]; mutate(values); return values; };
function resealManifest(mutate: (value: any) => void): PurchaseEvidenceManifest {
  const value = structuredClone(manifest); mutate(value);
  const { manifestHash: _old, ...body } = value;
  return { ...body, manifestHash: fingerprint("wealthpixels-portfolio-purchase-v1", body) };
}

test("three-leg fixture observations reconcile only to labelled consistency, with no live verification claim", () => {
  const result = reconcilePurchasePublicObservations(manifest, observations);
  assert.equal(result.status, "consistent-observations"); assert.equal(result.mode, "offline-fixture");
  assert.equal(result.executionProof, "none-caller-supplied-observations-only");
  assert.equal(result.historicalFinalityBeforeDelivery, "requires-separate-public-consensus-observation");
  assert.equal("publicFacts" in result, false); assert.equal("verified" in result, false);
  assert.deepEqual(result.actualCosts, manifest.actualCosts); assert.deepEqual(result.realizedCosts, manifest.realizedCosts);
  assert.deepEqual(result.settlement, manifest.settlement); assert.ok(Object.isFrozen(result));
});
test("historically expired quote/prices remain inspectable without changing their original validity", () => {
  assert.ok(Date.now() > Date.parse(manifest.quote.prices.expiresAt));
  assert.ok(Date.parse(manifest.recordedAt) > Date.parse(manifest.quote.expiresAt));
  const before = structuredClone(manifest);
  assert.equal(reconcilePurchasePublicObservations(manifest, observations).status, "consistent-observations");
  assert.deepEqual(manifest, before);
});
test("missing, extra and reversed observations cannot reconcile a complete purchase", () => {
  for (const values of [observations.slice(1), [...observations, observations[0]!], [...observations].reverse()]) {
    assert.throws(() => reconcilePurchasePublicObservations(manifest, values));
  }
});
for (const index of [0, 1, 2]) {
  test(`leg ${index + 1} rejects changed role, purchase association, signed hash and digest`, () => {
    for (const mutate of [(v: any) => v.proof.role = v.proof.role === "investor" ? "treasury" : "investor",
      (v: any) => v.proof.purchaseId = "different-purchase", (v: any) => v.proof.quoteHash = `0x${"00".repeat(32)}`,
      (v: any) => v.proof.transactionHash = `0x${"00".repeat(32)}`, (v: any) => v.proof.unsignedHash = `0x${"00".repeat(32)}`,
      (v: any) => v.transaction.signed.hash = `0x${"00".repeat(32)}`,
      (v: any) => v.transaction.signed.senderAddress = "0x1111111111111111111111111111111111111111"]) {
      assert.throws(() => reconcilePurchasePublicObservations(manifest, changed(values => mutate(values[index]))));
    }
  });
  test(`leg ${index + 1} rejects changed chain, nonce, gas and EIP-1559 parameters`, () => {
    for (const mutate of [(v: any) => v.transaction.prepared.chainId = 1n, (v: any) => v.transaction.prepared.nonce++,
      (v: any) => v.transaction.prepared.gasLimit++, (v: any) => v.transaction.prepared.maxFeePerGas++,
      (v: any) => v.transaction.prepared.maxPriorityFeePerGas++]) {
      assert.throws(() => reconcilePurchasePublicObservations(manifest, changed(values => mutate(values[index]))));
    }
  });
  test(`leg ${index + 1} rejects changed canonical block, finality and balances`, () => {
    for (const mutate of [(v: any) => v.proof.blockHash = `0x${"00".repeat(32)}`, (v: any) => v.proof.blockNumber++,
      (v: any) => v.proof.finality = "awaiting-finality", (v: any) => v.proof.after.recipientEth++,
      (v: any) => v.proof.before.senderEth++]) {
      assert.throws(() => reconcilePurchasePublicObservations(manifest, changed(values => mutate(values[index]))));
    }
  });
}
test("USDC and LINK exact calldata quantities and token contracts cannot be changed", () => {
  for (const index of [0, 1]) {
    const target = manifest.quote.transactions[index]!;
    for (const mutate of [(v: any) => v.transaction.prepared.tokenAddress = "0x1111111111111111111111111111111111111111",
      (v: any) => v.transaction.prepared.data = abi.encodeFunctionData("transfer", [target.recipientAddress, target.amountBaseUnits + 1n]),
      (v: any) => v.proof.tokenDeltas.recipient++, (v: any) => v.proof.after.recipientToken++]) {
      assert.throws(() => reconcilePurchasePublicObservations(manifest, changed(values => mutate(values[index]))));
    }
  }
});
test("native ETH value, recipient, empty calldata and preserved existing ETH are exact", () => {
  for (const mutate of [(v: any) => v.transaction.prepared.value++, (v: any) => v.transaction.prepared.data = "0x00",
    (v: any) => v.transaction.prepared.recipientAddress = manifest.authorities.roles.treasury.evmAddress,
    (v: any) => v.proof.nativeDeltas.recipient++, (v: any) => v.proof.after.recipientEth = manifest.quote.terms.quantities.ethWei]) {
    assert.throws(() => reconcilePurchasePublicObservations(manifest, changed(values => mutate(values[2]))));
  }
});
test("finalized payment must retain its exact chain:hash:TransferLogIndex identity", () => {
  for (const mutate of [(v: any) => delete v.proof.paymentClaim, (v: any) => v.proof.paymentClaim.logIndex++,
    (v: any) => v.proof.paymentClaim.chainId = 1n, (v: any) => v.proof.paymentClaim.transactionHash = observations[1]!.proof.transactionHash,
    (v: any) => v.proof.finality = "two-confirmations"]) {
    assert.throws(() => reconcilePurchasePublicObservations(manifest, changed(values => mutate(values[0]))));
  }
});
test("all EVM gas accounting and NEAR transaction/receipt costs must match preserved observations", () => {
  for (const index of [0, 1, 2]) for (const mutate of [(v: any) => v.proof.gasUsed++, (v: any) => v.proof.effectiveGasPriceWei++,
    (v: any) => v.proof.actualFeeWei++, (v: any) => v.proof.feeObservation.gasUsed++,
    (v: any) => v.nearCost.transactionTokensBurntYoctoNear++, (v: any) => v.nearCost.transactionHash = observations[(index + 1) % 3]!.nearCost.transactionHash,
    (v: any) => v.nearCost.receiptOutcomes[0].tokensBurntYoctoNear++, (v: any) => v.nearCost.refundedDepositYoctoNear = 1n]) {
    assert.throws(() => reconcilePurchasePublicObservations(manifest, changed(values => mutate(values[index]))));
  }
});
test("forged expected or actual totals cannot be accepted after resealing the outer manifest", () => {
  for (const mutate of [(m: any) => m.quote.feeAssessment.expectedFeeBpsCeil++, (m: any) => m.realizedCosts.realizedFeeBpsCeil++,
    (m: any) => m.realizedCosts.totalActualUsdcBaseUnitsCeil++, (m: any) => m.settlement.status = "partially-delivered"]) {
    assert.throws(() => reconcilePurchasePublicObservations(resealManifest(mutate), observations));
  }
});
test("production verifier rejects synthetic manifests before any public RPC request", async () => {
  let requests = 0;
  const result = await verifyPurchaseEvidence(manifest, { transport: { async request() { requests++; throw new Error("No network allowed"); } } });
  assert.equal(result.status, "failed"); assert.equal(result.stage, "manifest"); assert.equal(result.code, "INVALID_EVIDENCE");
  assert.equal(requests, 0); assert.deepEqual(result.completedChecks, []); assert.equal(result.publicFacts, undefined);
});
test("production pending placeholder remains incomplete and makes zero RPC requests", async () => {
  let requests = 0;
  const result = await verifyPurchaseEvidence({ schemaVersion: 1, kind: "wealthpixels-portfolio-purchase", mode: "live", status: "pending" },
    { transport: { async request() { requests++; throw new Error("No network allowed"); } } });
  assert.equal(result.status, "incomplete"); assert.equal(result.code, "PENDING"); assert.equal(requests, 0);
  assert.deepEqual(result.completedChecks, []); assert.equal(result.publicFacts, undefined);
});
test("fixture relabeling and contradictory or incomplete production declarations fail without RPC", async () => {
  const declared = resealManifest(m => {
    m.mode = "live"; m.disclosures.fixture = "Live execution claims require independent public NEAR and Sepolia verification; local validation alone is not blockchain proof.";
  });
  for (const candidate of [declared, { ...declared, status: "complete", legs: [] }, { schemaVersion: 1, kind: "wealthpixels-portfolio-purchase", mode: "live", status: "complete" }]) {
    let requests = 0;
    const result = await verifyPurchaseEvidence(candidate, { transport: { async request() { requests++; throw new Error("No network allowed"); } } });
    assert.equal(result.status, "failed"); assert.equal(result.code, "INVALID_EVIDENCE"); assert.equal(result.stage, "manifest"); assert.equal(requests, 0);
  }
});


test("V2 completed evidence remains historically inspectable after price expiry, including explicit signed recovery", async () => {
  for (const recoverSigned of [false, true]) {
    const sample = await completedPurchaseManifestFixture("10", recoverSigned, 2);
    const historical = exportCompletedPurchaseEvidence(sample.record, sample.recordedAt);
    const original = structuredClone(historical);
    assert.equal(historical.quote.schemaVersion, 2);
    assert.ok(Date.parse(historical.quoteApproval.approvedAt) > Date.parse(historical.quote.feeAssessment.expiresAt));
    assert.ok(Date.parse(historical.recordedAt) > Date.parse(historical.quote.prices.expiresAt));
    assert.ok(Date.parse(historical.paymentAuthorization.checkedAt) < Date.parse(historical.quote.prices.expiresAt));
    assertPurchaseEvidenceManifest(historical);
    assert.deepEqual(decodePurchaseEvidenceManifest(encodePurchaseEvidenceManifest(historical)), historical);
    const supplied = PURCHASE_LEGS.map(leg => {
      const entry = sample.record.execution!.legs[leg]!;
      return { transaction: { prepared: entry.prepared.prepared, signed: entry.signed! },
        proof: entry.proof, nearCost: entry.nearCost! } as PublicPurchaseLegVerification;
    });
    const result = reconcilePurchasePublicObservations(historical, supplied);
    assert.equal(result.status, "consistent-observations"); assert.equal(result.mode, "offline-fixture");
    assert.equal(result.executionProof, "none-caller-supplied-observations-only");
    assert.equal(result.settlement.status, "completed"); assert.deepEqual(historical, original);
    let requests = 0;
    const production = await verifyPurchaseEvidence(historical, { transport: {
      async request() { requests++; throw new Error("No network permitted for synthetic historical evidence"); },
    } });
    assert.equal(production.status, "failed"); assert.equal(production.stage, "manifest"); assert.equal(requests, 0);
  }
});
