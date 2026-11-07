import { isDeepStrictEqual } from "node:util";
import type { PublicPurchaseLegVerification } from "./purchase-leg.js";
import { assertPurchaseEvidenceManifest, type PurchaseEvidenceManifest } from "./purchase-manifest.js";
import { paymentClaimId } from "../purchase/claims.js";
import { valueAuthorizedActualCosts } from "../purchase/authorized-costs.js";
import { check, frozen } from "../purchase/integrity.js";

/** Mathematical consistency seam. Caller-supplied observations grant no public-verification or signing capability. */
export function reconcilePurchasePublicObservations(manifest: PurchaseEvidenceManifest, observations: readonly PublicPurchaseLegVerification[]) {
  assertPurchaseEvidenceManifest(manifest);
  check(observations.length === 3, "Exactly three independent observations are required.");
  for (const [index, value] of observations.entries()) {
    const declared = manifest.legs[index]!, proof = value.proof, p = value.transaction.prepared;
    check(proof.kind === "verified-purchase-leg" && proof.purchaseId === manifest.quote.purchaseId && proof.quoteHash === manifest.quote.quoteHash &&
      proof.leg === declared.leg && proof.role === declared.role && proof.unsignedHash === declared.unsignedHash &&
      proof.transactionHash === declared.evmTransactionHash && value.transaction.signed.hash === declared.evmTransactionHash &&
      value.transaction.signed.senderAddress === manifest.authorities.roles[declared.role].evmAddress,
      "Observed transaction, role, signed hash or purchase association changed.");
    check(isDeepStrictEqual(declared.transaction, { chainId: p.chainId, type: 2, nonce: p.nonce,
      to: "tokenAddress" in p ? p.tokenAddress : p.recipientAddress, value: p.value, data: p.data,
      gasLimit: p.gasLimit, maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas }),
      "Observed public transaction parameters changed.");
    const receipt = { blockNumber: proof.blockNumber, blockHash: proof.blockHash, gasUsed: proof.gasUsed,
      effectiveGasPriceWei: proof.effectiveGasPriceWei, actualFeeWei: proof.actualFeeWei, finality: proof.finality, before: proof.before, after: proof.after,
      ...(proof.tokenDeltas ? { tokenDeltas: proof.tokenDeltas } : {}), ...(proof.nativeDeltas ? { nativeDeltas: proof.nativeDeltas } : {}),
      ...(proof.paymentClaim ? { paymentClaim: proof.paymentClaim } : {}) };
    check(isDeepStrictEqual(receipt, declared.receipt), "Observed canonical receipt, finality or asset movement changed.");
    const canonicalNear = (value: typeof observations[number]["nearCost"]) => ({ ...value,
      receiptOutcomes: [...value.receiptOutcomes].sort((a, b) => a.receiptId.localeCompare(b.receiptId)) });
    check(isDeepStrictEqual(proof.feeObservation, manifest.actualCosts.evm[index]) &&
      isDeepStrictEqual(canonicalNear(value.nearCost), canonicalNear(manifest.actualCosts.near[index]!)),
      "Observed Ethereum or NEAR actual fee costs changed.");
  }
  const [payment, link, native] = observations;
  check(payment!.proof.paymentClaim && paymentClaimId(payment!.proof.paymentClaim) === manifest.settlement.paymentClaim &&
    payment!.proof.finality === "finalized", "Observed finalized USDC claim changed.");
  check(payment!.proof.blockNumber < link!.proof.blockNumber && link!.proof.blockNumber < native!.proof.blockNumber &&
    native!.transaction.prepared.nonce === link!.transaction.prepared.nonce + 1, "Observed transaction ordering or Treasury nonce progression changed.");
  const auth = manifest.paymentAuthorization;
  const actual = valueAuthorizedActualCosts(manifest.quote, { quoteHash: auth.quoteHash, priceSetHash: auth.priceSetHash,
    checkedAt: auth.checkedAt, authorizationHash: auth.authorizationHash }, manifest.actualCosts, manifest.realizedCosts.asOf, manifest.quote.policy);
  check(isDeepStrictEqual(actual, manifest.realizedCosts), "Realized costs do not match original assumptions and observations.");
  return frozen({ status: "consistent-observations" as const, mode: manifest.mode,
    executionProof: "none-caller-supplied-observations-only" as const,
    historicalFinalityBeforeDelivery: "requires-separate-public-consensus-observation" as const,
    actualCosts: manifest.actualCosts, realizedCosts: actual, settlement: manifest.settlement });
}
