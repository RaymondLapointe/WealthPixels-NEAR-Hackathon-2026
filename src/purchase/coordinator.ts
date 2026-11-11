import { isDeepStrictEqual } from "node:util";
import { assertNearSubmissionRecord, assertNearSubmissionSuccessor } from "../near/submission.js";
import { purchaseMpcFundingModel } from "../near/mpc-funding.js";
import { authorizeEvmBroadcast } from "../evm/broadcast.js";
import { addPaymentClaim, paymentClaimId } from "./claims.js";
import { assessAuthorizedPurchaseCosts, valueAuthorizedActualCosts } from "./authorized-costs.js";
import { assertPaymentAuthorizationEligible, DEFAULT_PURCHASE_QUOTE_POLICY, type PurchaseQuotePolicy } from "./quote.js";
import { assertPrepaymentFunding, assertPublicFundingInventory, readPurchaseJournal, withPurchaseExecutionJournal,
  type PrepaymentRecord, type PurchaseJournal } from "./journal.js";
import { assertPurchaseExecution, executionPhase, initialExecution, makePaymentAuthorization, PURCHASE_LEGS,
  roleForLeg, sealExecution, validNearHash, type PurchaseBroadcastAudit, type PurchaseExecution,
  type PurchaseExecutionDriver, type PurchaseLegExecution } from "./settlement.js";
import type { PurchaseLeg } from "./legs.js";
import { check, fingerprint, frozen, hexHash, label, utc } from "./integrity.js";

