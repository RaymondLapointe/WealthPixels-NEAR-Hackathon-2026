import { isDeepStrictEqual } from "node:util";
import { Interface, Transaction } from "ethers";
import { baseDecode } from "near-api-js";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID } from "../near/config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { normalizeMpcOutcome } from "../near/signing.js";
import { assembleSignedErc20Transfer } from "../evm/erc20-transfer.js";
import { assembleTreasuryNativeTransfer } from "../evm/native-transfer.js";
import { encodeState } from "../execution/state.js";
import { assertPurchaseQuote, assertQuoteApproval, type PurchaseQuote, type QuoteApproval } from "../purchase/quote.js";
import { assertPurchaseExecution, makePaymentAuthorization, PURCHASE_LEGS, roleForLeg, type PaymentAuthorization,
  type PurchaseLegExecution } from "../purchase/settlement.js";
import { assertPreparedPurchaseLeg, type LegBalances, type PurchaseLeg, type VerifiedPurchaseLeg } from "../purchase/legs.js";
import { observeNearExecutionCost } from "../purchase/services.js";
import { valueAuthorizedActualCosts, type AuthorizedActualCosts } from "../purchase/authorized-costs.js";
import { paymentClaimId, type PaymentClaim } from "../purchase/claims.js";
import { requireUint256 } from "../purchase/amounts.js";
import { purchaseExecutionPolicyForLeg } from "../purchase/config.js";
import type { ActualEvmCost, ActualNearCost } from "../purchase/fee-eligibility.js";
import type { PrepaymentRecord } from "../purchase/journal.js";
import { check, fingerprint, frozen, hexHash, label, utc } from "../purchase/integrity.js";

export const PURCHASE_EVIDENCE_DISCLOSURES = Object.freeze({
  custody: "The hackathon demonstrator may control both testnet roles; this does not establish production custody independence.",
  quoteAssociation: "Quote association and human approvals are operator-recorded local claims, not trustless onchain enforcement or proof of global payment uniqueness.",
  pricing: "Approved demonstration prices are historical assumptions; they are not current production market prices or evidence of production economic viability.",
});
export const PURCHASE_EVIDENCE_AUTHORITIES = frozen({ near: { networkId: "testnet" as const, contractId: MPC_CONTRACT_ID,
  domainId: ECDSA_DOMAIN_ID, derivationPath: DERIVATION_PATH, rootPublicKey: VERIFIED_MPC_ROOT }, roles: VERIFIED_IDENTITIES });
