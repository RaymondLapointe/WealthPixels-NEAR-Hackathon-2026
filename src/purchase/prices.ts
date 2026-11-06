import { isDeepStrictEqual } from "node:util";
import { requireUint256 } from "./amounts.js";
import type { FeePriceRate } from "./fee-eligibility.js";
import { check, fingerprint, frozen, hexHash, label, publicSource, purchaseId, utc } from "./integrity.js";

export const PRICE_ASSETS = ["ETH", "LINK", "NEAR"] as const;
export type PriceAsset = typeof PRICE_ASSETS[number];
export type PricingPurpose = "offline" | "prepayment";
export interface PriceInput {
  readonly asset: PriceAsset; readonly quoteCurrency: "USD"; readonly numerator: bigint; readonly denominator: bigint;
  readonly sourceUrl: string; readonly sourceReference: string; readonly originalObservedAt: string;
}
export interface PriceObservation extends PriceInput { readonly effectiveAt: string; readonly expiresAt: string }
export interface PricePacket {
  readonly schemaVersion: 1; readonly kind: "demonstration-price-proposal"; readonly purchaseId: string;
  readonly providerId: string; readonly validFrom: string; readonly expiresAt: string;
  readonly prices: Readonly<Record<PriceAsset, PriceInput>>; readonly approvalDigest: string;
}
export interface PriceApproval { readonly approvedDigest: string; readonly reference: string; readonly approvedAt: string }
export interface PriceSet {
  readonly schemaVersion: 1; readonly kind: "normalized-price-set"; readonly purchaseId: string; readonly providerId: string;
  readonly mode: "approved-demonstration" | "offline-fixture";
  readonly validFrom: string; readonly expiresAt: string;
  readonly prices: Readonly<Record<PriceAsset, PriceObservation>>;
  readonly approval: PriceApproval | null; readonly setHash: string;
}
export interface PriceRequest {
  readonly purchaseId: string; readonly asOf: string; readonly purpose: PricingPurpose; readonly expectedPriceSetHash?: string;
}
/** External acquisition boundary; allocation, costs and delivery need no vendor-specific API. */
export interface PriceProvider { getPrices(request: PriceRequest): Promise<PriceSet> }
export interface DemonstrationPriceInput {
  readonly purchaseId: string; readonly providerId: string; readonly validFrom: string; readonly expiresAt: string;
  readonly prices: Readonly<Record<PriceAsset, PriceInput>>;
}

