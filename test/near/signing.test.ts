import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { test } from "node:test";
import { SigningKey } from "ethers";
import { baseEncode, PublicKey, SignedTransaction, Signature as NearSignature } from "near-api-js";
import { DERIVATION_PATH, MPC_CONTRACT_ID, type AuthorityRole } from "../../src/near/config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../../src/near/identities.js";
import { deriveEvmPublicKey, type MpcDerivation, type MpcInspection } from "../../src/near/mpc.js";
import { assembleSignedErc20Transfer, normalizeMpcSignature } from "../../src/evm/erc20-transfer.js";
import {
  recordedOutcome, recordedState, RECORDED_EVM_HASH, RECORDED_NEAR_HASH,
  RECORDED_PUBLIC_KEY, RECORDED_SENDER, RECORDED_UNSIGNED_HASH,
} from "./fixtures/recorded-mpc.js";
import {
  MPC_SIGNING_DEPOSIT_YOCTO, MPC_SIGNING_GAS_TGAS, MpcSigningError, normalizeMpcOutcome,
  prepareMpcSigning, readMpcSigningOutcome, verifyRoleMpc,
  type MpcSigningOfflineFixtures,
} from "../../src/near/signing.js";

const BLOCK = "1".repeat(32), HASH = baseEncode(new Uint8Array(32).fill(7));
const DIGEST = "0x" + "12".repeat(32);
const REPOSITORY = resolve(".");
function credentialPath(role: AuthorityRole): string { return resolve("..", "offline-fixture-credentials", role + ".json"); }
function isCode(code: MpcSigningError["code"]) {
  return (error: unknown) => error instanceof MpcSigningError && error.code === code;
}
function fixture() {
  const calls: { kind: string; method?: string; params?: unknown; path?: string }[] = [];
  let role: AuthorityRole = "treasury";
  const changes: {
    root?: string; minimumGas?: number; extraKey?: boolean; badNonce?: unknown;
    nonce: number; sendFails?: boolean; wrongSigner?: boolean; wrongCredential?: boolean;
    wrongRealPath?: boolean; regular?: boolean; size?: number; readFails?: boolean;
    txStatusFails?: "missing" | "network"; network?: string;
  } = { nonce: 9 };
  const services: MpcSigningOfflineFixtures = {
    mode: "offline-fixtures",
    async readMpc(selected) {
      role = selected; calls.push({ kind: "mpc" });
      const identity = VERIFIED_IDENTITIES[role];
      const inspection: MpcInspection = {
        networkId: "testnet", contractId: MPC_CONTRACT_ID, domainId: 0, blockHash: BLOCK, blockHeight: 100,
        version: "3.18.0", rootPublicKey: changes.root ?? VERIFIED_MPC_ROOT,
        rootPublicKeySec1: "unused-fixture-public-field", minimumGasTgas: changes.minimumGas ?? 15,
        domain: { id: 0, protocol: "CaitSith", purpose: "Sign", reconstructionThreshold: 11, keyEpoch: 27, keyAttempt: 1 },
        config: {}, state: {},
      };
      const derivation: MpcDerivation = {
        nearAccountId: identity.accountId, derivationPath: DERIVATION_PATH, domainId: 0,
        blockHash: BLOCK, blockHeight: 100, derivedPublicKey: "unused-fixture-public-field",
        derivedPublicKeySec1: deriveEvmPublicKey(VERIFIED_MPC_ROOT, identity.accountId, DERIVATION_PATH),
        evmAddress: identity.evmAddress, localMatchesContract: true,
      };
      return { inspection, derivation };
    },
    async rpc(method, params) {
      calls.push({ kind: "rpc", method, params });
      if (method === "query") {
        const key = { public_key: VERIFIED_IDENTITIES[role].accessPublicKey, access_key: {
          permission: "FullAccess", nonce: changes.badNonce ?? changes.nonce,
        } };
        return { block_hash: BLOCK, block_height: 100, keys: changes.extraKey ? [key, key] : [key] };
      }
      if (method === "send_tx") {
        if (changes.sendFails) throw new Error("arbitrary transport details must be suppressed");
        return { final_execution_status: "NONE" };
      }
      if (method === "status") return { chain_id: changes.network ?? "testnet" };
      if (method === "tx_status" && changes.txStatusFails === "missing") {
        throw new MpcSigningError("METHOD_NOT_FOUND", "fixture");
      }
      if (method === "tx_status" && changes.txStatusFails === "network") {
        throw new MpcSigningError("RPC_FAILED", "fixture");
      }
      return { fixture: "public-outcome" };
    },
    async inspectFile(path) {
      calls.push({ kind: "file-metadata", path });
      return { realPath: changes.wrongRealPath ? path + ".different" : path, regular: changes.regular ?? true, size: changes.size ?? 200 };
    },
    async readCredentialText(path) {
      calls.push({ kind: "credential-read", path });
      if (changes.readFails) throw new Error("fixture file details that must not escape");
      const expected = VERIFIED_IDENTITIES[role];
      // In-memory placeholder only. The mocked signer never parses it as a secret.
      return JSON.stringify({
        account_id: changes.wrongCredential ? "wrong-role.testnet" : expected.accountId,
        public_key: expected.accessPublicKey, private_key: ["ed25519", "offline-fixture"].join(":"),
      });
    },
    createSigner() {
      calls.push({ kind: "signer-created" });
      const signerRole = role;
      return {
        async getPublicKey() {
          return PublicKey.fromString(VERIFIED_IDENTITIES[changes.wrongSigner ?
            (signerRole === "treasury" ? "investor" : "treasury") : signerRole].accessPublicKey);
        },
        async signTransaction(transaction) {
          calls.push({ kind: "local-sign-mock" });
          return {
            txHash: new Uint8Array(createHash("sha256").update(transaction.encode()).digest()),
            // Zero bytes are a mock Ed25519 signature, never sent to a real network.
            signedTransaction: new SignedTransaction({
              transaction, signature: new NearSignature({ keyType: 0, data: new Uint8Array(64) }),
            }),
          };
        },
      };
    },
  };
  return { services, changes, calls };
}
function options(role: AuthorityRole = "treasury") {
  return { role, credentialPath: credentialPath(role), rpcUrl: "https://rpc.testnet.near.org", digest: DIGEST, repositoryRoot: REPOSITORY };
}

