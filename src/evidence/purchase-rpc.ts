/** Public evidence reads only. No signing, account, transaction preparation or send capability exists. */
export type PurchaseRpcChain = "near" | "evm";
export interface PurchaseEvidenceTransport {
  request(chain: PurchaseRpcChain, method: string, params: unknown): Promise<unknown>;
}
export class PurchaseEvidenceRpcError extends Error {
  constructor(readonly code: "RPC_UNAVAILABLE" | "METHOD_NOT_FOUND" | "REQUEST_BUDGET" | "INVALID_RPC", message: string) {
    super(message); this.name = "PurchaseEvidenceRpcError";
  }
}
const methods = {
  near: new Set(["status", "tx_status", "EXPERIMENTAL_tx_status", "block", "gas_price"]),
  evm: new Set(["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_blockNumber",
    "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_call", "eth_getLogs", "eth_getTransactionCount"]),
};
export function publicRpcEndpoint(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    // Provider API paths/query parameters remain compatible. Endpoints are never exported or echoed on failure.
    return url.toString();
  } catch { throw new PurchaseEvidenceRpcError("INVALID_RPC", "Configure a compatible HTTPS public RPC endpoint without URL login credentials or fragments."); }
}
export function createPurchaseEvidenceTransport(options: {
  nearRpcUrl?: string; evmRpcUrl?: string; pacingMs?: number;
} = {}): PurchaseEvidenceTransport {
  const endpoints = { near: publicRpcEndpoint(options.nearRpcUrl ?? "https://archival-rpc.testnet.fastnear.com"),
    evm: publicRpcEndpoint(options.evmRpcUrl ?? "https://rpc.sepolia.ethpandaops.io") };
  const pacingMs = options.pacingMs ?? 125;
  if (!Number.isSafeInteger(pacingMs) || pacingMs < 0 || pacingMs > 2000)
    throw new PurchaseEvidenceRpcError("INVALID_RPC", "Read pacing must be an integer between 0 and 2000 milliseconds.");
  const queues: Record<PurchaseRpcChain, Promise<unknown>> = { near: Promise.resolve(), evm: Promise.resolve() };
  const stopped: Record<PurchaseRpcChain, unknown> = { near: null, evm: null };
  const counts = { near: 0, evm: 0 }, lastStart = { near: 0, evm: 0 }, started = Date.now();
  return Object.freeze({ request(chain: PurchaseRpcChain, method: string, params: unknown) {
    if (!methods[chain]?.has(method)) return Promise.reject(new PurchaseEvidenceRpcError("INVALID_RPC", "Operation is outside the purchase evidence read-only allowlist."));
    const run = queues[chain].then(async () => {
      if (stopped[chain]) throw stopped[chain];
      if (++counts[chain] > (chain === "near" ? 32 : 256) || Date.now() - started > 300_000)
        throw new PurchaseEvidenceRpcError("REQUEST_BUDGET", "Bounded public verification request budget expired; verification remains incomplete.");
      const delay = lastStart[chain] + pacingMs - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastStart[chain] = Date.now();
      try {
        const response = await fetch(endpoints[chain], { method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
          signal: AbortSignal.timeout(15_000), body: JSON.stringify({ jsonrpc: "2.0", id: "wealthpixels-purchase-evidence", method, params }) });
        if (!response.ok) throw new Error();
        const text = await response.text(); if (Buffer.byteLength(text) > 4_000_000) throw new Error();
        const value = JSON.parse(text);
        if (!value || value.jsonrpc !== "2.0" || value.id !== "wealthpixels-purchase-evidence") throw new Error();
        if (value.error?.code === -32601) throw new PurchaseEvidenceRpcError("METHOD_NOT_FOUND", "The configured public RPC does not support this read method.");
        if (value.error || !("result" in value)) throw new Error();
        return value.result;
      } catch (error) {
        if (error instanceof PurchaseEvidenceRpcError) throw error;
        throw new PurchaseEvidenceRpcError("RPC_UNAVAILABLE", `Public ${chain} read unavailable (${method}); history, rate limits or provider availability must be checked. No retry was made.`);
      }
    });
    // Drain every already queued read after a failure without issuing more network requests.
    queues[chain] = run.then(() => undefined, error => {
      if (!(error instanceof PurchaseEvidenceRpcError) || error.code !== "METHOD_NOT_FOUND") stopped[chain] = error;
    });
    return run;
  } });
}
