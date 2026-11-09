import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { baseDecode, baseEncode, PublicKey, SignedTransaction, Signature as NearSignature } from "near-api-js";
import { VERIFIED_IDENTITIES } from "../../../src/near/identities.js";
import {
  observeExperimentA, prepareExperimentA, type ExperimentAPorts, type ExperimentAState,
} from "../../../src/near/experiment-a.js";

/** Entirely synthetic offline observations. No real signer, credentials, RPC or funded account is used. */
export const EXPERIMENT_A_FIXTURE_AT = "2026-11-09T16:30:00.000Z";
export const EXPERIMENT_A_FIXTURE_BLOCK = baseEncode(new Uint8Array(32).fill(2));
export const EXPERIMENT_A_FIXTURE_HEIGHT = 276944000;
export const EXPERIMENT_A_FIXTURE_NONCE = 275946428000001n;
export const EXPERIMENT_A_FIXTURE_BALANCE = 9_999_195_988_080_103_099_999_999n;
export const EXPERIMENT_A_FIXTURE_FEE = 44_636_512_500_000_000_000n;
export const EXPERIMENT_A_FIXTURE_CREDENTIAL = resolve("..", "offline-fixture-credentials", "investor.json");
const PRIMARY = "https://primary.offline.invalid", SECONDARY = "https://secondary.offline.invalid";
const RECEIPT = baseEncode(new Uint8Array(32).fill(4));

