import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertNearSubmissionSuccessor } from "../near/submission.js";
import { baseDecode } from "near-api-js";
import { decodeEncodedState, runtimeStatePath, saveEncodedState, withStateLock } from "../execution/state.js";
import { VERIFIED_IDENTITIES } from "../near/identities.js";
import { SEPOLIA_ASSETS } from "./config.js";
import { requireUint256 } from "./amounts.js";
import type { CompletePurchaseCosts } from "./costs.js";
import { approvePurchaseQuote, assertPaymentAuthorizationEligible, assertPurchaseQuote, assertQuoteApproval,
  DEFAULT_PURCHASE_QUOTE_POLICY, type PurchaseQuote, type PurchaseQuotePolicy, type QuoteApproval, type PaymentEligibility } from "./quote.js";
import { check, fingerprint, frozen, hexHash, label, publicSource, utc } from "./integrity.js";
import { assertPurchaseExecution, executionPhase, PURCHASE_LEGS, type PurchaseExecution } from "./settlement.js";
import { paymentClaimId } from "./claims.js";

/** Full three-leg evidence and bounded monitoring history need more space than a
 * standalone transfer. Both read and atomic commit enforce this UTF-16 character
 * bound; unrelated runtime records keep their existing decoder limit. No pruning,
 * migration or changes to the recorded journal representation are performed.
 */
export const PURCHASE_JOURNAL_MAX_CHARACTERS = 32_000_000;

