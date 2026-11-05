import { USDC_DECIMALS } from "./config.js";

export const MAX_UINT256 = (1n << 256n) - 1n;
export function requireUint256(value: unknown, label: string, positive = false): bigint {
  if (typeof value !== "bigint" || value < (positive ? 1n : 0n) || value > MAX_UINT256) {
    throw new Error(`${label} must be a bounded ${positive ? "positive" : "nonnegative"} uint256 bigint.`);
  }
  return value;
}

/** Exact six-decimal text only; the smallest representable positive USDC unit is accepted. */
export function parseUsdcAmount(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 85 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)) {
    throw new Error("USDC amount must be plain decimal text with at most six decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  return requireUint256(BigInt(whole!) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0")), "USDC amount", true);
}

export function formatUsdcAmount(value: bigint): string {
  const amount = requireUint256(value, "USDC amount");
  const digits = amount.toString().padStart(USDC_DECIMALS + 1, "0");
  return `${digits.slice(0, -USDC_DECIMALS)}.${digits.slice(-USDC_DECIMALS)}`;
}