export interface PurchaseEvidenceTransaction {
  readonly chainId: bigint; readonly type: 2; readonly nonce: number; readonly to: string; readonly value: bigint; readonly data: string;
  readonly gasLimit: bigint; readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint;
}
export interface PurchaseEvidenceReceipt {
  readonly blockNumber: bigint; readonly blockHash: string; readonly gasUsed: bigint; readonly effectiveGasPriceWei: bigint;
  readonly actualFeeWei: bigint; readonly finality: "finalized" | "two-confirmations";
  readonly before: LegBalances; readonly after: LegBalances;
  readonly tokenDeltas?: Readonly<{ sender: bigint; recipient: bigint }>;
  readonly nativeDeltas?: Readonly<{ sender: bigint; recipient: bigint }>;
  readonly paymentClaim?: PaymentClaim;
}
export interface PurchaseEvidenceLeg {
  readonly leg: PurchaseLeg; readonly role: "investor" | "treasury"; readonly nearTransactionHash: string;
  readonly evmTransactionHash: string; readonly unsignedHash: string; readonly preparedAt: string;
  readonly signingApproval: { readonly digest: string; readonly reference: string; readonly at: string };
  readonly broadcast: { readonly signedHash: string; readonly at: string; readonly auditHash: string; readonly recovery: boolean;
    readonly expiredPreparationAcknowledgment: string | null };
  readonly transaction: PurchaseEvidenceTransaction; readonly receipt: PurchaseEvidenceReceipt;
}
export interface PurchaseEvidenceManifest {
  readonly schemaVersion: 1; readonly kind: "wealthpixels-portfolio-purchase"; readonly mode: "live" | "offline-fixture";
  readonly status: "complete"; readonly recordedAt: string; readonly operatorModel: "single-operator-demo";
  readonly settlementModel: "non-atomic-principal-inventory";
  readonly disclosures: typeof PURCHASE_EVIDENCE_DISCLOSURES & { readonly fixture: string };
  readonly authorities: typeof PURCHASE_EVIDENCE_AUTHORITIES;
  readonly quote: PurchaseQuote; readonly quoteApproval: QuoteApproval; readonly paymentAuthorization: PaymentAuthorization;
  readonly legs: readonly PurchaseEvidenceLeg[];
  readonly settlement: { readonly status: "completed"; readonly paidAt: string; readonly completedAt: string;
    readonly paymentClaim: string; readonly outstandingObligations: readonly [] };
  readonly actualCosts: { readonly evm: readonly ActualEvmCost[]; readonly near: readonly ActualNearCost[] };
  readonly realizedCosts: AuthorizedActualCosts; readonly manifestHash: string;
}
const abi = new Interface(["function transfer(address,uint256) returns(bool)"]);
const fixtureDisclosure = (mode: PurchaseEvidenceManifest["mode"]) => mode === "live" ?
  "Live execution claims require independent public NEAR and Sepolia verification; local validation alone is not blockchain proof." :
  "OFFLINE FIXTURE ONLY: simulated approvals, signing, receipts and ledger movements; no real onchain portfolio purchase occurred.";
