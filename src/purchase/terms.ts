import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SEPOLIA_ASSETS, BPS_DENOMINATOR } from "./config.js";
import { requireUint256 } from "./amounts.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";

/** Nominal USDC quote units per whole asset. Caller must establish provenance/freshness before live use. */
export interface ReferencePrice { readonly numerator: bigint; readonly denominator: bigint; readonly source: string }
export interface PurchaseTermsInput {
  readonly investmentUsdcBaseUnits: bigint;
  readonly ethPrice: ReferencePrice;
  readonly linkPrice: ReferencePrice;
  readonly allocationBps?: Readonly<{ eth: bigint; link: bigint }>;
}
export interface PurchaseTerms {
  readonly schemaVersion: 1; readonly kind: "purchase-allocation-terms"; readonly chainId: 11155111n;
  readonly investmentUsdcBaseUnits: bigint; readonly usdcTokenAddress: string; readonly usdcDecimals: 6;
  readonly investorAddress: string; readonly treasuryAddress: string;
  readonly mpc: Readonly<{ rootPublicKey: string; domainId: 0; path: "wealthpixels/sepolia/v1" }>;
  readonly allocationBps: Readonly<{ eth: bigint; link: bigint }>;
  readonly prices: Readonly<{ ETH: ReferencePrice; LINK: ReferencePrice }>;
  readonly quantities: Readonly<{ ethWei: bigint; linkBaseUnits: bigint }>;
  readonly rounding: Readonly<{ ethRemainder: bigint; ethDenominator: bigint; linkRemainder: bigint; linkDenominator: bigint }>;
  readonly termsHash: string;
}
function price(value: ReferencePrice): ReferencePrice {
  if (!value || typeof value.source !== "string" || !value.source.trim() || value.source.length > 2048) throw new Error("A documented price source is required.");
  return Object.freeze({ numerator: requireUint256(value.numerator, "Price numerator", true),
    denominator: requireUint256(value.denominator, "Price denominator", true), source: value.source });
}
function hash(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, canonical(field)]));
    return item;
  }
  return "0x" + createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Pure allocation terms, not an approved/executable quote, price oracle or transaction preparation. */
export function createPurchaseTerms(input: PurchaseTermsInput): PurchaseTerms {
  const investment = requireUint256(input.investmentUsdcBaseUnits, "Investment USDC amount", true);
  const allocationBps = Object.freeze({ eth: requireUint256(input.allocationBps?.eth ?? 5000n, "ETH weight", true),
    link: requireUint256(input.allocationBps?.link ?? 5000n, "LINK weight", true) });
  if (allocationBps.eth + allocationBps.link !== BPS_DENOMINATOR) throw new Error("Allocation weights must sum to 10000 basis points.");
  const eth = price(input.ethPrice), link = price(input.linkPrice);
  // Keep fractional USDC budgets rational until conversion: no artificial two-micro-USDC minimum.
  const ethNumerator = investment * allocationBps.eth * 10n ** 18n * eth.denominator;
  const ethDenominator = 10n ** 6n * BPS_DENOMINATOR * eth.numerator;
  const linkNumerator = investment * allocationBps.link * 10n ** 18n * link.denominator;
  const linkDenominator = 10n ** 6n * BPS_DENOMINATOR * link.numerator;
  const quantities = Object.freeze({ ethWei: requireUint256(ethNumerator / ethDenominator, "ETH allocation", true),
    linkBaseUnits: requireUint256(linkNumerator / linkDenominator, "LINK allocation", true) });
  const base = {
    schemaVersion: 1 as const, kind: "purchase-allocation-terms" as const, chainId: 11155111n as const,
    investmentUsdcBaseUnits: investment, usdcTokenAddress: SEPOLIA_ASSETS.USDC.address, usdcDecimals: 6 as const,
    investorAddress: VERIFIED_IDENTITIES.investor.evmAddress, treasuryAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
    mpc: Object.freeze({ rootPublicKey: VERIFIED_MPC_ROOT, domainId: 0 as const, path: "wealthpixels/sepolia/v1" as const }),
    allocationBps, prices: Object.freeze({ ETH: eth, LINK: link }), quantities,
    rounding: Object.freeze({ ethRemainder: ethNumerator % ethDenominator, ethDenominator,
      linkRemainder: linkNumerator % linkDenominator, linkDenominator }),
  };
  return Object.freeze({ ...base, termsHash: hash(base) });
}

export function assertPurchaseTerms(value: PurchaseTerms, expectedHash?: string): void {
  if (!value || typeof value !== "object") throw new Error("Purchase terms are required.");
  const rebuilt = createPurchaseTerms({ investmentUsdcBaseUnits: value.investmentUsdcBaseUnits,
    ethPrice: value.prices?.ETH, linkPrice: value.prices?.LINK, allocationBps: value.allocationBps });
  if (!isDeepStrictEqual(value, rebuilt) ||
    (expectedHash !== undefined && expectedHash !== rebuilt.termsHash)) throw new Error("Purchase terms or approved terms hash mismatch.");
}