test("public role verification pins sole FullAccess and nonce to the MPC finalized block without credential reads", async () => {
  const f = fixture(), verified = await verifyRoleMpc("treasury", options().rpcUrl, f.services);
  assert.equal(verified.accessKeyNonce, "9");
  assert.deepEqual(f.calls.find((entry) => entry.method === "query")?.params, {
    request_type: "view_access_key_list", account_id: VERIFIED_IDENTITIES.treasury.accountId, block_id: BLOCK,
  });
  assert.equal(f.calls.some((entry) => entry.kind === "credential-read" || entry.kind === "local-sign-mock" || entry.method === "send_tx"), false);
});

test("prepares exact direct v2 request and transaction hash before any send", async () => {
  const f = fixture(), prepared = await prepareMpcSigning(options(), f.services);
  assert.deepEqual(prepared.request, { payload_v2: { Ecdsa: DIGEST.slice(2) }, path: DERIVATION_PATH, domain_id: 0 });
  assert.equal(prepared.signerAccountId, VERIFIED_IDENTITIES.treasury.accountId);
  assert.equal(prepared.receiverId, MPC_CONTRACT_ID);
  assert.equal(prepared.gasTgas, 100); assert.equal(prepared.depositYocto, "1");
  assert.match(prepared.transactionHash, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.deepEqual(f.calls.filter((entry) => entry.kind === "credential-read").map((entry) => entry.path), [credentialPath("treasury")]);
  assert.equal(f.calls.filter((entry) => entry.method === "send_tx").length, 0);
  await prepared.broadcastOnce();
  const sends = f.calls.filter((entry) => entry.method === "send_tx");
  assert.equal(sends.length, 1);
  assert.equal((sends[0].params as any).wait_until, "NONE");
  const signed = SignedTransaction.decode(Buffer.from((sends[0].params as any).signed_tx_base64, "base64"));
  assert.equal(signed.transaction.nonce, 10n);
  assert.equal(signed.transaction.signerId, VERIFIED_IDENTITIES.treasury.accountId);
  assert.equal(signed.transaction.publicKey.toString(), VERIFIED_IDENTITIES.treasury.accessPublicKey);
  assert.equal(signed.transaction.receiverId, MPC_CONTRACT_ID);
  assert.equal(baseEncode(createHash("sha256").update(signed.transaction.encode()).digest()), prepared.transactionHash);
  const call = (signed.transaction.actions[0] as any).functionCall;
  assert.equal(call.methodName, "sign"); assert.equal(call.gas, 100000000000000n); assert.equal(call.deposit, 1n);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(Uint8Array.from(call.args))), { request: prepared.request });
  await assert.rejects(prepared.broadcastOnce(), isCode("ALREADY_ATTEMPTED"));
});