export function experimentAFixture() {
  let now = Date.parse(EXPERIMENT_A_FIXTURE_AT);
  const identity = VERIFIED_IDENTITIES.investor;
  const calls: { kind: string; endpoint?: string; method?: string; params?: any }[] = [];
  const saved: ExperimentAState[] = [];
  const control: {
    network: string; nonce: bigint; balance: bigint; extraKey: boolean; key: string; permission: unknown;
    gasPrice: string; config: any; readFailure?: string; sendFailure?: Error; wrongSigner?: boolean;
    signatureValid: boolean; signedTransactionChanged?: boolean; hashChanged?: boolean;
    outcome?: any; secondaryOutcome?: any; outcomeFailure?: Error; secondaryFailure?: Error;
  } = {
    network: "testnet", nonce: EXPERIMENT_A_FIXTURE_NONCE, balance: EXPERIMENT_A_FIXTURE_BALANCE,
    extraKey: false, key: identity.accessPublicKey, permission: "FullAccess", gasPrice: "100000000", signatureValid: true,
    config: { chain_id: "testnet", protocol_version: 88, transaction_validity_period: 86400,
      runtime_config: { storage_amount_per_byte: "10000000000000000000", min_gas_purchase_price: "100000000",
        transaction_costs: { action_receipt_creation_config: { send_sir: 108059500000, execution: 108059500000, send_not_sir: 108059500000 },
          action_creation_config: { transfer_cost: { send_sir: 115123062500, execution: 115123062500, send_not_sir: 115123062500 } },
          pessimistic_gas_price_inflation_ratio: [1, 1] } } },
  };
  let lastSigned: SignedTransaction | undefined;
  let expectedHash: string | undefined;
  const ports: ExperimentAPorts = {
    mode: "offline-fixtures",
    now: () => now,
    async rpc(endpoint, method, params) {
      calls.push({ kind: "rpc", endpoint, method, params });
      if (control.readFailure === method && method !== "send_tx") throw new Error("OFFLINE simulated public read unavailable; secret text must not escape");
      const p = params as any;
      if (method === "status") return { chain_id: control.network, sync_info: { syncing: false, latest_block_height: EXPERIMENT_A_FIXTURE_HEIGHT } };
      if (method === "block") return { header: { hash: EXPERIMENT_A_FIXTURE_BLOCK, height: EXPERIMENT_A_FIXTURE_HEIGHT,
        timestamp_nanosec: String(BigInt(Date.parse(EXPERIMENT_A_FIXTURE_AT)) * 1_000_000n), gas_price: control.gasPrice } };
      if (method === "query" && p.request_type === "view_account") return { amount: control.balance.toString(), locked: "0", storage_usage: 182,
        code_hash: "1".repeat(32), block_height: EXPERIMENT_A_FIXTURE_HEIGHT, block_hash: EXPERIMENT_A_FIXTURE_BLOCK };
      if (method === "query" && p.request_type === "view_access_key_list") {
        const key = { public_key: control.key, access_key: { nonce: control.nonce.toString(), permission: control.permission } };
        return { keys: control.extraKey ? [key, key] : [key], block_height: EXPERIMENT_A_FIXTURE_HEIGHT, block_hash: EXPERIMENT_A_FIXTURE_BLOCK };
      }
      if (method === "EXPERIMENTAL_protocol_config") return structuredClone(control.config);
      if (method === "gas_price") return { gas_price: control.gasPrice };
      if (method === "send_tx") {
        lastSigned = SignedTransaction.decode(new Uint8Array(Buffer.from(p.signed_tx_base64, "base64")));
        expectedHash = baseEncode(createHash("sha256").update(lastSigned.transaction.encode()).digest());
        if (control.sendFailure) throw control.sendFailure;
        control.nonce += 1n; control.balance -= EXPERIMENT_A_FIXTURE_FEE;
        return { final_execution_status: "NONE", transaction: { hash: expectedHash } };
      }
      if (method === "tx") {
        const secondary = endpoint === SECONDARY;
        if (secondary ? control.secondaryFailure : control.outcomeFailure) throw (secondary ? control.secondaryFailure : control.outcomeFailure)!;
        return structuredClone(secondary && control.secondaryOutcome !== undefined ? control.secondaryOutcome : control.outcome ?? outcome(p.tx_hash));
      }
      throw new Error("Unexpected offline RPC method: " + method);
    },
    async loadSigner() {
      calls.push({ kind: "credential-read-mock" });
      return {
        async getPublicKey() { return PublicKey.fromString(control.wrongSigner ? VERIFIED_IDENTITIES.treasury.accessPublicKey : identity.accessPublicKey); },
        async signTransaction(transaction) {
          calls.push({ kind: "local-sign-mock" });
          const txHash = new Uint8Array(createHash("sha256").update(transaction.encode()).digest());
          if (control.hashChanged) txHash[0] ^= 1;
          // A zero-byte signature is an inert fixture; the explicit offline verifier is mocked below.
          return { txHash, signedTransaction: new SignedTransaction({ transaction,
            signature: new NearSignature({ keyType: 0, data: new Uint8Array(64) }) }) };
        },
      };
    },
    verifySignature(publicKey, message, signature) {
      calls.push({ kind: "signature-verify-mock" });
      return control.signatureValid && publicKey === identity.accessPublicKey && message.length === 32 && signature.length === 64;
    },
  };
  function outcome(hash: string) {
    const transferGas = 223182562500;
    const tx = { hash, signer_id: identity.accountId, receiver_id: identity.accountId, public_key: identity.accessPublicKey,
      nonce: (EXPERIMENT_A_FIXTURE_NONCE + 1n).toString(), actions: [{ Transfer: { deposit: "1" } }],
      signature: "ed25519:" + baseEncode(new Uint8Array(64)) };
    return { final_execution_status: "FINAL", status: { SuccessValue: "" }, transaction: tx,
      transaction_outcome: { id: hash, block_hash: EXPERIMENT_A_FIXTURE_BLOCK, outcome: { executor_id: identity.accountId,
        gas_burnt: transferGas, tokens_burnt: "22318256250000000000", logs: [], receipt_ids: [RECEIPT], status: { SuccessReceiptId: RECEIPT } } },
      receipts_outcome: [{ id: RECEIPT, block_hash: EXPERIMENT_A_FIXTURE_BLOCK, outcome: { executor_id: identity.accountId,
        gas_burnt: transferGas, tokens_burnt: "22318256250000000000", logs: [], receipt_ids: [], status: { SuccessValue: "" } } }] };
  }
  return {
    ports, control, calls, saved, primary: PRIMARY, secondary: SECONDARY, outcome,
    clock: { now: () => now, advance(ms: number) { now += ms; } },
    async prepare() {
      const preflight = await observeExperimentA({ primaryRpc: PRIMARY, secondaryRpc: SECONDARY }, ports);
      return prepareExperimentA("experiment-a-investor-offline-001", preflight, now);
    },
    async save(state: ExperimentAState) { calls.push({ kind: "save", params: { status: state.status, stage: state.events.at(-1)?.stage } }); saved.push(structuredClone(state)); },
    count(kind: string) { return calls.filter(call => call.kind === kind).length; },
    sendCount() { return calls.filter(call => call.method === "send_tx").length; },
    get signed() { return lastSigned; },
  };
}
