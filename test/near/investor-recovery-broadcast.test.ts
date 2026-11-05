import assert from "node:assert/strict";
import test from "node:test";
import { Interface, keccak256 } from "ethers";
import { assembleSignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { encodeState, type ExecutionState } from "../../src/execution/state.js";
import { broadcastTransfer, type ExecutionPorts } from "../../src/execution/workflow.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../../src/near/identities.js";
import { normalizeMpcOutcome } from "../../src/near/signing.js";
import {
  INVESTOR_RECOVERY_CREATED_AT, INVESTOR_RECOVERY_NEAR_HASH, INVESTOR_RECOVERY_SIGNED_HASH,
  INVESTOR_RECOVERY_UNSIGNED_HASH, RECOVERY_SIGNED_HASH, RecoveryBroadcastError,
  broadcastRecoveredTransfer, inspectRecoveryBroadcast, recoveryBroadcastAuditSha256,
  type RecoveryBroadcastAudit, type RecoveryBroadcastPorts, type RecoveryReadPorts,
} from "../../src/execution/recovery-broadcast.js";
import { recordedInvestorState, recordedInvestorOutcome, INVESTOR_PUBLIC_KEY } from "./fixtures/recorded-investor-mpc.js";

const TOKEN = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
const BLOCK_HASH = "0x" + "67".repeat(32);
const abi = new Interface(["function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)", "function transfer(address,uint256) returns(bool)"]);
const q = (value: bigint) => `0x${value.toString(16)}`;
const approval = { nearRpcUrl: "offline-investor-fixture", approval: INVESTOR_RECOVERY_SIGNED_HASH, expiredPreparationAcknowledgment: INVESTOR_RECOVERY_CREATED_AT };
const isCode = (code: string) => (error: unknown) => error instanceof RecoveryBroadcastError && error.code === code;

/** Reassembles the original public signature only; no signer or live provider exists in these tests. */
function signedState(): ExecutionState {
  const value = recordedInvestorState(), outcome = recordedInvestorOutcome();
  const signature = normalizeMpcOutcome(outcome, "investor", INVESTOR_RECOVERY_NEAR_HASH, INVESTOR_RECOVERY_UNSIGNED_HASH);
  value.signed = assembleSignedErc20Transfer(value.preflight.prepared, signature, VERIFIED_IDENTITIES.investor.evmAddress);
  value.nearOutcome = outcome; value.status = "signed"; delete value.recovery;
  return value;
}
interface Options {
  chainId?: bigint; decimals?: number; roleCode?: string;
  nonce?: bigint; lateNonce?: bigint; baseFee?: bigint; gas?: bigint; investorLink?: bigint; nativeBalance?: bigint;
  knownTransaction?: boolean; knownReceipt?: boolean; codeChanged?: boolean; reorg?: boolean;
  wrongSignature?: boolean; wrongRole?: boolean; unfinishedOutcome?: boolean; failedOutcome?: boolean; readLatencyMs?: number;
  failAuditSave?: boolean; failStateSave?: boolean; stateSaveLatencyMs?: number;
  timeoutSend?: boolean; wrongReturnedHash?: boolean; failPostSendSave?: boolean;
}
function fixture(value: ExecutionState, options: Options = {}) {
  const counts = { verifies: 0, outcomes: 0, audits: 0, saves: 0, sends: 0 };
  const audits: RecoveryBroadcastAudit[] = [], saved: ExecutionState[] = [], events: string[] = [];
  let time = Date.parse("2026-11-05T18:00:00Z"), canonicalReads = 0;
  const blockNumber = value.preflight.blockNumber + 10n;
  const ports: RecoveryBroadcastPorts = {
    now: () => time,
    async verifyMpc(role) {
      assert.equal(role, "investor"); counts.verifies++; time += options.readLatencyMs ?? 0;
      return {
        role: options.wrongRole ? "treasury" : "investor", accessPublicKey: VERIFIED_IDENTITIES.investor.accessPublicKey, accessKeyNonce: "276000000000001",
        inspection: { networkId: "testnet", contractId: "v1.signer-prod.testnet", domainId: 0, rootPublicKey: VERIFIED_MPC_ROOT,
          version: "3.18.0", blockHash: "1".repeat(32), blockHeight: 276_400_000 },
        derivation: { nearAccountId: VERIFIED_IDENTITIES.investor.accountId, derivationPath: "wealthpixels/sepolia/v1", domainId: 0,
          derivedPublicKeySec1: INVESTOR_PUBLIC_KEY, evmAddress: VERIFIED_IDENTITIES.investor.evmAddress,
          blockHash: "1".repeat(32), blockHeight: 276_400_000, localMatchesContract: true },
      } as Awaited<ReturnType<RecoveryReadPorts["verifyMpc"]>>;
    },
    async readOutcome(role, hash) {
      assert.equal(role, "investor"); assert.equal(hash, INVESTOR_RECOVERY_NEAR_HASH); counts.outcomes++;
      const outcome = recordedInvestorOutcome();
      if (options.wrongSignature) {
        const signature = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"));
        signature.recovery_id = 1; outcome.status.SuccessValue = Buffer.from(JSON.stringify(signature)).toString("base64");
      }
      if (options.unfinishedOutcome) outcome.final_execution_status = "EXECUTED";
      if (options.failedOutcome) (outcome as { status: unknown }).status = { Failure: { ActionError: { kind: "FunctionCallError" } } };
      return outcome;
    },
    evm: { async request(method, params) {
      if (method === "eth_chainId") return q(options.chainId ?? 11155111n);
      if (method === "eth_getBlockByNumber") {
        if (params[0] !== "latest") canonicalReads++;
        return { number: q(blockNumber), hash: options.reorg && canonicalReads >= 2 ? "0x" + "89".repeat(32) : BLOCK_HASH, baseFeePerGas: q(options.baseFee ?? 19n) };
      }
      if (method === "eth_getCode") return params[0] === TOKEN ? options.codeChanged ? "0x6000" : value.preflight.snapshot.tokenCode : options.roleCode ?? "0x";
      if (method === "eth_getBalance") return q(options.nativeBalance ?? 50_000_000_000_000_000n);
      if (method === "eth_getTransactionCount") return q(options.lateNonce !== undefined && params[1] === "latest" ? options.lateNonce : options.nonce ?? 0n);
      if (method === "eth_estimateGas") return q(options.gas ?? 43_334n);
      if (method === "eth_getTransactionByHash") return options.knownTransaction ? { hash: INVESTOR_RECOVERY_SIGNED_HASH } : null;
      if (method === "eth_getTransactionReceipt") return options.knownReceipt ? { transactionHash: INVESTOR_RECOVERY_SIGNED_HASH, status: "0x1" } : null;
      if (method === "eth_call") {
        const call = abi.parseTransaction({ data: (params[0] as { data: string }).data })!;
        if (call.name === "decimals") return abi.encodeFunctionResult("decimals", [options.decimals ?? 18]);
        if (call.name === "transfer") {
          assert.equal(call.args[0], VERIFIED_IDENTITIES.treasury.evmAddress); assert.equal(call.args[1], 100_000_000_000_000_000n);
          return abi.encodeFunctionResult("transfer", [true]);
        }
        return abi.encodeFunctionResult("balanceOf", [call.args[0] === VERIFIED_IDENTITIES.investor.evmAddress ? options.investorLink ?? 10n ** 18n : 24n * 10n ** 18n]);
      }
      throw new Error("Unexpected offline Investor read");
    } },
    async saveAudit(audit) {
      counts.audits++; events.push("audit");
      if (options.failAuditSave) throw new Error("No raw filesystem information may escape");
      audits.push(structuredClone(audit));
    },
    async save(candidate) {
      counts.saves++; events.push(`save:${candidate.status}`);
      if (options.failStateSave || (options.failPostSendSave && counts.saves > 1)) throw new Error("Offline persistence failure");
      saved.push(structuredClone(candidate)); if (counts.saves === 1) time += options.stateSaveLatencyMs ?? 0;
    },
    broadcast: { async sendRawTransaction(bytes) {
      counts.sends++; events.push("send"); assert.equal(bytes, value.signed!.serialized);
      if (options.timeoutSend) throw new Error("Offline transport uncertainty");
      return options.wrongReturnedHash ? "0x" + "00".repeat(32) : INVESTOR_RECOVERY_SIGNED_HASH;
    } },
  };
  return { ports, counts, audits, saved, events, setTime: (value: number) => { time = value; } };
}
function readsOnly(ports: RecoveryBroadcastPorts): RecoveryReadPorts {
  return { evm: ports.evm, verifyMpc: ports.verifyMpc, readOutcome: ports.readOutcome, now: ports.now };
}

test("authentic Investor recovery inspection binds the recorded MPC result, full public key and 0.1 LINK bytes", async () => {
  const value = signedState(), before = encodeState(value), f = fixture(value);
  const ports = new Proxy(readsOnly(f.ports), { get(target, key, receiver) {
    if (["save", "saveAudit", "broadcast", "prepareSigning", "sign", "credentialPath"].includes(String(key))) throw new Error("Read-only inspection accessed a mutation capability");
    return Reflect.get(target, key, receiver);
  } });
  const audit = await inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, ports);
  assert.equal(audit.kind, "recorded-investor-recovery-broadcast"); assert.equal(audit.role, "investor");
  assert.equal(audit.status, "passed"); assert.equal(audit.originalPreparationExpired, true);
  assert.equal(audit.originalCreatedAt, INVESTOR_RECOVERY_CREATED_AT); assert.equal(audit.nearTransactionHash, INVESTOR_RECOVERY_NEAR_HASH);
  assert.equal(audit.unsignedHash, INVESTOR_RECOVERY_UNSIGNED_HASH); assert.equal(audit.signedTransactionHash, INVESTOR_RECOVERY_SIGNED_HASH);
  assert.equal(keccak256(value.signed!.serialized), INVESTOR_RECOVERY_SIGNED_HASH);
  assert.equal(audit.near.accountId, VERIFIED_IDENTITIES.investor.accountId); assert.equal(audit.near.recoveredPublicKeySec1, INVESTOR_PUBLIC_KEY);
  assert.equal(audit.evm.senderAddress, VERIFIED_IDENTITIES.investor.evmAddress); assert.equal(audit.evm.recipientAddress, VERIFIED_IDENTITIES.treasury.evmAddress);
  assert.equal(audit.evm.amountBaseUnits, "100000000000000000"); assert.equal(audit.evm.gasLimit, "52001");
  assert.equal(audit.evm.maxFeePerGasWei, "5000"); assert.equal(audit.evm.maxPriorityFeePerGasWei, "1000");
  assert.equal(audit.evm.maximumFeeWei, "260005000"); assert.equal(audit.evm.investorLinkBalance, "1000000000000000000");
  assert.equal(audit.evm.treasuryLinkBalance, "24000000000000000000");
  assert.equal(Date.parse(audit.expiresAt) - Date.parse(audit.checkedAt), 30_000);
  assert.equal(encodeState(value), before); assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
});

