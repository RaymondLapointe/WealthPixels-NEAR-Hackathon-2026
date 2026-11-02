import { createHash } from "node:crypto";
import { computeAddress } from "ethers";
import {
  DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID, TARGET_CHAIN_ID,
  type AuthorityRole, type DerivationConfiguration,
} from "./config.js";
import {
  deriveEvmPublicKey, nearPublicKeyToEvmAddress,
  type MpcDerivation, type MpcInspection,
} from "./mpc.js";

export interface PublicAuthority {
  readonly accountId: string;
  readonly publicKey: string;
  readonly evmAddress: string;
}
export interface AuthorityManifest {
  readonly schemaVersion: 1;
  readonly networkId: "testnet";
  readonly contractId: string;
  readonly domainId: number;
  readonly derivationPath: string;
  readonly targetChainId: number;
  readonly rootPublicKey: string;
  readonly roles: Readonly<Record<AuthorityRole, PublicAuthority>>;
  readonly sourceBlock: Readonly<{ hash: string; height: number }>;
  readonly bindingHash: string;
}
function fingerprint(value: Omit<AuthorityManifest, "bindingHash"> | AuthorityManifest): string {
  const canonical = [
    value.schemaVersion, value.networkId, value.contractId, value.domainId,
    value.derivationPath, value.targetChainId, value.rootPublicKey,
    value.roles.treasury.accountId, value.roles.treasury.publicKey, value.roles.treasury.evmAddress,
    value.roles.investor.accountId, value.roles.investor.publicKey, value.roles.investor.evmAddress,
  ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
/** A public authority binding, never a credential/signer container. */
export function createAuthorityManifest(
  configuration: DerivationConfiguration,
  inspection: MpcInspection,
  results: Readonly<Record<AuthorityRole, MpcDerivation>>,
): AuthorityManifest {
  if (configuration.networkId !== "testnet" || configuration.contractId !== MPC_CONTRACT_ID ||
      configuration.domainId !== ECDSA_DOMAIN_ID || configuration.derivationPath !== DERIVATION_PATH ||
      inspection.networkId !== "testnet" || inspection.contractId !== configuration.contractId ||
      inspection.domainId !== configuration.domainId) {
    throw new Error("Derivation configuration does not match the verified MPC inspection.");
  }
  if (configuration.roles.treasury === configuration.roles.investor) {
    throw new Error("Treasury and investor authorities must be distinct.");
  }
  const roles = {} as Record<AuthorityRole, PublicAuthority>;
  for (const role of ["treasury", "investor"] as const) {
    const result = results[role];
    if (result.nearAccountId !== configuration.roles[role] ||
        result.derivationPath !== configuration.derivationPath ||
        result.domainId !== configuration.domainId || result.blockHash !== inspection.blockHash ||
        result.blockHeight !== inspection.blockHeight || result.localMatchesContract !== true) {
      throw new Error("Derived authority does not match its configured role and finalized inspection.");
    }
    const expected = deriveEvmPublicKey(inspection.rootPublicKey, result.nearAccountId, result.derivationPath);
    if (expected.toLowerCase() !== result.derivedPublicKeySec1.toLowerCase() ||
        computeAddress(expected) !== result.evmAddress ||
        nearPublicKeyToEvmAddress(result.derivedPublicKey) !== result.evmAddress) {
      throw new Error("Derived authority public key/address verification failed.");
    }
    roles[role] = Object.freeze({
      accountId: result.nearAccountId, publicKey: result.derivedPublicKey, evmAddress: result.evmAddress,
    });
  }
  if (roles.treasury.evmAddress === roles.investor.evmAddress) {
    throw new Error("Treasury and investor must derive distinct EVM addresses.");
  }
  const manifest = {
    schemaVersion: 1 as const, networkId: "testnet" as const,
    contractId: configuration.contractId, domainId: configuration.domainId,
    derivationPath: configuration.derivationPath, targetChainId: TARGET_CHAIN_ID,
    rootPublicKey: inspection.rootPublicKey, roles: Object.freeze(roles),
    sourceBlock: Object.freeze({ hash: inspection.blockHash, height: inspection.blockHeight }),
  };
  return Object.freeze({ ...manifest, bindingHash: fingerprint(manifest) });
}

export function assertAuthorityManifestUnchanged(expected: AuthorityManifest, current: AuthorityManifest): void {
  if (expected.bindingHash !== fingerprint(expected) || current.bindingHash !== fingerprint(current) ||
      expected.bindingHash !== current.bindingHash) {
    throw new Error("Authority derivation configuration changed; reverify before funding or signing.");
  }
}

export function authorityForRole(manifest: AuthorityManifest, role: AuthorityRole): PublicAuthority {
  if (role !== "treasury" && role !== "investor") throw new Error("Unknown authority role.");
  if (manifest.bindingHash !== fingerprint(manifest)) throw new Error("Authority manifest was changed.");
  return manifest.roles[role];
}
