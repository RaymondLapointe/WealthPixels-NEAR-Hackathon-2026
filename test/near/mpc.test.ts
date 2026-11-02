import assert from "node:assert/strict";
import { test } from "node:test";
import { getBytes } from "ethers";
import { KeyType, PublicKey } from "near-api-js";
import {
  deriveEvmPublicKey, MPC_READ_METHODS, MPC_TESTNET_CONTRACT, MpcReadOnlyError,
  nearPublicKeyToEvmAddress, ReadOnlyMpcClient,
  type MpcViewRequest, type MpcViewTransport,
} from "../../src/near/mpc.js";

const GENERATOR = "0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" +
  "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
const PATH = "wealthpixels-sepolia-v1";
// Synthetic fixture labels only; these are never supplied to a live RPC.
// Expected points were independently calculated with Python hashlib.sha3_256
// and elementary secp256k1 modular arithmetic from the public generator.
const TREASURY = "fixture-treasury.testnet";
const INVESTOR = "fixture-investor.testnet";
const TREASURY_POINT = "0x0419ce80d74ba0bd5fd443a099751dd91d903d26c7d8129fdcca9ae8cdbe30c14ea5" +
  "c4dbf972ac4f1628cbdceaa2195b0d936ad100f8f0f2cae56916e9e576ec33";
const INVESTOR_POINT = "0x04737857cac0b3c5fba619f698575e3cb2f9af1b8d9d29dd85b3b57fa5e1db1ade3" +
  "072c845de80be425ffb7532b6c342ac424b0a855298b325b16fd2e52d24be24";
const BLOCK_HASH = "11111111111111111111111111111111";

function nearKey(point: string): string {
  return new PublicKey({
    keyType: KeyType.SECP256K1, data: getBytes(point).subarray(1),
  }).toString();
}

function fakeRpc(options: {
  network?: string; wrongDerivedKey?: boolean; failView?: boolean;
  keysetRoot?: string; domainPurpose?: string; minimumGasTgas?: number; notRunning?: boolean;
} = {}) {
  const requests: MpcViewRequest[] = [];
  const blockRequests: unknown[] = [];
  let statusRequests = 0;
  const transport: MpcViewTransport = {
    async viewNodeStatus() {
      statusRequests++;
      return { chain_id: options.network ?? "testnet" };
    },
    async viewBlock(query) {
      blockRequests.push(query);
      return { header: { hash: BLOCK_HASH, height: 101 } };
    },
    async callFunction(request) {
      requests.push(request);
      if (options.failView) throw new Error("private RPC URL must never be surfaced");
      switch (request.method) {
        case "version": return "3.15.1";
        case "config": return { sign_call_gas_attachment_requirement_tera_gas: options.minimumGasTgas ?? 15 };
        case "state": return options.notRunning ? { Resharing: {} } : { Running: {
          domains: { domains: [
            { id: 0, protocol: "CaitSith", purpose: options.domainPurpose ?? "Sign", reconstruction_threshold: 11 },
          ] },
          keyset: { epoch_id: 27, domains: [{
            domain_id: 0, attempt: 1,
            key: { Secp256k1: { near_public_key: options.keysetRoot ?? nearKey(GENERATOR) } },
          }] },
        } };
        case "public_key": return nearKey(GENERATOR);
        case "derived_public_key":
          return nearKey(options.wrongDerivedKey || request.args.predecessor === INVESTOR
            ? INVESTOR_POINT : TREASURY_POINT);
        default: throw new Error("Unexpected method");
      }
    },
  };
  return { transport, requests, blockRequests, statusRequests: () => statusRequests };
}

function isMpcError(code: string) {
  return (error: unknown): boolean => error instanceof MpcReadOnlyError && error.code === code;
}