export interface FundingInventorySnapshot {
  readonly mode: "offline" | "live"; readonly observedAt: string; readonly chainId: bigint;
  readonly treasuryAddress: string; readonly investorAddress: string; readonly linkTokenAddress: string; readonly usdcTokenAddress: string;
  readonly treasuryNearAccountId: string; readonly investorNearAccountId: string;
  readonly blockNumber: bigint; readonly blockHash: string; readonly nearBlockHeight: bigint; readonly nearBlockHash: string;
  readonly sourceUrl: string; readonly reference: string;
  readonly treasuryEthWei: bigint; readonly treasuryLinkBaseUnits: bigint;
  readonly investorEthWei: bigint; readonly investorUsdcBaseUnits: bigint;
  readonly treasurySpendableNearYocto: bigint; readonly investorSpendableNearYocto: bigint;
}
export interface InventoryReservation {
  readonly linkBaseUnits: bigint; readonly treasuryEthWei: bigint; readonly investorMaxEvmFeeWei: bigint;
  readonly treasuryMaxNearYocto: bigint; readonly investorMaxNearYocto: bigint;
  readonly expiresAt: string; readonly afterPaymentAuthorization: "retain-until-reconciled"; readonly reservationHash: string;
}
export interface PrepaymentRecord {
  readonly status: "quoted" | "approved" | "payment-authorized" | "expired-unpaid" | "executing" | "settling" | "partially-delivered" | "completed" | "attention-required";
  readonly quote: PurchaseQuote; readonly inventory: FundingInventorySnapshot; readonly reservation: InventoryReservation;
  readonly approval: QuoteApproval | null; readonly eligibility: PaymentEligibility | null;
  readonly authorizationInventory: FundingInventorySnapshot | null; readonly updatedAt: string; readonly releasedAt: string | null;
  readonly execution?: PurchaseExecution;
}
export interface PurchaseJournal {
  readonly schemaVersion: 1; readonly kind: "purchase-prepayment-journal"; readonly revision: number;
  readonly active: PrepaymentRecord | null; readonly archive: readonly PrepaymentRecord[];
  /** No payment acceptance or settlement mutation exists in Task 03D-1. */
  readonly paymentClaims: readonly string[];
}
function exactKeys(value: unknown, fields: string[]): void {
  check(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === fields.sort().join(), "Unexpected or missing prepayment journal fields.");
}
function currentAction(asOf: string, quote: PurchaseQuote, expiring = false): void {
  const now = Date.now();
  check(Number.isFinite(now) && now >= utc(asOf) && now - utc(asOf) <= 30_000, "Journal mutation requires a current trusted-clock timestamp.");
  check(expiring ? now >= utc(quote.expiresAt) : now >= utc(quote.createdAt) && now < utc(quote.expiresAt),
    "Current clock does not permit this quote action; expiry cannot be backdated or bypassed.");
}
function funding(value: FundingInventorySnapshot, asOf: string, quote: PurchaseQuote, costs = quote.costs): void {
  exactKeys(value, ["mode", "observedAt", "chainId", "treasuryAddress", "investorAddress", "linkTokenAddress", "usdcTokenAddress",
    "treasuryNearAccountId", "investorNearAccountId",
    "blockNumber", "blockHash", "nearBlockHeight", "nearBlockHash", "sourceUrl", "reference", "treasuryEthWei", "treasuryLinkBaseUnits",
    "investorEthWei", "investorUsdcBaseUnits", "treasurySpendableNearYocto", "investorSpendableNearYocto"]);
  check((value.mode === "offline" || value.mode === "live") && value.chainId === 11155111n &&
    value.treasuryAddress === VERIFIED_IDENTITIES.treasury.evmAddress && value.investorAddress === VERIFIED_IDENTITIES.investor.evmAddress &&
    value.treasuryNearAccountId === VERIFIED_IDENTITIES.treasury.accountId && value.investorNearAccountId === VERIFIED_IDENTITIES.investor.accountId &&
    value.linkTokenAddress === SEPOLIA_ASSETS.LINK.address && value.usdcTokenAddress === SEPOLIA_ASSETS.USDC.address,
    "Inventory network, role or token identity mismatch.");
  if (quote.purpose === "prepayment") check(value.mode === "live", "Offline inventory cannot authorize prepayment eligibility.");
  const age = utc(asOf) - utc(value.observedAt);
  check(age >= 0 && age < 60_000, "Inventory observation is stale or from the future.");
  requireUint256(value.blockNumber, "Inventory EVM block", true); hexHash(value.blockHash);
  requireUint256(value.nearBlockHeight, "Inventory NEAR block", true);
  check(typeof value.nearBlockHash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.nearBlockHash) && baseDecode(value.nearBlockHash).length === 32,
    "Inventory NEAR block reference is invalid.");
  check(value.blockNumber >= costs.evmObservation.blockNumber &&
    (value.blockNumber !== costs.evmObservation.blockNumber || value.blockHash === costs.evmObservation.blockHash) &&
    value.nearBlockHeight >= costs.nearObservation.blockHeight &&
    (value.nearBlockHeight !== costs.nearObservation.blockHeight || value.nearBlockHash === costs.nearObservation.blockHash),
    "Inventory is older than, or conflicts with, execution-cost observation blocks.");
  publicSource(value.sourceUrl); label(value.reference, "Funding/inventory observation reference");
  for (const field of ["treasuryEthWei", "treasuryLinkBaseUnits", "investorEthWei", "investorUsdcBaseUnits", "treasurySpendableNearYocto", "investorSpendableNearYocto"] as const) {
    requireUint256(value[field], field);
  }
}
function reservation(quote: PurchaseQuote, assessment: Pick<PaymentEligibility["feeAssessment"], "expectedCosts"> = quote.feeAssessment): InventoryReservation {
  const reserve = (asset: "ETH" | "NEAR", payer: "treasury" | "investor") => assessment.expectedCosts
    .filter(item => item.asset === asset && item.payer === payer).reduce((total, item) => total + item.maximumNativeReserveBaseUnits, 0n);
  const body = { linkBaseUnits: quote.terms.quantities.linkBaseUnits,
    treasuryEthWei: quote.terms.quantities.ethWei + reserve("ETH", "treasury") + quote.policy.execution.operatingReserveWei,
    investorMaxEvmFeeWei: reserve("ETH", "investor"), treasuryMaxNearYocto: reserve("NEAR", "treasury"), investorMaxNearYocto: reserve("NEAR", "investor"),
    expiresAt: quote.expiresAt, afterPaymentAuthorization: "retain-until-reconciled" as const };
  return frozen({ ...body, reservationHash: fingerprint("purchase-inventory-reservation-v1", body) });
}
function sufficientTreasury(inventory: FundingInventorySnapshot, r: InventoryReservation): void {
  check(inventory.treasuryLinkBaseUnits >= r.linkBaseUnits && inventory.treasuryEthWei >= r.treasuryEthWei,
    "Treasury inventory cannot reserve the allocation, both EVM fee ceilings and operating reserve.");
}
function sufficientPaymentFunding(inventory: FundingInventorySnapshot, quote: PurchaseQuote, r: InventoryReservation): void {
  sufficientTreasury(inventory, r);
  check(inventory.investorUsdcBaseUnits >= quote.terms.investmentUsdcBaseUnits && inventory.investorEthWei >= r.investorMaxEvmFeeWei &&
    inventory.investorSpendableNearYocto >= r.investorMaxNearYocto && inventory.treasurySpendableNearYocto >= r.treasuryMaxNearYocto,
    "Investor payment or role-specific EVM/NEAR fee funding is insufficient.");
}
export function assertPublicFundingInventory(inventory: FundingInventorySnapshot, asOf: string, quote: PurchaseQuote, costs = quote.costs): void {
  funding(inventory, asOf, quote, costs);
}
export function assertPrepaymentFunding(inventory: FundingInventorySnapshot, asOf: string, quote: PurchaseQuote,
  originalReservation: InventoryReservation, assessment: Pick<PaymentEligibility["feeAssessment"], "expectedCosts">, costs: CompletePurchaseCosts): void {
  funding(inventory, asOf, quote, costs);
  const fresh = reservation(quote, assessment);
  for (const field of ["treasuryEthWei", "investorMaxEvmFeeWei", "treasuryMaxNearYocto", "investorMaxNearYocto"] as const) {
    check(fresh[field] <= originalReservation[field], "Fresh maximum fees exceed the immutable reservation; approve a new quote.");
  }
  sufficientPaymentFunding(inventory, quote, fresh);
}
function assertRecord(record: PrepaymentRecord, policy: PurchaseQuotePolicy): void {
  exactKeys(record, ["status", "quote", "inventory", "reservation", "approval", "eligibility", "authorizationInventory", "updatedAt", "releasedAt", ...("execution" in record ? ["execution"] : [])]);
  check(["quoted", "approved", "payment-authorized", "expired-unpaid", "executing", "settling", "partially-delivered", "completed", "attention-required"].includes(record.status), "Unsupported purchase journal status.");
  const quote = record.quote;
  assertPurchaseQuote(quote, quote.quoteHash, policy);
  funding(record.inventory, quote.createdAt, quote);
  check(isDeepStrictEqual(record.reservation, reservation(quote)), "Immutable inventory reservation changed.");
  sufficientTreasury(record.inventory, record.reservation);
  check(utc(record.updatedAt) >= utc(quote.createdAt), "Journal action time moved backwards.");
  if (record.approval !== null) {
    assertQuoteApproval(quote, record.approval, policy);
    check(utc(record.updatedAt) >= utc(record.approval.approvedAt), "Journal update predates approval.");
  }
  if (record.status === "quoted") check(record.approval === null && record.eligibility === null, "Unapproved quote cannot contain authorization evidence.");
  if (record.status === "approved") check(record.approval !== null && record.eligibility === null, "Approved journal state is incomplete.");
  if (record.status === "payment-authorized" || record.execution) {
    check(record.approval && record.eligibility && record.authorizationInventory, "Payment eligibility record is incomplete.");
    const eligibility = assertPaymentAuthorizationEligible(quote, record.approval, { role: "investor", approval: quote.quoteHash,
      asOf: record.eligibility.checkedAt, freshCosts: record.eligibility.freshCosts }, policy);
    check(isDeepStrictEqual(eligibility, record.eligibility) && (record.execution || record.updatedAt === eligibility.checkedAt), "Saved payment eligibility was altered.");
    funding(record.authorizationInventory, eligibility.checkedAt, quote, eligibility.freshCosts);
    const current = reservation(quote, eligibility.feeAssessment);
    for (const field of ["treasuryEthWei", "investorMaxEvmFeeWei", "treasuryMaxNearYocto", "investorMaxNearYocto"] as const) {
      check(current[field] <= record.reservation[field], "Fresh maximum fees exceed the immutable reservation; a new quote is required.");
    }
    sufficientPaymentFunding(record.authorizationInventory, quote, current);
  } else check(record.eligibility === null && record.authorizationInventory === null, "Unsigned/unpaid state cannot contain payment authorization evidence.");
  if (record.execution) {
    assertPurchaseExecution(quote, record.approval, record.execution);
    check(record.updatedAt === record.execution.updatedAt && (record.status === executionPhase(record.execution) || record.status === "expired-unpaid"), "Purchase phase differs from durable leg substates.");
    if (record.status === "expired-unpaid") check(!record.execution.paymentAuthorization && !record.execution.paidAt &&
      PURCHASE_LEGS.every(leg => !record.execution!.legs[leg]?.nearTransactionHash && !record.execution!.legs[leg]?.signed && !record.execution!.legs[leg]?.evmAttempt), "Unresolved signing or payment cannot release inventory.");
  } else check(["quoted", "approved", "payment-authorized", "expired-unpaid"].includes(record.status), "Settlement state requires durable execution evidence.");
  if (record.status === "expired-unpaid") check(record.releasedAt === record.updatedAt && utc(record.updatedAt) >= utc(quote.expiresAt), "Unpaid expiry or reservation release is invalid.");
  else if (record.status === "completed") check(record.releasedAt === record.updatedAt && record.execution?.realizedCosts, "Completion requires actual-cost accounting and reservation release.");
  else check(record.releasedAt === null, "Active inventory reservation cannot be released.");
}
function empty(): PurchaseJournal { return { schemaVersion: 1, kind: "purchase-prepayment-journal", revision: 0, active: null, archive: [], paymentClaims: [] }; }
function assertJournal(value: PurchaseJournal, policy: PurchaseQuotePolicy): void {
  exactKeys(value, ["schemaVersion", "kind", "revision", "active", "archive", "paymentClaims"]);
  check(value.schemaVersion === 1 && value.kind === "purchase-prepayment-journal" && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    Array.isArray(value.archive) && Array.isArray(value.paymentClaims), "Unsupported purchase journal.");
  check(value.active === null || (!!value.active && typeof value.active === "object" && !Array.isArray(value.active)), "Active prepayment record must be an object or null.");
  const ids = new Set<string>();
  for (const record of [...value.archive, ...(value.active ? [value.active] : [])]) {
    assertRecord(record, policy);
    check(!ids.has(record.quote.purchaseId), "Purchase ID was already used."); ids.add(record.quote.purchaseId);
  }
  check(value.archive.every(record => record.status === "expired-unpaid" || record.status === "completed") &&
    (!value.active || !["expired-unpaid", "completed"].includes(value.active.status)), "One active purchase and terminal history are required.");
  const claimed = [...value.archive, ...(value.active ? [value.active] : [])].flatMap(record => record.execution?.paymentClaim ? [record.execution.paymentClaim] : []);
  check(new Set(claimed).size === claimed.length && new Set(value.paymentClaims).size === value.paymentClaims.length &&
    isDeepStrictEqual([...claimed].sort(), [...value.paymentClaims].sort()) &&
    value.paymentClaims.every(id => /^11155111:0x[0-9a-f]{64}:(?:0|[1-9][0-9]*)$/.test(id)), "Payment claims must be unique and atomically associated with finalized paid purchases.");
}
async function journalPath(root: string): Promise<string> {
  return runtimeStatePath(resolve(root, ".local", "transfers", "purchase-journal.json"), root, true);
}
async function locked<T>(root: string, policy: PurchaseQuotePolicy,
  action: (journal: PurchaseJournal) => Promise<{ value: T; next?: PurchaseJournal }>): Promise<T> {
  const path = await journalPath(root);
  return withStateLock(path, async () => {
    let state: PurchaseJournal;
    try { state = decodeEncodedState(await readFile(path, "utf8"), PURCHASE_JOURNAL_MAX_CHARACTERS) as PurchaseJournal; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; state = empty(); }
    assertJournal(state, policy);
    const result = await action(frozen(state));
    if (result.next) {
      assertJournal(result.next, policy);
      const last = result.next.active ?? result.next.archive.at(-1);
      if (last) currentAction(last.updatedAt, last.quote, last.status === "expired-unpaid");
      await saveEncodedState(path, result.next, PURCHASE_JOURNAL_MAX_CHARACTERS);
    }
    return frozen(result.value);
  });
}
export async function readPurchaseJournal(root = process.cwd(), policy = DEFAULT_PURCHASE_QUOTE_POLICY): Promise<PurchaseJournal> {
  return locked(root, policy, async journal => ({ value: journal }));
}
export async function reservePurchaseQuote(input: { readonly quote: PurchaseQuote; readonly expectedQuoteHash: string;
  readonly inventory: FundingInventorySnapshot; readonly asOf: string }, root = process.cwd(), policy = DEFAULT_PURCHASE_QUOTE_POLICY): Promise<PurchaseJournal> {
  return locked(root, policy, async journal => {
    const quote = input.quote;
    assertPurchaseQuote(quote, input.expectedQuoteHash, policy);
    currentAction(input.asOf, quote);
    check(input.asOf === quote.createdAt, "Initial reservation must use the quote creation observation time.");
    check(!journal.active, "Another active purchase/reservation exists; reconcile or expire it explicitly.");
    check(!journal.archive.some(record => record.quote.purchaseId === quote.purchaseId), "Purchase ID cannot be reused.");
    funding(input.inventory, input.asOf, quote);
    funding(input.inventory, new Date(Date.now()).toISOString(), quote);
    const active: PrepaymentRecord = { status: "quoted", quote, inventory: input.inventory, reservation: reservation(quote),
      approval: null, eligibility: null, authorizationInventory: null, updatedAt: input.asOf, releasedAt: null };
    sufficientTreasury(active.inventory, active.reservation);
    const next: PurchaseJournal = { ...journal, revision: journal.revision + 1, active };
    return { value: next, next };
  });
}
export async function approveReservedPurchase(input: { readonly expectedQuoteHash: string; readonly role: "investor";
  readonly approval: string; readonly reference: string; readonly approvedAt: string }, root = process.cwd(), policy = DEFAULT_PURCHASE_QUOTE_POLICY): Promise<PurchaseJournal> {
  return locked(root, policy, async journal => {
    const current = journal.active;
    check(current?.status === "quoted" && current.quote.quoteHash === hexHash(input.expectedQuoteHash), "No matching unapproved active quote.");
    currentAction(input.approvedAt, current.quote);
    const approval = approvePurchaseQuote(current.quote, input, policy);
    const next: PurchaseJournal = { ...journal, revision: journal.revision + 1,
      active: { ...current, status: "approved", approval, updatedAt: approval.approvedAt } };
    return { value: next, next };
  });
}
export async function authorizeReservedPayment(input: { readonly expectedQuoteHash: string; readonly role: "investor"; readonly approval: string;
  readonly asOf: string; readonly freshCosts: CompletePurchaseCosts; readonly inventory: FundingInventorySnapshot },
  root = process.cwd(), policy = DEFAULT_PURCHASE_QUOTE_POLICY): Promise<PurchaseJournal> {
  return locked(root, policy, async journal => {
    const current = journal.active;
    check(current?.status === "approved" && current.approval && current.quote.quoteHash === hexHash(input.expectedQuoteHash), "A matching approved active quote is required; authorization cannot be repeated.");
    check(utc(input.asOf) >= utc(current.updatedAt), "Prepayment action time moved backwards.");
    currentAction(input.asOf, current.quote);
    const eligibility = assertPaymentAuthorizationEligible(current.quote, current.approval, input, policy);
    funding(input.inventory, new Date(Date.now()).toISOString(), current.quote, input.freshCosts);
    const next: PurchaseJournal = { ...journal, revision: journal.revision + 1, active: { ...current, status: "payment-authorized",
      eligibility, authorizationInventory: input.inventory, updatedAt: input.asOf } };
    return { value: next, next };
  });
}
export async function expireUnpaidPurchase(input: { readonly expectedQuoteHash: string; readonly asOf: string },
  root = process.cwd(), policy = DEFAULT_PURCHASE_QUOTE_POLICY): Promise<PurchaseJournal> {
  return locked(root, policy, async journal => {
    const active = journal.active;
    check(active && active.quote.quoteHash === hexHash(input.expectedQuoteHash), "No matching active purchase.");
    check(active.status !== "payment-authorized" && !active.execution, "Payment authorization may be signed/submitted later; retain reservation until Task 03D-2 reconciles it.");
    currentAction(input.asOf, active.quote, true);
    check(utc(input.asOf) >= utc(active.updatedAt) && utc(input.asOf) >= utc(active.quote.expiresAt), "Unpaid quote is not expired or action time moved backwards.");
    const record: PrepaymentRecord = { ...active, status: "expired-unpaid", updatedAt: input.asOf, releasedAt: input.asOf };
    const next: PurchaseJournal = { ...journal, revision: journal.revision + 1, active: null, archive: [...journal.archive, record] };
    return { value: next, next };
  });
}

