import { requireUint256 } from "./amounts.js";

export interface PaymentClaim { readonly chainId: bigint; readonly transactionHash: string; readonly logIndex: bigint }
export function paymentClaimId(claim: PaymentClaim): string {
  if (!claim || claim.chainId !== 11155111n || typeof claim.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(claim.transactionHash)) {
    throw new Error("Payment claim requires a Sepolia transaction hash.");
  }
  return `11155111:${claim.transactionHash.toLowerCase()}:${requireUint256(claim.logIndex, "Payment log index")}`;
}

/** Pure identity check only. Task 03D must atomically persist the claim with the paid-state transition. */
export function addPaymentClaim(existing: readonly string[], claim: PaymentClaim): readonly string[] {
  if (!Array.isArray(existing) || new Set(existing).size !== existing.length || existing.some(id => typeof id !== "string" ||
    !/^11155111:0x[0-9a-f]{64}:(?:0|[1-9][0-9]{0,77})$/.test(id) || BigInt(id.split(":")[2]!) > (1n << 256n) - 1n)) throw new Error("Invalid payment claim registry.");
  const id = paymentClaimId(claim);
  if (existing.includes(id)) throw new Error("Duplicate payment claim: a payment cannot fund another purchase.");
  return Object.freeze([...existing, id]);
}