test("derives exact additive SHA3 public-key fixtures for separate accounts", () => {
  const root = nearKey(GENERATOR);
  assert.equal(deriveEvmPublicKey(root, TREASURY, PATH), TREASURY_POINT);
  assert.equal(deriveEvmPublicKey(root, INVESTOR, PATH), INVESTOR_POINT);
  assert.notEqual(TREASURY_POINT, INVESTOR_POINT);
  assert.equal(nearPublicKeyToEvmAddress(root), "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
});

test("validates key curve and point before computing an EVM address", () => {
  assert.throws(() => nearPublicKeyToEvmAddress("ed25519:" + "1".repeat(32)), isMpcError("INVALID_PUBLIC_KEY"));
  assert.throws(() => nearPublicKeyToEvmAddress("secp256k1:" + "1".repeat(64)), isMpcError("INVALID_PUBLIC_KEY"));
  assert.throws(() => nearPublicKeyToEvmAddress("not a key"), isMpcError("INVALID_PUBLIC_KEY"));
});

test("queries only allowed views with explicit domain, predecessor, and one final block", async () => {
  const fixture = fakeRpc();
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  const [treasury, investor] = await Promise.all([
    client.derive(TREASURY, PATH), client.derive(INVESTOR, PATH),
  ]);
  const inspection = await client.inspect();
  assert.equal(fixture.statusRequests(), 1);
  assert.deepEqual(fixture.blockRequests, [{ finality: "final" }]);
  assert.equal(inspection.networkId, "testnet");
  assert.equal(inspection.rootPublicKeySec1, GENERATOR);
  assert.equal(inspection.minimumGasTgas, 15);
  assert.deepEqual(inspection.domain, {
    id: 0, protocol: "CaitSith", purpose: "Sign", reconstructionThreshold: 11, keyEpoch: 27, keyAttempt: 1,
  });
  assert.equal(treasury.derivedPublicKeySec1, TREASURY_POINT);
  assert.equal(investor.derivedPublicKeySec1, INVESTOR_POINT);
  assert.equal(treasury.localMatchesContract, true);
  assert.notEqual(treasury.evmAddress, investor.evmAddress);
  assert.equal(fixture.requests.length, 6);
  for (const request of fixture.requests) {
    assert.ok(MPC_READ_METHODS.includes(request.method));
    assert.equal(request.contractId, MPC_TESTNET_CONTRACT);
    assert.deepEqual(request.blockQuery, { blockId: BLOCK_HASH });
  }
  assert.deepEqual(fixture.requests.find((r) => r.method === "public_key")?.args, { domain_id: 0 });
  assert.deepEqual(fixture.requests.filter((r) => r.method === "derived_public_key").map((r) => r.args), [
    { predecessor: TREASURY, path: PATH, domain_id: 0 },
    { predecessor: INVESTOR, path: PATH, domain_id: 0 },
  ]);
});

test("rejects a mainnet RPC response before block or contract queries", async () => {
  const fixture = fakeRpc({ network: "mainnet" });
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  await assert.rejects(client.inspect(), isMpcError("WRONG_NETWORK"));
  assert.equal(fixture.blockRequests.length, 0);
  assert.equal(fixture.requests.length, 0);
});

test("rejects invalid identities and paths before contacting the RPC", async () => {
  const fixture = fakeRpc();
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  for (const account of ["example.near", "upperCase.testnet", "a..testnet", "ed25519:secret"]) {
    await assert.rejects(client.derive(account, PATH), isMpcError("INVALID_ACCOUNT"));
  }
  for (const path of ["", " changed ", "bad\npath"]) {
    await assert.rejects(client.derive(TREASURY, path), isMpcError("INVALID_PATH"));
  }
  assert.equal(fixture.statusRequests(), 0);
});

test("rejects a contract key that differs from independent local derivation", async () => {
  const fixture = fakeRpc({ wrongDerivedKey: true });
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  await assert.rejects(client.derive(TREASURY, PATH), isMpcError("DERIVATION_MISMATCH"));
});

test("rejects mainnet contract/domain and unsafe RPC configuration", () => {
  for (const options of [
    { rpcUrl: "https://rpc.testnet.near.org", contractId: "v1.signer" },
    { rpcUrl: "https://rpc.testnet.near.org", domainId: 1 },
    { rpcUrl: "https://rpc.mainnet.near.org" },
    { rpcUrl: "http://rpc.testnet.near.org" },
    { rpcUrl: "https://user:password@rpc.testnet.near.org" },
  ]) {
    assert.throws(() => new ReadOnlyMpcClient(options), isMpcError("INVALID_CONFIG"));
  }
});

test("does not expose provider, arbitrary calls, signing, or broadcast methods", () => {
  const fixture = fakeRpc();
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  assert.deepEqual(Object.getOwnPropertyNames(ReadOnlyMpcClient.prototype).sort(), ["constructor", "derive", "inspect"]);
  for (const name of ["provider", "callFunction", "sign", "broadcast", "sendTransaction"]) {
    assert.equal(name in client, false);
  }
});

test("keeps potentially sensitive RPC error details out of surfaced failures", async () => {
  const fixture = fakeRpc({ failView: true });
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  await assert.rejects(client.inspect(), (error: unknown) =>
    error instanceof MpcReadOnlyError && error.code === "READ_FAILED" &&
    !error.message.includes("private RPC URL"));
});

test("rejects a root that disagrees with the domain keyset", async () => {
  const fixture = fakeRpc({ keysetRoot: nearKey(INVESTOR_POINT) });
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  await assert.rejects(client.inspect(), isMpcError("ROOT_KEY_MISMATCH"));
});

test("rejects a non-signing domain and an unsupported protocol state", async () => {
  const domainFixture = fakeRpc({ domainPurpose: "ForeignTx" });
  const domainClient = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, domainFixture.transport);
  await assert.rejects(domainClient.inspect(), isMpcError("INVALID_DOMAIN"));
  const stateFixture = fakeRpc({ notRunning: true });
  const stateClient = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, stateFixture.transport);
  await assert.rejects(stateClient.inspect(), isMpcError("UNSUPPORTED_STATE"));
});

test("rejects an invalid live gas requirement instead of substituting documentation defaults", async () => {
  const fixture = fakeRpc({ minimumGasTgas: 0 });
  const client = new ReadOnlyMpcClient({ rpcUrl: "https://rpc.testnet.near.org" }, fixture.transport);
  await assert.rejects(client.inspect(), isMpcError("INVALID_RESPONSE"));
});
