import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Signature, Transaction, computeAddress, getBytes, recoverAddress } from "ethers";
import { KeyType, PublicKey } from "near-api-js";
import { buildUnsignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { deriveEvmPublicKey } from "../../src/near/mpc.js";
import {
  EvidenceVerificationError, SEPOLIA_LINK, createReadOnlyEvidenceTransport,
  normalizeEvmSignatureScalar, verifyEvidence, verifyTransferProof,
  type EvidenceTransport, type EvidenceTransfer, type TransferProofContext,
} from "../../src/evidence/verify.js";

const PATH = "wealthpixels/sepolia/v1";
const R = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const PUBLIC_GENERATOR = `0x04${R}483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8`;
const ROOT = new PublicKey({ keyType: KeyType.SECP256K1, data: getBytes(PUBLIC_GENERATOR).slice(1) }).toString();
const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const code = (expected: string) => (error: unknown) => error instanceof EvidenceVerificationError && error.code === expected;

// Offline public R/s fixture reused from Task02A. This reconstructs a signature
// and recovers a public address; it never creates keys, calls sign, or claims a
// network transaction exists. It is a one-leg validator fixture, not live proof.
function proof() {
  const signature = Signature.from({ r: `0x${R}`, s: "0x" + "1".padStart(64, "0"), v: 27 });
  const initial = buildUnsignedErc20Transfer({
    chainId: 11155111n, senderAddress: "0x3333333333333333333333333333333333333333",
    tokenAddress: SEPOLIA_LINK, recipientAddress: "0x2222222222222222222222222222222222222222",
    amount: 1_000_000_000_000_000_000n, nonce: 7, gasLimit: 65_000n,
    maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  });
  const sender = recoverAddress(initial.unsignedHash, signature);
  const tx = Transaction.from(initial.unsignedSerialized);
  tx.signature = signature;
  const transactionHash = tx.hash!;
  const blockHash = "0x" + "ab".repeat(32);
  const transfer: EvidenceTransfer = {
    direction: "treasury-to-investor", amountBaseUnits: initial.amount.toString(),
    nearTransactionHash: "1".repeat(44), evmTransactionHash: transactionHash,
  };
  const context: TransferProofContext = {
    senderAccountId: "fixture-treasury.testnet", senderAddress: sender,
    recipientAddress: initial.recipientAddress, derivationPath: PATH,
    tokenAddress: SEPOLIA_LINK, minimumConfirmations: 2,
  };
  const mpcResult = { scheme: "Secp256k1", big_r: { affine_point: `02${R}` }, s: { scalar: "1".padStart(64, "0") }, recovery_id: 0 };
  const request = { payload_v2: { Ecdsa: initial.unsignedHash.slice(2) }, path: PATH, domain_id: 0 };
  const nearTransaction = {
    final_execution_status: "FINAL",
    transaction: {
      hash: transfer.nearTransactionHash, signer_id: context.senderAccountId,
      receiver_id: "v1.signer-prod.testnet",
      actions: [{ FunctionCall: { method_name: "sign", args: base64({ request }) } }],
    },
    status: { SuccessValue: base64(mpcResult) },
  };
  const evmTransaction = {
    type: "0x2", chainId: "0xaa36a7", hash: transactionHash, from: sender, to: SEPOLIA_LINK,
    value: "0x0", input: initial.data, accessList: [], nonce: "0x7", gas: "0xfde8",
    maxFeePerGas: "0xb2d05e00", maxPriorityFeePerGas: "0x3b9aca00",
    r: signature.r, s: signature.s, v: "0x0", blockHash, blockNumber: "0x64",
  };
  const events = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const log = events.encodeEventLog(events.getEvent("Transfer")!, [sender, initial.recipientAddress, initial.amount]);
  const receipt = {
    transactionHash, blockHash, blockNumber: "0x64", from: sender, to: SEPOLIA_LINK, status: "0x1",
    logs: [{ ...log, address: SEPOLIA_LINK, removed: false, transactionHash, blockHash }],
  };
  return { transfer, context, observed: { nearTransaction, evmTransaction, receipt, headBlock: "0x65" }, request, mpcResult };
}
function completeManifest() {
  const role = (nearAccountId: string) => ({ nearAccountId, evmAddress: computeAddress(deriveEvmPublicKey(ROOT, nearAccountId, PATH)) });
  return {
    schemaVersion: 1, kind: "fixture", status: "complete", operatorModel: "single-operator-demo",
    near: { networkId: "testnet", contractId: "v1.signer-prod.testnet", domainId: 0, derivationPath: PATH, rootPublicKey: ROOT },
    evm: { chainId: 11155111, tokenAddress: SEPOLIA_LINK, decimals: 18, minimumConfirmations: 2 },
    roles: { treasury: role("fixture-treasury.testnet"), investor: role("fixture-investor.testnet") },
    transfers: [proof().transfer, { ...proof().transfer, direction: "investor-to-treasury", nearTransactionHash: "2".repeat(44), evmTransactionHash: "0x" + "cd".repeat(32) }],
  };
}
const noNetwork: EvidenceTransport = { async request() { throw new Error("Unexpected network/transport request"); } };

test("pending live manifest fails actionably before network or endpoint construction", async () => {
  await assert.rejects(verifyEvidence({ schemaVersion: 1, kind: "live", status: "pending", transfers: [] }, {
    transport: noNetwork, nearRpcUrl: "not-a-url", evmRpcUrl: "not-a-url",
  }), (error: unknown) => code("PENDING")(error) && (error as Error).message.includes("No RPC requests were made"));
});

test("live verification rejects fixture kind and malformed completed role/token metadata before RPC", async () => {
  await assert.rejects(verifyEvidence(completeManifest(), { transport: noNetwork }), code("INVALID_EVIDENCE"));
  const badRole = completeManifest(); badRole.roles.investor.evmAddress = badRole.roles.treasury.evmAddress;
  await assert.rejects(verifyEvidence(badRole, { transport: noNetwork, allowFixtures: true }), /derivation/);
  const badToken = completeManifest(); badToken.evm.tokenAddress = "0x1111111111111111111111111111111111111111";
  await assert.rejects(verifyEvidence(badToken, { transport: noNetwork, allowFixtures: true }), /Sepolia LINK/);
  const missing = completeManifest(); missing.transfers.pop();
  await assert.rejects(verifyEvidence(missing, { transport: noNetwork, allowFixtures: true }), /investor return/);
});

test("public one-leg fixture links FINAL NEAR payload and MPC response to an exact mined LINK transfer", () => {
  const fixture = proof();
  const verified = verifyTransferProof(fixture.transfer, fixture.context, fixture.observed);
  assert.equal(verified.confirmations, "2");
  assert.equal(verified.blockNumber, "100");
  assert.equal(verified.evmTransactionHash, fixture.transfer.evmTransactionHash);
});

test("normalizes minimal RPC signature quantities and padded scalars without weakening hash checks", () => {
  const fixture = proof();
  fixture.observed.evmTransaction.s = "0x1";
  assert.equal(verifyTransferProof(fixture.transfer, fixture.context, fixture.observed).confirmations, "2");
  // Pure scalar parsing covers leading-zero r encodings without manufacturing signatures.
  assert.equal(normalizeEvmSignatureScalar("0x0001"), "0x" + "1".padStart(64, "0"));
  assert.equal(normalizeEvmSignatureScalar(`0x${R}`), `0x${R}`);
  for (const scalar of ["0x0", "0x0000", "0x" + "1".repeat(65), "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"]) {
    assert.throws(() => normalizeEvmSignatureScalar(scalar), /scalar/);
  }
  fixture.observed.evmTransaction.hash = "0x1";
  assert.throws(() => verifyTransferProof(fixture.transfer, fixture.context, fixture.observed), /hash/);
});

test("rejects NEAR signer, receiver, finality, direct-action and payload substitutions", () => {
  for (const change of ["signer", "receiver", "finality", "action", "path", "domain", "digest", "legacy"]) {
    const fixture = proof(), near = fixture.observed.nearTransaction;
    if (change === "signer") near.transaction.signer_id = "other.testnet";
    if (change === "receiver") near.transaction.receiver_id = "other.testnet";
    if (change === "finality") near.final_execution_status = "INCLUDED_FINAL";
    if (change === "action") near.transaction.actions.push(near.transaction.actions[0]);
    if (change === "path") fixture.request.path = "other/path";
    if (change === "domain") fixture.request.domain_id = 1;
    if (change === "digest") fixture.request.payload_v2.Ecdsa = "00".repeat(32);
    const request = change === "legacy" ? { ...fixture.request, payload: [1], key_version: 0 } : fixture.request;
    near.transaction.actions[0].FunctionCall.args = base64({ request });
    assert.throws(() => verifyTransferProof(fixture.transfer, fixture.context, fixture.observed), /NEAR|MPC|direct/);
  }
});

test("uses only top-level final MPC return and rejects wrappers or different signatures", () => {
  for (const result of [{ Secp256k1: proof().mpcResult }, { ...proof().mpcResult, scheme: "Ed25519" }, { ...proof().mpcResult, s: { scalar: "2".padStart(64, "0") } }]) {
    const fixture = proof(); fixture.observed.nearTransaction.status.SuccessValue = base64(result);
    assert.throws(() => verifyTransferProof(fixture.transfer, fixture.context, fixture.observed), /MPC/);
  }
  const ambiguous = proof();
  Object.assign(ambiguous.observed.nearTransaction.status, { Failure: {} });
  assert.throws(() => verifyTransferProof(ambiguous.transfer, ambiguous.context, ambiguous.observed), /unambiguous SuccessValue/);
  const fixture = proof(); fixture.observed.nearTransaction.status.SuccessValue = "";
  assert.throws(() => verifyTransferProof(fixture.transfer, fixture.context, fixture.observed), /MPC/);
});

test("rejects EVM chain, from, calldata, hash and native-value mismatches", () => {
  for (const [key, value] of [
    ["chainId", "0x1"], ["from", "0x3333333333333333333333333333333333333333"],
    ["input", "0x"], ["hash", "0x" + "00".repeat(32)], ["value", "0x1"],
  ]) {
    const fixture = proof(); (fixture.observed.evmTransaction as Record<string, unknown>)[key] = value;
    assert.throws(() => verifyTransferProof(fixture.transfer, fixture.context, fixture.observed), /Sepolia|EVM/);
  }
});

test("requires a successful matching receipt, unremoved exact Transfer event and confirmations", () => {
  for (const change of ["failed", "block", "missing-log", "removed-log", "log-hash", "confirmations"]) {
    const fixture = proof();
    if (change === "failed") fixture.observed.receipt.status = "0x0";
    if (change === "block") fixture.observed.receipt.blockHash = "0x" + "00".repeat(32);
    if (change === "missing-log") fixture.observed.receipt.logs = [];
    if (change === "removed-log") fixture.observed.receipt.logs[0].removed = true;
    if (change === "log-hash") fixture.observed.receipt.logs[0].transactionHash = "0x" + "00".repeat(32);
    if (change === "confirmations") fixture.observed.headBlock = "0x64";
    assert.throws(() => verifyTransferProof(fixture.transfer, fixture.context, fixture.observed), /receipt|Transfer|confirmations/);
  }
});

test("transport permits only read-only methods and rejects credential-bearing URL forms", async () => {
  const transport = createReadOnlyEvidenceTransport();
  await assert.rejects(transport.request("near", "sign", {}), /allowlist/);
  await assert.rejects(transport.request("evm", "eth_sendRawTransaction", []), /allowlist/);
  for (const nearRpcUrl of ["http://rpc.testnet.near.org", "https://user:secret@rpc.testnet.near.org", "https://rpc.testnet.near.org?api_key=secret"]) {
    assert.throws(() => createReadOnlyEvidenceTransport({ nearRpcUrl }), /public HTTPS/);
  }
});

test("falls back to EXPERIMENTAL_tx_status only for a method-not-found response", async () => {
  for (const errorCode of ["METHOD_NOT_FOUND", "RPC_FAILED"] as const) {
    const calls: string[] = [], fixture = proof();
    const transport: EvidenceTransport = { async request(chain, method) {
      calls.push(`${chain}:${method}`);
      if (method === "status") return { chain_id: "testnet" };
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "eth_blockNumber") return "0x65";
      if (method === "tx_status") throw new EvidenceVerificationError(errorCode, "Fixture RPC error");
      if (method === "EXPERIMENTAL_tx_status") return fixture.observed.nearTransaction;
      if (method === "eth_getTransactionByHash") return fixture.observed.evmTransaction;
      if (method === "eth_getTransactionReceipt") return fixture.observed.receipt;
      throw new Error("Unexpected method");
    } };
    // This fixture deliberately cannot pass the real two-role common-root check
    // against its unrelated public one-leg signature. Never relax that binding.
    await assert.rejects(verifyEvidence(completeManifest(), { transport, allowFixtures: true }));
    assert.equal(calls.includes("near:EXPERIMENTAL_tx_status"), errorCode === "METHOD_NOT_FOUND");
  }
});

test("raw fetch wrapper emits only the selected read method and sanitizes RPC errors", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)).method);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { chain_id: "testnet" } }), { status: 200 });
  };
  try {
    assert.deepEqual(await createReadOnlyEvidenceTransport().request("near", "status", []), { chain_id: "testnet" });
    assert.deepEqual(calls, ["status"]);
    globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 99, result: {} }));
    await assert.rejects(createReadOnlyEvidenceTransport().request("near", "status", []), code("RPC_FAILED"));
    globalThis.fetch = async () => { throw new Error("Do not expose a credential-bearing URL"); };
    await assert.rejects(createReadOnlyEvidenceTransport().request("near", "status", []), (error: unknown) => code("RPC_FAILED")(error) && !(error as Error).message.includes("credential-bearing"));
  } finally { globalThis.fetch = original; }
});