test("Investor recovery requires its own exact hash and expired timestamp acknowledgement before public reads", async () => {
  for (const input of [
    { ...approval, approval: RECOVERY_SIGNED_HASH }, { ...approval, approval: "" },
    { ...approval, expiredPreparationAcknowledgment: "" },
    { ...approval, expiredPreparationAcknowledgment: "2026-11-05T16:17:00.757Z" },
  ]) {
    const value = signedState(), before = encodeState(value), f = fixture(value);
    await assert.rejects(broadcastRecoveredTransfer(value, input, f.ports), isCode("INVALID_APPROVAL"));
    assert.equal(encodeState(value), before); assert.deepEqual(f.counts, { verifies: 0, outcomes: 0, audits: 0, saves: 0, sends: 0 });
  }
});

test("Investor recovery rejects altered role, intent, bytes, digest, timestamp, limits and attempt markers", async () => {
  const changes: Array<(value: ExecutionState) => void> = [
    value => { value.role = "treasury"; },
    value => { value.nearTransactionHash = "1".repeat(32); },
    value => { value.createdAt = "2026-11-05T16:17:00.757Z"; },
    value => { value.signed = { ...value.signed!, senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress }; },
    value => { value.signed = { ...value.signed!, serialized: value.signed!.serialized.slice(0, -2) + "00" }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, unsignedHash: "0x" + "00".repeat(32) } }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, amount: 1n } }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress } }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, nonce: 1 } }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, maxFeePerGas: 5001n } }; },
    value => { value.preflight = { ...value.preflight, policy: { ...value.preflight.policy, gasLimitCap: 180_001n } }; },
    value => { value.recoveryBroadcastAudit = { auditSha256: "0".repeat(64), checkedAt: "2026-11-05T18:00:00Z", expiredPreparationAcknowledgment: INVESTOR_RECOVERY_CREATED_AT, approvedSignedHash: INVESTOR_RECOVERY_SIGNED_HASH }; },
  ];
  for (const change of changes) {
    const value = signedState(); change(value); const before = encodeState(value), f = fixture(value);
    await assert.rejects(inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports)), isCode("INVALID_STATE"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.verifies + f.counts.outcomes + f.counts.audits + f.counts.saves + f.counts.sends, 0);
  }
});

