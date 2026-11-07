import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStandaloneNativeIntent, prepareStandaloneNative } from "../../../src/evm/standalone-native.js";
import { createStandaloneNativeState, type StandaloneNativeExecutionPorts, type StandaloneNativeExecutionState,
  type StandaloneNativeApproval } from "../../../src/execution/standalone-native.js";
import { VERIFIED_IDENTITIES } from "../../../src/near/identities.js";
import { nativeSnapshot, nativeObservationRpc } from "./native-delivery.js";

// Fixed synthetic observations and mocked submission capabilities only. This
// fixture generates no keys/signatures and reads no credentials or live RPCs.
// No authentic Treasury-native MPC signature is available yet; the strict
// production workflow has no fixture flag or replaceable crypto validation.
export const STANDALONE_AT = "2026-11-07T00:00:00.000Z";
export const STANDALONE_NEAR_HASH = "1".repeat(32);
export function standaloneExecutionFixture(options: { amountWei?: bigint; nearHash?: string; timeout?: boolean } = {}) {
  const intent = createStandaloneNativeIntent({ testId: "offline-standalone-native", role: "treasury", amountWei: options.amountWei ?? 100_000_000_000_000n });
  const preflight = prepareStandaloneNative(intent, { maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n }, nativeSnapshot());
  const state = createStandaloneNativeState(preflight, intent.intentHash, STANDALONE_AT);
  let clockMs = Date.parse(STANDALONE_AT), submitted = false;
  const clock = { now: () => clockMs, advance(ms: number) { clockMs += ms; }, set(ms: number) { clockMs = ms; } };
  const events: string[] = [], saved: StandaloneNativeExecutionState[] = [];
  const credentialPath = join(tmpdir(), "OFFLINE-NOT-A-CREDENTIAL-TREASURY.json");
  const input: StandaloneNativeApproval & { credentialPath: string } = { role: "treasury", expectedIntentHash: intent.intentHash,
    approval: preflight.prepared.unsignedHash, reference: "SIMULATED offline digest approval; no human/live authorization", nearRpcUrl: "https://example.invalid/offline-only", credentialPath };
  const denied = async (): Promise<never> => { throw new Error("Unexpected offline capability invocation"); };
  const ports: { -readonly [K in keyof StandaloneNativeExecutionPorts]: StandaloneNativeExecutionPorts[K] } = { evm: nativeObservationRpc().rpc, now: clock.now,
    verifyMpc: async () => { events.push("public-mpc-verification"); return { kind: "OFFLINE-PUBLIC-MPC-OBSERVATION" } as any; },
    prepareSigning: async args => {
      events.push("prepare-signing-packet"); assert.equal(args.role, "treasury"); assert.equal(args.credentialPath, credentialPath);
      assert.equal(args.digest, preflight.prepared.unsignedHash);
      return { transactionHash: options.nearHash ?? STANDALONE_NEAR_HASH, signerAccountId: VERIFIED_IDENTITIES.treasury.accountId,
        receiverId: "v1.signer-prod.testnet", request: { payload_v2: { Ecdsa: args.digest.slice(2) }, path: "wealthpixels/sepolia/v1", domain_id: 0 },
        gasTgas: 100, depositYocto: "1", async broadcastOnce() {
          assert.equal(submitted, false, "Offline NEAR capability must be one-use"); submitted = true; events.push("MOCK-near-submit");
          if (options.timeout) throw new Error("Offline submission timeout; never a live call"); return { fixtureOnly: true };
        } };
    },
    readOutcome: denied, broadcast: { sendRawTransaction: denied }, saveAudit: denied,
    async save(next) { events.push(next.status); saved.push(structuredClone(next)); },
  };
  return { intent, preflight, state, clock, events, saved, credentialPath, input, ports };
}
export function standaloneFinalFailure(state: StandaloneNativeExecutionState): unknown {
  return { fixture: "SIMULATED final NEAR failure only; no actual native signing occurred", final_execution_status: "FINAL",
    transaction: { hash: state.nearTransactionHash, signer_id: VERIFIED_IDENTITIES.treasury.accountId,
      public_key: VERIFIED_IDENTITIES.treasury.accessPublicKey, receiver_id: "v1.signer-prod.testnet", actions: [{ FunctionCall: {
        method_name: "sign", gas: 100_000_000_000_000, deposit: "1", args: Buffer.from(JSON.stringify({ request: {
          payload_v2: { Ecdsa: state.preflight.prepared.unsignedHash.slice(2) }, path: "wealthpixels/sepolia/v1", domain_id: 0,
        } })).toString("base64") } }] }, status: { Failure: { fixtureOnly: "simulated execution failure" } } };
}