test("unknown submission is attempted once and cannot be retried or locally re-signed", async () => {
  const f = fixture(); f.changes.sendFails = true;
  const prepared = await prepareMpcSigning(options(), f.services);
  await assert.rejects(prepared.broadcastOnce(), isCode("SUBMISSION_UNKNOWN"));
  await assert.rejects(prepared.broadcastOnce(), isCode("ALREADY_ATTEMPTED"));
  assert.equal(f.calls.filter((entry) => entry.method === "send_tx").length, 1);
  assert.equal(f.calls.filter((entry) => entry.kind === "local-sign-mock").length, 1);
});

test("changed nonce or root between preparation and submission prevents send", async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.changes.nonce++; },
    (f: ReturnType<typeof fixture>) => { f.changes.root = "changed-public-root"; }]) {
    const f = fixture(), prepared = await prepareMpcSigning(options(), f.services);
    mutate(f);
    await assert.rejects(prepared.broadcastOnce(), isCode("PUBLIC_CHECK_FAILED"));
    await assert.rejects(prepared.broadcastOnce(), isCode("ALREADY_ATTEMPTED"));
    assert.equal(f.calls.filter((entry) => entry.method === "send_tx").length, 0);
  }
});

test("rejects unsupported network, digest, root, gas, extra key and unsafe nonce before reading credentials", async () => {
  const invalid = fixture();
  for (const input of [
    { ...options(), rpcUrl: "https://rpc.mainnet.near.org" },
    { ...options(), rpcUrl: "https://rpc.testnet.near.org?credential=blocked" },
    { ...options(), digest: "0x" + "ff".repeat(32) }, { ...options(), digest: "0x12" },
  ]) await assert.rejects(prepareMpcSigning(input, invalid.services), isCode("INVALID_INPUT"));
  assert.equal(invalid.calls.length, 0);
  for (const change of [{ root: "changed" }, { minimumGas: 101 }, { extraKey: true }, { badNonce: Number.MAX_SAFE_INTEGER + 1 }]) {
    const f = fixture(); Object.assign(f.changes, change);
    await assert.rejects(prepareMpcSigning(options(), f.services), isCode("PUBLIC_CHECK_FAILED"));
    assert.equal(f.calls.some((entry) => entry.kind === "credential-read"), false);
  }
});

test("selected credential must be external, regular, bounded, role-matching and derive the registered public key", async () => {
  for (const path of ["treasury.json", resolve("treasury.json"), credentialPath("investor")]) {
    const f = fixture();
    await assert.rejects(prepareMpcSigning({ ...options(), credentialPath: path }, f.services), isCode("CREDENTIAL_FAILED"));
    assert.equal(f.calls.some((entry) => entry.kind === "credential-read"), false);
  }
  for (const change of [{ wrongRealPath: true }, { regular: false }, { size: 5000 },
    { wrongCredential: true }, { wrongSigner: true }, { readFails: true }]) {
    const f = fixture(); Object.assign(f.changes, change);
    await assert.rejects(prepareMpcSigning(options(), f.services), isCode("CREDENTIAL_FAILED"));
    assert.equal(f.calls.some((entry) => entry.kind === "local-sign-mock" || entry.method === "send_tx"), false);
  }
});

test("one credential role per process fixture prevents reading the other role file", async () => {
  const f = fixture();
  await prepareMpcSigning(options("treasury"), f.services);
  await assert.rejects(prepareMpcSigning(options("investor"), f.services), isCode("CREDENTIAL_FAILED"));
  assert.deepEqual(f.calls.filter((entry) => entry.kind === "credential-read").map((entry) => entry.path), [credentialPath("treasury")]);
});