export interface PurchaseStep { readonly quoteHash: string; readonly leg: PurchaseLeg; readonly role: "investor" | "treasury" }
export interface PurchaseBroadcastApproval extends PurchaseStep {
  readonly approval: string; readonly paymentAuthorizationHash: string;
  readonly recovery?: boolean; readonly expiredPreparationAcknowledgment?: string;
}
type Store = { current(): PurchaseJournal; commit(next: PurchaseJournal): Promise<void> };
const AGE = 15 * 60_000, AUDIT_AGE = 30_000;
function authContext(e: PurchaseExecution) {
  check(e.paymentAuthorization, "An existing hash-bound payment authorization is required.");
  const a = e.paymentAuthorization;
  return { quoteHash: a.quoteHash, priceSetHash: a.priceSetHash, checkedAt: a.checkedAt, authorizationHash: a.authorizationHash };
}
/** Every call performs one explicit step. No workflow loop, automatic resend, fee increase or replacement exists. */
export function createPurchaseCoordinator(driver: PurchaseExecutionDriver,
  options: { root?: string; policy?: PurchaseQuotePolicy } = {}) {
  const root = options.root ?? process.cwd(), policy = options.policy ?? DEFAULT_PURCHASE_QUOTE_POLICY;
  const now = () => { const n = driver.now(); check(Number.isSafeInteger(n) && n >= 0, "Invalid coordinator clock."); return n; };
  const at = () => new Date(now()).toISOString();
  const fresh = (entry: PurchaseLegExecution) => {
    const age = now() - utc(entry.preparedAt);
    check(age >= 0 && age <= AGE, "Transaction preparation expired; preserve its bytes and use the bound recovery or unsigned-retirement path.");
  };
  const freshAudit = (audit: PurchaseBroadcastAudit) => {
    check(now() >= utc(audit.checkedAt) && now() <= utc(audit.expiresAt), "Purchase audit expired; reconcile without retrying.");
    if (audit.leg === "usdc-payment") {
      check(audit.costAssessment && typeof audit.costAssessment === "object" && "expiresAt" in audit.costAssessment &&
        now() < utc(audit.costAssessment.expiresAt), "Economic observations expired before the payment send; nothing may be submitted.");
    } else {
      const evidence = audit.readEvidence as { funding?: { expiresAt?: unknown } };
      check(evidence.funding && now() < utc(evidence.funding.expiresAt), "Treasury funding observations expired before sending; reconcile without retrying.");
    }
  };
  const newPayment = (record: PrepaymentRecord) => check(now() >= utc(record.quote.createdAt) && now() < utc(record.quote.expiresAt),
    "The quote is no longer eligible for a NEW payment authorization; a new quote and approvals are required.");
  function active(store: Store, input: PurchaseStep): PrepaymentRecord {
    check(PURCHASE_LEGS.includes(input.leg) && input.role === roleForLeg(input.leg), "Explicit purchase leg and independent signing role are required.");
    const r = store.current().active;
    check(r && r.quote.quoteHash === hexHash(input.quoteHash), "No matching active purchase; completed purchases cannot be delivered again.");
    return r;
  }
  async function verifyStored(record: PrepaymentRecord): Promise<void> {
    const e = record.execution; if (!e) return;
    assertPurchaseExecution(record.quote, record.approval, e);
    check(e.mode === driver.mode, "Offline fixture execution state cannot be used by a live driver.");
    for (const leg of PURCHASE_LEGS) {
      const entry = e.legs[leg]; if (!entry) continue;
      driver.assertPrepared(record.quote, entry.prepared);
      if (entry.signed) {
        const signed = driver.assemble(record.quote, entry.prepared, entry.nearTransactionHash!, entry.nearOutcome);
        check(isDeepStrictEqual(signed, entry.signed), "Saved signed bytes no longer match the complete MPC proof.");
        driver.assertSigned(record.quote, entry.prepared, entry.signed);
      }
      if (entry.nearCost) check(isDeepStrictEqual(entry.nearCost, driver.nearCost(roleForLeg(leg), entry.nearTransactionHash!, entry.nearOutcome, leg)), "Actual NEAR costs differ from public outcomes.");
      if (entry.proof) await driver.replayReceipt(record.quote, entry.prepared, entry.signed!, {
        status: entry.proof.kind === "failed-purchase-leg" ? "failed" : entry.status === "confirmed" ? "confirmed" : "awaiting-finality", proof: entry.proof,
      } as Parameters<PurchaseExecutionDriver["replayReceipt"]>[3]);
    }
    check(isDeepStrictEqual(e.actualCosts, actualCosts(e)), "Actual cost ledger differs from durable leg evidence.");
    if (e.realizedCosts) {
      const accountingAt = e.realizedCosts.asOf;
      check(utc(accountingAt) <= utc(e.updatedAt) && isDeepStrictEqual(e.realizedCosts,
        valueAuthorizedActualCosts(record.quote, authContext(e), e.actualCosts, accountingAt, policy)),
        "Realized purchase costs differ from the preserved receipts and original approved conversion rates.");
    }
  }
  function actualCosts(e: PurchaseExecution) {
    return { evm: PURCHASE_LEGS.flatMap(leg => {
      const entry = e.legs[leg]; return entry && ["confirmed", "failed"].includes(entry.status) && entry.proof ? [entry.proof.feeObservation] : [];
    }), near: PURCHASE_LEGS.flatMap(leg => e.legs[leg]?.nearCost ? [e.legs[leg]!.nearCost!] : []) };
  }
  function changed(e: PurchaseExecution, patch: Partial<PurchaseExecution>, action: string, leg: PurchaseLeg | null, reference: string) {
    const timestamp = at();
    check(utc(timestamp) >= utc(e.updatedAt), "Coordinator clock moved backwards.");
    return sealExecution({ ...e, ...patch, updatedAt: timestamp, events: [...e.events,
      { at: timestamp, action, leg, reference: label(reference, "Action reference") }] });
  }
  function withLeg(e: PurchaseExecution, leg: PurchaseLeg, entry: PurchaseLegExecution) { return { ...e.legs, [leg]: entry }; }
  async function persist(store: Store, record: PrepaymentRecord, input: PurchaseExecution) {
    let e = sealExecution({ ...input, actualCosts: actualCosts(input) });
    const phase = executionPhase(e);
    if (phase === "completed") e = sealExecution({ ...e, realizedCosts: valueAuthorizedActualCosts(record.quote, authContext(e), e.actualCosts, e.updatedAt, policy) });
    const completed = phase === "completed";
    const nextRecord: PrepaymentRecord = { ...record, status: phase, execution: e, updatedAt: e.updatedAt, releasedAt: completed ? e.updatedAt : null };
    const current = store.current();
    let claims = current.paymentClaims;
    if (e.paymentClaim && !claims.includes(e.paymentClaim)) {
      const proof = e.legs["usdc-payment"]!.proof;
      check(proof?.kind === "verified-purchase-leg" && proof.paymentClaim, "A finalized payment proof is required for the atomic claim.");
      claims = addPaymentClaim(claims, proof.paymentClaim);
    }
    check(!e.paymentClaim || current.active?.execution?.paymentClaim === e.paymentClaim || !current.paymentClaims.includes(e.paymentClaim), "This payment has already funded a different purchase.");
    const next: PurchaseJournal = { ...current, revision: current.revision + 1, paymentClaims: claims,
      active: completed ? null : nextRecord, archive: completed ? [...current.archive, nextRecord] : current.archive };
    await store.commit(next); return next;
  }
  async function paidProof(record: PrepaymentRecord) {
    const e = record.execution;
    check(e?.paidAt && e.paymentClaim, "Finalized, atomically claimed USDC payment is required before Treasury delivery.");
    const p = e.legs["usdc-payment"]!;
    const result = await driver.inspectReceipt(record.quote, p.prepared, p.signed!);
    check(result.status === "confirmed" && result.proof.kind === "verified-purchase-leg" && result.proof.finality === "finalized" && result.proof.paymentClaim &&
      paymentClaimId(result.proof.paymentClaim) === e.paymentClaim && result.proof.blockHash === p.proof!.blockHash,
      "Accepted payment is no longer finalized/canonical; preserve obligations and reconcile before releasing inventory.");
  }
  async function remainingFunding(record: PrepaymentRecord, leg: PurchaseLeg, prepared?: PurchaseLegExecution["prepared"]) {
    const result = await driver.funding(record.quote), q = record.quote, f = result.inventory;
    assertPublicFundingInventory(f, at(), q);
    const native = q.costs.evm.find(item => item.leg === "treasury-eth-delivery")!, link = q.costs.evm.find(item => item.leg === "treasury-link-delivery")!;
    const buffered = (gas: bigint) => (gas * (10_000n + q.policy.execution.gasBufferBps) + 9999n) / 10_000n;
    const nativeReserve = leg === "eth-delivery" && prepared ? prepared.prepared.maximumFeeWei : buffered(native.estimatedGas) * native.maxFeePerGasWei;
    const linkReserve = leg === "link-delivery" ? prepared?.prepared.maximumFeeWei ?? buffered(link.estimatedGas) * link.maxFeePerGasWei : 0n;
    check(f.treasuryEthWei >= q.terms.quantities.ethWei + nativeReserve + linkReserve + q.policy.execution.operatingReserveWei &&
      (leg !== "link-delivery" || f.treasuryLinkBaseUnits >= q.terms.quantities.linkBaseUnits), "Remaining Treasury inventory, both delivery fees or operating reserve is insufficient.");
    const fundingModel = purchaseMpcFundingModel(result.fundingInputs, result.gasPriceYoctoNear);
    const nearReserve = q.costs.near.filter(item => item.payer === "treasury" &&
      !record.execution?.legs[item.leg === "treasury-link-delivery" ? "link-delivery" : "eth-delivery"]?.nearTransactionHash)
      .reduce((total) => total + BigInt(fundingModel.requiredSpendableYocto), 0n);
    check(f.treasurySpendableNearYocto >= nearReserve, "Treasury NEAR signing funding is insufficient.");
    check(now() < utc(result.expiresAt), "Treasury funding observations expired during validation.");
    return result;
  }
  async function confirmedLinkProof(record: PrepaymentRecord) {
    const entry = record.execution?.legs["link-delivery"];
    check(entry?.status === "confirmed" && entry.signed && entry.proof, "Confirm LINK before preparing native ETH with its fresh Treasury nonce.");
    const result = await driver.inspectReceipt(record.quote, entry.prepared, entry.signed);
    check(result.status === "confirmed" && result.proof.kind === "verified-purchase-leg" &&
      result.proof.transactionHash === entry.proof.transactionHash && result.proof.blockHash === entry.proof.blockHash,
      "Previously confirmed LINK delivery is no longer canonical/confirmed; preserve the settlement obligation and reconcile without redelivery.");
  }
  async function locked<T>(input: PurchaseStep, action: (store: Store, r: PrepaymentRecord) => Promise<T>) {
    return withPurchaseExecutionJournal(root, policy, async store => { const r = active(store, input); await verifyStored(r); return action(store, r); });
  }
  async function audit(record: PrepaymentRecord, input: PurchaseBroadcastApproval): Promise<PurchaseBroadcastAudit> {
    const e = record.execution, entry = e?.legs[input.leg];
    check(e && entry?.status === "signed" && entry.signed && entry.nearTransactionHash && !entry.evmAttempt && !entry.externalObservation, "Only an existing unsubmitted signed leg qualifies; reconcile prior attempts instead of repeating them.");
    check(input.approval === entry.signed.hash && input.paymentAuthorizationHash === e.paymentAuthorization?.authorizationHash,
      "Broadcast requires the exact signed hash and acknowledgment of the original payment authorization.");
    const start = now(), expired = start - utc(entry.preparedAt) > AGE;
    check(start >= utc(entry.preparedAt), "Preparation timestamp is in the future.");
    if (input.recovery) check(expired && input.expiredPreparationAcknowledgment === entry.preparedAt, "Recovery requires explicit original expired preparation acknowledgment.");
    else { fresh(entry); check(input.expiredPreparationAcknowledgment === undefined, "Expired acknowledgment is reserved for the bound recovery route."); }
    if (input.leg !== "usdc-payment") await paidProof(record);
    if (input.leg === "eth-delivery") await confirmedLinkProof(record);
    const [authority, outcome, preflight, lookup, costsOrFunds] = await Promise.all([
      driver.verifyAuthority(input.role), driver.readSigning(input.role, entry.nearTransactionHash),
      driver.recheck(record.quote, entry.prepared), driver.lookup(entry.prepared, entry.signed),
      input.leg === "usdc-payment" ? driver.collectCosts(record.quote) : remainingFunding(record, input.leg, entry.prepared),
    ]);
    check(isDeepStrictEqual(driver.assemble(record.quote, entry.prepared, entry.nearTransactionHash, outcome), entry.signed), "Fresh finalized MPC result does not authorize the original signed bytes.");
    check(!lookup.known && !lookup.receipt && lookup.confirmedNonce === entry.prepared.prepared.nonce && lookup.pendingNonce === entry.prepared.prepared.nonce,
      "Signed hash already known, nonce changed or lookup uncertain; reconcile without submitting.");
    const costAssessment = input.leg === "usdc-payment" ? assessAuthorizedPurchaseCosts(record.quote, authContext(e),
      (costsOrFunds as Awaited<ReturnType<PurchaseExecutionDriver["collectCosts"]>>).costs, at(), policy) : null;
    if (costAssessment) {
      check(costAssessment.eligible, "Fresh total expected execution fees exceed 10%; do not submit the unpaid payment.");
      const f = costsOrFunds as Awaited<ReturnType<PurchaseExecutionDriver["collectCosts"]>>;
      assertPrepaymentFunding(f.inventory, at(), record.quote, record.reservation, costAssessment, f.costs);
      check(f.inventory.investorUsdcBaseUnits >= record.quote.terms.investmentUsdcBaseUnits && f.inventory.investorEthWei >= entry.prepared.prepared.maximumFeeWei,
        "Investor payment funding changed before broadcasting.");
    }
    if (!input.recovery) fresh(entry);
    check(now() - start <= AUDIT_AGE, "Fresh purchase recovery/broadcast audit exceeded 30 seconds; nothing was submitted.");
    const body = { kind: "purchase-leg-broadcast-audit" as const, purchaseId: record.quote.purchaseId, quoteHash: record.quote.quoteHash,
      leg: input.leg, role: input.role, unsignedHash: entry.prepared.prepared.unsignedHash, signedHash: entry.signed.hash,
      nearHash: entry.nearTransactionHash, originalPreparedAt: entry.preparedAt, recovery: !!input.recovery,
      checkedAt: new Date(start).toISOString(), completedAt: at(), expiresAt: new Date(start + AUDIT_AGE).toISOString(),
      expiredPreparationAcknowledgment: input.recovery ? entry.preparedAt : null,
      paymentAuthorizationHash: e.paymentAuthorization!.authorizationHash,
      readEvidence: { authority, outcome, preflight, lookup, funding: costsOrFunds }, costAssessment };
    return frozen({ ...body, auditHash: fingerprint("purchase-leg-broadcast-audit-v1", body) });
  }
  return Object.freeze({
    async inspect() { const j = await readPurchaseJournal(root, policy); for (const r of [...j.archive, ...(j.active ? [j.active] : [])]) await verifyStored(r); return j; },
    async prepare(input: PurchaseStep & { reference: string }) {
      return locked(input, async (store, original) => {
        let r = original, e = r.execution ?? initialExecution(r.quote, driver.mode, at());
        let preparationEligibilityDeadline: string | undefined;
        check(!e.legs[input.leg], "This leg already has a preparation or attempt; reconcile it instead of duplicating delivery.");
        if (input.leg === "usdc-payment") {
          check(!r.execution && (r.status === "approved" || r.status === "payment-authorized") && r.approval, "An approved, unpaid quote is required for the first payment preparation.");
          newPayment(r);
          const observed = await driver.collectCosts(r.quote), eligibility = assertPaymentAuthorizationEligible(r.quote, r.approval,
            { role: "investor", approval: r.quote.quoteHash, asOf: at(), freshCosts: observed.costs }, policy);
          assertPrepaymentFunding(observed.inventory, at(), r.quote, r.reservation, eligibility.feeAssessment, observed.costs);
          preparationEligibilityDeadline = eligibility.expiresAt;
          if (!r.eligibility) r = { ...r, eligibility, authorizationInventory: observed.inventory };
        } else {
          await paidProof(r);
          if (input.leg === "eth-delivery") await confirmedLinkProof(r);
          await remainingFunding(r, input.leg);
        }
        const prepared = await driver.prepare(r.quote, input.leg); driver.assertPrepared(r.quote, prepared);
        if (input.leg === "usdc-payment") {
          newPayment(r);
          check(now() < utc(preparationEligibilityDeadline), "Fresh economic eligibility expired during payment preparation; nothing was submitted.");
        } else await remainingFunding(r, input.leg, prepared);
        const entry: PurchaseLegExecution = { prepared, preparedAt: at(), status: "prepared", signingApproval: null,
          nearTransactionHash: null, nearOutcome: null, signed: null, audit: null, evmAttempt: null, proof: null, receiptHistory: [], nearCost: null };
        e = changed(e, { legs: withLeg(e, input.leg, entry), attention: null }, "prepared", input.leg, input.reference);
        return persist(store, r, e);
      });
    },
    async sign(input: PurchaseStep & { approval: string; reference: string; credentialPath: string }) {
      return locked(input, async (store, r) => {
        let e = r.execution; const entry = e?.legs[input.leg];
        check(e && entry?.status === "prepared" && !entry.nearTransactionHash && input.approval === entry.prepared.prepared.unsignedHash, "Signing requires a fresh unattempted leg and exact unsigned-digest approval.");
        fresh(entry); await driver.recheck(r.quote, entry.prepared);
        let authorization = e.paymentAuthorization;
        let fundingDeadline: string | undefined;
        if (input.leg === "usdc-payment") {
          check(!authorization && r.approval, "Payment signing authorization was already consumed."); newPayment(r);
          const observed = await driver.collectCosts(r.quote);
          const eligibility = assertPaymentAuthorizationEligible(r.quote, r.approval, { role: "investor", approval: r.quote.quoteHash, asOf: at(), freshCosts: observed.costs }, policy);
          assertPrepaymentFunding(observed.inventory, at(), r.quote, r.reservation, eligibility.feeAssessment, observed.costs);
          authorization = makePaymentAuthorization(r.quote, r.approval, input.approval, eligibility, input.reference);
        } else { await paidProof(r); if (input.leg === "eth-delivery") await confirmedLinkProof(r);
          fundingDeadline = (await remainingFunding(r, input.leg, entry.prepared)).expiresAt; }
        fresh(entry);
        const submissionDeadlineMs = Math.min(utc(entry.preparedAt) + AGE, input.leg === "usdc-payment" ?
          Math.min(utc(r.quote.expiresAt), utc(authorization!.eligibility.expiresAt)) : utc(fundingDeadline));
        const packet = await driver.prepareSigning(input.role, input.approval, input.credentialPath, submissionDeadlineMs);
        fresh(entry); if (input.leg === "usdc-payment") { newPayment(r); check(now() < utc(authorization!.eligibility.expiresAt), "Economic eligibility expired before the first MPC submission."); }
        else check(fundingDeadline && now() < utc(fundingDeadline), "Treasury funding observations expired before the first MPC submission.");
        validNearHash(packet.transactionHash);
        check(packet.signerAccountId === r.quote.transactions[PURCHASE_LEGS.indexOf(input.leg)]!.nearAccountId && packet.receiverId === "v1.signer-prod.testnet" &&
          packet.request.payload_v2.Ecdsa === input.approval.slice(2) && packet.request.domain_id === 0 && packet.request.path === "wealthpixels/sepolia/v1" &&
          packet.gasTgas === 100 && packet.depositYocto === "1", "Prepared direct MPC request differs from the exact approved purchase leg.");
        assertNearSubmissionRecord(packet.submission, { role: input.role, transactionHash: packet.transactionHash, digest: input.approval });
        const marked: PurchaseLegExecution = { ...entry, status: "near-submitting", nearTransactionHash: packet.transactionHash, nearSubmission: structuredClone(packet.submission),
          signingApproval: { digest: input.approval, reference: label(input.reference, "Signing approval reference"), at: at() } };
        e = changed(e, { paymentAuthorization: authorization, legs: withLeg(e, input.leg, marked) }, "near-submitting", input.leg, input.reference);
        await persist(store, r, e); // Hash and consumed authorization are durable before the sole submission capability.
        let status: "near-submitted" | "near-uncertain" = "near-submitted";
        try { fresh(marked); if (input.leg === "usdc-payment") { newPayment(r); check(now() < utc(authorization!.eligibility.expiresAt), "Economic eligibility expired after the durable marker."); }
          else check(fundingDeadline && now() < utc(fundingDeadline), "Treasury funding observations expired after the durable marker.");
          await packet.broadcastOnce(async next => {
            const current = store.current().active!, execution = current.execution!, latest = execution.legs[input.leg]!;
            assertNearSubmissionSuccessor(latest.nearSubmission!, next);
            await persist(store, current, changed(execution, { legs: withLeg(execution, input.leg,
              { ...latest, nearSubmission: structuredClone(next) }) }, "near-submission-observation", input.leg, input.reference));
          }); }
        catch { status = "near-uncertain"; }
        const current = store.current().active!; e = current.execution!;
        return persist(store, current, changed(e, { legs: withLeg(e, input.leg, { ...e.legs[input.leg]!, status }) }, status, input.leg, input.reference));
      });
    },
    async reconcileSigning(input: PurchaseStep) {
      return locked(input, async (store, r) => {
        const e = r.execution, entry = e?.legs[input.leg];
        check(e && entry?.nearTransactionHash && ["near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed"].includes(entry.status), "No existing NEAR signing attempt can be reconciled.");
        await driver.verifyAuthority(input.role);
        const outcome = await driver.readSigning(input.role, entry.nearTransactionHash);
        check(outcome && typeof outcome === "object" && "final_execution_status" in outcome && outcome.final_execution_status === "FINAL", "NEAR outcome is not FINAL; preserve its existing hash without retrying.");
        const failed = "status" in outcome && outcome.status && typeof outcome.status === "object" && "Failure" in outcome.status;
        const nearCost = driver.nearCost(input.role, entry.nearTransactionHash, outcome, input.leg);
        if (failed) return persist(store, r, changed(e, { legs: withLeg(e, input.leg, { ...entry, status: "near-failed", nearOutcome: outcome, nearCost }),
          attention: { at: at(), reference: "final-near-failure", reason: "Actual finalized NEAR execution failed; no new signing submission is automatic." } }, "near-failed", input.leg, "final-near-failure"));
        const signed = driver.assemble(r.quote, entry.prepared, entry.nearTransactionHash, outcome);
        if (entry.status === "signed") { check(isDeepStrictEqual(entry.signed, signed), "Reconciled signature changed existing signed bytes."); return store.current(); }
        const updated = { ...entry, status: "signed" as const, nearOutcome: outcome, nearCost, signed };
        return persist(store, r, changed(e, { legs: withLeg(e, input.leg, updated), attention: null }, "signed", input.leg, entry.nearTransactionHash));
      });
    },
    async auditBroadcast(input: PurchaseBroadcastApproval) { return locked(input, async (_store, r) => audit(r, input)); },
    async broadcast(input: PurchaseBroadcastApproval) {
      return locked(input, async (store, r) => {
        const a = await audit(r, input), e = r.execution!, entry = e.legs[input.leg]!;
        freshAudit(a);
        const sendOnce = authorizeEvmBroadcast(entry.signed!.serialized, entry.signed!.hash, input.approval, driver.broadcast);
        const marked: PurchaseLegExecution = { ...entry, status: "evm-submitting", audit: a,
          evmAttempt: { signedHash: entry.signed!.hash, at: at(), auditHash: a.auditHash } };
        await persist(store, r, changed(e, { legs: withLeg(e, input.leg, marked) }, "evm-submitting", input.leg, input.approval));
        let status: "evm-submitted" | "evm-uncertain" = "evm-submitted";
        try { freshAudit(a); if (!input.recovery) fresh(marked); await sendOnce(); }
        catch { status = "evm-uncertain"; }
        const current = store.current().active!, next = current.execution!;
        return persist(store, current, changed(next, { legs: withLeg(next, input.leg, { ...marked, status }) }, status, input.leg, input.approval));
      });
    },
    async reconcile(input: PurchaseStep) {
      return locked(input, async (store, r) => {
        const e = r.execution, entry = e?.legs[input.leg];
        check(e && entry?.signed && ["signed", "evm-submitting", "evm-submitted", "evm-uncertain", "observed", "confirmed", "failed"].includes(entry.status), "No existing signed EVM transaction can be reconciled.");
        let external = entry.externalObservation;
        if (!entry.evmAttempt && !external) {
          const lookup = await driver.lookup(entry.prepared, entry.signed);
          check(lookup.known || lookup.receipt, "The signed hash is not known to Sepolia; no submission or state reset occurred.");
          external = { signedHash: entry.signed.hash, at: at() };
        }
        const result = await driver.inspectReceipt(r.quote, entry.prepared, entry.signed);
        if (result.status === "not-mined") {
          if (entry.evmAttempt || entry.externalObservation) return store.current();
          return persist(store, r, changed(e, { legs: withLeg(e, input.leg, { ...entry, status: "evm-uncertain", externalObservation: external! }) },
            "externally-observed-signed-hash", input.leg, "Read-only discovery; no local broadcast was performed."));
        }
        const proof = result.proof;
        if (entry.status === "confirmed") { check(entry.proof?.blockHash === proof.blockHash && entry.proof.transactionHash === proof.transactionHash, "Previously accepted receipt changed; reconcile exceptional settlement without redelivery."); return store.current(); }
        const stage = result.status === "failed" ? "failed" : result.status === "confirmed" ? "confirmed" : "observed";
        if (input.leg === "eth-delivery" && stage === "confirmed") { await paidProof(r); await confirmedLinkProof(r); }
        const updated: PurchaseLegExecution = { ...entry, ...(external ? { externalObservation: external } : {}), status: stage, proof, receiptHistory: [...entry.receiptHistory, result] };
        let next = changed(e, { legs: withLeg(e, input.leg, updated), attention: result.status === "failed" ? {
          at: at(), reference: entry.signed.hash, reason: "Canonical transaction reverted; paid obligations remain outstanding and replacements require a separate decision." } : e.attention }, stage, input.leg, entry.signed.hash);
        if (input.leg === "usdc-payment" && result.status === "confirmed") {
          check(proof.kind === "verified-purchase-leg" && proof.finality === "finalized" && proof.paymentClaim, "USDC payment cannot be claimed before finality.");
          next = sealExecution({ ...next, paidAt: at(), paymentClaim: paymentClaimId(proof.paymentClaim) });
        }
        return persist(store, r, next); // Final paid state and unique claim commit atomically.
      });
    },
    async retireUnsigned(input: PurchaseStep & { approval: string; originalPreparedAt: string; reference: string }) {
      return locked(input, async (store, r) => {
        const e = r.execution, entry = e?.legs[input.leg];
        check(e && entry?.status === "prepared" && !entry.nearTransactionHash && !entry.signed && !entry.evmAttempt &&
          input.approval === entry.prepared.prepared.unsignedHash && input.originalPreparedAt === entry.preparedAt && now() - utc(entry.preparedAt) > AGE,
          "Only an acknowledged expired unsigned preparation without any signing/submission attempt may be retired.");
        const next = changed(e, { legs: { ...e.legs, [input.leg]: null }, attention: null,
          retiredUnsigned: [...e.retiredUnsigned, { leg: input.leg, prepared: entry.prepared, preparedAt: entry.preparedAt, retiredAt: at(), reference: input.reference }] },
          "retired-unsigned", input.leg, input.reference);
        if (input.leg !== "usdc-payment") return persist(store, r, next);
        check(!next.paymentAuthorization && !next.paidAt && now() >= utc(r.quote.expiresAt), "A consumed payment authorization cannot be expired as unpaid.");
        const record: PrepaymentRecord = { ...r, execution: next, status: "expired-unpaid", updatedAt: next.updatedAt, releasedAt: next.updatedAt };
        const current = store.current(), journal: PurchaseJournal = { ...current, revision: current.revision + 1, active: null, archive: [...current.archive, record] };
        await store.commit(journal); return journal;
      });
    },
  });
}