test("Investor saved and fresh signatures must recover the full expected key and finalized authority", async () => {
  for (const options of [{ wrongSignature: true }, { wrongRole: true }, { unfinishedOutcome: true }, { failedOutcome: true }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value, options);
    await assert.rejects(inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports)), isCode("PROOF_MISMATCH"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.saves + f.counts.sends, 0);
  }
  const value = signedState(), outcome = recordedInvestorOutcome();
  const signature = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"));
  signature.recovery_id = 1; outcome.status.SuccessValue = Buffer.from(JSON.stringify(signature)).toString("base64"); value.nearOutcome = outcome;
  const before = encodeState(value), f = fixture(value);
  await assert.rejects(inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports)), isCode("INVALID_STATE"));
  assert.equal(encodeState(value), before); assert.equal(f.counts.verifies + f.counts.sends, 0);
});

test("Investor current nonce, inventory, ETH, gas, fee and code checks remain strict", async () => {
  for (const options of [{ nonce: 1n }, { baseFee: 4001n }, { gas: 52_002n }, { investorLink: 0n }, { nativeBalance: 1n }, { codeChanged: true }, { chainId: 1n }, { decimals: 6 }, { roleCode: "0x6000" }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value, options);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("PREFLIGHT_FAILED"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
  }
  const value = signedState(), f = fixture(value, { lateNonce: 1n });
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("NONCE_CHANGED")); assert.equal(f.counts.sends, 0);
  const boundary = fixture(signedState(), { baseFee: 4000n });
  assert.equal((await inspectRecoveryBroadcast(signedState(), { nearRpcUrl: approval.nearRpcUrl }, readsOnly(boundary.ports))).evm.baseFeePerGasWei, "4000");
});

