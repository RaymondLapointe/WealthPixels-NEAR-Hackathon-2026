import { createHash } from "node:crypto";

export function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function utc(value: unknown, label = "Timestamp"): number {
  check(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), `${label} must be UTC ISO.`);
  const time = Date.parse(value);
  check(Number.isFinite(time) && new Date(time).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z")), `${label} is invalid.`);
  return time;
}
export function label(value: unknown, name: string, max = 512): string {
  check(typeof value === "string" && value.trim().length > 0 && value.length <= max, `${name} is required and must be bounded.`);
  return value;
}
export function purchaseId(value: unknown): string {
  check(typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value), "Purchase ID is invalid."); return value;
}
export function publicSource(value: unknown): string {
  const text = label(value, "Public source URL", 2048);
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error("Public HTTPS source URL is required."); }
  check(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash &&
    ![...parsed.searchParams.keys()].some(key => /key|secret|token|password/i.test(key)), "Source URL must be public HTTPS without credentials.");
  return text;
}
export function hexHash(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value), "Exact lowercase 32-byte hash is required."); return value;
}
/** Typed bigint encoding avoids collisions with strings and sorts keys without locale dependencies. */
export function fingerprint(kind: string, value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (typeof item === "bigint") return { $bigint: item.toString() };
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, field]) => [key, canonical(field)]));
    check(item !== undefined && typeof item !== "function" && typeof item !== "symbol", "Unsupported integrity field.");
    return item;
  };
  return `0x${createHash("sha256").update(kind + "\n" + JSON.stringify(canonical(value))).digest("hex")}`;
}
export function frozen<T>(value: T): T {
  const result = structuredClone(value);
  const freeze = (item: unknown): void => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(result); return result;
}
