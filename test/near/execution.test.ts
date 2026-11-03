import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface, keccak256, toQuantity } from "ethers";
import { authorizeEvmBroadcast } from "../../src/evm/broadcast.js";
import { buildUnsignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { decodeState, encodeState, publicExecutionSummary, readState, saveState, withStateLock, type ExecutionState } from "../../src/execution/state.js";
import { broadcastTransfer, reconcileEvm, reconcileSigning, requestSignature, type ExecutionPorts } from "../../src/execution/workflow.js";
import { VERIFIED_IDENTITIES, requireRole } from "../../src/near/identities.js";
import { SEPOLIA_LINK } from "../../src/evidence/verify.js";

/** Fixed synthetic public observations; never live execution or private key material. */
function state(): ExecutionState {
  const prepared = buildUnsignedErc20Transfer({
    chainId: 11155111n, senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
    recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress, tokenAddress: SEPOLIA_LINK,
    amount: 10n ** 18n, nonce: 0, gasLimit: 72_000n, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  });
  return { schemaVersion: 1, role: "treasury", status: "prepared", createdAt: new Date().toISOString(), preflight: {
    role: "treasury", policy: { gasLimitCap: 120_000n, maxFeePerGasCap: 30_000_000_000n, maxTotalFeeWei: 3_600_000_000_000_000n },
    prepared, blockNumber: 100n, blockHash: "0x" + "11".repeat(32),
    balances: { treasuryLink: 2n * 10n ** 18n, investorLink: 0n, treasuryEth: 10n ** 17n, investorEth: 10n ** 17n },
    snapshot: { chainId: 11155111n, senderAddress: prepared.senderAddress, tokenAddress: SEPOLIA_LINK, tokenCode: "0x6000", pendingNonce: 0, estimatedGas: 60_000n, tokenBalance: 2n * 10n ** 18n, nativeBalance: 10n ** 17n, baseFeePerGas: 1_000_000_000n },
  } };
}
function deniedPorts(): ExecutionPorts {
  const deny = async (): Promise<never> => { throw new Error("Unexpected side effect."); };
  return { evm: { request: deny }, verifyMpc: deny, prepareSigning: deny, readOutcome: deny, broadcast: { sendRawTransaction: deny }, save: deny };
}
function mockedReadPorts(value: ExecutionState): ExecutionPorts {
  const ports = deniedPorts(), abi = new Interface(["function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)", "function transfer(address,uint256) returns(bool)"]);
  ports.evm = { async request(method, params) {
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: value.preflight.blockHash, baseFeePerGas: "0x3b9aca00" };
    if (method === "eth_getCode") return params[0] === SEPOLIA_LINK ? "0x6000" : "0x";
    if (method === "eth_getBalance") return toQuantity(10n ** 17n);
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_estimateGas") return "0xea60";
    if (method === "eth_call") {
      const decoded = abi.parseTransaction({ data: (params[0] as { data: string }).data })!;
      if (decoded.name === "decimals") return abi.encodeFunctionResult("decimals", [18]);
      if (decoded.name === "transfer") return abi.encodeFunctionResult("transfer", [true]);
      return abi.encodeFunctionResult("balanceOf", [decoded.args[0] === VERIFIED_IDENTITIES.treasury.evmAddress ? 2n * 10n ** 18n : 0n]);
    }
    throw new Error("Unexpected mocked read method.");
  } };
  return ports;
}

test("requires an explicit valid role and rejects role confusion in saved state", async () => {
  for (const role of [undefined, "", "owner", "Treasury"]) assert.throws(() => requireRole(role));
  assert.equal(requireRole("investor"), "investor");
  const value = state();
  assert.equal(decodeState(encodeState(value)).preflight.prepared.amount, 10n ** 18n);
  assert.throws(() => decodeState(encodeState({ ...value, role: "investor" })), /role mismatch/);
});

