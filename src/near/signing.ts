import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverAddress, SigningKey } from "ethers";
import {
  actions, baseDecode, baseEncode, createTransaction, KeyPairSigner, PublicKey,
  type KeyPairString, type SignedTransaction, type Transaction,
} from "near-api-js";
import { normalizeMpcSignature, type MpcEcdsaSignature } from "../evm/erc20-transfer.js";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID, type AuthorityRole } from "./config.js";
import { requireRole, VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "./identities.js";
import { deriveEvmPublicKey, ReadOnlyMpcClient, type MpcDerivation, type MpcInspection } from "./mpc.js";

export const MPC_SIGNING_GAS_TGAS = 100;
export const MPC_SIGNING_DEPOSIT_YOCTO = "1";
const EXPECTED_MPC_VERSION = "3.18.0";
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const DEFAULT_REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
type ReadMethod = "status" | "query" | "tx_status" | "EXPERIMENTAL_tx_status";
type RpcMethod = ReadMethod | "send_tx";

export class MpcSigningError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "PUBLIC_CHECK_FAILED" | "CREDENTIAL_FAILED" |
    "PREPARATION_FAILED" | "ALREADY_ATTEMPTED" | "SUBMISSION_UNKNOWN" | "RPC_FAILED" |
    "METHOD_NOT_FOUND" | "INVALID_OUTCOME", message: string) {
    super(message); this.name = "MpcSigningError";
  }
}
function requireThat(condition: unknown, code: MpcSigningError["code"], message: string): asserts condition {
  if (!condition) throw new MpcSigningError(code, message);
}
function object(value: unknown, code: MpcSigningError["code"], label: string): Record<string, any> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), code, label);
  return value as Record<string, any>;
}
function rpcUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        url.hostname.toLowerCase().includes("mainnet")) throw new Error();
    return url.toString();
  } catch { throw new MpcSigningError("INVALID_INPUT", "Use a public HTTPS NEAR testnet RPC without credentials or query strings."); }
}
function digestHex(value: string): string {
  requireThat(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) &&
    BigInt(value) < ORDER, "INVALID_INPUT", "The EVM digest must be a 32-byte hex scalar below the secp256k1 order.");
  return value.toLowerCase();
}
function transactionHash(value: string): string {
  try {
    requireThat(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) &&
      baseDecode(value).length === 32, "INVALID_INPUT", "Use a 32-byte base58 NEAR transaction hash.");
    return value;
  } catch { throw new MpcSigningError("INVALID_INPUT", "Use a 32-byte base58 NEAR transaction hash."); }
}
async function rawRpc(endpoint: string, method: RpcMethod, params: unknown): Promise<unknown> {
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
      body: JSON.stringify({ jsonrpc: "2.0", id: "wealthpixels-signing", method, params }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error();
    const body = object(await response.json(), "RPC_FAILED", "Invalid public RPC response.");
    if (body.jsonrpc !== "2.0" || body.id !== "wealthpixels-signing") throw new Error();
    if (body.error?.code === -32601) throw new MpcSigningError("METHOD_NOT_FOUND", "The public RPC method is unavailable.");
    if (body.error || !("result" in body)) throw new Error();
    return body.result;
  } catch (error) {
    if (error instanceof MpcSigningError && error.code === "METHOD_NOT_FOUND") throw error;
    throw new MpcSigningError("RPC_FAILED", "The public NEAR RPC request failed.");
  }
}
export interface LocalNearTransactionSigner {
  getPublicKey(): Promise<PublicKey>;
  signTransaction(transaction: Transaction): Promise<{ txHash: Uint8Array; signedTransaction: SignedTransaction }>;
}
/** Explicit offline-only hooks. Production callers omit these; identities cannot be overridden. */
export interface MpcSigningOfflineFixtures {
  readonly mode: "offline-fixtures";
  readMpc(role: AuthorityRole): Promise<{ inspection: MpcInspection; derivation: MpcDerivation }>;
  rpc(method: RpcMethod, params: unknown): Promise<unknown>;
  inspectFile(path: string): Promise<{ realPath: string; regular: boolean; size: number }>;
  readCredentialText(path: string): Promise<string>;
  createSigner(privateKey: string): LocalNearTransactionSigner;
}
export interface VerifiedRoleMpc {
  readonly role: AuthorityRole;
  readonly inspection: MpcInspection;
  readonly derivation: MpcDerivation;
  readonly accessPublicKey: string;
  readonly accessKeyNonce: string;
}
function fixtureMode(fixtures?: MpcSigningOfflineFixtures): void {
  requireThat(!fixtures || fixtures.mode === "offline-fixtures", "INVALID_INPUT", "Invalid offline fixture services.");
}
function rpcFor(endpoint: string, fixtures?: MpcSigningOfflineFixtures) {
  return (method: RpcMethod, params: unknown) => fixtures ? fixtures.rpc(method, params) : rawRpc(endpoint, method, params);
}