test("outcome reconciliation is credential-free, FINAL, and falls back only on method-not-found", async () => {
  const f = fixture(); f.changes.txStatusFails = "missing";
  assert.deepEqual(await readMpcSigningOutcome("investor", HASH, options().rpcUrl, f.services), { fixture: "public-outcome" });
  const reads = f.calls.filter((entry) => entry.kind === "rpc");
  assert.deepEqual(reads.map((entry) => entry.method), ["status", "tx_status", "EXPERIMENTAL_tx_status"]);
  assert.deepEqual(reads[1].params, { tx_hash: HASH, sender_account_id: VERIFIED_IDENTITIES.investor.accountId, wait_until: "FINAL" });
  assert.equal(f.calls.some((entry) => entry.kind === "credential-read" || entry.kind === "local-sign-mock" || entry.method === "send_tx"), false);
  const networkFailure = fixture(); networkFailure.changes.txStatusFails = "network";
  await assert.rejects(readMpcSigningOutcome("treasury", HASH, options().rpcUrl, networkFailure.services), isCode("RPC_FAILED"));
  assert.equal(networkFailure.calls.some((entry) => entry.method === "EXPERIMENTAL_tx_status"), false);
  const mainnet = fixture(); mainnet.changes.network = "mainnet";
  await assert.rejects(readMpcSigningOutcome("treasury", HASH, options().rpcUrl, mainnet.services), isCode("PUBLIC_CHECK_FAILED"));
  assert.equal(mainnet.calls.some((entry) => entry.method === "tx_status"), false);
});

/** Public-point, chosen-digest verification fixture. No private key or signing API.
 * For R=G+Q, choosing z=r and s=r makes ECDSA verification reconstruct R.
 * This deliberately chosen digest is unrelated to any EVM transaction preimage.
 */
function publicOutcome(role: AuthorityRole) {
  const q = deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES[role].accountId, DERIVATION_PATH);
  const generator = "0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" +
    "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
  const point = SigningKey.addPoints(generator, q, true).slice(2);
  const r = point.slice(2), digest = "0x" + r;
  const signature = { scheme: "Secp256k1", big_r: { affine_point: point }, s: { scalar: r }, recovery_id: point.startsWith("02") ? 0 : 1 };
  const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
  const result = {
    final_execution_status: "FINAL", transaction: {
      hash: HASH, signer_id: VERIFIED_IDENTITIES[role].accountId, public_key: VERIFIED_IDENTITIES[role].accessPublicKey,
      receiver_id: MPC_CONTRACT_ID, actions: [{ FunctionCall: {
        method_name: "sign", gas: MPC_SIGNING_GAS_TGAS * 1e12, deposit: MPC_SIGNING_DEPOSIT_YOCTO,
        args: base64({ request: { path: DERIVATION_PATH, domain_id: 0, payload_v2: { Ecdsa: digest.slice(2) } } }),
      } }],
    }, status: { SuccessValue: base64(signature) },
  };
  return { result, signature, digest, base64 };
}

test("final direct MPC response binds exact digest and signature recovery to either public role", () => {
  for (const role of ["treasury", "investor"] as const) {
    const f = publicOutcome(role);
    assert.deepEqual(normalizeMpcOutcome(f.result, role, HASH, f.digest), f.signature);
  }
});

test("normalizer rejects changed role/hash/digest, indirect actions, gas/deposit, wrapper and failed or unfinished outcome", () => {
  const f = publicOutcome("treasury");
  const mutations: ((value: typeof f.result) => void)[] = [
    (v) => { v.final_execution_status = "EXECUTED_OPTIMISTIC"; },
    (v) => { v.transaction.hash = BLOCK; },
    (v) => { v.transaction.public_key = VERIFIED_IDENTITIES.investor.accessPublicKey; },
    (v) => { v.transaction.actions.push(v.transaction.actions[0]); },
    (v) => { v.transaction.actions[0].FunctionCall.method_name = "other"; },
    (v) => { v.transaction.actions[0].FunctionCall.gas = 15e12; },
    (v) => { v.transaction.actions[0].FunctionCall.deposit = "2" as "1"; },
    (v) => { v.transaction.actions[0].FunctionCall.args = f.base64({ request: { path: "changed", domain_id: 0, payload_v2: { Ecdsa: f.digest.slice(2) } } }); },
    (v) => { v.status.SuccessValue = f.base64({ ...f.signature, scheme: "Ed25519" }); },
    (v) => { v.status.SuccessValue = "!!!"; },
  ];
  for (const mutate of mutations) {
    const result = structuredClone(f.result); mutate(result);
    assert.throws(() => normalizeMpcOutcome(result, "treasury", HASH, f.digest), isCode("INVALID_OUTCOME"));
  }
  assert.throws(() => normalizeMpcOutcome(f.result, "investor", HASH, f.digest), isCode("INVALID_OUTCOME"));
  assert.throws(() => normalizeMpcOutcome(f.result, "treasury", HASH, DIGEST), isCode("INVALID_OUTCOME"));
});

