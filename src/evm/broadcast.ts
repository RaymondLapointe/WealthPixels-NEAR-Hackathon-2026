import { keccak256 } from "ethers";

/** A mutation transport deliberately separate from the read-only RPC interface. */
export interface EvmBroadcastTransport {
  sendRawTransaction(serialized: string): Promise<unknown>;
}

export function createEvmBroadcastTransport(url: string): EvmBroadcastTransport {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.hostname.includes("mainnet")) {
    throw new Error("Use a Sepolia HTTPS RPC without embedded credentials.");
  }
  return {
    async sendRawTransaction(serialized) {
      try {
        const response = await fetch(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [serialized] }),
          signal: AbortSignal.timeout(20_000), redirect: "error",
        });
        const body = await response.json() as { result?: unknown; error?: unknown };
        if (!response.ok || body.error || typeof body.result !== "string") throw new Error();
        return body.result;
      } catch {
        throw new Error("EVM submission is uncertain. Reconcile the saved transaction hash and nonce; do not resubmit automatically.");
      }
    },
  };
}

/** A single-use submission capability; failure consumes it as well as success. */
export function authorizeEvmBroadcast(
  serialized: string, expectedHash: string, approval: string, transport: EvmBroadcastTransport,
): () => Promise<string> {
  if (keccak256(serialized) !== expectedHash || approval !== expectedHash) {
    throw new Error("Explicit broadcast approval must match the verified signed transaction hash.");
  }
  let attempted = false;
  return async () => {
    if (attempted) throw new Error("Broadcast was already attempted; reconcile before any further action.");
    attempted = true;
    const result = await transport.sendRawTransaction(serialized);
    if (typeof result !== "string" || result.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error("RPC returned a different hash; reconcile the saved expected hash.");
    }
    return expectedHash;
  };
}
