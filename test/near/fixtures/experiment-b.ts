import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { baseEncode, PublicKey, SignedTransaction, Signature as NearSignature } from "near-api-js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../../../src/near/identities.js";
import { deriveEvmPublicKey } from "../../../src/near/mpc.js";
import type { VerifiedMpcEcdsaSignature, VerifiedRoleMpc } from "../../../src/near/signing.js";
import {
  observeExperimentB, prepareExperimentB, type ExperimentBPorts, type ExperimentBState,
} from "../../../src/near/experiment-b.js";

/** Entirely synthetic OFFLINE observations and inert signatures. No file, private seed, live RPC or funded signer is used. */
export const EXPERIMENT_B_FIXTURE_ID = "experiment-b-investor-offline-synthetic-001";
export const EXPERIMENT_B_FIXTURE_AT = "2026-11-09T16:30:00.000Z";
export const EXPERIMENT_B_FIXTURE_BLOCK = baseEncode(new Uint8Array(32).fill(22));
export const EXPERIMENT_B_FIXTURE_HEIGHT = 276944000;
export const EXPERIMENT_B_FIXTURE_NONCE = 275946428000002n;
export const EXPERIMENT_B_FIXTURE_BALANCE = 9_999_151_351_567_603_099_999_999n;
export const EXPERIMENT_B_FIXTURE_FEE_BUDGET = "30000000000000000000000";
export const EXPERIMENT_B_FIXTURE_CREDENTIAL = resolve("..", "OFFLINE-SYNTHETIC-INVALID-credentials", "investor.json");
const PRIMARY = "https://primary.offline.invalid", SECONDARY = "https://secondary.offline.invalid";
const RECEIPT = baseEncode(new Uint8Array(32).fill(24));
const PATH = "wealthpixels/sepolia/v1";
const MPC_CONTRACT = "v1.signer-prod.testnet";
const SYNTHETIC_RESULT = { scheme: "Secp256k1", big_r: { affine_point: "02" + "11".repeat(32) },
  s: { scalar: "0".repeat(63) + "1" }, recovery_id: 0 } as const;

