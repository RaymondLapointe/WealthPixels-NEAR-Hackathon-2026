import { isDeepStrictEqual } from "node:util";
import { keccak256 } from "ethers";
import { baseDecode } from "near-api-js";
import type { PreparedMpcSigning } from "../near/signing.js";
import { assertNearSubmissionRecord, type NearSubmissionRecord } from "../near/submission.js";
import type { AuthorityRole } from "../near/config.js";
import type { EvmBroadcastTransport } from "../evm/broadcast.js";
import { VERIFIED_IDENTITIES } from "../near/identities.js";
import type { FundingInventorySnapshot } from "./journal.js";
import type { CompletePurchaseCosts } from "./costs.js";
import type { AuthorizedActualCosts } from "./authorized-costs.js";
import type { ActualEvmCost, ActualNearCost } from "./fee-eligibility.js";
import type { PurchaseQuote, QuoteApproval, PaymentEligibility } from "./quote.js";
import { assertPaymentAuthorizationEligible } from "./quote.js";
import type { PreparedPurchaseLeg, PurchaseLeg, PurchaseLegSigned, PurchaseLegReceiptResult, VerifiedPurchaseLeg, FailedPurchaseLegProof } from "./legs.js";
import { paymentClaimId } from "./claims.js";
import { check, fingerprint, frozen, hexHash, label, utc } from "./integrity.js";

export const PURCHASE_LEGS = ["usdc-payment", "link-delivery", "eth-delivery"] as const;
export type LegStatus = "prepared" | "near-submitting" | "near-submitted" | "near-uncertain" | "near-failed" | "signed" |
  "evm-submitting" | "evm-submitted" | "evm-uncertain" | "observed" | "confirmed" | "failed";
export interface PaymentAuthorization {
  readonly kind: "payment-authorization"; readonly quoteHash: string; readonly priceSetHash: string;
  readonly checkedAt: string; readonly unsignedHash: string; readonly reference: string;
  readonly eligibility: PaymentEligibility; readonly authorizationHash: string;
}
export interface PurchaseBroadcastAudit {
  readonly kind: "purchase-leg-broadcast-audit"; readonly purchaseId: string; readonly quoteHash: string; readonly leg: PurchaseLeg;
  readonly role: AuthorityRole; readonly unsignedHash: string; readonly signedHash: string; readonly nearHash: string;
  readonly originalPreparedAt: string; readonly recovery: boolean; readonly checkedAt: string; readonly completedAt: string;
  readonly expiresAt: string; readonly expiredPreparationAcknowledgment: string | null;
  readonly paymentAuthorizationHash: string; readonly readEvidence: unknown; readonly costAssessment: unknown;
  readonly auditHash: string;
}
export interface PurchaseLegExecution {
  readonly prepared: PreparedPurchaseLeg; readonly preparedAt: string; readonly status: LegStatus;
  readonly signingApproval: { readonly digest: string; readonly reference: string; readonly at: string } | null;
  readonly nearTransactionHash: string | null; readonly nearOutcome: unknown | null;
  readonly nearSubmission?: NearSubmissionRecord;
  readonly signed: PurchaseLegSigned | null; readonly audit: PurchaseBroadcastAudit | null;
  readonly evmAttempt: { readonly signedHash: string; readonly at: string; readonly auditHash: string } | null;
  /** Read-only discovery of the exact signed hash outside this process; never a local-send approval. */
  readonly externalObservation?: { readonly signedHash: string; readonly at: string };
  readonly proof: VerifiedPurchaseLeg | FailedPurchaseLegProof | null;
  readonly receiptHistory: readonly PurchaseLegReceiptResult[];
  readonly nearCost: ActualNearCost | null;
}
export interface PurchaseExecution {
  readonly schemaVersion: 1; readonly kind: "purchase-execution"; readonly mode: "live" | "offline-fixtures";
  readonly quoteHash: string; readonly startedAt: string; readonly updatedAt: string;
  readonly paymentAuthorization: PaymentAuthorization | null; readonly paidAt: string | null; readonly paymentClaim: string | null;
  readonly legs: Readonly<Record<PurchaseLeg, PurchaseLegExecution | null>>;
  readonly attention: { readonly at: string; readonly reference: string; readonly reason: string } | null;
  readonly events: readonly { readonly at: string; readonly action: string; readonly leg: PurchaseLeg | null; readonly reference: string }[];
  readonly retiredUnsigned: readonly { readonly leg: PurchaseLeg; readonly prepared: PreparedPurchaseLeg; readonly preparedAt: string; readonly retiredAt: string; readonly reference: string }[];
  readonly actualCosts: { readonly evm: readonly ActualEvmCost[]; readonly near: readonly ActualNearCost[] };
  readonly realizedCosts: AuthorizedActualCosts | null; readonly executionHash: string;
}
/** Trusted application ports. The production factory fixes real crypto/RPC implementations.
 * Offline test drivers are code-injected, never a CLI flag or data-only proof bypass. */
