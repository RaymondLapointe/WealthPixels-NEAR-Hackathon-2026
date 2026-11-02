import assert from "node:assert/strict";
import test from "node:test";
import { computeAddress, getBytes } from "ethers";
import { KeyType, PublicKey } from "near-api-js";
import {
  createDerivationConfiguration, configurationFromPublicEnvironment, DERIVATION_PATH,
} from "../../src/near/config.js";
import {
  createAuthorityManifest, assertAuthorityManifestUnchanged, authorityForRole,
} from "../../src/near/authority.js";
import { deriveEvmPublicKey, type MpcInspection, type MpcDerivation } from "../../src/near/mpc.js";
import { prepareRoleTransferDryRun } from "../../src/evm/dry-run.js";

// Existing public MPC root used only as offline public data; no credentials.
const ROOT = "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3";
const BLOCK = "11111111111111111111111111111111";
function fixture(treasury = "fixture-treasury.testnet", investor = "fixture-investor.testnet") {
  const configuration = createDerivationConfiguration({ treasuryAccountId: treasury, investorAccountId: investor });
  const inspection = {
    networkId: "testnet", contractId: "v1.signer-prod.testnet", domainId: 0,
    blockHash: BLOCK, blockHeight: 1, version: "offline-fixture", rootPublicKey: ROOT,
  } as MpcInspection;
  function result(nearAccountId: string): MpcDerivation {
    const derivedPublicKeySec1 = deriveEvmPublicKey(ROOT, nearAccountId, DERIVATION_PATH);
    const derivedPublicKey = new PublicKey({
      keyType: KeyType.SECP256K1, data: getBytes(derivedPublicKeySec1).slice(1),
    }).toString();
    return {
      nearAccountId, derivationPath: DERIVATION_PATH, domainId: 0,
      blockHash: BLOCK, blockHeight: 1, derivedPublicKey, derivedPublicKeySec1,
      evmAddress: computeAddress(derivedPublicKeySec1), localMatchesContract: true,
    };
  }
  const results = { treasury: result(treasury), investor: result(investor) };
  return { configuration, inspection, results, manifest: createAuthorityManifest(configuration, inspection, results) };
}
test("public account IDs are mandatory, distinct and testnet-scoped", () => {
  assert.throws(() => configurationFromPublicEnvironment({}), /both public/);
  assert.throws(() => createDerivationConfiguration({ treasuryAccountId: "same.testnet", investorAccountId: "same.testnet" }), /distinct/);
  for (const bad of ["example.near", " Invalid.testnet", "<treasury.testnet>", "bad..testnet"]) {
    assert.throws(() => createDerivationConfiguration({ treasuryAccountId: bad, investorAccountId: "valid.testnet" }));
  }
});
test("RPC configuration rejects non-HTTPS, mainnet and embedded credentials", () => {
  for (const rpcUrl of ["http://rpc.testnet.near.org", "https://rpc.mainnet.near.org", "https://user:secret@example.invalid"]) {
    assert.throws(() => createDerivationConfiguration({ treasuryAccountId: "a.testnet", investorAccountId: "b.testnet", rpcUrl }));
  }
});
test("fresh authority manifest binds independent roles to derived keys", () => {
  const { manifest } = fixture();
  assert.notEqual(manifest.roles.treasury.evmAddress, manifest.roles.investor.evmAddress);
  assert.equal(authorityForRole(manifest, "treasury").accountId, "fixture-treasury.testnet");
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.roles.treasury));
  assertAuthorityManifestUnchanged(manifest, fixture().manifest);
});
test("derivation root/domain/path/account/key changes invalidate the binding", () => {
  const { manifest } = fixture();
  for (const changed of [
    { ...manifest, rootPublicKey: "changed" },
    { ...manifest, domainId: 1 },
    { ...manifest, derivationPath: "changed" },
    { ...manifest, roles: { ...manifest.roles, treasury: { ...manifest.roles.treasury, accountId: "changed.testnet" } } },
    fixture("different.testnet").manifest,
  ]) assert.throws(() => assertAuthorityManifestUnchanged(manifest, changed), /configuration changed/);
});
test("manifest creation rejects swapped roles and derivation tampering", () => {
  const { configuration, inspection, results } = fixture();
  assert.throws(() => createAuthorityManifest(configuration, inspection, { treasury: results.investor, investor: results.treasury }), /configured role/);
  assert.throws(() => createAuthorityManifest(configuration, inspection, {
    ...results, treasury: { ...results.treasury, evmAddress: results.investor.evmAddress },
  }), /verification failed/);
});
test("role dry-run is offline, unsigned and cannot request signing or broadcast", () => {
  const { manifest } = fixture();
  const result = prepareRoleTransferDryRun(manifest, "treasury", {
    chainId: 11155111n, tokenAddress: "0x1111111111111111111111111111111111111111",
    amount: 1n, nonce: 0, gasLimit: 65000n,
    maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  });
  assert.equal(result.prepared.senderAddress, manifest.roles.treasury.evmAddress);
  assert.equal(result.prepared.recipientAddress, manifest.roles.investor.evmAddress);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.signingRequested, false);
  assert.equal(result.broadcast, false);
  assert.equal(result.liveObservationsVerified, false);
  assert.equal("serialized" in result, false);
  assert.equal("sign" in result, false);
  assert.equal("broadcastTransaction" in result, false);
});