test("state validation rejects changed token, amount, nonce metadata and malformed integer markers", () => {
  for (const override of [{ tokenAddress: VERIFIED_IDENTITIES.investor.evmAddress }, { amount: 1n }, { nonce: 3 }]) {
    const value = state();
    const altered = { ...value, preflight: { ...value.preflight, prepared: { ...value.preflight.prepared, ...override } } };
    assert.throws(() => decodeState(encodeState(altered)));
  }
  assert.throws(() => decodeState('{"x":{"$bigint":"1e18"}}'));
});

test("separate approvals stop before any injected provider or credential operation", async () => {
  const value = state(), ports = deniedPorts();
  await assert.rejects(requestSignature(value, { credentialPath: "not-opened", nearRpcUrl: "not-called", approval: "wrong" }, ports), /signing approval/);
  await assert.rejects(broadcastTransfer(value, { nearRpcUrl: "not-called", approval: "wrong" }, ports), /verified MPC/);
});

test("interrupted NEAR operations cannot issue another signing request", async () => {
  for (const status of ["near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed"] as const) {
    const value = { ...state(), status, nearTransactionHash: "1".repeat(44) };
    await assert.rejects(requestSignature(value, { credentialPath: "not-opened", nearRpcUrl: "not-called", approval: value.preflight.prepared.unsignedHash }, deniedPorts()), /already attempted/);
  }
});

test("unavailable or unfinished NEAR execution remains recoverable without a new signing request", async () => {
  for (const unavailable of [true, false]) {
    const value = state(), ports = deniedPorts(); value.status = "near-uncertain"; value.nearTransactionHash = "1".repeat(32);
    ports.verifyMpc = async () => ({ accessKeyNonce: "7" } as Awaited<ReturnType<ExecutionPorts["verifyMpc"]>>);
    ports.readOutcome = async () => { if (unavailable) throw new Error("fixture timeout"); return { final_execution_status: "EXECUTED" }; };
    ports.save = async () => {};
    await reconcileSigning(value, "mock-read-only", ports);
    assert.equal(value.status, "near-uncertain"); assert.match(value.recovery!, /nonce: 7/);
    assert.equal(value.signed, undefined);
  }
});

test("stale preparation never opens credentials or asks for a signature", async () => {
  const value = state(); value.createdAt = "2020-01-01T00:00:00Z";
  await assert.rejects(requestSignature(value, { credentialPath: "not-opened", nearRpcUrl: "not-called", approval: value.preflight.prepared.unsignedHash }, deniedPorts()), /expired/);
});

test("NEAR hash is saved before the only submission; timeout consumes the operation", async () => {
  const value = state(), ports = mockedReadPorts(value), events: string[] = [];
  ports.prepareSigning = async () => ({
    transactionHash: "1".repeat(32), signerAccountId: VERIFIED_IDENTITIES.treasury.accountId, receiverId: "v1.signer-prod.testnet",
    request: { payload_v2: { Ecdsa: value.preflight.prepared.unsignedHash.slice(2) }, path: "wealthpixels/sepolia/v1", domain_id: 0 },
    gasTgas: 100, depositYocto: "1", async broadcastOnce() { events.push("submit"); throw new Error("fixture timeout"); },
  });
  ports.save = async saved => { assert.equal(saved.nearTransactionHash, "1".repeat(32)); events.push(saved.status); };
  const input = { credentialPath: "mock-selected-role-only", nearRpcUrl: "mock-not-used", approval: value.preflight.prepared.unsignedHash };
  await requestSignature(value, input, ports);
  assert.deepEqual(events, ["near-submitting", "submit", "near-uncertain"]);
  await assert.rejects(requestSignature(value, input, ports), /already attempted/);
  assert.equal(events.filter(event => event === "submit").length, 1);
});