test("Investor known transaction, confirmed receipt or reorg cannot trigger a duplicate send", async () => {
  for (const options of [{ knownTransaction: true }, { knownReceipt: true }, { reorg: true }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value, options);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode(options.reorg ? "PREFLIGHT_FAILED" : "ALREADY_KNOWN"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.saves + f.counts.sends, 0);
  }
});

test("repeated Investor read-only inspection is idempotent and never rearms or mutates signed state", async () => {
  const value = signedState(), before = encodeState(value), f = fixture(value);
  const first = await inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports));
  const second = await inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports));
  assert.deepEqual(second, first); assert.equal(encodeState(value), before);
  assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
});

test("ordinary Investor broadcast still enforces the original fifteen-minute freshness window", async () => {
  const value = signedState(), before = encodeState(value), f = fixture(value), originalNow = Date.now;
  const ports: ExecutionPorts = { ...f.ports, async prepareSigning() { throw new Error("Expired ordinary broadcast must not access signing"); } };
  Date.now = () => Date.parse(INVESTOR_RECOVERY_CREATED_AT) + 900_001;
  try {
    await assert.rejects(broadcastTransfer(value, { approval: INVESTOR_RECOVERY_SIGNED_HASH, nearRpcUrl: approval.nearRpcUrl }, ports), /expired/);
  } finally { Date.now = originalNow; }
  assert.equal(encodeState(value), before); assert.equal(f.counts.verifies + f.counts.saves + f.counts.sends, 0);
});

