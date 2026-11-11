import { formatUnits } from "ethers";
import type { PurchaseJournal, PrepaymentRecord } from "./journal.js";
import type { PricePacket, PriceSet } from "./prices.js";
import type { PurchaseLeg } from "./legs.js";
import { PURCHASE_LEGS } from "./settlement.js";

export interface CommandContext {
  readonly command: string;
  /** Application entry after module loading, not the VS Code permission request. */
  readonly startedAt: string;
  readonly outputAt: string;
  readonly leg?: PurchaseLeg;
  readonly quoteHash?: string;
}
function remaining(expiresAt: string, at: string): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.parse(at)) / 1000));
}
export function commandTiming(context: CommandContext) {
  return {
    command: context.command, commandStartedAt: context.startedAt, commandCompletedAt: context.outputAt,
    elapsedMs: Date.parse(context.outputAt) - Date.parse(context.startedAt),
    commandOutputAt: context.outputAt, operatorPresentedAt: null, operatorApprovalReceivedAt: null,
    timingMeaning: "Application timestamps only; UI delivery and human response times are unavailable.",
  };
}
function approval(action: string, text: string) {
  return { operatorActionRequired: "OPERATOR ACTION REQUIRED — " + action,
    approvalInstruction: "COPY THIS APPROVAL INTO CODEX CHAT", copyApproval: text };
}
function nextApproval(r: PrepaymentRecord | undefined, context: CommandContext): Partial<ReturnType<typeof approval>> {
  if (!r) return {};
  const q = r.quote, open = Date.parse(context.outputAt) < Date.parse(q.expiresAt);
  if (context.command === "quote" && r.status === "quoted" && open)
    return approval("APPROVE EXACT PORTFOLIO QUOTE", "APPROVE QUOTE " + q.quoteHash);
  if (context.command === "approve-quote" && r.status === "approved" && open)
    return approval("AUTHORIZE INVESTOR PAYMENT PREPARATION",
      "AUTHORIZE INVESTOR PAYMENT PREPARATION FOR " + q.purchaseId + " QUOTE " + q.quoteHash +
      ". This authorizes unsigned preparation only; no credential access, signing or broadcast.");
  const leg = context.leg, entry = leg ? r.execution?.legs[leg] : undefined;
  if (!leg || !entry) return {};
  const preparationOpen = Date.parse(context.outputAt) < Date.parse(entry.preparedAt) + 900_000;
  if (context.command === "prepare" && entry.status === "prepared" && preparationOpen && (leg !== "usdc-payment" || open))
    return approval("AUTHORIZE ONE " + entry.prepared.role.toUpperCase() + " MPC SIGNING REQUEST",
      "AUTHORIZE ONE " + entry.prepared.role.toUpperCase() + " NEAR MPC SIGNING REQUEST FOR " + q.purchaseId +
      " QUOTE " + q.quoteHash + " LEG " + leg + " UNSIGNED DIGEST " + entry.prepared.prepared.unsignedHash +
      ". Use only the selected role credential; v1.signer-prod.testnet, domain 0, path wealthpixels/sepolia/v1, 100 Tgas + 1 yoctoNEAR. No Ethereum broadcast.");
  if (context.command === "reconcile-signing" && entry.status === "signed" && entry.signed && !entry.evmAttempt &&
      !entry.externalObservation && r.execution?.paymentAuthorization) {
    const recovery = preparationOpen ? "" : " RECOVERY ACKNOWLEDGING ORIGINAL PREPARED-AT " + entry.preparedAt;
    return approval("AUTHORIZE ONE " + entry.prepared.role.toUpperCase() + " ETHEREUM BROADCAST" + (preparationOpen ? "" : " RECOVERY"),
      "AUTHORIZE ONE ETHEREUM BROADCAST" + recovery + " FOR " + q.purchaseId + " QUOTE " + q.quoteHash +
      " LEG " + leg + " SIGNED HASH " + entry.signed.hash + " ACKNOWLEDGE PAYMENT AUTHORIZATION " +
      r.execution.paymentAuthorization.authorizationHash + ". Subject to fresh CLI checks; no re-signing, retry or replacement.");
  }
  return {};
}
function compactRecord(r: PrepaymentRecord, context: CommandContext) {
  const q = r.quote, e = r.execution, fee = q.feeAssessment;
  const eligibility = e?.paymentAuthorization?.eligibility ?? r.eligibility;
  return {
    purchaseId: q.purchaseId, quotePolicyVersion: q.schemaVersion, quoteHash: q.quoteHash, status: r.status,
    quoteCreatedAt: q.createdAt, quoteExpiresAt: q.expiresAt,
    remainingPurchaseValiditySecondsAtOutput: remaining(q.expiresAt, context.outputAt),
    investmentUsdc: formatUnits(q.terms.investmentUsdcBaseUnits, 6),
    investmentUsdcBaseUnits: q.terms.investmentUsdcBaseUnits,
    allocationBps: q.terms.allocationBps,
    quantities: { ...q.terms.quantities, eth: formatUnits(q.terms.quantities.ethWei, 18),
      link: formatUnits(q.terms.quantities.linkBaseUnits, 18) },
    investorAddress: q.transactions[0]!.senderAddress, treasuryAddress: q.transactions[0]!.recipientAddress,
    priceSetHash: q.prices.setHash, priceExpiresAt: q.prices.expiresAt,
    expectedFees: { eligibleAtQuoteCreation: fee.eligible,
      totalExpectedUsdcCeil: formatUnits(fee.totalExpectedUsdcBaseUnitsCeil, 6),
      totalExpectedUsdcBaseUnitsCeil: fee.totalExpectedUsdcBaseUnitsCeil, expectedFeeBpsCeil: fee.expectedFeeBpsCeil,
      maxExpectedFeeBps: fee.maxExpectedFeeBps, platformFee: false,
      totalMaximumReserveUsdcBaseUnitsCeil: fee.totalMaximumReserveUsdcBaseUnitsCeil,
      originalObservedAt: q.costs.sampledAt, originalExpiresAt: fee.expiresAt,
      components: fee.expectedCosts.map(cost => ({ leg: cost.leg, payer: cost.payer, asset: cost.asset,
        expectedNativeBaseUnits: cost.expectedNativeBaseUnits, expectedUsdcExact: cost.expectedUsdcExact,
        maximumNativeReserveBaseUnits: cost.maximumNativeReserveBaseUnits })) },
    executionLimits: q.policy.execution,
    selectedFees: q.costs.evm.map(cost => ({ leg: cost.leg, maxFeePerGasWei: cost.maxFeePerGasWei,
      maxPriorityFeePerGasWei: cost.maxPriorityFeePerGasWei })),
    latestPaymentEligibility: eligibility ? { checkedAt: eligibility.checkedAt, expiresAt: eligibility.expiresAt,
      remainingSecondsAtOutput: remaining(eligibility.expiresAt, context.outputAt),
      totalExpectedUsdcBaseUnitsCeil: eligibility.feeAssessment.totalExpectedUsdcBaseUnitsCeil,
      expectedFeeBpsCeil: eligibility.feeAssessment.expectedFeeBpsCeil } : null,
    paymentAuthorizationHash: e?.paymentAuthorization?.authorizationHash ?? null, paidAt: e?.paidAt ?? null,
    legs: e ? Object.fromEntries(PURCHASE_LEGS.map(leg => {
      const entry = e.legs[leg];
      if (!entry) return [leg, { status: "pending" }];
      const p = entry.prepared.prepared;
      return [leg, { status: entry.status, role: entry.prepared.role, preparedAt: entry.preparedAt,
        preparationExpiresAt: new Date(Date.parse(entry.preparedAt) + 900_000).toISOString(),
        chainId: p.chainId, senderAddress: p.senderAddress, recipientAddress: p.recipientAddress,
        tokenAddress: "tokenAddress" in p ? p.tokenAddress : null,
        amountBaseUnits: "amount" in p ? p.amount : p.amountWei,
        nonce: p.nonce, gasLimit: p.gasLimit, maxFeePerGas: p.maxFeePerGas,
        maxPriorityFeePerGas: p.maxPriorityFeePerGas, maximumFeeWei: p.maximumFeeWei,
        unsignedHash: p.unsignedHash, nearTransactionHash: entry.nearTransactionHash,
        signedHash: entry.signed?.hash ?? null, submissionAttempt: entry.evmAttempt,
        receipt: entry.proof ? { transactionHash: entry.proof.transactionHash, blockNumber: entry.proof.blockNumber,
          actualFeeWei: entry.proof.actualFeeWei, finality: entry.proof.finality } : null }];
    })) : null,
  };
}
/** Presentation only: no I/O, approval, clock mutation or execution capability. */
export function compactPurchaseOutput(journal: PurchaseJournal, context: CommandContext) {
  const affected = journal.active ?? journal.archive.find(r => r.quote.quoteHash === context.quoteHash);
  return {
    ...nextApproval(affected, context), ...commandTiming(context), revision: journal.revision,
    active: journal.active ? compactRecord(journal.active, context) : null,
    archived: !journal.active && affected ? compactRecord(affected, context) : null,
    archivedPurchaseCount: journal.archive.length, paymentClaimCount: journal.paymentClaims.length,
    nextCheckpoint: context.command === "sign" ? "Reconcile the recorded signing outcome; never repeat sign automatically." :
      context.command === "broadcast" ? "Reconcile the recorded transaction; never repeat broadcast automatically." :
      "Each next operation requires its own explicit authorization and applicable fresh checks.",
    detailedEvidence: "Retained in the purchase journal; purchase inspect exposes the sanitized detailed record.",
  };
}
export function priceCommandOutput(value: PricePacket | PriceSet, context: CommandContext) {
  const pending = value.kind === "demonstration-price-proposal";
  return {
    ...(pending && Date.parse(context.outputAt) < Date.parse(value.expiresAt) ?
      approval("APPROVE DEMONSTRATION PRICES", "APPROVE DEMONSTRATION PRICES " + value.approvalDigest) : {}),
    ...value, displayPricesUsd: Object.fromEntries(Object.entries(value.prices).map(([asset, price]) => {
      const decimals = price.denominator.toString().length - 1;
      return [asset, price.denominator === 10n ** BigInt(decimals) ? formatUnits(price.numerator, decimals) :
        price.numerator.toString() + "/" + price.denominator.toString()];
    })), ...commandTiming(context),
    remainingPriceValiditySecondsAtOutput: remaining(value.expiresAt, context.outputAt),
  };
}
export function commandFailure(error: unknown, command: string, startedAt: string, failedAt: string) {
  const candidate = error instanceof Error ? error.message : "";
  // Filesystem/network diagnostics can embed protected paths or request contents.
  const publicMessage = candidate.length > 0 && candidate.length <= 512 &&
    !/[\\\r\n]|(?:^|[\s'"])(?:\/|[a-z]:)|https?:\/\/|(?:private|secret)[_-]?key|(?:ed25519|secp256k1):|0x[0-9a-f]{80,}/i.test(candidate) ?
    candidate : "Purchase command failed; preserve records and inspect the saved state before any separately authorized recovery.";
  const deadlineGuard = /expired|stale|current clock|not yet valid|deadline/i.test(publicMessage);
  return {
    command: /^[a-z-]{1,32}$/.test(command) ? command : "invalid-command",
    commandStartedAt: startedAt, commandFailedAt: failedAt,
    ...(deadlineGuard ? { guardRejectedAt: failedAt } : {}),
    elapsedMs: Date.parse(failedAt) - Date.parse(startedAt), error: publicMessage,
    operatorPresentedAt: null, operatorApprovalReceivedAt: null,
    outcome: "failed-command; this does not establish absence of a prior submission",
    nextCheckpoint: "Preserve state; inspect/reconcile before any retry. No automatic retry is authorized.",
  };
}