export function parseExactPriceDecimal(value: unknown): { numerator: bigint; denominator: bigint } {
  check(typeof value === "string" && value.length <= 116 && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,36})?$/.test(value), "Price must be an exact plain decimal string.");
  const [whole, decimal = ""] = value.split(".");
  return frozen({ numerator: requireUint256(BigInt(whole! + decimal), "Price numerator", true), denominator: 10n ** BigInt(decimal.length) });
}
export function prepareDemonstrationPrices(input: DemonstrationPriceInput): PricePacket {
  purchaseId(input.purchaseId); label(input.providerId, "Provider ID", 128);
  const from = utc(input.validFrom), end = utc(input.expiresAt);
  check(end > from && end - from <= 300_000, "Demonstration validity must be positive and at most five minutes.");
  check(input.prices && Object.keys(input.prices).sort().join() === [...PRICE_ASSETS].sort().join(), "All three exact price assets are required.");
  const prices = Object.fromEntries(PRICE_ASSETS.map(asset => {
    const p = input.prices[asset];
    check(p && p.asset === asset && p.quoteCurrency === "USD", "Price asset or quote currency mismatch.");
    const normalized: PriceInput = { asset, quoteCurrency: "USD", numerator: requireUint256(p.numerator, "Price numerator", true),
      denominator: requireUint256(p.denominator, "Price denominator", true), sourceUrl: publicSource(p.sourceUrl),
      sourceReference: label(p.sourceReference, "Original price reference"), originalObservedAt: p.originalObservedAt };
    check(utc(normalized.originalObservedAt) <= from, "Original price observation cannot be later than demonstration validity.");
    check(isDeepStrictEqual(p, normalized), "Unexpected or malformed price fields.");
    return [asset, normalized];
  })) as unknown as Record<PriceAsset, PriceInput>;
  const body = { schemaVersion: 1 as const, kind: "demonstration-price-proposal" as const, purchaseId: input.purchaseId,
    providerId: input.providerId, validFrom: input.validFrom, expiresAt: input.expiresAt, prices };
  return frozen({ ...body, approvalDigest: fingerprint("demonstration-price-proposal-v1", body) });
}
function packetFromSet(set: PriceSet): PricePacket {
  const prices = Object.fromEntries(PRICE_ASSETS.map(asset => {
    const p = set.prices[asset];
    return [asset, { asset: p.asset, quoteCurrency: p.quoteCurrency, numerator: p.numerator, denominator: p.denominator,
      sourceUrl: p.sourceUrl, sourceReference: p.sourceReference, originalObservedAt: p.originalObservedAt }];
  })) as unknown as Record<PriceAsset, PriceInput>;
  return prepareDemonstrationPrices({ purchaseId: set.purchaseId, providerId: set.providerId,
    validFrom: set.validFrom, expiresAt: set.expiresAt, prices });
}
function priceSet(packet: PricePacket, approval: PriceApproval | null): PriceSet {
  const rebuilt = prepareDemonstrationPrices(packet);
  check(isDeepStrictEqual(packet, rebuilt), "Demonstration proposal integrity failed.");
  if (approval) {
    check(approval.approvedDigest === packet.approvalDigest, "Explicit approval must equal the exact price proposal digest.");
    label(approval.reference, "Price approval reference");
    check(utc(approval.approvedAt) >= utc(packet.validFrom) && utc(approval.approvedAt) < utc(packet.expiresAt), "Price approval is outside validity.");
    check(Object.keys(approval).sort().join() === "approvedAt,approvedDigest,reference", "Unexpected approval fields.");
  }
  const effectiveAt = approval?.approvedAt ?? packet.validFrom;
  const prices = Object.fromEntries(PRICE_ASSETS.map(asset => [asset, { ...packet.prices[asset], effectiveAt, expiresAt: packet.expiresAt }])) as unknown as Record<PriceAsset, PriceObservation>;
  const body = { schemaVersion: 1 as const, kind: "normalized-price-set" as const, purchaseId: packet.purchaseId, providerId: packet.providerId,
    mode: approval ? "approved-demonstration" as const : "offline-fixture" as const, validFrom: packet.validFrom,
    expiresAt: packet.expiresAt, prices, approval };
  return frozen({ ...body, setHash: fingerprint("normalized-price-set-v1", body) });
}
export function approveDemonstrationPrices(packet: PricePacket, approval: PriceApproval): PriceSet {
  check(approval && typeof approval === "object", "Explicit demonstration price approval is required.");
  return priceSet(packet, approval);
}
export function createOfflinePriceSet(input: DemonstrationPriceInput): PriceSet { return priceSet(prepareDemonstrationPrices(input), null); }
export function assertPriceSet(set: PriceSet, request: PriceRequest): void {
  check(set && typeof set === "object" && set.prices && (request.purpose === "offline" || request.purpose === "prepayment"), "Price set and purpose are required.");
  const expected = priceSet(packetFromSet(set), set.approval);
  check(isDeepStrictEqual(set, expected), "Normalized price-set integrity failed.");
  check(set.purchaseId === purchaseId(request.purchaseId), "Price approval belongs to another purchase.");
  check(utc(request.asOf) >= utc(set.validFrom) && utc(request.asOf) < utc(set.expiresAt) &&
    utc(request.asOf) >= utc(set.prices.ETH.effectiveAt), "Price set is not yet valid or has expired.");
  if (request.expectedPriceSetHash !== undefined) check(hexHash(request.expectedPriceSetHash) === set.setHash, "Approved price set changed.");
  if (request.purpose === "prepayment") check(set.mode === "approved-demonstration" && set.approval !== null, "Unapproved/offline prices cannot authorize payment eligibility.");
}
export function createDemonstrationPriceProvider(set: PriceSet): PriceProvider {
  check(set.mode === "approved-demonstration", "An approved demonstration price set is required.");
  const fixed = frozen(set);
  return Object.freeze({ async getPrices(request: PriceRequest) { assertPriceSet(fixed, request); return fixed; } });
}
export function createOfflinePriceProvider(set: PriceSet): PriceProvider {
  check(set.mode === "offline-fixture", "Explicit offline fixture mode is required.");
  const fixed = frozen(set);
  return Object.freeze({ async getPrices(request: PriceRequest) { assertPriceSet(fixed, request); return fixed; } });
}
export function toAllocationPrices(set: PriceSet, request: PriceRequest) {
  assertPriceSet(set, request);
  const reference = (asset: "ETH" | "LINK") => ({ numerator: set.prices[asset].numerator, denominator: set.prices[asset].denominator,
    source: `${set.providerId}:${set.prices[asset].sourceUrl}:${set.prices[asset].sourceReference}:${set.setHash}` });
  return frozen({ ethPrice: reference("ETH"), linkPrice: reference("LINK") });
}
export function toFeePriceRates(set: PriceSet, request: PriceRequest): Readonly<Record<"ETH" | "NEAR", FeePriceRate>> {
  assertPriceSet(set, request);
  const rate = (asset: "ETH" | "NEAR"): FeePriceRate => {
    const p = set.prices[asset];
    return { asset, usdNumerator: p.numerator, usdDenominator: p.denominator, sourceUrl: p.sourceUrl,
      reference: `${set.providerId}:${set.setHash}:original=${p.originalObservedAt}:${p.sourceReference}`,
      evidence: set.mode === "approved-demonstration" ? "approved-demonstration" : "offline-fixture",
      ...(set.approval ? { approvalReference: set.approval.reference } : {}), observedAt: p.effectiveAt, expiresAt: p.expiresAt };
  };
  return frozen({ ETH: rate("ETH"), NEAR: rate("NEAR") });
}