/** Public checks only. No credential, local signing, or broadcast is performed. */
export async function verifyRoleMpc(
  roleValue: AuthorityRole, endpointValue: string, fixtures?: MpcSigningOfflineFixtures,
): Promise<VerifiedRoleMpc> {
  const role = requireRole(roleValue), endpoint = rpcUrl(endpointValue);
  fixtureMode(fixtures);
  const expected = VERIFIED_IDENTITIES[role];
  try {
    let inspected: { inspection: MpcInspection; derivation: MpcDerivation };
    if (fixtures) inspected = await fixtures.readMpc(role);
    else {
      const client = new ReadOnlyMpcClient({ rpcUrl: endpoint });
      const inspection = await client.inspect();
      inspected = { inspection, derivation: await client.derive(expected.accountId, DERIVATION_PATH) };
    }
    const { inspection, derivation } = inspected;
    requireThat(inspection.networkId === "testnet" && inspection.contractId === MPC_CONTRACT_ID &&
      inspection.domainId === ECDSA_DOMAIN_ID && inspection.version === EXPECTED_MPC_VERSION &&
      inspection.rootPublicKey === VERIFIED_MPC_ROOT && inspection.domain.id === ECDSA_DOMAIN_ID &&
      inspection.domain.purpose === "Sign" && (inspection.domain.protocol === "CaitSith" || inspection.domain.protocol === "RobustEcdsa") &&
      Number.isSafeInteger(inspection.minimumGasTgas) && inspection.minimumGasTgas > 0 &&
      inspection.minimumGasTgas <= MPC_SIGNING_GAS_TGAS, "PUBLIC_CHECK_FAILED", "The live MPC root, version, domain, or gas configuration changed.");
    requireThat(derivation.nearAccountId === expected.accountId && derivation.derivationPath === DERIVATION_PATH &&
      derivation.domainId === ECDSA_DOMAIN_ID && derivation.blockHash === inspection.blockHash &&
      derivation.blockHeight === inspection.blockHeight && derivation.localMatchesContract === true &&
      derivation.evmAddress === expected.evmAddress, "PUBLIC_CHECK_FAILED", "The selected role's live MPC derivation changed.");
    const keyList = object(await rpcFor(endpoint, fixtures)("query", {
      request_type: "view_access_key_list", account_id: expected.accountId, block_id: inspection.blockHash,
    }), "PUBLIC_CHECK_FAILED", "Invalid finalized access-key response.");
    requireThat(keyList.block_hash === inspection.blockHash && keyList.block_height === inspection.blockHeight &&
      Array.isArray(keyList.keys) && keyList.keys.length === 1 &&
      keyList.keys[0]?.public_key === expected.accessPublicKey &&
      keyList.keys[0]?.access_key?.permission === "FullAccess",
    "PUBLIC_CHECK_FAILED", "The selected role must retain its sole verified FullAccess key.");
    const nonce = keyList.keys[0].access_key.nonce;
    requireThat((typeof nonce === "string" && /^(0|[1-9][0-9]*)$/.test(nonce)) ||
      (typeof nonce === "number" && Number.isSafeInteger(nonce) && nonce >= 0),
    "PUBLIC_CHECK_FAILED", "The finalized access-key nonce is invalid.");
    const accessKeyNonce = BigInt(nonce);
    requireThat(accessKeyNonce < (1n << 64n) - 1n, "PUBLIC_CHECK_FAILED", "The access-key nonce is outside the supported range.");
    return Object.freeze({ role, inspection, derivation, accessPublicKey: expected.accessPublicKey, accessKeyNonce: accessKeyNonce.toString() });
  } catch (error) {
    if (error instanceof MpcSigningError && error.code === "PUBLIC_CHECK_FAILED") throw error;
    throw new MpcSigningError("PUBLIC_CHECK_FAILED", "The selected role's public finalized MPC and account checks failed.");
  }
}