/** Internal coordinator storage boundary: one lock spans reads, validations, durable markers and one-use transports. */
export async function withPurchaseExecutionJournal<T>(root: string, policy: PurchaseQuotePolicy,
  action: (store: { current(): PurchaseJournal; commit(next: PurchaseJournal): Promise<void> }) => Promise<T>): Promise<T> {
  const path = await journalPath(root);
  return withStateLock(path, async () => {
    let current: PurchaseJournal;
    try { current = decodeEncodedState(await readFile(path, "utf8"), PURCHASE_JOURNAL_MAX_CHARACTERS) as PurchaseJournal; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; current = empty(); }
    assertJournal(current, policy);
    return action({ current: () => frozen(current), async commit(next) {
      assertJournal(next, policy);
      check(next.revision === current.revision + 1 && next.archive.length >= current.archive.length &&
        isDeepStrictEqual(next.archive.slice(0, current.archive.length), current.archive) &&
        isDeepStrictEqual(next.paymentClaims.slice(0, current.paymentClaims.length), current.paymentClaims), "Journal history or claims cannot be reset.");
      const prior = current.active;
      const candidate = next.active ?? next.archive.at(-1);
      if (prior && candidate) {
        check(isDeepStrictEqual(prior.quote, candidate.quote) && isDeepStrictEqual(prior.reservation, candidate.reservation) &&
          isDeepStrictEqual(prior.approval, candidate.approval) && (isDeepStrictEqual(prior.eligibility, candidate.eligibility) ||
            !prior.execution && prior.eligibility === null && !!candidate.execution && !!candidate.eligibility) &&
          (prior.authorizationInventory === null || isDeepStrictEqual(prior.authorizationInventory, candidate.authorizationInventory)) &&
          utc(candidate.updatedAt) >= utc(prior.updatedAt), "Accepted quote, reservation, approval or chronology changed.");
        const old = prior.execution, fresh = candidate.execution;
        if (old) {
          check(fresh && old.mode === fresh.mode && old.startedAt === fresh.startedAt &&
            isDeepStrictEqual(fresh.events.slice(0, old.events.length), old.events) &&
            isDeepStrictEqual(fresh.retiredUnsigned.slice(0, old.retiredUnsigned.length), old.retiredUnsigned) &&
            (!old.paymentAuthorization || isDeepStrictEqual(old.paymentAuthorization, fresh.paymentAuthorization)) &&
            (!old.paidAt || old.paidAt === fresh.paidAt) && (!old.paymentClaim || old.paymentClaim === fresh.paymentClaim), "Execution history, authorization or obligation cannot be reset.");
          for (const leg of PURCHASE_LEGS) {
            const previous = old.legs[leg], entry = fresh.legs[leg]; if (!previous) continue;
            if (previous.nearSubmission) {
              check(entry?.nearSubmission, "Public NEAR submission metadata cannot be discarded.");
              if (!isDeepStrictEqual(previous.nearSubmission, entry.nearSubmission)) assertNearSubmissionSuccessor(previous.nearSubmission, entry.nearSubmission);
            }
            if (!entry) check(previous.status === "prepared" && !previous.nearTransactionHash && !previous.signed && !previous.evmAttempt &&
              fresh.retiredUnsigned.some(item => item.leg === leg && item.preparedAt === previous.preparedAt && isDeepStrictEqual(item.prepared, previous.prepared)), "A transaction attempt cannot be discarded.");
            else check(isDeepStrictEqual(previous.prepared, entry.prepared) && previous.preparedAt === entry.preparedAt &&
              (!previous.nearTransactionHash || previous.nearTransactionHash === entry.nearTransactionHash) &&
              (!previous.signed || isDeepStrictEqual(previous.signed, entry.signed)) && (!previous.evmAttempt || isDeepStrictEqual(previous.evmAttempt, entry.evmAttempt)) &&
              (!previous.externalObservation || isDeepStrictEqual(previous.externalObservation, entry.externalObservation)) &&
              (previous.status !== "confirmed" || entry.status === "confirmed"), "Original transaction bytes, hashes, timestamps or completed delivery cannot change.");
          }
        }
      }
      await saveEncodedState(path, next, PURCHASE_JOURNAL_MAX_CHARACTERS); current = frozen(next);
    } });
  });
}
