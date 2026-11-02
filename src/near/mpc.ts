import { createHash } from "node:crypto";
import { computeAddress, hexlify, SigningKey } from "ethers";
import { JsonRpcProvider, KeyType, PublicKey } from "near-api-js";

export const MPC_TESTNET_CONTRACT = "v1.signer-prod.testnet";
export const MPC_ECDSA_DOMAIN_ID = 0;
export const MPC_READ_METHODS = Object.freeze([
  "version", "config", "state", "public_key", "derived_public_key",
] as const);

export type MpcReadMethod = (typeof MPC_READ_METHODS)[number];
export type MpcErrorCode =
  | "INVALID_CONFIG" | "INVALID_ACCOUNT" | "INVALID_PATH"
  | "WRONG_NETWORK" | "READ_FAILED" | "INVALID_RESPONSE"
  | "INVALID_PUBLIC_KEY" | "INVALID_TWEAK" | "DERIVATION_MISMATCH"
  | "UNSUPPORTED_STATE" | "INVALID_DOMAIN" | "ROOT_KEY_MISMATCH";

export class MpcReadOnlyError extends Error {
  constructor(public readonly code: MpcErrorCode, message: string) {
    super(message);
    this.name = "MpcReadOnlyError";
  }
}

export interface MpcViewRequest {
  contractId: string;
  method: MpcReadMethod;
  args: Record<string, string | number>;
  blockQuery: { blockId: string };
}

/** Narrow transport for offline fixtures; the client never exposes the SDK provider. */
export interface MpcViewTransport {
  viewNodeStatus(): Promise<unknown>;
  viewBlock(query: { finality: "final" }): Promise<unknown>;
  callFunction(request: MpcViewRequest): Promise<unknown>;
}

export interface MpcInspection {
  networkId: "testnet";
  contractId: typeof MPC_TESTNET_CONTRACT;
  domainId: typeof MPC_ECDSA_DOMAIN_ID;
  blockHash: string;
  blockHeight: number;
  version: string;
  rootPublicKey: string;
  rootPublicKeySec1: string;
  minimumGasTgas: number;
  domain: {
    id: typeof MPC_ECDSA_DOMAIN_ID;
    protocol: "CaitSith" | "RobustEcdsa";
    purpose: "Sign";
    reconstructionThreshold: number;
    keyEpoch: number;
    keyAttempt: number;
  };
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

export interface MpcDerivation {
  nearAccountId: string;
  derivationPath: string;
  domainId: typeof MPC_ECDSA_DOMAIN_ID;
  blockHash: string;
  blockHeight: number;
  derivedPublicKey: string;
  derivedPublicKeySec1: string;
  evmAddress: string;
  localMatchesContract: true;
}

const SCALAR_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const KDF_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";
const READ_METHOD_SET: ReadonlySet<string> = new Set(MPC_READ_METHODS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateIdentity(accountId: string, path: string): void {
  if (
    typeof accountId !== "string" || accountId.length > 64 ||
    !accountId.endsWith(".testnet") ||
    !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(accountId)
  ) {
    throw new MpcReadOnlyError("INVALID_ACCOUNT", "An explicit, valid NEAR .testnet account ID is required.");
  }
  // Project constraint; preserve the exact path rather than trimming or normalizing it.
  if (typeof path !== "string" || !/^[\x21-\x7e]{1,256}$/.test(path)) {
    throw new MpcReadOnlyError("INVALID_PATH", "The derivation path must contain 1–256 visible ASCII characters without spaces.");
  }
}

function secpPublicKey(value: unknown): string {
  try {
    if (typeof value !== "string" || !value.startsWith("secp256k1:")) throw new Error();
    const key = PublicKey.fromString(value);
    if (key.keyType !== KeyType.SECP256K1 || key.data.length !== 64) throw new Error();
    // NEAR encodes the 64-byte x/y coordinates; Ethers expects SEC1's 0x04 prefix.
    return SigningKey.computePublicKey("0x04" + hexlify(key.data).slice(2), false);
  } catch {
    throw new MpcReadOnlyError("INVALID_PUBLIC_KEY", "The MPC response must contain a valid secp256k1 public key.");
  }
}

export function nearPublicKeyToEvmAddress(publicKey: string): string {
  return computeAddress(secpPublicKey(publicKey));
}

/** Public additive derivation only. This does not generate or possess a private key.
 * Algorithm: near/mpc crates/near-mpc-crypto-types/src/kdf.rs and
 * crates/contract/src/crypto_shared/kdf.rs. NIST SHA3-256 is not Keccak-256.
 */
export function deriveEvmPublicKey(rootPublicKey: string, accountId: string, path: string): string {
  validateIdentity(accountId, path);
  const root = secpPublicKey(rootPublicKey);
  const tweak = "0x" + createHash("sha3-256")
    .update(KDF_PREFIX + accountId + "," + path, "utf8")
    .digest("hex");
  const scalar = BigInt(tweak);
  // Match k256::Scalar::from_repr: reject rather than reduce modulo the order.
  if (scalar >= SCALAR_ORDER) {
    throw new MpcReadOnlyError("INVALID_TWEAK", "The derivation tweak is outside the secp256k1 scalar range.");
  }
  if (scalar === 0n) return root;
  try {
    const tweakPoint = SigningKey.computePublicKey(tweak, false);
    return SigningKey.addPoints(root, tweakPoint, false);
  } catch {
    throw new MpcReadOnlyError("INVALID_TWEAK", "The derived secp256k1 public point is invalid.");
  }
}

/** Public view calls only: no account, credential, signing, or broadcast API. */
export class ReadOnlyMpcClient {
  readonly #transport: MpcViewTransport;
  #inspection: Promise<MpcInspection> | undefined;

  constructor(
    options: { rpcUrl: string; contractId?: string; domainId?: number },
    transport?: MpcViewTransport,
  ) {
    if (
      (options.contractId ?? MPC_TESTNET_CONTRACT) !== MPC_TESTNET_CONTRACT ||
      (options.domainId ?? MPC_ECDSA_DOMAIN_ID) !== MPC_ECDSA_DOMAIN_ID
    ) {
      throw new MpcReadOnlyError("INVALID_CONFIG", "Only the testnet MPC contract and ECDSA domain 0 are allowed.");
    }
    try {
      const url = new URL(options.rpcUrl);
      if (
        url.protocol !== "https:" || url.username || url.password || url.hash ||
        url.hostname.toLowerCase().includes("mainnet")
      ) throw new Error();
    } catch {
      throw new MpcReadOnlyError("INVALID_CONFIG", "Use an HTTPS NEAR testnet RPC URL without embedded credentials or a fragment.");
    }
    if (transport) {
      this.#transport = transport;
    } else {
      const provider = new JsonRpcProvider(
        { url: options.rpcUrl },
        { retries: 2, wait: 100, backoff: 2 },
      );
      this.#transport = {
        viewNodeStatus: () => provider.viewNodeStatus(),
        viewBlock: (query) => provider.viewBlock(query),
        callFunction: (request) => provider.callFunction(request),
      };
    }
  }

  async #read<T>(operation: () => Promise<T>, label: string): Promise<T> {
    try {
      return await operation();
    } catch {
      // RPC errors can contain credential-bearing URLs. Keep them out of output.
      throw new MpcReadOnlyError("READ_FAILED", "The public NEAR RPC " + label + " read failed.");
    }
  }