export function experimentBFixture() {
  let now = Date.parse(EXPERIMENT_B_FIXTURE_AT);
  const identity = VERIFIED_IDENTITIES.investor;
  const derived = deriveEvmPublicKey(VERIFIED_MPC_ROOT, identity.accountId, PATH);
  const rootSec1 = "0x04" + Buffer.from(PublicKey.fromString(VERIFIED_MPC_ROOT).data).toString("hex");
  const authority: VerifiedRoleMpc = {
    role: "investor", accessPublicKey: identity.accessPublicKey, accessKeyNonce: EXPERIMENT_B_FIXTURE_NONCE.toString(),
    inspection: { networkId: "testnet", contractId: MPC_CONTRACT, domainId: 0,
      blockHash: EXPERIMENT_B_FIXTURE_BLOCK, blockHeight: EXPERIMENT_B_FIXTURE_HEIGHT,
      version: "3.18.0", rootPublicKey: VERIFIED_MPC_ROOT,
      rootPublicKeySec1: rootSec1,
      minimumGasTgas: 100, domain: { id: 0, protocol: "RobustEcdsa", purpose: "Sign", reconstructionThreshold: 2, keyEpoch: 0, keyAttempt: 0 },
      config: { sign_call_gas_attachment_requirement_tera_gas: 100 }, state: { OFFLINE_SYNTHETIC: true } },
    derivation: { nearAccountId: identity.accountId, derivationPath: PATH, domainId: 0,
      blockHash: EXPERIMENT_B_FIXTURE_BLOCK, blockHeight: EXPERIMENT_B_FIXTURE_HEIGHT,
      derivedPublicKey: "secp256k1:" + baseEncode(Buffer.from(derived.slice(4), "hex")), derivedPublicKeySec1: derived,
      evmAddress: identity.evmAddress, localMatchesContract: true },
  };
  const calls: { kind: string; endpoint?: string; method?: string; params?: any }[] = [];
  const saved: ExperimentBState[] = [];
  const control: {
    network: string; nonce: bigint; balance: bigint; extraKey: boolean; key: string; permission: unknown;
    gasPrice: string; config: any; authority: VerifiedRoleMpc; readFailure?: string; authorityFailure?: boolean;
    sendFailure?: Error; wrongSigner?: boolean; signatureValid: boolean; hashChanged?: boolean;
    signedTransactionChanged?: boolean; outcome?: any; secondaryOutcome?: any;
    outcomeFailure?: Error; secondaryFailure?: Error; mpcVerifyFailure?: boolean;
  } = {
    network: "testnet", nonce: EXPERIMENT_B_FIXTURE_NONCE, balance: EXPERIMENT_B_FIXTURE_BALANCE,
    extraKey: false, key: identity.accessPublicKey, permission: "FullAccess", gasPrice: "100000000", signatureValid: true,
    authority,
    config: { chain_id: "testnet", protocol_version: 88, transaction_validity_period: 86400,
      runtime_config: { storage_amount_per_byte: "10000000000000000000", min_gas_purchase_price: "1000000000",
        transaction_costs: {
          action_receipt_creation_config: { send_sir: 108059500000, execution: 108059500000, send_not_sir: 108059500000 },
          action_creation_config: {
            function_call_cost: { send_sir: 2319861500000, execution: 2319861500000, send_not_sir: 2319861500000 },
            function_call_cost_per_byte: { send_sir: 2235934, execution: 2235934, send_not_sir: 2235934 },
          }, pessimistic_gas_price_inflation_ratio: [1, 1],
        } } },
  };
  let lastSigned: SignedTransaction | undefined;
  let lastDigest: string | undefined;
  const ports: ExperimentBPorts = {
    mode: "offline-fixtures", now: () => now,
    async readAuthority(endpoint) {
      calls.push({ kind: "authority-read-mock", endpoint });
      if (control.authorityFailure) throw new Error("OFFLINE SYNTHETIC authority unavailable");
      const observed = structuredClone(control.authority);
      (observed as any).accessKeyNonce = control.nonce.toString();
      return observed;
    },
    async rpc(endpoint, method, params) {
      calls.push({ kind: "rpc", endpoint, method, params });
      if (control.readFailure === method && method !== "send_tx") throw new Error("OFFLINE SYNTHETIC public read unavailable; untrusted-secret-text");
      const p = params as any;
      if (method === "status") return { chain_id: control.network, sync_info: { syncing: false, latest_block_height: EXPERIMENT_B_FIXTURE_HEIGHT } };
      if (method === "block") return { header: { hash: EXPERIMENT_B_FIXTURE_BLOCK, height: EXPERIMENT_B_FIXTURE_HEIGHT,
        timestamp_nanosec: String(BigInt(Date.parse(EXPERIMENT_B_FIXTURE_AT)) * 1_000_000n), gas_price: control.gasPrice } };
      if (method === "query" && p.request_type === "view_account") return { amount: control.balance.toString(), locked: "0", storage_usage: 182,
        code_hash: "1".repeat(32), block_height: EXPERIMENT_B_FIXTURE_HEIGHT, block_hash: EXPERIMENT_B_FIXTURE_BLOCK };
      if (method === "query" && p.request_type === "view_access_key_list") {
        const key = { public_key: control.key, access_key: { nonce: control.nonce.toString(), permission: control.permission } };
        return { keys: control.extraKey ? [key, key] : [key], block_height: EXPERIMENT_B_FIXTURE_HEIGHT, block_hash: EXPERIMENT_B_FIXTURE_BLOCK };
      }
      if (method === "EXPERIMENTAL_protocol_config") return structuredClone(control.config);
      if (method === "gas_price") return { gas_price: control.gasPrice };
      if (method === "send_tx") {
        lastSigned = SignedTransaction.decode(new Uint8Array(Buffer.from(p.signed_tx_base64, "base64")));
        const call = lastSigned.transaction.actions[0]!.functionCall!;
        lastDigest = "0x" + JSON.parse(Buffer.from(call.args).toString("utf8")).request.payload_v2.Ecdsa;
        if (control.sendFailure) throw control.sendFailure;
        control.nonce += 1n;
        return { final_execution_status: "NONE", transaction: { hash: baseEncode(createHash("sha256").update(lastSigned.transaction.encode()).digest()) } };
      }
      if (method === "tx") {
        const secondary = endpoint === SECONDARY;
        if (secondary ? control.secondaryFailure : control.outcomeFailure) throw (secondary ? control.secondaryFailure : control.outcomeFailure)!;
        return structuredClone(secondary && control.secondaryOutcome !== undefined ? control.secondaryOutcome : control.outcome ?? outcome(p.tx_hash, lastDigest));
      }
      throw new Error("Unexpected OFFLINE SYNTHETIC RPC method: " + method);
    },
    async loadSigner() {
      calls.push({ kind: "credential-read-mock" });
      return {
        async getPublicKey() { return PublicKey.fromString(control.wrongSigner ? VERIFIED_IDENTITIES.treasury.accessPublicKey : identity.accessPublicKey); },
        async signTransaction(transaction) {
          calls.push({ kind: "local-sign-mock" });
          const txHash = new Uint8Array(createHash("sha256").update(transaction.encode()).digest());
          if (control.hashChanged) txHash[0] ^= 1;
          const retained = control.signedTransactionChanged ? Object.assign(transaction, { nonce: transaction.nonce + 1n }) : transaction;
          // Zero Ed25519 bytes are inert: trusted OFFLINE test code explicitly simulates acceptance.
          return { txHash, signedTransaction: new SignedTransaction({ transaction: retained,
            signature: new NearSignature({ keyType: 0, data: new Uint8Array(64) }) }) };
        },
      };
    },
    verifySignature(publicKey, message, signature) {
      calls.push({ kind: "signature-verify-mock" });
      return control.signatureValid && publicKey === identity.accessPublicKey && message.length === 32 && signature.length === 64 && signature.every(byte => byte === 0);
    },
    verifyMpcOutcome(value, hash, digest): VerifiedMpcEcdsaSignature {
      calls.push({ kind: "mpc-verification-mock" });
      // This executable mock port is the sole positive-cryptography substitute. Serialized data cannot enable it.
      // It intentionally does not claim the inert result is a real signature by the unknown Investor MPC private key.
      const result = value as any;
      const request = JSON.parse(Buffer.from(result.transaction.actions[0].FunctionCall.args, "base64").toString("utf8")).request;
      const signature = JSON.parse(Buffer.from(result.status.SuccessValue, "base64").toString("utf8"));
      if (control.mpcVerifyFailure || result.final_execution_status !== "FINAL" || result.transaction.hash !== hash ||
        request.payload_v2.Ecdsa !== digest.slice(2) || JSON.stringify(signature) !== JSON.stringify(SYNTHETIC_RESULT)) {
        throw new Error("OFFLINE SYNTHETIC trusted signature verifier rejected result");
      }
      return structuredClone(SYNTHETIC_RESULT);
    },
  };
  function outcome(hash: string, digest = lastDigest) {
    if (!digest) throw new Error("OFFLINE SYNTHETIC digest required before building an outcome");
    const result = Buffer.from(JSON.stringify(SYNTHETIC_RESULT), "utf8").toString("base64");
    const args = { request: { payload_v2: { Ecdsa: digest.slice(2) }, path: PATH, domain_id: 0 } };
    const tx = { hash, signer_id: identity.accountId, receiver_id: MPC_CONTRACT, public_key: identity.accessPublicKey,
      nonce: (EXPERIMENT_B_FIXTURE_NONCE + 1n).toString(),
      actions: [{ FunctionCall: { method_name: "sign", args: Buffer.from(JSON.stringify(args), "utf8").toString("base64"), gas: 100_000_000_000_000, deposit: "1" } }],
      signature: "ed25519:" + baseEncode(new Uint8Array(64)) };
    return { final_execution_status: "FINAL", status: { SuccessValue: result }, transaction: tx,
      transaction_outcome: { id: hash, block_hash: EXPERIMENT_B_FIXTURE_BLOCK, outcome: { executor_id: identity.accountId,
        gas_burnt: 1_000_000_000_000, tokens_burnt: "100000000000000000000", logs: [], receipt_ids: [RECEIPT], status: { SuccessReceiptId: RECEIPT } } },
      receipts_outcome: [{ id: RECEIPT, block_hash: EXPERIMENT_B_FIXTURE_BLOCK, outcome: { executor_id: MPC_CONTRACT,
        gas_burnt: 7_000_000_000_000, tokens_burnt: "700000000000000000000", logs: [], receipt_ids: [], status: { SuccessValue: result } } }] };
  }
  return {
    ports, control, calls, saved, primary: PRIMARY, secondary: SECONDARY, outcome,
    clock: { now: () => now, advance(ms: number) { now += ms; } },
    async prepare(id = EXPERIMENT_B_FIXTURE_ID) {
      const preflight = await observeExperimentB({ id, feeBudgetYocto: EXPERIMENT_B_FIXTURE_FEE_BUDGET, primaryRpc: PRIMARY, secondaryRpc: SECONDARY }, ports);
      return prepareExperimentB(id, preflight, now);
    },
    async save(state: ExperimentBState) { calls.push({ kind: "save", params: { status: state.status, stage: state.events.at(-1)?.stage } }); saved.push(structuredClone(state)); },
    count(kind: string) { return calls.filter(call => call.kind === kind).length; },
    sendCount() { return calls.filter(call => call.method === "send_tx").length; },
    get signed() { return lastSigned; },
  };
}
