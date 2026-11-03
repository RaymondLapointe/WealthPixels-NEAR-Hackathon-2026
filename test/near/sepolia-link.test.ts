import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { SEPOLIA_LINK } from "../../src/evidence/verify.js";
import { buildUnsignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import {
  LINK_TRANSFER_AMOUNTS, SEPOLIA_READ_METHODS, SepoliaLinkError,
  assertIsolatedLinkTransferLogs, assertLinkPreflight, assertLinkTokenDeltas,
  createSepoliaReadRpc, prepareSepoliaLinkTransfer, recheckSepoliaLinkTransfer,
  verifySepoliaLinkReceipt, type LinkFeePolicy, type SepoliaReadMethod, type SepoliaReadRpc,
} from "../../src/evm/sepolia-link.js";

const abi = new Interface([
  "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)", "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const POLICY: LinkFeePolicy = { gasLimitCap: 100_000n, maxFeePerGasCap: 10_000_000_000n, maxTotalFeeWei: 1_000_000_000_000_000n };
const BLOCK_HASH = "0x" + "aa".repeat(32), TX_HASH = "0x" + "11".repeat(32);
const q = (value: bigint) => `0x${value.toString(16)}`;
interface Options {
  chain?: bigint; block?: bigint; code?: string; roleCode?: string; decimals?: bigint;
  treasuryLink?: bigint; investorLink?: bigint; nativeBalance?: bigint;
  pending?: bigint; confirmed?: bigint; baseFee?: bigint; priority?: bigint; gas?: bigint;
  transferResult?: boolean; reorg?: boolean; raw?: unknown; receipt?: unknown;
}
function fakeRpc(options: Options = {}) {
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  const rpc: SepoliaReadRpc = { async request(method, params) {
    calls.push({ method, params });
    if (method === "eth_chainId") return q(options.chain ?? 11155111n);
    if (method === "eth_getBlockByNumber") return {
      number: q(options.block ?? 100n), hash: options.reorg && params[0] !== "latest" ? "0x" + "bb".repeat(32) : BLOCK_HASH,
      baseFeePerGas: q(options.baseFee ?? 1_000_000_000n),
    };
    if (method === "eth_getCode") return params[0] === SEPOLIA_LINK ? options.code ?? "0x60006000" : options.roleCode ?? "0x";
    if (method === "eth_getBalance") return q(options.nativeBalance ?? 1_000_000_000_000_000_000n);
    if (method === "eth_getTransactionCount") return q(params[1] === "pending" ? options.pending ?? 7n : options.confirmed ?? 7n);
    if (method === "eth_estimateGas") return q(options.gas ?? 50_000n);
    if (method === "eth_maxPriorityFeePerGas") return q(options.priority ?? 1_000_000_000n);
    if (method === "eth_getTransactionByHash") return options.raw ?? null;
    if (method === "eth_getTransactionReceipt") return options.receipt ?? null;
    if (method === "eth_blockNumber") return "0x65";
    if (method === "eth_call") {
      const call = params[0] as { data: string };
      if (call.data.startsWith(abi.getFunction("decimals")!.selector)) return abi.encodeFunctionResult("decimals", [options.decimals ?? 18n]);
      if (call.data.startsWith(abi.getFunction("transfer")!.selector)) return abi.encodeFunctionResult("transfer", [options.transferResult ?? true]);
      const owner = abi.decodeFunctionData("balanceOf", call.data)[0];
      const amount = owner === VERIFIED_IDENTITIES.treasury.evmAddress ? options.treasuryLink ?? 10_000_000_000_000_000_000n : options.investorLink ?? 2_000_000_000_000_000_000n;
      return abi.encodeFunctionResult("balanceOf", [amount]);
    }
    throw new Error(`Unexpected offline fixture method ${method}`);
  } };
  return { rpc, calls };
}
const errorCode = (code: string) => (error: unknown) => error instanceof SepoliaLinkError && error.code === code;
function transferLog(role: "treasury" | "investor", overrides: Record<string, unknown> = {}) {
  const sender = VERIFIED_IDENTITIES[role].evmAddress, recipient = VERIFIED_IDENTITIES[role === "treasury" ? "investor" : "treasury"].evmAddress;
  return {
    ...abi.encodeEventLog(abi.getEvent("Transfer")!, [sender, recipient, LINK_TRANSFER_AMOUNTS[role]]),
    address: SEPOLIA_LINK, removed: false, transactionHash: TX_HASH, blockHash: BLOCK_HASH, logIndex: "0x0", ...overrides,
  };
}

test("prepares fixed one-LINK delivery and 0.1-LINK return using pinned read-only observations", async () => {
  for (const role of ["treasury", "investor"] as const) {
    const fixture = fakeRpc(), preflight = await prepareSepoliaLinkTransfer(role, POLICY, fixture.rpc);
    assert.equal(preflight.prepared.amount, LINK_TRANSFER_AMOUNTS[role]);
    assert.equal(preflight.prepared.senderAddress, VERIFIED_IDENTITIES[role].evmAddress);
    assert.equal(preflight.prepared.tokenAddress, SEPOLIA_LINK);
    assert.equal(preflight.prepared.gasLimit, 60_000n);
    assert.equal(preflight.prepared.maxFeePerGas, 3_000_000_000n);
    assert.equal(preflight.prepared.maximumFeeWei, 180_000_000_000_000n);
    assert.equal(preflight.blockNumber, 100n);
    assertLinkPreflight(preflight, POLICY);
    const stateReads = fixture.calls.filter((call) => ["eth_call", "eth_getCode", "eth_getBalance"].includes(call.method));
    assert.ok(stateReads.length > 0 && stateReads.every((call) => call.params[1] === "0x64"));
    assert.ok(fixture.calls.every((call) => (SEPOLIA_READ_METHODS as readonly string[]).includes(call.method)));
    assert.ok(Object.isFrozen(preflight));
  }
});

test("rejects wrong chain, missing token code, non-EOA roles, decimals and failed simulation", async () => {
  const cases: Array<[Options, RegExp]> = [
    [{ chain: 1n }, /Sepolia/], [{ code: "0x" }, /bytecode/], [{ roleCode: "0x6000" }, /EOAs/],
    [{ decimals: 6n }, /18 decimals/], [{ transferResult: false }, /simulation/], [{ reorg: true }, /block changed/],
  ];
  for (const [options, message] of cases) await assert.rejects(prepareSepoliaLinkTransfer("treasury", POLICY, fakeRpc(options).rpc), message);
});

test("requires matching confirmed/pending nonce and sufficient inventory and gas funds", async () => {
  for (const [options, message] of [
    [{ pending: 8n }, /pending transactions/], [{ pending: 9007199254740992n, confirmed: 9007199254740992n }, /nonce/],
    [{ treasuryLink: LINK_TRANSFER_AMOUNTS.treasury - 1n }, /inventory/], [{ nativeBalance: 1n }, /maximum fee/],
  ] as Array<[Options, RegExp]>) await assert.rejects(prepareSepoliaLinkTransfer("treasury", POLICY, fakeRpc(options).rpc), message);
});

test("enforces explicit fee budgets and rounds the gas safety buffer upward", async () => {
  for (const limits of [
    { ...POLICY, gasLimitCap: 59_999n }, { ...POLICY, maxFeePerGasCap: 2_999_999_999n },
    { ...POLICY, maxTotalFeeWei: 179_999_999_999_999n },
  ]) await assert.rejects(prepareSepoliaLinkTransfer("treasury", limits, fakeRpc().rpc), /approved/);
  const preflight = await prepareSepoliaLinkTransfer("treasury", POLICY, fakeRpc({ gas: 50_001n }).rpc);
  assert.equal(preflight.prepared.gasLimit, 60_002n);
  const fixture = fakeRpc();
  await assert.rejects(prepareSepoliaLinkTransfer("treasury", { ...POLICY, gasLimitCap: 0n }, fixture.rpc), /gasLimitCap/);
  assert.equal(fixture.calls.length, 0);
});

test("fixed-intent integrity checks reject self-consistent amount, recipient, gas and policy substitutions", async () => {
  const preflight = await prepareSepoliaLinkTransfer("treasury", POLICY, fakeRpc().rpc);
  for (const changes of [
    { amount: 1n }, { recipientAddress: "0x1111111111111111111111111111111111111111" },
    { senderAddress: VERIFIED_IDENTITIES.investor.evmAddress, recipientAddress: VERIFIED_IDENTITIES.treasury.evmAddress },
  ]) {
    const changed = buildUnsignedErc20Transfer({ ...preflight.prepared, ...changes });
    assert.throws(() => assertLinkPreflight({ ...preflight, prepared: changed }), /fixed verified LINK/);
  }
  const overGas = buildUnsignedErc20Transfer({ ...preflight.prepared, gasLimit: POLICY.gasLimitCap + 1n });
  assert.throws(() => assertLinkPreflight({ ...preflight, prepared: overGas }), /gasLimitCap/);
  const alteredBuffer = buildUnsignedErc20Transfer({ ...preflight.prepared, gasLimit: preflight.prepared.gasLimit + 1n });
  assert.throws(() => assertLinkPreflight({ ...preflight, prepared: alteredBuffer }), /estimate buffer rule/);
  assert.throws(() => assertLinkPreflight({ ...preflight, policy: { ...POLICY, maxTotalFeeWei: POLICY.maxTotalFeeWei + 1n } }, POLICY), /freshly supplied approved limits/);
});

test("fresh recheck preserves the prepared digest and rejects nonce, fee, gas and inventory drift", async () => {
  const preflight = await prepareSepoliaLinkTransfer("treasury", POLICY, fakeRpc().rpc);
  const result = await recheckSepoliaLinkTransfer(preflight, fakeRpc().rpc);
  assert.equal(result.snapshot.pendingNonce, preflight.prepared.nonce);
  for (const [options, message] of [
    [{ pending: 8n, confirmed: 8n }, /pendingNonce/], [{ baseFee: 2_000_000_001n }, /base fee/],
    [{ gas: 60_001n }, /gas estimate/], [{ treasuryLink: 0n }, /inventory/],
  ] as Array<[Options, RegExp]>) await assert.rejects(recheckSepoliaLinkTransfer(preflight, fakeRpc(options).rpc), message);
});

test("exact token deltas accept fixed delivery/return and reject concurrent balance changes", () => {
  const before = { treasuryLink: 10_000_000_000_000_000_000n, investorLink: 2_000_000_000_000_000_000n };
  for (const role of ["treasury", "investor"] as const) {
    const delta = LINK_TRANSFER_AMOUNTS[role] * (role === "treasury" ? -1n : 1n);
    const after = { treasuryLink: before.treasuryLink + delta, investorLink: before.investorLink - delta };
    assert.deepEqual(assertLinkTokenDeltas(role, before, after), { treasury: delta, investor: -delta });
    assert.throws(() => assertLinkTokenDeltas(role, before, { ...after, investorLink: after.investorLink + 1n }), /balance deltas/);
  }
});

test("role-filter logs deduplicate the same event and reject extra, removed or altered movements", () => {
  const log = transferLog("treasury");
  assert.equal(assertIsolatedLinkTransferLogs("treasury", [log, log], TX_HASH, BLOCK_HASH), `${TX_HASH}:0`);
  for (const logs of [
    [], [log, transferLog("investor", { logIndex: "0x1" })], [transferLog("treasury", { removed: true })],
    [transferLog("treasury", { transactionHash: "0x" + "22".repeat(32) })],
    [log, transferLog("investor")],
  ]) assert.throws(() => assertIsolatedLinkTransferLogs("treasury", logs, TX_HASH, BLOCK_HASH), /LINK|RPC/);
});

test("receipt verification never resends a missing transaction and rejects mined intent/signature mismatches", async () => {
  const preflight = await prepareSepoliaLinkTransfer("treasury", POLICY, fakeRpc().rpc);
  await assert.rejects(verifySepoliaLinkReceipt(preflight, TX_HASH, fakeRpc().rpc), errorCode("NOT_MINED"));
  const raw = {
    type: "0x2", chainId: "0xaa36a7", hash: TX_HASH, from: preflight.prepared.senderAddress, to: SEPOLIA_LINK,
    value: "0x0", input: preflight.prepared.data, nonce: "0x7", gas: q(preflight.prepared.gasLimit),
    maxFeePerGas: q(preflight.prepared.maxFeePerGas), maxPriorityFeePerGas: q(preflight.prepared.maxPriorityFeePerGas), accessList: [],
    r: "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", s: "0x1", v: "0x0",
  };
  for (const changed of [{ ...raw, nonce: "0x8" }, { ...raw, input: "0x" }, raw]) {
    // The reused public R/s fixture cannot impersonate either fixed verified role.
    await assert.rejects(verifySepoliaLinkReceipt(preflight, TX_HASH, fakeRpc({ raw: changed, receipt: {} }).rpc), /Mined transaction|Mined signature/);
  }
});

test("fetch adapter exposes only read methods, has no retries and sanitizes endpoint errors", async () => {
  const rpc = createSepoliaReadRpc();
  assert.deepEqual(Object.keys(rpc), ["request"]);
  await assert.rejects(rpc.request("eth_sendRawTransaction" as SepoliaReadMethod, []), /allowlist/);
  assert.throws(() => createSepoliaReadRpc("https://user:secret@example.com"), /public HTTPS/);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).method, "eth_chainId");
    throw new Error("Never print https://example.com/private-credential");
  };
  try {
    await assert.rejects(rpc.request("eth_chainId", []), (error: unknown) => errorCode("RPC_FAILED")(error) && !(error as Error).message.includes("private-credential"));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