  async #view(method: MpcReadMethod, args: Record<string, string | number>, blockHash: string): Promise<unknown> {
    if (!READ_METHOD_SET.has(method)) {
      throw new MpcReadOnlyError("INVALID_CONFIG", "The MPC method is not an allowed public view.");
    }
    return this.#read(() => this.#transport.callFunction({
      contractId: MPC_TESTNET_CONTRACT,
      method,
      args,
      blockQuery: { blockId: blockHash },
    }), method);
  }

  async #inspect(): Promise<MpcInspection> {
    const status = await this.#read(() => this.#transport.viewNodeStatus(), "status");
    if (!isRecord(status) || status.chain_id !== "testnet") {
      throw new MpcReadOnlyError("WRONG_NETWORK", "The NEAR RPC must report chain_id testnet.");
    }
    const block = await this.#read(() => this.#transport.viewBlock({ finality: "final" }), "finalized block");
    const header = isRecord(block) && isRecord(block.header) ? block.header : undefined;
    if (
      !header || typeof header.hash !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(header.hash) ||
      typeof header.height !== "number" || !Number.isSafeInteger(header.height) || header.height < 1
    ) {
      throw new MpcReadOnlyError("INVALID_RESPONSE", "The NEAR RPC returned an invalid finalized block.");
    }
    const blockHash = header.hash;
    const [version, config, state, rootPublicKey] = await Promise.all([
      this.#view("version", {}, blockHash),
      this.#view("config", {}, blockHash),
      this.#view("state", {}, blockHash),
      this.#view("public_key", { domain_id: MPC_ECDSA_DOMAIN_ID }, blockHash),
    ]);
    if (
      typeof version !== "string" || version.length === 0 || version.length > 128 ||
      !isRecord(config) || !isRecord(state)
    ) {
      throw new MpcReadOnlyError("INVALID_RESPONSE", "The MPC version, config, or state view has an unsupported response shape.");
    }
    const rootPublicKeySec1 = secpPublicKey(rootPublicKey);
    const minimumGasTgas = config.sign_call_gas_attachment_requirement_tera_gas;
    if (typeof minimumGasTgas !== "number" || !Number.isSafeInteger(minimumGasTgas) || minimumGasTgas < 1) {
      throw new MpcReadOnlyError("INVALID_RESPONSE", "The MPC config does not expose a valid signing gas requirement.");
    }
    if (!isRecord(state.Running)) {
      throw new MpcReadOnlyError("UNSUPPORTED_STATE", "The MPC contract must expose the verified Running state schema.");
    }
    const running = state.Running;
    const registry = running.domains;
    const keyset = running.keyset;
    if (
      !isRecord(registry) || !Array.isArray(registry.domains) ||
      !isRecord(keyset) || !Array.isArray(keyset.domains) ||
      typeof keyset.epoch_id !== "number" || !Number.isSafeInteger(keyset.epoch_id) || keyset.epoch_id < 0
    ) {
      throw new MpcReadOnlyError("INVALID_DOMAIN", "The MPC domain registry or keyset has an unsupported response shape.");
    }
    const domains = registry.domains.filter((entry: unknown) => isRecord(entry) && entry.id === MPC_ECDSA_DOMAIN_ID);
    const keys = keyset.domains.filter((entry: unknown) => isRecord(entry) && entry.domain_id === MPC_ECDSA_DOMAIN_ID);
    if (domains.length !== 1 || keys.length !== 1) {
      throw new MpcReadOnlyError("INVALID_DOMAIN", "The MPC state must expose exactly one domain 0 and its key.");
    }
    const domain = domains[0] as Record<string, unknown>;
    const domainKey = keys[0] as Record<string, unknown>;
    const protocol = domain.protocol;
    const reconstructionThreshold = domain.reconstruction_threshold;
    const keyAttempt = domainKey.attempt;
    if (
      (protocol !== "CaitSith" && protocol !== "RobustEcdsa") || domain.purpose !== "Sign" ||
      typeof reconstructionThreshold !== "number" || !Number.isSafeInteger(reconstructionThreshold) ||
      reconstructionThreshold < 2 ||
      typeof keyAttempt !== "number" || !Number.isSafeInteger(keyAttempt) || keyAttempt < 0 ||
      !isRecord(domainKey.key) || !isRecord(domainKey.key.Secp256k1)
    ) {
      throw new MpcReadOnlyError("INVALID_DOMAIN", "Domain 0 must be a supported secp256k1 signing domain.");
    }
    const keysetPoint = secpPublicKey(domainKey.key.Secp256k1.near_public_key);
    if (keysetPoint !== rootPublicKeySec1) {
      throw new MpcReadOnlyError("ROOT_KEY_MISMATCH", "The public_key view does not match domain 0 in the MPC keyset.");
    }
    return Object.freeze<MpcInspection>({
      networkId: "testnet", contractId: MPC_TESTNET_CONTRACT, domainId: MPC_ECDSA_DOMAIN_ID,
      blockHash, blockHeight: header.height, version, rootPublicKey: rootPublicKey as string,
      rootPublicKeySec1, minimumGasTgas,
      domain: {
        id: MPC_ECDSA_DOMAIN_ID, protocol, purpose: "Sign",
        reconstructionThreshold, keyEpoch: keyset.epoch_id, keyAttempt,
      },
      config, state,
    });
  }

  inspect(): Promise<MpcInspection> {
    this.#inspection ??= this.#inspect();
    return this.#inspection;
  }

  async derive(accountId: string, path: string): Promise<MpcDerivation> {
    validateIdentity(accountId, path);
    const inspection = await this.inspect();
    const derivedPublicKey = await this.#view("derived_public_key", {
      predecessor: accountId, path, domain_id: MPC_ECDSA_DOMAIN_ID,
    }, inspection.blockHash);
    const contractPoint = secpPublicKey(derivedPublicKey);
    const localPoint = deriveEvmPublicKey(inspection.rootPublicKey, accountId, path);
    if (contractPoint !== localPoint) {
      throw new MpcReadOnlyError("DERIVATION_MISMATCH", "Local derivation does not match the MPC derived_public_key view.");
    }
    return {
      nearAccountId: accountId, derivationPath: path, domainId: MPC_ECDSA_DOMAIN_ID,
      blockHash: inspection.blockHash, blockHeight: inspection.blockHeight,
      derivedPublicKey: derivedPublicKey as string, derivedPublicKeySec1: localPoint,
      evmAddress: computeAddress(localPoint), localMatchesContract: true,
    };
  }
}