test("a durable-save failure prevents any NEAR submission", async () => {
  const value = state(), ports = mockedReadPorts(value); let sends = 0;
  ports.prepareSigning = async () => ({
    transactionHash: "1".repeat(32), signerAccountId: VERIFIED_IDENTITIES.treasury.accountId, receiverId: "v1.signer-prod.testnet",
    request: { payload_v2: { Ecdsa: value.preflight.prepared.unsignedHash.slice(2) }, path: "wealthpixels/sepolia/v1", domain_id: 0 },
    gasTgas: 100, depositYocto: "1", async broadcastOnce() { sends++; },
  });
  ports.save = async () => { throw new Error("fixture disk full"); };
  await assert.rejects(requestSignature(value, { credentialPath: "mock-selected-role-only", nearRpcUrl: "not-used", approval: value.preflight.prepared.unsignedHash }, ports), /disk full/);
  assert.equal(sends, 0);
});

test("inspection contains complete intent and fees without signed payloads or signature fields", () => {
  const value = state(); value.signed = { hash: "public-hash", serialized: "executable-bytes", senderAddress: value.preflight.prepared.senderAddress };
  value.nearOutcome = { signature: "signature-material" };
  const output = encodeState(publicExecutionSummary(value));
  for (const excluded of ["executable-bytes", "signature-material", "unsignedSerialized"]) assert.ok(!output.includes(excluded));
  assert.ok(output.includes("maximumFeeWei") && output.includes("recipientAddress") && output.includes("public-hash"));
});

test("broadcast transport submits at most once, including after timeout or wrong returned hash", async () => {
  const bytes = "0x02c0", hash = keccak256(bytes); // Synthetic bytes test transport only; not an executable transaction.
  let calls = 0;
  const send = authorizeEvmBroadcast(bytes, hash, hash, { async sendRawTransaction() { calls++; return hash; } });
  assert.equal(await send(), hash);
  await assert.rejects(send(), /already attempted/); assert.equal(calls, 1);
  const uncertain = authorizeEvmBroadcast(bytes, hash, hash, { async sendRawTransaction() { calls++; throw new Error("timeout"); } });
  await assert.rejects(uncertain()); await assert.rejects(uncertain(), /already attempted/); assert.equal(calls, 2);
  const mismatch = authorizeEvmBroadcast(bytes, hash, hash, { async sendRawTransaction() { return "0x" + "00".repeat(32); } });
  await assert.rejects(mismatch(), /different hash/); await assert.rejects(mismatch(), /already attempted/);
  assert.throws(() => authorizeEvmBroadcast(bytes, hash, "wrong", { sendRawTransaction: async () => hash }), /approval/);
});

test("uncertain EVM recovery reads hash and both nonces without signing or broadcasting", async () => {
  const value = state(); value.status = "evm-uncertain";
  value.signed = { hash: "0x" + "12".repeat(32), serialized: "0x02c0", senderAddress: value.preflight.prepared.senderAddress };
  const calls: string[] = [], ports = deniedPorts();
  ports.evm = { async request(method) { calls.push(method); return method === "eth_chainId" ? "0xaa36a7" : method === "eth_getTransactionCount" ? "0x1" : null; } };
  ports.save = async () => { calls.push("save"); };
  await reconcileEvm(value, ports);
  assert.equal(calls.filter(method => method === "eth_getTransactionCount").length, 2);
  assert.match(value.recovery!, /no automatic retry/);
  assert.equal(value.status, "evm-uncertain");
});

test("atomic state saves preserve bigint fields and concurrent execution is refused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wealthpixels-offline-"));
  const file = join(directory, "fixture.json");
  try {
    await saveState(file, state());
    assert.equal((await readState(file, "treasury")).preflight.prepared.amount, 10n ** 18n);
    await assert.rejects(readState(file, "investor"), /Selected role/);
    await withStateLock(file, async () => { await assert.rejects(withStateLock(file, async () => {}), /locked/); });
    await withStateLock(file, async () => {});
    assert.ok((await readFile(file, "utf8")).includes("$bigint"));
  } finally { await rm(directory, { recursive: true }); }
});