test("recorded live public response recovers the full trusted NEAR-derived key and approved EVM hash offline", () => {
  const outcome = recordedOutcome(), state = recordedState();
  assert.equal(state.status, "near-failed"); // Historical saved status; no live operation is executed.
  assert.equal(state.preflight.prepared.unsignedHash, RECORDED_UNSIGNED_HASH);
  const response = normalizeMpcOutcome(outcome, "treasury", RECORDED_NEAR_HASH, RECORDED_UNSIGNED_HASH);
  assert.equal(response.big_r.affine_point.slice(0, 2), "03");
  assert.equal(response.recovery_id, 0);
  assert.equal(SigningKey.recoverPublicKey(RECORDED_UNSIGNED_HASH, normalizeMpcSignature(response)), RECORDED_PUBLIC_KEY);
  assert.equal(deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES.treasury.accountId, DERIVATION_PATH), RECORDED_PUBLIC_KEY);
  assert.equal(assembleSignedErc20Transfer(state.preflight.prepared, response, RECORDED_SENDER).hash, RECORDED_EVM_HASH);
  assert.equal(recordedState().status, "near-failed");
});

test("recorded response rejects wrong recovery, altered scalars, points, digest, role and final status", () => {
  const original = recordedOutcome();
  const signature = JSON.parse(Buffer.from(original.status.SuccessValue, "base64").toString("utf8"));
  for (const mutate of [
    (value: typeof signature) => { value.recovery_id = 1; },
    (value: typeof signature) => { value.s.scalar = (BigInt("0x" + value.s.scalar) + 1n).toString(16).padStart(64, "0"); },
    (value: typeof signature) => { value.big_r.affine_point = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; },
    (value: typeof signature) => { value.big_r.affine_point = "02" + "ff".repeat(32); },
    (value: typeof signature) => { value.scheme = "Ed25519"; },
  ]) {
    const outcome = recordedOutcome(), altered = structuredClone(signature);
    mutate(altered);
    outcome.status.SuccessValue = Buffer.from(JSON.stringify(altered)).toString("base64");
    assert.throws(() => normalizeMpcOutcome(outcome, "treasury", RECORDED_NEAR_HASH, RECORDED_UNSIGNED_HASH), isCode("INVALID_OUTCOME"));
  }
  assert.throws(() => normalizeMpcOutcome(original, "treasury", RECORDED_NEAR_HASH, DIGEST), isCode("INVALID_OUTCOME"));
  assert.throws(() => normalizeMpcOutcome(original, "investor", RECORDED_NEAR_HASH, RECORDED_UNSIGNED_HASH), isCode("INVALID_OUTCOME"));
  original.final_execution_status = "EXECUTED_OPTIMISTIC";
  assert.throws(() => normalizeMpcOutcome(original, "treasury", RECORDED_NEAR_HASH, RECORDED_UNSIGNED_HASH), isCode("INVALID_OUTCOME"));
});

test("a high-s equivalent recorded response preserves recovery and the exact signed hash", () => {
  const outcome = recordedOutcome();
  const signature = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"));
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  signature.s.scalar = (order - BigInt("0x" + signature.s.scalar)).toString(16).padStart(64, "0");
  signature.recovery_id = 1;
  outcome.status.SuccessValue = Buffer.from(JSON.stringify(signature)).toString("base64");
  const response = normalizeMpcOutcome(outcome, "treasury", RECORDED_NEAR_HASH, RECORDED_UNSIGNED_HASH);
  assert.equal(normalizeMpcSignature(response).yParity, 0);
  assert.equal(assembleSignedErc20Transfer(recordedState().preflight.prepared, response, RECORDED_SENDER).hash, RECORDED_EVM_HASH);
});