let productionSelection: { role: AuthorityRole; path: string } | undefined;
const fixtureSelections = new WeakMap<MpcSigningOfflineFixtures, { role: AuthorityRole; path: string }>();
function outsideRepository(file: string, repository: string): boolean {
  const remainder = relative(repository, file);
  return remainder !== "" && (remainder === ".." || remainder.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) || isAbsolute(remainder));
}
async function selectedSigner(
  role: AuthorityRole, pathValue: string, repositoryValue: string, fixtures?: MpcSigningOfflineFixtures,
): Promise<LocalNearTransactionSigner> {
  try {
    requireThat(typeof pathValue === "string" && isAbsolute(pathValue) && basename(pathValue) === role + ".json",
      "CREDENTIAL_FAILED", "Select the explicit absolute credential file for this role.");
    const path = resolve(pathValue), repository = resolve(repositoryValue);
    requireThat(outsideRepository(path, repository), "CREDENTIAL_FAILED", "Credential storage must be outside the repository.");
    const info = fixtures ? await fixtures.inspectFile(path) : await (async () => {
      const metadata = await lstat(path);
      return { realPath: await realpath(path), regular: metadata.isFile() && !metadata.isSymbolicLink(), size: metadata.size };
    })();
    const canonicalRepo = fixtures ? repository : await realpath(repository);
    requireThat(info.regular && info.size > 0 && info.size <= 4096 &&
      info.realPath.toLowerCase() === path.toLowerCase() && outsideRepository(info.realPath, canonicalRepo),
    "CREDENTIAL_FAILED", "The selected credential must be one regular external file without links.");
    const selection = fixtures ? fixtureSelections.get(fixtures) : productionSelection;
    requireThat(!selection || (selection.role === role && selection.path.toLowerCase() === path.toLowerCase()),
      "CREDENTIAL_FAILED", "One role and one credential file are allowed per process. Start a separate process for the other role.");
    if (fixtures) fixtureSelections.set(fixtures, { role, path });
    else productionSelection = { role, path };
    const text = fixtures ? await fixtures.readCredentialText(path) : await readFile(path, "utf8");
    const credential = object(JSON.parse(text), "CREDENTIAL_FAILED", "Invalid selected credential.");
    const expected = VERIFIED_IDENTITIES[role];
    requireThat(Object.keys(credential).sort().join(",") === "account_id,private_key,public_key" &&
      credential.account_id === expected.accountId && credential.public_key === expected.accessPublicKey &&
      typeof credential.private_key === "string" && credential.private_key.startsWith("ed25519:"),
    "CREDENTIAL_FAILED", "The selected credential does not match the verified role.");
    const signer = fixtures ? fixtures.createSigner(credential.private_key) :
      KeyPairSigner.fromSecretKey(credential.private_key as KeyPairString);
    requireThat((await signer.getPublicKey()).toString() === expected.accessPublicKey,
      "CREDENTIAL_FAILED", "The selected secret does not derive the verified role access key.");
    return signer;
  } catch {
    // Filesystem, JSON and SDK exceptions may contain secrets or local paths.
    throw new MpcSigningError("CREDENTIAL_FAILED", "Selected credential validation failed. Check its role, protected external location and registered public key.");
  }
}
export interface MpcSignRequest {
  readonly payload_v2: { readonly Ecdsa: string };
  readonly path: typeof DERIVATION_PATH;
  readonly domain_id: typeof ECDSA_DOMAIN_ID;
}
export interface PreparedMpcSigning {
  readonly transactionHash: string;
  readonly signerAccountId: string;
  readonly receiverId: typeof MPC_CONTRACT_ID;
  readonly request: MpcSignRequest;
  readonly gasTgas: typeof MPC_SIGNING_GAS_TGAS;
  readonly depositYocto: typeof MPC_SIGNING_DEPOSIT_YOCTO;
  /** Persist transactionHash durably before calling. A failed/uncertain attempt cannot be retried. */
  broadcastOnce(): Promise<unknown>;
}