export interface PurchaseExecutionDriver {
  readonly mode: "live" | "offline-fixtures";
  now(): number;
  prepare(quote: PurchaseQuote, leg: PurchaseLeg): Promise<PreparedPurchaseLeg>;
  assertPrepared(quote: PurchaseQuote, prepared: PreparedPurchaseLeg): void;
  recheck(quote: PurchaseQuote, prepared: PreparedPurchaseLeg): Promise<unknown>;
  verifyAuthority(role: AuthorityRole): Promise<unknown>;
  prepareSigning(role: AuthorityRole, digest: string, credentialPath: string, submissionDeadlineMs?: number): Promise<PreparedMpcSigning>;
  readSigning(role: AuthorityRole, hash: string): Promise<unknown>;
  assemble(quote: PurchaseQuote, prepared: PreparedPurchaseLeg, nearHash: string, outcome: unknown): PurchaseLegSigned;
  assertSigned(quote: PurchaseQuote, prepared: PreparedPurchaseLeg, signed: PurchaseLegSigned): void;
  inspectReceipt(quote: PurchaseQuote, prepared: PreparedPurchaseLeg, signed: PurchaseLegSigned): Promise<PurchaseLegReceiptResult>;
  replayReceipt(quote: PurchaseQuote, prepared: PreparedPurchaseLeg, signed: PurchaseLegSigned, result: PurchaseLegReceiptResult): Promise<void>;
  lookup(prepared: PreparedPurchaseLeg, signed: PurchaseLegSigned): Promise<{ known: boolean; receipt: boolean; confirmedNonce: number; pendingNonce: number }>;
  collectCosts(quote: PurchaseQuote): Promise<{ costs: CompletePurchaseCosts; inventory: FundingInventorySnapshot }>;
  funding(quote: PurchaseQuote): Promise<{ inventory: FundingInventorySnapshot; gasPriceYoctoNear: bigint; expiresAt: string }>;
  nearCost(role: AuthorityRole, hash: string, outcome: unknown, leg: PurchaseLeg): ActualNearCost;
  readonly broadcast: EvmBroadcastTransport;
}
export function roleForLeg(leg: PurchaseLeg): AuthorityRole { return leg === "usdc-payment" ? "investor" : "treasury"; }
export function validNearHash(value: unknown): string {
  check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32, "Existing NEAR transaction hash is invalid.");
  return value;
}
export function makePaymentAuthorization(quote: PurchaseQuote, approval: QuoteApproval, unsignedHash: string,
  eligibility: PaymentEligibility, reference: string): PaymentAuthorization {
  const expected = assertPaymentAuthorizationEligible(quote, approval, { role: "investor", approval: quote.quoteHash,
    asOf: eligibility.checkedAt, freshCosts: eligibility.freshCosts }, quote.policy);
  check(isDeepStrictEqual(eligibility, expected), "Payment authorization has invalid economic evidence.");
  const body = { kind: "payment-authorization" as const, quoteHash: quote.quoteHash, priceSetHash: quote.prices.setHash,
    checkedAt: eligibility.checkedAt, unsignedHash: hexHash(unsignedHash), reference: label(reference, "Payment signing approval reference"), eligibility };
  return frozen({ ...body, authorizationHash: fingerprint("payment-authorization-v1", body) });
}
export function sealExecution(input: Omit<PurchaseExecution, "executionHash"> | PurchaseExecution): PurchaseExecution {
  const { executionHash: _old, ...body } = input as PurchaseExecution;
  return frozen({ ...body, executionHash: fingerprint("purchase-execution-v1", body) });
}
export function initialExecution(quote: PurchaseQuote, mode: PurchaseExecution["mode"], at: string): PurchaseExecution {
  return sealExecution({ schemaVersion: 1, kind: "purchase-execution", mode, quoteHash: quote.quoteHash, startedAt: at, updatedAt: at,
    paymentAuthorization: null, paidAt: null, paymentClaim: null, legs: { "usdc-payment": null, "link-delivery": null, "eth-delivery": null },
    attention: null, events: [], retiredUnsigned: [], actualCosts: { evm: [], near: [] }, realizedCosts: null });
}
export function executionPhase(e: PurchaseExecution): "executing" | "settling" | "partially-delivered" | "completed" | "attention-required" {
  if (e.attention) return "attention-required";
  if (!e.paidAt) return "executing";
  if (e.legs["link-delivery"]?.status === "confirmed" && e.legs["eth-delivery"]?.status === "confirmed") return "completed";
  if (e.legs["link-delivery"]?.status === "confirmed") return "partially-delivered";
  return "settling";
}
/** Local structural integrity only; the production driver additionally verifies full MPC signatures and replays receipt proofs. */
export function assertPurchaseExecution(quote: PurchaseQuote, approval: QuoteApproval | null, value: PurchaseExecution): void {
  check(value && value.schemaVersion === 1 && value.kind === "purchase-execution" && ["live", "offline-fixtures"].includes(value.mode) &&
    value.quoteHash === quote.quoteHash && isDeepStrictEqual(value, sealExecution(value)), "Purchase execution integrity failed.");
  check(utc(value.startedAt) >= utc(quote.createdAt) && utc(value.updatedAt) >= utc(value.startedAt), "Invalid purchase execution times.");
  check(Object.keys(value.legs).sort().join() === [...PURCHASE_LEGS].sort().join(), "Exactly three purchase leg slots are required.");
  if (value.paymentAuthorization) {
    check(approval, "Payment authorization requires Investor quote approval.");
    const a = value.paymentAuthorization;
    check(isDeepStrictEqual(a, makePaymentAuthorization(quote, approval, a.unsignedHash, a.eligibility, a.reference)) &&
      a.unsignedHash === value.legs["usdc-payment"]?.prepared.prepared.unsignedHash, "Payment authorization does not bind the original payment digest.");
  }
  for (const leg of PURCHASE_LEGS) {
    const entry = value.legs[leg]; if (!entry) continue;
    const p = entry.prepared, role = roleForLeg(leg), expected = quote.transactions[PURCHASE_LEGS.indexOf(leg)]!;
    check(p.purchaseId === quote.purchaseId && p.quoteHash === quote.quoteHash && p.leg === leg && p.role === role &&
      p.prepared.senderAddress === expected.senderAddress && p.prepared.recipientAddress === expected.recipientAddress &&
      ("amount" in p.prepared ? p.prepared.amount : p.prepared.amountWei) === expected.amountBaseUnits,
      "Purchase leg differs from the immutable quote or signing role.");
    hexHash(p.prepared.unsignedHash); check(utc(entry.preparedAt) >= utc(value.startedAt) && utc(entry.preparedAt) <= utc(value.updatedAt), "Leg preparation time changed.");
    check(["prepared", "near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed", "evm-submitting", "evm-submitted", "evm-uncertain", "observed", "confirmed", "failed"].includes(entry.status), "Invalid purchase leg stage.");
    if (entry.status !== "prepared") {
      validNearHash(entry.nearTransactionHash);
      check(entry.signingApproval?.digest === p.prepared.unsignedHash && entry.signingApproval.reference.length > 0, "Missing exact signing approval.");
      if (leg === "usdc-payment") check(value.paymentAuthorization, "Payment signature attempt requires consumed quote authorization.");
    } else check(!entry.nearTransactionHash && !entry.nearSubmission && !entry.signed && !entry.evmAttempt, "Unsigned preparation contains a prior attempt.");
    if (entry.nearSubmission !== undefined) assertNearSubmissionRecord(entry.nearSubmission,
      { role, transactionHash: validNearHash(entry.nearTransactionHash), digest: p.prepared.unsignedHash });
    if (entry.signed) check(keccak256(entry.signed.serialized) === entry.signed.hash && entry.signed.senderAddress === VERIFIED_IDENTITIES[role].evmAddress && entry.nearOutcome,
      "Signed payload hash, role or public MPC proof is missing.");
    if (["signed", "evm-submitting", "evm-submitted", "evm-uncertain", "observed", "confirmed", "failed"].includes(entry.status)) check(entry.signed, "Signed transaction is required at this stage.");
    if (entry.audit) {
      const { auditHash, ...audit } = entry.audit;
      check(auditHash === fingerprint("purchase-leg-broadcast-audit-v1", audit) && audit.purchaseId === quote.purchaseId &&
        audit.quoteHash === quote.quoteHash && audit.leg === leg && audit.role === role && audit.signedHash === entry.signed?.hash &&
        audit.unsignedHash === p.prepared.unsignedHash && audit.nearHash === entry.nearTransactionHash && audit.originalPreparedAt === entry.preparedAt &&
        audit.paymentAuthorizationHash === value.paymentAuthorization?.authorizationHash && utc(audit.completedAt) >= utc(audit.checkedAt) &&
        utc(audit.expiresAt) - utc(audit.checkedAt) === 30_000 && utc(audit.completedAt) <= utc(audit.expiresAt) &&
        (audit.recovery ? audit.expiredPreparationAcknowledgment === entry.preparedAt && utc(audit.checkedAt) - utc(entry.preparedAt) > 900_000 :
          audit.expiredPreparationAcknowledgment === null && utc(audit.checkedAt) - utc(entry.preparedAt) <= 900_000),
        "Saved broadcast audit does not bind the exact original leg, approval or freshness window.");
    }
    if (entry.evmAttempt) check(entry.signed && entry.evmAttempt.signedHash === entry.signed.hash && entry.audit?.auditHash === entry.evmAttempt.auditHash,
      "EVM attempt marker lost its exact signed hash or durable audit.");
    if (entry.externalObservation) check(entry.signed?.hash === entry.externalObservation.signedHash && utc(entry.externalObservation.at) >= utc(entry.preparedAt), "External observation must bind the exact existing signed hash.");
    if (["evm-submitting", "evm-submitted", "evm-uncertain", "observed", "confirmed", "failed"].includes(entry.status)) check(entry.evmAttempt || entry.externalObservation, "EVM execution requires a preserved attempt marker or explicit read-only external observation.");
    if (entry.proof) check(entry.signed && entry.proof.quoteHash === quote.quoteHash && entry.proof.purchaseId === quote.purchaseId &&
      entry.proof.leg === leg && entry.proof.role === role && entry.proof.unsignedHash === p.prepared.unsignedHash &&
      entry.proof.transactionHash === entry.signed.hash && entry.proof.actualFeeWei === entry.proof.gasUsed * entry.proof.effectiveGasPriceWei,
      "Receipt evidence differs from the approved leg or signed transaction.");
    if (entry.status === "confirmed") check(entry.proof?.kind === "verified-purchase-leg" &&
      entry.proof.finality === (leg === "usdc-payment" ? "finalized" : "two-confirmations"), "Confirmed leg lacks the required canonical finality proof.");
    if (entry.status === "failed") check(entry.proof?.kind === "failed-purchase-leg", "Failed leg requires verified failure evidence.");
    if (leg !== "usdc-payment") check(value.paidAt && value.legs["usdc-payment"]?.status === "confirmed", "Treasury cannot release inventory before finalized payment.");
    if (leg === "eth-delivery") check(value.legs["link-delivery"]?.status === "confirmed", "Native ETH must follow confirmed LINK delivery.");
  }
  if (value.paidAt) {
    const proof = value.legs["usdc-payment"]?.proof;
    check(proof?.kind === "verified-purchase-leg" && proof.finality === "finalized" && proof.paymentClaim &&
      proof.paymentClaim.transactionHash === proof.transactionHash && proof.paymentClaim.chainId === 11155111n &&
      value.paymentClaim === paymentClaimId(proof.paymentClaim), "Paid state requires a finalized exact payment claim.");
    check(utc(value.paidAt) >= utc(value.paymentAuthorization!.checkedAt), "Paid time predates payment authorization.");
  } else check(value.paymentClaim === null, "Unpaid execution cannot claim a payment.");
}