function keys(value: unknown, expected: readonly string[], description: string): void {
  check(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...expected].sort().join(), `Unexpected or missing ${description} fields.`);
}
function nearHash(value: string): void {
  check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32,
    "Invalid public NEAR transaction hash.");
}
function publicOnly(value: unknown, mode: PurchaseEvidenceManifest["mode"], depth = 0): void {
  check(depth <= 40, "Public purchase evidence nesting exceeds its limit.");
  if (typeof value === "string") {
    check(value.length <= 20_000 && !/(?:^|[\s("'])\w:[\\/]|(?:^|\s)\/(?:home|Users)\/|\.local[\\/]|\.near-credentials|-----BEGIN .*PRIVATE KEY|ed25519:[1-9A-HJ-NP-Za-km-z]{80,}|https?:\/\/[^\s/]*@|[?&](?:api[_-]?key|token|secret|password)=/i.test(value),
      "Public purchase evidence contains local paths or credential material.");
    if (mode === "live") check(!/https:\/\/[^/\s]*\.invalid(?:[/:]|$)|OFFLINE[- _]?(?:FIXTURE|SIMULATED)|SIMULATED (?:offline|approval|readiness|complete)/i.test(value),
      "Fixture provenance cannot be relabelled as live evidence.");
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      check(!/(?:private[_-]?key|secret[_-]?key|credential|password|mnemonic|seed[_-]?phrase|serialized|rawTransaction|readEvidence)/i.test(key),
        "Public purchase evidence contains a forbidden local or executable field.");
      publicOnly(item, mode, depth + 1);
    }
  }
}
function strictActualCosts(input: PurchaseEvidenceManifest["actualCosts"]): void {
  keys(input, ["evm", "near"], "actual cost");
  check(Array.isArray(input.evm) && input.evm.length === 3 && Array.isArray(input.near) && input.near.length === 3,
    "Completed evidence requires three EVM and three NEAR execution costs.");
  for (const item of input.evm) keys(item, ["leg", "payer", "transactionHash", "executionStatus", "gasUsed", "effectiveGasPriceWei"], "EVM cost");
  for (const item of input.near) {
    keys(item, ["leg", "payer", "transactionHash", "transactionTokensBurntYoctoNear", "receiptOutcomes", "originalAttachedDepositYoctoNear", "refundedDepositYoctoNear",
      ...(Object.hasOwn(item, "depositAccounting") ? ["depositAccounting"] : [])], "NEAR cost");
    if (Object.hasOwn(item, "depositAccounting")) check((item as ActualNearCost & { depositAccounting: string }).depositAccounting ===
      "conservative-one-yocto-deposit-counted-as-cost-refund-not-proven", "Unsupported NEAR deposit accounting assumption.");
    requireUint256(item.transactionTokensBurntYoctoNear, "NEAR transaction cost");
    check(item.originalAttachedDepositYoctoNear === 1n && item.refundedDepositYoctoNear >= 0n && item.refundedDepositYoctoNear <= 1n,
      "NEAR actual deposit costs differ from the original one-yocto signing request.");
    check(Array.isArray(item.receiptOutcomes) && item.receiptOutcomes.length <= 1000, "Bounded NEAR public receipt costs are required.");
    for (const receipt of item.receiptOutcomes) {
      keys(receipt, ["receiptId", "tokensBurntYoctoNear"], "NEAR receipt cost"); nearHash(receipt.receiptId);
      requireUint256(receipt.tokensBurntYoctoNear, "NEAR receipt cost");
    }
  }
}
function receiptFields(proof: VerifiedPurchaseLeg): PurchaseEvidenceReceipt {
  return { blockNumber: proof.blockNumber, blockHash: proof.blockHash, gasUsed: proof.gasUsed,
    effectiveGasPriceWei: proof.effectiveGasPriceWei, actualFeeWei: proof.actualFeeWei,
    finality: proof.finality as PurchaseEvidenceReceipt["finality"], before: proof.before, after: proof.after,
    ...(proof.tokenDeltas ? { tokenDeltas: { sender: proof.tokenDeltas.sender, recipient: proof.tokenDeltas.recipient } } : {}),
    ...(proof.nativeDeltas ? { nativeDeltas: { sender: proof.nativeDeltas.sender, recipient: proof.nativeDeltas.recipient } } : {}),
    ...(proof.paymentClaim ? { paymentClaim: { chainId: proof.paymentClaim.chainId, transactionHash: proof.paymentClaim.transactionHash, logIndex: proof.paymentClaim.logIndex } } : {}) };
}
function transactionFields(entry: PurchaseLegExecution): PurchaseEvidenceTransaction {
  const p = entry.prepared.prepared;
  return { chainId: p.chainId, type: 2, nonce: p.nonce,
    to: entry.prepared.leg === "eth-delivery" ? entry.prepared.prepared.recipientAddress : entry.prepared.prepared.tokenAddress,
    value: entry.prepared.leg === "eth-delivery" ? entry.prepared.prepared.amountWei : 0n,
    data: p.data, gasLimit: p.gasLimit, maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas };
}
/** Explicit public-field extraction only. Local record hashes and human approval references are not public execution proof. */
export function exportCompletedPurchaseEvidence(record: PrepaymentRecord, recordedAt: string): PurchaseEvidenceManifest {
  const e = record.execution;
  check(record.status === "completed" && e && e.mode && record.approval && e.paymentAuthorization && e.paidAt && e.paymentClaim && e.realizedCosts &&
    record.updatedAt === e.updatedAt && record.releasedAt === e.updatedAt && !e.attention, "Only a completed, reconciled purchase can be exported.");
  assertPurchaseExecution(record.quote, record.approval, e);
  const mode: PurchaseEvidenceManifest["mode"] = e.mode === "live" ? "live" : "offline-fixture";
  const legs = PURCHASE_LEGS.map(leg => {
    const entry = e.legs[leg];
    check(entry?.status === "confirmed" && entry.signed && entry.nearTransactionHash && entry.signingApproval && entry.audit && entry.evmAttempt &&
      entry.proof?.kind === "verified-purchase-leg" && entry.nearCost, "Completed export requires exact confirmed legs and preserved human approvals.");
    assertPreparedPurchaseLeg(entry.prepared, record.quote, record.quote.quoteHash);
    if (mode === "live") {
      const signature = normalizeMpcOutcome(entry.nearOutcome, entry.prepared.role, entry.nearTransactionHash, entry.prepared.prepared.unsignedHash);
      const signed = entry.prepared.leg === "eth-delivery" ? assembleTreasuryNativeTransfer(entry.prepared.prepared, signature) :
        assembleSignedErc20Transfer(entry.prepared.prepared, signature, entry.prepared.prepared.senderAddress);
      check(isDeepStrictEqual(signed, entry.signed) && isDeepStrictEqual(entry.nearCost,
        observeNearExecutionCost(entry.prepared.role, entry.nearTransactionHash, entry.nearOutcome, leg)), "Live export requires authentic full-key MPC proof and exact public signing costs.");
    }
    const a = entry.audit;
    return { leg, role: entry.prepared.role, nearTransactionHash: entry.nearTransactionHash, evmTransactionHash: entry.signed.hash,
      unsignedHash: entry.prepared.prepared.unsignedHash, preparedAt: entry.preparedAt,
      signingApproval: { digest: entry.signingApproval.digest, reference: entry.signingApproval.reference, at: entry.signingApproval.at },
      broadcast: { signedHash: entry.signed.hash, at: entry.evmAttempt.at, auditHash: a.auditHash,
        recovery: a.recovery, expiredPreparationAcknowledgment: a.expiredPreparationAcknowledgment },
      transaction: transactionFields(entry), receipt: receiptFields(entry.proof) };
  });
  check(isDeepStrictEqual(e.actualCosts.evm, PURCHASE_LEGS.map(leg => e.legs[leg]!.proof!.feeObservation)) &&
    isDeepStrictEqual(e.actualCosts.near, PURCHASE_LEGS.map(leg => e.legs[leg]!.nearCost!)), "Actual costs differ from the preserved execution records.");
  const body = { schemaVersion: 1 as const, kind: "wealthpixels-portfolio-purchase" as const, mode, status: "complete" as const, recordedAt,
    operatorModel: "single-operator-demo" as const, settlementModel: "non-atomic-principal-inventory" as const,
    disclosures: { ...PURCHASE_EVIDENCE_DISCLOSURES, fixture: fixtureDisclosure(mode) }, authorities: PURCHASE_EVIDENCE_AUTHORITIES,
    quote: record.quote, quoteApproval: record.approval, paymentAuthorization: e.paymentAuthorization, legs,
    settlement: { status: "completed" as const, paidAt: e.paidAt, completedAt: e.updatedAt, paymentClaim: e.paymentClaim, outstandingObligations: [] as const },
    actualCosts: e.actualCosts, realizedCosts: e.realizedCosts };
  const result: PurchaseEvidenceManifest = frozen({ ...body, manifestHash: fingerprint("wealthpixels-portfolio-purchase-v1", body) });
  assertPurchaseEvidenceManifest(result); return result;
}

/** Local mathematical/integrity checks only. A separate public-RPC verifier must establish blockchain authenticity. */
export function assertPurchaseEvidenceManifest(value: unknown): asserts value is PurchaseEvidenceManifest {
  keys(value, ["schemaVersion", "kind", "mode", "status", "recordedAt", "operatorModel", "settlementModel", "disclosures", "authorities",
    "quote", "quoteApproval", "paymentAuthorization", "legs", "settlement", "actualCosts", "realizedCosts", "manifestHash"], "purchase manifest");
  const m = value as PurchaseEvidenceManifest;
  check(m.schemaVersion === 1 && m.kind === "wealthpixels-portfolio-purchase" && ["live", "offline-fixture"].includes(m.mode) && m.status === "complete" &&
    m.operatorModel === "single-operator-demo" && m.settlementModel === "non-atomic-principal-inventory", "Unsupported public purchase evidence model.");
  check(isDeepStrictEqual(m.authorities, PURCHASE_EVIDENCE_AUTHORITIES) && isDeepStrictEqual(m.disclosures,
    { ...PURCHASE_EVIDENCE_DISCLOSURES, fixture: fixtureDisclosure(m.mode) }), "Public authorities or required disclosures changed.");
  publicOnly(m, m.mode);
  const { manifestHash, ...body } = m;
  check(hexHash(manifestHash) === fingerprint("wealthpixels-portfolio-purchase-v1", body), "Purchase manifest integrity hash changed.");
  keys(m.quote.policy, ["maxExpectedFeeBps", "maxEstimateAgeMs", "nominalQuoteWindowMs", "execution"], "quote policy");
  keys(m.quote.policy.execution, ["gasLimitCap", "usdcPaymentGasLimitCap", "maxFeePerGasCap", "maxTotalFeeWei", "gasBufferBps", "operatingReserveWei"], "execution policy");
  assertPurchaseQuote(m.quote, m.quote.quoteHash, m.quote.policy); assertQuoteApproval(m.quote, m.quoteApproval, m.quote.policy);
  check(m.quote.purpose === "prepayment" && m.quote.prices.mode === "approved-demonstration", "Evidence requires the original approved demonstration quote.");
  const auth = m.paymentAuthorization;
  check(isDeepStrictEqual(auth, makePaymentAuthorization(m.quote, m.quoteApproval, auth.unsignedHash, auth.eligibility, auth.reference)),
    "Original payment authorization or historical economic eligibility changed.");
  check(Array.isArray(m.legs) && m.legs.length === 3, "Exactly three ordered purchase legs are required.");
  const evmHashes = new Set<string>(), nearHashes = new Set<string>();
  const publicLegs: readonly PurchaseEvidenceLeg[] = m.legs;
  for (const [index, leg] of publicLegs.entries()) {
    keys(leg, ["leg", "role", "nearTransactionHash", "evmTransactionHash", "unsignedHash", "preparedAt", "signingApproval", "broadcast", "transaction", "receipt"], "purchase leg");
    const name = PURCHASE_LEGS[index]!, role = roleForLeg(name), expected = m.quote.transactions[index]!, tx = leg.transaction, receipt = leg.receipt;
    check(leg.leg === name && leg.role === role, "Purchase leg order or independent signing role changed.");
    nearHash(leg.nearTransactionHash); hexHash(leg.evmTransactionHash); hexHash(leg.unsignedHash);
    check(!nearHashes.has(leg.nearTransactionHash) && !evmHashes.has(leg.evmTransactionHash), "Purchase legs cannot reuse signing or EVM transaction hashes.");
    nearHashes.add(leg.nearTransactionHash); evmHashes.add(leg.evmTransactionHash);
    keys(tx, ["chainId", "type", "nonce", "to", "value", "data", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"], "public transaction");
    check(tx.chainId === 11155111n && tx.type === 2 && Number.isSafeInteger(tx.nonce) && tx.nonce >= 0 &&
      tx.to === (name === "eth-delivery" ? expected.recipientAddress : expected.tokenAddress) &&
      tx.value === (name === "eth-delivery" ? expected.amountBaseUnits : 0n) &&
      tx.data === (name === "eth-delivery" ? "0x" : abi.encodeFunctionData("transfer", [expected.recipientAddress, expected.amountBaseUnits])),
      "Transaction chain, type, nonce, token, recipient, value or calldata differs from the approved leg.");
    const fee = m.quote.costs.evm.find(item => item.leg === expected.leg)!;
    requireUint256(tx.gasLimit, "Signed gas limit", true); requireUint256(tx.maxFeePerGas, "Signed maximum fee", true);
    requireUint256(tx.maxPriorityFeePerGas, "Signed maximum priority fee");
    check(tx.gasLimit >= 21_000n && tx.gasLimit <= purchaseExecutionPolicyForLeg(m.quote.policy.execution, name).gasLimitCap &&
      tx.maxFeePerGas === fee.maxFeePerGasWei && tx.maxPriorityFeePerGas === fee.maxPriorityFeePerGasWei && tx.maxPriorityFeePerGas <= tx.maxFeePerGas &&
      tx.gasLimit * tx.maxFeePerGas <= m.quote.policy.execution.maxTotalFeeWei, "Transaction protective fee parameters changed.");
    check(Transaction.from({ ...tx, accessList: [] }).unsignedHash === leg.unsignedHash, "Unsigned transaction parameters do not reconstruct the approved digest.");
    keys(leg.signingApproval, ["digest", "reference", "at"], "signing approval"); label(leg.signingApproval.reference, "Public signing approval reference");
    check(leg.signingApproval.digest === leg.unsignedHash && utc(leg.preparedAt) >= utc(m.quote.createdAt) &&
      utc(leg.signingApproval.at) >= utc(leg.preparedAt) && utc(leg.signingApproval.at) - utc(leg.preparedAt) <= 900_000,
      "Original preparation or exact-digest signing approval changed.");
    keys(leg.broadcast, ["signedHash", "at", "auditHash", "recovery", "expiredPreparationAcknowledgment"], "broadcast approval");
    const b = leg.broadcast, age = utc(b.at) - utc(leg.preparedAt);
    check(b.signedHash === leg.evmTransactionHash && utc(b.at) >= utc(leg.signingApproval.at) && typeof b.recovery === "boolean" &&
      (b.recovery ? age > 900_000 && b.expiredPreparationAcknowledgment === leg.preparedAt : age <= 900_000 && b.expiredPreparationAcknowledgment === null),
      "Exact signed-hash broadcast approval or expired-preparation acknowledgment changed."); hexHash(b.auditHash);
    keys(receipt, ["blockNumber", "blockHash", "gasUsed", "effectiveGasPriceWei", "actualFeeWei", "finality", "before", "after",
      ...(name === "eth-delivery" ? ["nativeDeltas"] : ["tokenDeltas"]), ...(name === "usdc-payment" ? ["paymentClaim"] : [])], "receipt");
    requireUint256(receipt.blockNumber, "Receipt block", true); hexHash(receipt.blockHash);
    requireUint256(receipt.gasUsed, "Receipt gas used", true); requireUint256(receipt.effectiveGasPriceWei, "Receipt gas price");
    check(receipt.gasUsed <= tx.gasLimit && receipt.effectiveGasPriceWei <= tx.maxFeePerGas &&
      receipt.actualFeeWei === receipt.gasUsed * receipt.effectiveGasPriceWei &&
      receipt.finality === (name === "usdc-payment" ? "finalized" : "two-confirmations"), "Receipt fees or required finality changed.");
    for (const balance of [receipt.before, receipt.after]) {
      keys(balance, ["senderEth", "recipientEth", ...(name === "eth-delivery" ? [] : ["senderToken", "recipientToken"])], "receipt balance");
      for (const amount of Object.values(balance)) requireUint256(amount, "Receipt balance");
    }
    check(receipt.after.senderEth - receipt.before.senderEth === -receipt.actualFeeWei - tx.value &&
      receipt.after.recipientEth - receipt.before.recipientEth === tx.value, "Native receipt movements do not preserve existing balances and exact gas fees.");
    if (name === "eth-delivery") {
      keys(receipt.nativeDeltas, ["sender", "recipient"], "native movement");
      check(receipt.nativeDeltas!.sender === -tx.value - receipt.actualFeeWei && receipt.nativeDeltas!.recipient === tx.value, "Native delivery quantity changed.");
    } else {
      keys(receipt.tokenDeltas, ["sender", "recipient"], "token movement");
      check(receipt.tokenDeltas!.sender === -expected.amountBaseUnits && receipt.tokenDeltas!.recipient === expected.amountBaseUnits &&
        receipt.after.senderToken! - receipt.before.senderToken! === -expected.amountBaseUnits &&
        receipt.after.recipientToken! - receipt.before.recipientToken! === expected.amountBaseUnits, "ERC-20 receipt movement differs from the exact allocation.");
    }
  }
  const payment = publicLegs[0]!, link = publicLegs[1]!, eth = publicLegs[2]!;
  check(payment.unsignedHash === auth.unsignedHash && utc(auth.checkedAt) <= utc(payment.signingApproval.at) &&
    utc(auth.eligibility.expiresAt) > utc(payment.signingApproval.at), "Payment authorization does not bind the first valid payment signing attempt.");
  check(payment.receipt.blockNumber < link.receipt.blockNumber && link.receipt.blockNumber < eth.receipt.blockNumber &&
    eth.transaction.nonce === link.transaction.nonce + 1, "Payment and sequential Treasury asset execution order changed.");
  keys(payment.receipt.paymentClaim, ["chainId", "transactionHash", "logIndex"], "payment claim");
  check(payment.receipt.paymentClaim!.transactionHash === payment.evmTransactionHash, "Payment claim references a different transaction.");
  keys(m.settlement, ["status", "paidAt", "completedAt", "paymentClaim", "outstandingObligations"], "settlement");
  check(m.settlement.status === "completed" && Array.isArray(m.settlement.outstandingObligations) && m.settlement.outstandingObligations.length === 0 &&
    m.settlement.paymentClaim === paymentClaimId(payment.receipt.paymentClaim!) && utc(m.settlement.paidAt) >= utc(payment.broadcast.at) &&
    utc(link.preparedAt) >= utc(m.settlement.paidAt) && utc(m.settlement.completedAt) >= utc(eth.broadcast.at) &&
    utc(m.recordedAt) >= utc(m.settlement.completedAt), "Settlement completion, payment identity or historical chronology changed.");
  strictActualCosts(m.actualCosts);
  for (const [index, leg] of m.legs.entries()) {
    const evm = m.actualCosts.evm[index]!, near = m.actualCosts.near[index]!, expectedFeeLeg = m.quote.transactions[index]!.leg;
    check(evm.leg === expectedFeeLeg && near.leg === expectedFeeLeg && evm.payer === leg.role && near.payer === leg.role &&
      evm.transactionHash === leg.evmTransactionHash && near.transactionHash === leg.nearTransactionHash && evm.executionStatus === "success" &&
      evm.gasUsed === leg.receipt.gasUsed && evm.effectiveGasPriceWei === leg.receipt.effectiveGasPriceWei,
      "Actual execution costs do not belong to the exact public purchase legs.");
  }
  check(m.realizedCosts.asOf === m.settlement.completedAt && isDeepStrictEqual(m.realizedCosts,
    valueAuthorizedActualCosts(m.quote, auth, m.actualCosts, m.realizedCosts.asOf, m.quote.policy)),
    "Realized execution costs differ from the preserved original rates and actual cost records.");
}
export function encodePurchaseEvidenceManifest(manifest: PurchaseEvidenceManifest): string {
  assertPurchaseEvidenceManifest(manifest); const text = encodeState(manifest);
  check(Buffer.byteLength(text, "utf8") <= 2_000_000, "Public purchase evidence exceeds two megabytes."); return text;
}
export function decodePurchaseEvidenceManifest(text: string): PurchaseEvidenceManifest {
  check(typeof text === "string" && Buffer.byteLength(text, "utf8") <= 2_000_000, "Public purchase evidence exceeds two megabytes.");
  const value: unknown = JSON.parse(text, (_key, item: unknown) => {
    if (item && typeof item === "object" && "$bigint" in item) {
      const digits = (item as { $bigint: unknown }).$bigint;
      check(Object.keys(item).length === 1 && typeof digits === "string" && /^(?:0|-?[1-9][0-9]{0,1023})$/.test(digits), "Invalid public evidence bigint encoding.");
      return BigInt(digits);
    }
    return item;
  });
  assertPurchaseEvidenceManifest(value); return frozen(value);
}