/** Local preparation only. The returned broadcast capability is the sole mutation path. */
export async function prepareMpcSigning(options: {
  role: AuthorityRole; credentialPath: string; rpcUrl: string; digest: string; repositoryRoot?: string;
}, fixtures?: MpcSigningOfflineFixtures): Promise<PreparedMpcSigning> {
  const role = requireRole(options.role), endpoint = rpcUrl(options.rpcUrl), digest = digestHex(options.digest);
  fixtureMode(fixtures);
  const verified = await verifyRoleMpc(role, endpoint, fixtures);
  const signer = await selectedSigner(role, options.credentialPath, options.repositoryRoot ?? DEFAULT_REPOSITORY, fixtures);
  const request: MpcSignRequest = Object.freeze({
    payload_v2: Object.freeze({ Ecdsa: digest.slice(2) }), path: DERIVATION_PATH, domain_id: ECDSA_DOMAIN_ID,
  });
  let signedBytes: string, hash: string;
  try {
    const transaction = createTransaction(
      VERIFIED_IDENTITIES[role].accountId, PublicKey.fromString(verified.accessPublicKey), MPC_CONTRACT_ID,
      BigInt(verified.accessKeyNonce) + 1n,
      [actions.functionCall("sign", { request }, BigInt(MPC_SIGNING_GAS_TGAS) * 10n ** 12n, 1n)],
      baseDecode(verified.inspection.blockHash),
    );
    const expectedHash = new Uint8Array(createHash("sha256").update(transaction.encode()).digest());
    const signed = await signer.signTransaction(transaction);
    requireThat(Buffer.from(signed.txHash).equals(Buffer.from(expectedHash)) &&
      Buffer.from(signed.signedTransaction.transaction.encode()).equals(Buffer.from(transaction.encode())),
    "PREPARATION_FAILED", "The locally signed NEAR transaction changed.");
    hash = baseEncode(expectedHash);
    signedBytes = Buffer.from(signed.signedTransaction.encode()).toString("base64");
  } catch { throw new MpcSigningError("PREPARATION_FAILED", "Local NEAR transaction preparation failed; nothing was submitted."); }
  let attempted = false;
  return Object.freeze({
    transactionHash: hash, signerAccountId: VERIFIED_IDENTITIES[role].accountId, receiverId: MPC_CONTRACT_ID,
    request, gasTgas: MPC_SIGNING_GAS_TGAS, depositYocto: MPC_SIGNING_DEPOSIT_YOCTO,
    async broadcastOnce(): Promise<unknown> {
      requireThat(!attempted, "ALREADY_ATTEMPTED", "This prepared NEAR submission was already attempted. Reconcile its persisted hash.");
      attempted = true;
      const current = await verifyRoleMpc(role, endpoint, fixtures);
      requireThat(current.accessKeyNonce === verified.accessKeyNonce, "PUBLIC_CHECK_FAILED",
        "The role's access-key nonce changed. Stop and review the persisted transaction hash.");
      try {
        // One HTTP POST, no SDK broadcast retry, redirect, nonce rebuild or re-signing.
        return await rpcFor(endpoint, fixtures)("send_tx", { signed_tx_base64: signedBytes, wait_until: "NONE" });
      } catch {
        throw new MpcSigningError("SUBMISSION_UNKNOWN", "NEAR submission outcome is unknown. Reconcile the persisted hash; do not submit again.");
      }
    },
  });
}

/** Public status read only; this never prepares, signs or resubmits a transaction. */
export async function readMpcSigningOutcome(
  roleValue: AuthorityRole, hashValue: string, endpointValue: string, fixtures?: MpcSigningOfflineFixtures,
): Promise<unknown> {
  const role = requireRole(roleValue), hash = transactionHash(hashValue), endpoint = rpcUrl(endpointValue);
  fixtureMode(fixtures);
  const rpc = rpcFor(endpoint, fixtures);
  const status = object(await rpc("status", []), "RPC_FAILED", "Invalid NEAR status.");
  requireThat(status.chain_id === "testnet", "PUBLIC_CHECK_FAILED", "The NEAR RPC must report testnet.");
  const params = { tx_hash: hash, sender_account_id: VERIFIED_IDENTITIES[role].accountId, wait_until: "FINAL" };
  try { return await rpc("tx_status", params); }
  catch (error) {
    if (!(error instanceof MpcSigningError) || error.code !== "METHOD_NOT_FOUND") throw error;
    return rpc("EXPERIMENTAL_tx_status", params);
  }
}
function base64Json(value: unknown): Record<string, any> {
  requireThat(typeof value === "string" && value.length <= 32768, "INVALID_OUTCOME", "Expected bounded base64 JSON.");
  try {
    const bytes = Buffer.from(value, "base64");
    requireThat(bytes.toString("base64") === value, "INVALID_OUTCOME", "Expected canonical base64.");
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "INVALID_OUTCOME", "Expected a JSON object.");
  } catch { throw new MpcSigningError("INVALID_OUTCOME", "Invalid MPC outcome encoding."); }
}
export interface VerifiedMpcEcdsaSignature extends MpcEcdsaSignature { readonly scheme: "Secp256k1" }