test("Investor exceptional route rejects a still-fresh preparation and stale thirty-second audit", async () => {
  const value = signedState(), before = encodeState(value), fresh = fixture(value);
  fresh.setTime(Date.parse(INVESTOR_RECOVERY_CREATED_AT) + 60_000);
  await assert.rejects(broadcastRecoveredTransfer(value, approval, fresh.ports), isCode("INVALID_STATE"));
  const stale = fixture(value, { readLatencyMs: 30_001 });
  await assert.rejects(broadcastRecoveredTransfer(value, approval, stale.ports), isCode("AUDIT_EXPIRED"));
  assert.equal(encodeState(value), before); assert.equal(fresh.counts.sends + stale.counts.sends + stale.counts.audits, 0);
});

test("mock Investor recovery persists hash-bound audit and submitting marker before exactly one send, with no NEAR signing port", async () => {
  const value = signedState(), original = structuredClone(value), f = fixture(value);
  const ports = new Proxy(f.ports, { get(target, key, receiver) {
    if (["prepareSigning", "sign", "credentialPath", "signer"].includes(String(key))) throw new Error("NEAR signing capability must never be available");
    return Reflect.get(target, key, receiver);
  } });
  await broadcastRecoveredTransfer(value, approval, ports);
  assert.deepEqual(f.events, ["audit", "save:evm-submitting", "send", "save:evm-submitted"]);
  assert.equal(f.counts.sends, 1); assert.equal(value.status, "evm-submitted");
  assert.deepEqual(value.signed, original.signed); assert.deepEqual(value.preflight, original.preflight); assert.equal(value.createdAt, original.createdAt);
  assert.equal(f.audits[0].approvedSignedHash, INVESTOR_RECOVERY_SIGNED_HASH);
  assert.equal(f.audits[0].expiredPreparationAcknowledgment, INVESTOR_RECOVERY_CREATED_AT);
  assert.equal(value.recoveryBroadcastAudit!.auditSha256, recoveryBroadcastAuditSha256(f.audits[0]));
  await assert.rejects(broadcastRecoveredTransfer(value, approval, ports), isCode("INVALID_STATE")); assert.equal(f.counts.sends, 1);
});

test("Investor persistence failures and audit expiry cannot cause an unrecorded or stale send", async () => {
  for (const options of [{ failAuditSave: true }, { failStateSave: true }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value, options);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode(options.failAuditSave ? "AUDIT_SAVE_FAILED" : "STATE_SAVE_FAILED"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.sends, 0);
  }
  const value = signedState(), original = structuredClone(value), f = fixture(value, { stateSaveLatencyMs: 30_001 });
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("AUDIT_EXPIRED"));
  assert.equal(value.status, "evm-submitting"); assert.equal(f.counts.sends, 0);
  assert.deepEqual(value.signed, original.signed); assert.equal(value.createdAt, original.createdAt);
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("INVALID_STATE"));
});

test("Investor timeout, unexpected hash or post-send save failure preserves state and never retries", async () => {
  for (const options of [{ timeoutSend: true }, { wrongReturnedHash: true }, { failPostSendSave: true }]) {
    const value = signedState(), original = structuredClone(value), f = fixture(value, options);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode(options.failPostSendSave ? "STATE_SAVE_FAILED" : "SUBMISSION_UNKNOWN"));
    assert.equal(f.counts.sends, 1); assert.equal(f.saved[0].status, "evm-submitting");
    if (!options.failPostSendSave) assert.equal(value.status, "evm-uncertain");
    assert.deepEqual(value.signed, original.signed); assert.deepEqual(value.preflight, original.preflight); assert.equal(value.createdAt, original.createdAt);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("INVALID_STATE")); assert.equal(f.counts.sends, 1);
  }
});
