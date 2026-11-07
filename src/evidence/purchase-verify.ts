import { isDeepStrictEqual } from "node:util";
import type { SepoliaReadRpc } from "../evm/sepolia-link.js";
import { paymentClaimId } from "../purchase/claims.js";
import { frozen, hexHash } from "../purchase/integrity.js";
import { PURCHASE_LEGS } from "../purchase/settlement.js";
import { assertPurchaseEvidenceManifest, type PurchaseEvidenceManifest } from "./purchase-manifest.js";
import { verifyPublicPurchaseLeg, PurchaseEvidenceLegError } from "./purchase-leg.js";
import { createReadOnlyBeaconTransport, verifyHistoricalPaymentFinality, HistoricalFinalityError, type BeaconReadTransport } from "./purchase-finality.js";
import { createPurchaseEvidenceTransport, PurchaseEvidenceRpcError, type PurchaseEvidenceTransport } from "./purchase-rpc.js";
import { reconcilePurchasePublicObservations } from "./purchase-reconcile.js";

export interface PurchaseVerificationOptions {
  readonly nearRpcUrl?: string; readonly evmRpcUrl?: string; readonly beaconUrl?: string; readonly pacingMs?: number;
  readonly expectedQuoteHash?: string;
  /** Read-only code injection for tests/compatible providers. Cryptographic checks cannot be replaced. */
  readonly transport?: PurchaseEvidenceTransport; readonly beacon?: BeaconReadTransport;
}
export interface PurchaseVerificationResult {
  readonly status: "verified" | "incomplete" | "failed"; readonly stage: string; readonly code: string;
  readonly message: string; readonly checkedAt: string; readonly completedChecks: readonly string[];
  readonly manifestHash?: string; readonly publicFacts?: unknown; readonly boundaries: readonly string[];
}
const boundaries = Object.freeze([
  "Public facts are verified against the configured execution, NEAR and Ethereum consensus RPC providers; this is not a light client or an SSZ state-proof verifier.",
  "Quote association, human approval references, historical gas estimates and absence of duplicate claims in other journals are operator assertions, not trustless onchain enforcement.",
  "Demonstration prices are approved order assumptions, not independently authenticated current market prices; test USDC is valued at one nominal USD unit.",
  "The two disposable roles may be controlled by one demonstrator. Settlement is sequential and non-atomic; no pooled portfolio token is issued.",
]);
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function object(value: unknown): Record<string, any> { check(value && typeof value === "object" && !Array.isArray(value), "Missing public object."); return value as Record<string, any>; }
function quantity(value: unknown): bigint { check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Malformed public integer."); return BigInt(value); }
const tag = (number: bigint) => "0x" + number.toString(16);
type Leg = PurchaseEvidenceManifest["legs"][number];
function transactionFields(value: Awaited<ReturnType<typeof verifyPublicPurchaseLeg>>["transaction"]["prepared"]) {
  return { chainId: value.chainId, type: 2 as const, nonce: value.nonce,
    to: "tokenAddress" in value ? value.tokenAddress : value.recipientAddress, value: value.value, data: value.data,
    gasLimit: value.gasLimit, maxFeePerGas: value.maxFeePerGas, maxPriorityFeePerGas: value.maxPriorityFeePerGas };
}
function receiptFields(proof: Awaited<ReturnType<typeof verifyPublicPurchaseLeg>>["proof"]): Leg["receipt"] {
  check(proof.finality !== "awaiting-finality", "Receipt awaits required canonical finality.");
  return { blockNumber: proof.blockNumber, blockHash: proof.blockHash, gasUsed: proof.gasUsed,
    effectiveGasPriceWei: proof.effectiveGasPriceWei, actualFeeWei: proof.actualFeeWei, finality: proof.finality,
    before: proof.before, after: proof.after, ...(proof.tokenDeltas ? { tokenDeltas: proof.tokenDeltas } : {}),
    ...(proof.nativeDeltas ? { nativeDeltas: proof.nativeDeltas } : {}), ...(proof.paymentClaim ? { paymentClaim: proof.paymentClaim } : {}) };
}
function nearComparable(value: PurchaseEvidenceManifest["actualCosts"]["near"][number]) {
  return { ...value, receiptOutcomes: [...value.receiptOutcomes].sort((a, b) => a.receiptId.localeCompare(b.receiptId)) };
}
/** Independent public verification. This module never reads a journal, environment file or credential. */
export async function verifyPurchaseEvidence(value: unknown, options: PurchaseVerificationOptions = {}): Promise<PurchaseVerificationResult> {
  let stage = "manifest", manifestHash: string | undefined;
  const completedChecks: string[] = [], unavailable: unknown[] = [];
  const result = (status: PurchaseVerificationResult["status"], code: string, message: string, publicFacts?: unknown): PurchaseVerificationResult => frozen({
    status, stage, code, message, checkedAt: new Date().toISOString(), completedChecks,
    ...(manifestHash ? { manifestHash } : {}), ...(publicFacts ? { publicFacts } : {}), boundaries,
  });
  try {
    const candidate = object(value);
    if (candidate.schemaVersion === 1 && candidate.kind === "wealthpixels-portfolio-purchase" && candidate.mode === "live" && candidate.status === "pending")
      return result("incomplete", "PENDING", "No completed live purchase is published. No RPC requests were made.");
    assertPurchaseEvidenceManifest(value);
    const manifest = value; manifestHash = manifest.manifestHash;
    if (options.expectedQuoteHash !== undefined) check(hexHash(options.expectedQuoteHash) === manifest.quote.quoteHash,
      "The evidence quote differs from the separately preserved approved quote hash.");
    check(manifest.mode === "live", "Synthetic purchase fixtures cannot be verified or reported as live blockchain evidence.");
    check(!/example\.invalid|SIMULATED|OFFLINE[- ]FIXTURE/i.test(JSON.stringify(manifest.quote, (_key, field) => typeof field === "bigint" ? field.toString() : field)),
      "A synthetic quotation cannot be relabelled as live purchase evidence.");
    completedChecks.push("immutable-quote-approvals-all-six-costs-and-local-manifest-integrity");
    const transport = options.transport ?? createPurchaseEvidenceTransport(options);
    const read = async (chain: "near" | "evm", method: string, params: unknown) => {
      try { return await transport.request(chain, method, params); }
      catch (error) { unavailable.push(error); throw error; }
    };
    const rpc: SepoliaReadRpc = { request(method, params) { return read("evm", method, params); } };
    stage = "network-identity";
    check(object(await read("near", "status", [])).chain_id === "testnet" && quantity(await read("evm", "eth_chainId", [])) === 11155111n,
      "Configured public endpoints do not report NEAR Testnet and Ethereum Sepolia.");
    completedChecks.push("public-network-identities");
    const proofs: Awaited<ReturnType<typeof verifyPublicPurchaseLeg>>[] = [];
    for (const [index, leg] of manifest.legs.entries()) {
      stage = `${leg.leg}-public-authorization-and-receipt`;
      const params = { tx_hash: leg.nearTransactionHash, sender_account_id: manifest.authorities.roles[leg.role].accountId, wait_until: "FINAL" };
      let outcome: unknown;
      try { outcome = await read("near", "tx_status", params); }
      catch (error) {
        if (!(error instanceof PurchaseEvidenceRpcError) || error.code !== "METHOD_NOT_FOUND") throw error;
        unavailable.pop(); // The documented method-name alternative is not a transaction retry.
        outcome = await read("near", "EXPERIMENTAL_tx_status", params);
      }
      if (!outcome || object(outcome).final_execution_status !== "FINAL") return result("incomplete", "NEAR_NOT_FINAL", "The recorded NEAR authorization is not available as a FINAL outcome.");
      const raw = await read("evm", "eth_getTransactionByHash", [leg.evmTransactionHash]);
      const receipt = await read("evm", "eth_getTransactionReceipt", [leg.evmTransactionHash]);
      if (!raw || !receipt) return result("incomplete", "TRANSACTION_UNAVAILABLE", "The recorded Ethereum transaction or receipt is unavailable; no fixture fallback is permitted.");
      const referenceBlockNumber = index === 0 ? manifest.quote.costs.evmObservation.blockNumber : proofs[index - 1]!.proof.blockNumber;
      const verified = await verifyPublicPurchaseLeg({ quote: manifest.quote, leg: leg.leg,
        nearTransactionHash: leg.nearTransactionHash, evmTransactionHash: leg.evmTransactionHash, unsignedHash: leg.unsignedHash, referenceBlockNumber }, outcome, rpc);
      check(isDeepStrictEqual(leg.transaction, transactionFields(verified.transaction.prepared)), "Public transaction parameters differ from the manifest and original signed intent.");
      check(isDeepStrictEqual(leg.receipt, receiptFields(verified.proof)), "Canonical receipt, asset movement or gas accounting differs from the manifest.");
      const address = manifest.authorities.roles[leg.role].evmAddress, number = verified.proof.blockNumber;
      const beforeNonce = quantity(await read("evm", "eth_getTransactionCount", [address, tag(number - 1n)]));
      const afterNonce = quantity(await read("evm", "eth_getTransactionCount", [address, tag(number)]));
      check(beforeNonce === BigInt(leg.transaction.nonce) && afterNonce === beforeNonce + 1n,
        "Historical role nonce progression does not isolate the recorded purchase leg.");
      const expectedEvm = manifest.actualCosts.evm[index]!, expectedNear = manifest.actualCosts.near[index]!;
      check(isDeepStrictEqual(expectedEvm, verified.proof.feeObservation) && isDeepStrictEqual(nearComparable(expectedNear), nearComparable(verified.nearCost)),
        "Published actual costs differ from public Ethereum gas or finalized NEAR receipt costs.");
      proofs.push(verified); completedChecks.push(`${leg.leg}-full-key-mpc-signed-bytes-canonical-receipt-movements-nonce-and-costs`);
    }
    stage = "order-and-historical-payment-finality";
    const [payment, link, native] = proofs;
    check(payment && link && native && payment.proof.paymentClaim && paymentClaimId(payment.proof.paymentClaim) === manifest.settlement.paymentClaim,
      "Finalized public USDC event does not match the published unique payment identity.");
    check(payment.proof.blockNumber < link.proof.blockNumber && link.proof.blockNumber < native.proof.blockNumber &&
      native.transaction.prepared.nonce === link.transaction.prepared.nonce + 1, "Canonical delivery order or sequential Treasury nonce is invalid.");
    const finality = await verifyHistoricalPaymentFinality({ paymentBlockNumber: payment.proof.blockNumber, paymentBlockHash: payment.proof.blockHash,
      linkBlockNumber: link.proof.blockNumber, linkBlockHash: link.proof.blockHash },
    { evm: rpc, beacon: options.beacon ?? createReadOnlyBeaconTransport({ beaconUrl: options.beaconUrl, pacingMs: options.pacingMs }) });
    completedChecks.push("historical-finalized-payment-before-link-delivery-under-public-rpc-trust");
    stage = "realized-fees-and-settlement";
    const actual = reconcilePurchasePublicObservations(manifest, proofs).realizedCosts;
    check(manifest.settlement.status === "completed" && manifest.settlement.outstandingObligations.length === 0 && PURCHASE_LEGS.every((leg, index) => manifest.legs[index]?.leg === leg),
      "Public asset deliveries do not reconcile a completed purchase.");
    completedChecks.push("authenticated-actual-fees-realized-ratio-and-all-three-deliveries");
    stage = "complete";
    return result("verified", "VERIFIED", "All required public purchase checks passed under the disclosed RPC trust model.", {
      investmentUsdcBaseUnits: manifest.quote.terms.investmentUsdcBaseUnits, quantities: manifest.quote.terms.quantities,
      legs: proofs.map((proof, index) => ({ leg: manifest.legs[index]!.leg, nearTransactionHash: manifest.legs[index]!.nearTransactionHash,
        evmTransactionHash: proof.proof.transactionHash, blockNumber: proof.proof.blockNumber, blockHash: proof.proof.blockHash, actualEvmFeeWei: proof.proof.actualFeeWei })),
      historicalPaymentFinality: finality, actualCosts: manifest.actualCosts, realizedCosts: actual,
      onchainSettlement: "three-matching-direct-asset-transfers", operatorClaim: "completed-local-purchase-association",
    });
  } catch (error) {
    if (error instanceof PurchaseEvidenceLegError)
      return result(error.code === "PENDING" || error.code === "RPC_FAILED" ? "incomplete" : "failed", error.code, error.message);
    if (error instanceof HistoricalFinalityError)
      return result(error.code === "RPC_UNAVAILABLE" ? "incomplete" : "failed", error.code, error.message);
    if (error instanceof PurchaseEvidenceRpcError)
      return result(error.code === "INVALID_RPC" ? "failed" : "incomplete", error.code, error.message);
    if (unavailable.length) return result("incomplete", "PUBLIC_HISTORY_UNAVAILABLE", "Required public history was unavailable or rate limited; verification remains unresolved. Configure compatible archival endpoints and run verification again.");
    return result("failed", "INVALID_EVIDENCE", stage === "manifest" ? "Manifest, quotation, approval or fixture/live integrity checks failed; no live proof was accepted." :
      `Contradictory or invalid public evidence at ${stage}; no verification success was recorded.`);
  }
}