/** Pure validation binding the final direct MPC request and returned signature to this role/digest. */
export function normalizeMpcOutcome(
  outcome: unknown, roleValue: AuthorityRole, hashValue: string, digestValue: string,
): VerifiedMpcEcdsaSignature {
  const role = requireRole(roleValue), hash = transactionHash(hashValue), digest = digestHex(digestValue);
  try {
    const final = object(outcome, "INVALID_OUTCOME", "Invalid NEAR final outcome.");
    const tx = object(final.transaction, "INVALID_OUTCOME", "Missing NEAR transaction.");
    const expected = VERIFIED_IDENTITIES[role];
    requireThat(final.final_execution_status === "FINAL" && tx.hash === hash &&
      tx.signer_id === expected.accountId && tx.public_key === expected.accessPublicKey &&
      tx.receiver_id === MPC_CONTRACT_ID && Array.isArray(tx.actions) && tx.actions.length === 1,
    "INVALID_OUTCOME", "The finalized NEAR transaction does not match the selected role and persisted hash.");
    const direct = object(tx.actions[0], "INVALID_OUTCOME", "Missing direct action.");
    requireThat(Object.keys(direct).length === 1 && "FunctionCall" in direct, "INVALID_OUTCOME", "Require exactly one direct function-call action.");
    const action = object(direct.FunctionCall, "INVALID_OUTCOME", "Missing direct MPC call.");
    requireThat(action.method_name === "sign" && String(action.gas) === String(MPC_SIGNING_GAS_TGAS * 1e12) &&
      action.deposit === MPC_SIGNING_DEPOSIT_YOCTO, "INVALID_OUTCOME", "The direct MPC method, gas or deposit changed.");
    const args = base64Json(action.args);
    const request = object(args.request, "INVALID_OUTCOME", "Missing MPC request.");
    const payload = object(request.payload_v2, "INVALID_OUTCOME", "Missing ECDSA payload.");
    requireThat(Object.keys(args).length === 1 && Object.keys(request).sort().join(",") === "domain_id,path,payload_v2" &&
      request.path === DERIVATION_PATH && request.domain_id === ECDSA_DOMAIN_ID &&
      Object.keys(payload).length === 1 && typeof payload.Ecdsa === "string" &&
      /^[0-9a-fA-F]{64}$/.test(payload.Ecdsa) && "0x" + payload.Ecdsa.toLowerCase() === digest,
    "INVALID_OUTCOME", "The finalized MPC request does not match the exact approved digest, path and domain.");
    const status = object(final.status, "INVALID_OUTCOME", "Missing final status.");
    requireThat(Object.keys(status).length === 1 && "SuccessValue" in status, "INVALID_OUTCOME", "Require one final inline SuccessValue.");
    const signature = base64Json(status.SuccessValue);
    requireThat(signature.scheme === "Secp256k1", "INVALID_OUTCOME", "Require the Secp256k1 signature scheme.");
    const normalized = normalizeMpcSignature(signature);
    const trustedPublicKey = deriveEvmPublicKey(VERIFIED_MPC_ROOT, expected.accountId, DERIVATION_PATH);
    requireThat(SigningKey.recoverPublicKey(digest, normalized).toLowerCase() === trustedPublicKey.toLowerCase() &&
      recoverAddress(digest, normalized) === expected.evmAddress,
    "INVALID_OUTCOME", "The MPC signature does not recover the selected role's full derived public key and address.");
    return Object.freeze({
      scheme: "Secp256k1", big_r: Object.freeze({ affine_point: signature.big_r.affine_point }),
      s: Object.freeze({ scalar: signature.s.scalar }), recovery_id: signature.recovery_id,
    });
  } catch {
    throw new MpcSigningError("INVALID_OUTCOME", "The final NEAR MPC outcome does not prove this role's approved EVM digest.");
  }
}
