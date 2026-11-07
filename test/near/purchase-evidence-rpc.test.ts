import assert from "node:assert/strict";
import test from "node:test";
import { createPurchaseEvidenceTransport, publicRpcEndpoint, PurchaseEvidenceRpcError } from "../../src/evidence/purchase-rpc.js";

const id = "wealthpixels-purchase-evidence";
function ok(result: unknown) { return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 }); }
async function fetchFixture(action: (calls: { url: string; method: string; at: number }[]) => Promise<void>, response?: (method: string) => Response | Promise<Response>) {
  const previous = globalThis.fetch, calls: { url: string; method: string; at: number }[] = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)); calls.push({ url: String(input), method: body.method, at: Date.now() });
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    return response ? response(body.method) : ok("fixture-response");
  };
  try { await action(calls); } finally { globalThis.fetch = previous; }
}
const code = (expected: string) => (error: unknown) => error instanceof PurchaseEvidenceRpcError && error.code === expected;

test("purchase public RPC transport is inert and rejects every mutation method before fetching", async () => fetchFixture(async calls => {
  const rpc = createPurchaseEvidenceTransport({ pacingMs: 0 }); assert.equal(calls.length, 0);
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "eth_sign", "eth_estimateGas"])
    await assert.rejects(rpc.request("evm", method, []), code("INVALID_RPC"));
  for (const method of ["broadcast_tx_commit", "broadcast_tx_async", "send_tx", "sign"])
    await assert.rejects(rpc.request("near", method, []), code("INVALID_RPC"));
  assert.equal(calls.length, 0);
}));

test("public endpoint validation rejects insecure URL login credentials and fragments", () => {
  for (const value of ["http://example.invalid", "https://user:password@example.invalid", "https://example.invalid/#fragment", "file:///tmp/data", "not a URL"])
    assert.throws(() => publicRpcEndpoint(value), code("INVALID_RPC"));
  assert.equal(publicRpcEndpoint("https://example.invalid/provider-path?api_key=TEST_ONLY_PLACEHOLDER"),
    "https://example.invalid/provider-path?api_key=TEST_ONLY_PLACEHOLDER");
  for (const pacingMs of [-1, 0.5, 2001, Number.NaN]) assert.throws(() => createPurchaseEvidenceTransport({ pacingMs }), code("INVALID_RPC"));
});

test("read-only RPC queues pace requests per network and preserve caller results", async () => fetchFixture(async calls => {
  const rpc = createPurchaseEvidenceTransport({ pacingMs: 25 });
  const result = await Promise.all([rpc.request("evm", "eth_chainId", []), rpc.request("evm", "eth_blockNumber", [])]);
  assert.deepEqual(result, ["fixture-response", "fixture-response"]); assert.equal(calls.length, 2);
  assert.ok(calls[1]!.at - calls[0]!.at >= 20, "Per-network starts must retain the configured read pacing.");
}));

test("an unavailable read is never retried and already queued reads fail without more HTTP requests", async () => fetchFixture(async calls => {
  const rpc = createPurchaseEvidenceTransport({ pacingMs: 0 });
  const requests = await Promise.allSettled([rpc.request("evm", "eth_chainId", []), rpc.request("evm", "eth_blockNumber", []), rpc.request("evm", "eth_getBalance", [])]);
  assert.ok(requests.every(r => r.status === "rejected")); assert.equal(calls.length, 1);
  for (const result of requests) if (result.status === "rejected") assert.equal(result.reason.code, "RPC_UNAVAILABLE");
}, () => new Response("rate limited", { status: 429 })));

test("documented NEAR method-name fallback remains possible after METHOD_NOT_FOUND", async () => fetchFixture(async calls => {
  const rpc = createPurchaseEvidenceTransport({ pacingMs: 0 });
  await assert.rejects(rpc.request("near", "tx_status", {}), code("METHOD_NOT_FOUND"));
  assert.deepEqual(await rpc.request("near", "EXPERIMENTAL_tx_status", {}), { final_execution_status: "FINAL" });
  assert.deepEqual(calls.map(item => item.method), ["tx_status", "EXPERIMENTAL_tx_status"]);
}, method => method === "tx_status" ? new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "fixture unsupported method" } })) : ok({ final_execution_status: "FINAL" })));

test("provider error details and endpoint keys never appear in public RPC failures", async () => {
  const previous = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("TEST_ONLY_PLACEHOLDER provider-sensitive-message"); };
  try {
    const rpc = createPurchaseEvidenceTransport({ evmRpcUrl: "https://example.invalid/TEST_ONLY_PLACEHOLDER", pacingMs: 0 });
    await assert.rejects(rpc.request("evm", "eth_chainId", []), error => error instanceof PurchaseEvidenceRpcError &&
      error.code === "RPC_UNAVAILABLE" && !/PLACEHOLDER|sensitive-message|example.invalid/.test(error.message));
    assert.equal(requests, 1);
  } finally { globalThis.fetch = previous; }
});

test("malformed, mismatched and oversized JSON-RPC envelopes fail closed without retries", async () => {
  for (const response of [new Response("not-json"), new Response(JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: "0x1" })),
    new Response(JSON.stringify({ jsonrpc: "2.0", id })), new Response(" ".repeat(4_000_001))]) {
    await fetchFixture(async calls => {
      const rpc = createPurchaseEvidenceTransport({ pacingMs: 0 });
      await assert.rejects(rpc.request("evm", "eth_chainId", []), code("RPC_UNAVAILABLE")); assert.equal(calls.length, 1);
    }, () => response);
  }
});

test("bounded request and elapsed-time budgets stop public verification without more HTTP calls", async () => fetchFixture(async calls => {
  const rpc = createPurchaseEvidenceTransport({ pacingMs: 0 });
  for (let index = 0; index < 32; index++) await rpc.request("near", "status", []);
  await assert.rejects(rpc.request("near", "status", []), code("REQUEST_BUDGET")); assert.equal(calls.length, 32);
  const originalNow = Date.now; let now = 1_000_000; Date.now = () => now;
  try {
    const expired = createPurchaseEvidenceTransport({ pacingMs: 0 }); now += 300_001;
    await assert.rejects(expired.request("evm", "eth_chainId", []), code("REQUEST_BUDGET")); assert.equal(calls.length, 32);
  } finally { Date.now = originalNow; }
}));
