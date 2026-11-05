import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Interface } from "ethers";
import { assembleSignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { encodeState, type ExecutionState } from "../../src/execution/state.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../../src/near/identities.js";
import { normalizeMpcOutcome } from "../../src/near/signing.js";
import {
  RECOVERY_CREATED_AT, RECOVERY_NEAR_HASH, RECOVERY_SIGNED_HASH, RECOVERY_UNSIGNED_HASH,
  RecoveryBroadcastError, broadcastRecoveredTransfer, encodeRecoveryBroadcastAudit,
  inspectRecoveryBroadcast, recoveryBroadcastAuditSha256,
  type RecoveryBroadcastAudit, type RecoveryBroadcastPorts, type RecoveryReadPorts,
} from "../../src/execution/recovery-broadcast.js";
import { recordedOutcome, recordedState, RECORDED_PUBLIC_KEY } from "./fixtures/recorded-mpc.js";

const TOKEN = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
const BLOCK_HASH = "0x" + "34".repeat(32);
const abi = new Interface(["function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)", "function transfer(address,uint256) returns(bool)"]);
const q = (value: bigint) => `0x${value.toString(16)}`;
const approval = { nearRpcUrl: "offline-public-fixture", approval: RECOVERY_SIGNED_HASH, expiredPreparationAcknowledgment: RECOVERY_CREATED_AT };
const isCode = (code: string) => (error: unknown) => error instanceof RecoveryBroadcastError && error.code === code;

/** Only reconstructs the existing public MPC signature; never signs or invokes a live transport. */
function signedState(): ExecutionState {
  const value = recordedState(), outcome = recordedOutcome();
  const signature = normalizeMpcOutcome(outcome, "treasury", RECOVERY_NEAR_HASH, RECOVERY_UNSIGNED_HASH);
  value.signed = assembleSignedErc20Transfer(value.preflight.prepared, signature, VERIFIED_IDENTITIES.treasury.evmAddress);
  value.nearOutcome = outcome; value.status = "signed"; delete value.recovery;
  return value;
}
interface Options {
  nonce?: bigint; lateNonce?: bigint; baseFee?: bigint; gas?: bigint; treasuryLink?: bigint; nativeBalance?: bigint;
  knownTransaction?: boolean; knownReceipt?: boolean; codeChanged?: boolean; reorgAtFinalRead?: boolean;
  wrongFreshSignature?: boolean; readLatencyMs?: number; failAuditSave?: boolean; auditSaveLatencyMs?: number;
  failStateSave?: boolean; stateSaveLatencyMs?: number; timeoutSend?: boolean; wrongReturnedHash?: boolean; failPostSendSave?: boolean;
}
function fixture(value: ExecutionState, options: Options = {}) {
  const counts = { verify: 0, outcome: 0, audits: 0, saves: 0, sends: 0 };
  const audits: RecoveryBroadcastAudit[] = [], saved: ExecutionState[] = [], events: string[] = [];
  let time = Date.parse("2026-11-05T00:00:00Z"), canonicalReads = 0;
  const blockNumber = value.preflight.blockNumber + 10n;
  const ports: RecoveryBroadcastPorts = {
    now: () => time,
    async verifyMpc() {
      counts.verify++; time += options.readLatencyMs ?? 0;
      return {
        role: "treasury", accessPublicKey: VERIFIED_IDENTITIES.treasury.accessPublicKey, accessKeyNonce: "1",
        inspection: { networkId: "testnet", contractId: "v1.signer-prod.testnet", domainId: 0, rootPublicKey: VERIFIED_MPC_ROOT,
          version: "3.18.0", blockHash: "1".repeat(32), blockHeight: 275_900_000 },
        derivation: { nearAccountId: VERIFIED_IDENTITIES.treasury.accountId, derivationPath: "wealthpixels/sepolia/v1", domainId: 0,
          derivedPublicKeySec1: RECORDED_PUBLIC_KEY, evmAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
          blockHash: "1".repeat(32), blockHeight: 275_900_000, localMatchesContract: true },
      } as Awaited<ReturnType<RecoveryReadPorts["verifyMpc"]>>;
    },
    async readOutcome(role, hash) {
      counts.outcome++; assert.equal(role, "treasury"); assert.equal(hash, RECOVERY_NEAR_HASH);
      const outcome = recordedOutcome();
      if (options.wrongFreshSignature) {
        const signature = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"));
        signature.recovery_id = 1; outcome.status.SuccessValue = Buffer.from(JSON.stringify(signature)).toString("base64");
      }
      return outcome;
    },
    evm: { async request(method, params) {
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "eth_getBlockByNumber") {
        if (params[0] !== "latest") canonicalReads++;
        return { number: q(blockNumber), hash: options.reorgAtFinalRead && canonicalReads >= 2 ? "0x" + "56".repeat(32) : BLOCK_HASH, baseFeePerGas: q(options.baseFee ?? 16n) };
      }
      if (method === "eth_getCode") return params[0] === TOKEN ? options.codeChanged ? "0x6000" : value.preflight.snapshot.tokenCode : "0x";
      if (method === "eth_getBalance") return q(options.nativeBalance ?? 50_000_000_000_000_000n);
      if (method === "eth_getTransactionCount") return q(options.lateNonce !== undefined && params[1] === "latest" ? options.lateNonce : options.nonce ?? 0n);
      if (method === "eth_estimateGas") return q(options.gas ?? 142_020n);
      if (method === "eth_getTransactionByHash") return options.knownTransaction ? { hash: RECOVERY_SIGNED_HASH } : null;
      if (method === "eth_getTransactionReceipt") return options.knownReceipt ? { transactionHash: RECOVERY_SIGNED_HASH } : null;
      if (method === "eth_call") {
        const call = abi.parseTransaction({ data: (params[0] as { data: string }).data })!;
        if (call.name === "decimals") return abi.encodeFunctionResult("decimals", [18]);
        if (call.name === "transfer") return abi.encodeFunctionResult("transfer", [true]);
        return abi.encodeFunctionResult("balanceOf", [call.args[0] === VERIFIED_IDENTITIES.treasury.evmAddress ? options.treasuryLink ?? 25n * 10n ** 18n : 0n]);
      }
      throw new Error("Unexpected offline public-read method");
    } },
    async saveAudit(audit) {
      events.push("audit"); counts.audits++;
      if (options.failAuditSave) throw new Error("Private audit path must not escape");
      audits.push(structuredClone(audit)); time += options.auditSaveLatencyMs ?? 0;
    },
    async save(candidate) {
      counts.saves++; events.push(`save:${candidate.status}`);
      if (options.failStateSave || (options.failPostSendSave && counts.saves > 1)) throw new Error("Private state path must not escape");
      saved.push(structuredClone(candidate));
      if (counts.saves === 1) time += options.stateSaveLatencyMs ?? 0;
    },
    broadcast: { async sendRawTransaction(bytes) {
      counts.sends++; events.push("send"); assert.equal(bytes, value.signed!.serialized);
      if (options.timeoutSend) throw new Error("Private submission endpoint timeout");
      return options.wrongReturnedHash ? "0x" + "00".repeat(32) : RECOVERY_SIGNED_HASH;
    } },
  };
  return { ports, counts, audits, saved, events, setTime: (value: number) => { time = value; } };
}
function readsOnly(ports: RecoveryBroadcastPorts): RecoveryReadPorts {
  return { evm: ports.evm, verifyMpc: ports.verifyMpc, readOutcome: ports.readOutcome, now: ports.now };
}

test("recorded recovery inspection uses only public read ports and preserves operation state", async () => {
  const value = signedState(), before = encodeState(value), f = fixture(value);
  const ports = new Proxy(readsOnly(f.ports), { get(target, key, receiver) {
    if (["save", "saveAudit", "broadcast", "prepareSigning", "sign"].includes(String(key))) throw new Error("Mutation capability must not be accessed");
    return Reflect.get(target, key, receiver);
  } });
  const audit = await inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, ports);
  assert.equal(audit.status, "passed"); assert.equal(audit.originalPreparationExpired, true);
  assert.equal(audit.originalCreatedAt, RECOVERY_CREATED_AT); assert.equal(audit.unsignedHash, RECOVERY_UNSIGNED_HASH);
  assert.equal(audit.signedTransactionHash, RECOVERY_SIGNED_HASH); assert.equal(audit.near.recoveredPublicKeySec1, RECORDED_PUBLIC_KEY);
  assert.equal(audit.evm.gasEstimate, "142020"); assert.equal(audit.evm.baseFeePerGasWei, "16");
  assert.equal(audit.evm.maximumFeeWei, "175195872"); assert.equal(audit.evm.knownTransaction, false); assert.equal(audit.evm.knownReceipt, false);
  assert.equal(audit.evm.tokenCodeHash, "0xcafbd9135200b24454a9ffcac5a8db40947a17f8a8a542062d0f1fb48bd8b269");
  assert.equal(audit.approvedSignedHash, undefined); assert.ok(Object.isFrozen(audit) && Object.isFrozen(audit.evm));
  assert.equal(encodeState(value), before); assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
  assert.equal(recoveryBroadcastAuditSha256(audit), createHash("sha256").update(encodeRecoveryBroadcastAudit(audit)).digest("hex"));
});

test("exact signed-hash approval and original timestamp acknowledgement are required before reads", async () => {
  for (const input of [{ ...approval, approval: "wrong" }, { ...approval, expiredPreparationAcknowledgment: "wrong" }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value);
    await assert.rejects(broadcastRecoveredTransfer(value, input, f.ports), isCode("INVALID_APPROVAL"));
    assert.equal(encodeState(value), before); assert.deepEqual(f.counts, { verify: 0, outcome: 0, audits: 0, saves: 0, sends: 0 });
  }
});

test("changed original intent, signer, hashes, creation time, code or fee caps fail before public reads", async () => {
  const changes: Array<(value: ExecutionState) => void> = [
    value => { value.nearTransactionHash = "1".repeat(32); },
    value => { value.createdAt = "2026-11-04T22:05:28.618Z"; },
    value => { value.signed = { ...value.signed!, hash: "0x" + "00".repeat(32) }; },
    value => { value.signed = { ...value.signed!, senderAddress: VERIFIED_IDENTITIES.investor.evmAddress }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, nonce: 1 } }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, tokenAddress: VERIFIED_IDENTITIES.investor.evmAddress } }; },
    value => { value.preflight = { ...value.preflight, prepared: { ...value.preflight.prepared, amount: 1n } }; },
    value => { value.preflight = { ...value.preflight, policy: { ...value.preflight.policy, maxTotalFeeWei: value.preflight.policy.maxTotalFeeWei + 1n } }; },
    value => { value.preflight = { ...value.preflight, snapshot: { ...value.preflight.snapshot, tokenCode: "0x6000" } }; },
    value => { value.recoveryBroadcastAudit = { auditSha256: "0".repeat(64), checkedAt: "2026-11-05T00:00:00Z", expiredPreparationAcknowledgment: RECOVERY_CREATED_AT, approvedSignedHash: RECOVERY_SIGNED_HASH }; },
  ];
  for (const change of changes) {
    const value = signedState(); change(value); const before = encodeState(value), f = fixture(value);
    await assert.rejects(inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports)), isCode("INVALID_STATE"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.verify + f.counts.sends + f.counts.saves + f.counts.audits, 0);
  }
});

test("saved and fresh MPC signatures must both prove the original full public key and exact bytes", async () => {
  for (const badSaved of [false, true]) {
    const value = signedState();
    if (badSaved) {
      const outcome = value.nearOutcome as ReturnType<typeof recordedOutcome>;
      const signature = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"));
      signature.recovery_id = 1; outcome.status.SuccessValue = Buffer.from(JSON.stringify(signature)).toString("base64");
    }
    const before = encodeState(value), f = fixture(value, { wrongFreshSignature: !badSaved });
    await assert.rejects(inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports)), isCode(badSaved ? "INVALID_STATE" : "PROOF_MISMATCH"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
  }
});

test("fresh nonce, inventory, gas, fixed-fee coverage and code guards reject submission", async () => {
  for (const options of [{ nonce: 1n }, { baseFee: 29n }, { gas: 170_425n }, { treasuryLink: 0n }, { nativeBalance: 1n }, { codeChanged: true }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value, options);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("PREFLIGHT_FAILED"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
  }
  const value = signedState(), f = fixture(value, { lateNonce: 1n });
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("NONCE_CHANGED"));
  assert.equal(f.counts.sends, 0);
});

test("existing transaction or receipt, and a changed canonical block, require read-only reconciliation", async () => {
  for (const options of [{ knownTransaction: true }, { knownReceipt: true }, { reorgAtFinalRead: true }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value, options);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode(options.reorgAtFinalRead ? "PREFLIGHT_FAILED" : "ALREADY_KNOWN"));
    assert.equal(encodeState(value), before); assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
  }
});

test("audit freshness includes the entire public read sequence rather than starting afterward", async () => {
  const value = signedState(), before = encodeState(value), slow = fixture(value, { readLatencyMs: 30_001 });
  await assert.rejects(inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(slow.ports)), isCode("AUDIT_EXPIRED"));
  assert.equal(encodeState(value), before); assert.equal(slow.counts.audits + slow.counts.saves + slow.counts.sends, 0);
  const f = fixture(value, { readLatencyMs: 10_000 });
  const audit = await inspectRecoveryBroadcast(value, { nearRpcUrl: approval.nearRpcUrl }, readsOnly(f.ports));
  assert.equal(Date.parse(audit.completedAt) - Date.parse(audit.checkedAt), 10_000);
  assert.equal(Date.parse(audit.expiresAt) - Date.parse(audit.checkedAt), 30_000);
});

test("exceptional broadcast rejects a preparation whose original expiry has not passed", async () => {
  const value = signedState(), before = encodeState(value), f = fixture(value);
  f.setTime(Date.parse(RECOVERY_CREATED_AT) + 60_000);
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("INVALID_STATE"));
  assert.equal(encodeState(value), before); assert.equal(f.counts.audits + f.counts.saves + f.counts.sends, 0);
});

test("offline successful submission persists its new approval-bound audit and marker before exactly one send", async () => {
  const value = signedState(), original = structuredClone(value), f = fixture(value);
  await broadcastRecoveredTransfer(value, approval, f.ports);
  assert.deepEqual(f.events, ["audit", "save:evm-submitting", "send", "save:evm-submitted"]);
  assert.equal(f.counts.sends, 1); assert.equal(value.status, "evm-submitted");
  assert.equal(value.createdAt, original.createdAt); assert.deepEqual(value.preflight, original.preflight); assert.deepEqual(value.signed, original.signed);
  assert.equal(f.audits[0].approvedSignedHash, RECOVERY_SIGNED_HASH);
  assert.equal(f.audits[0].expiredPreparationAcknowledgment, RECOVERY_CREATED_AT);
  assert.equal(value.recoveryBroadcastAudit!.auditSha256, recoveryBroadcastAuditSha256(f.audits[0]));
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("INVALID_STATE"));
  assert.equal(f.counts.sends, 1);
});

test("audit/state save failures before a durable marker never send and leave original state unchanged", async () => {
  for (const options of [{ failAuditSave: true }, { failStateSave: true }, { auditSaveLatencyMs: 30_001 }]) {
    const value = signedState(), before = encodeState(value), f = fixture(value, options);
    const code = options.failAuditSave ? "AUDIT_SAVE_FAILED" : options.failStateSave ? "STATE_SAVE_FAILED" : "AUDIT_EXPIRED";
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode(code));
    assert.equal(encodeState(value), before); assert.equal(f.counts.sends, 0);
  }
});

test("audit expiry after durable state save retains the submitting marker and never sends", async () => {
  const value = signedState(), original = structuredClone(value), f = fixture(value, { stateSaveLatencyMs: 30_001 });
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("AUDIT_EXPIRED"));
  assert.equal(value.status, "evm-submitting"); assert.equal(f.saved[0].status, "evm-submitting"); assert.equal(f.counts.sends, 0);
  assert.deepEqual(value.preflight, original.preflight); assert.deepEqual(value.signed, original.signed); assert.equal(value.createdAt, original.createdAt);
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("INVALID_STATE"));
});

test("timeout or unexpected returned hash preserves evm-uncertain and cannot retry", async () => {
  for (const options of [{ timeoutSend: true }, { wrongReturnedHash: true }]) {
    const value = signedState(), original = structuredClone(value), f = fixture(value, options);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("SUBMISSION_UNKNOWN"));
    assert.equal(value.status, "evm-uncertain"); assert.equal(f.saved.at(-1)!.status, "evm-uncertain"); assert.equal(f.counts.sends, 1);
    assert.deepEqual(value.preflight, original.preflight); assert.deepEqual(value.signed, original.signed); assert.equal(value.createdAt, original.createdAt);
    assert.match(value.recovery!, /do not retry automatically/);
    await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("INVALID_STATE"));
    assert.equal(f.counts.sends, 1);
  }
});

test("a post-send persistence error leaves the durable submitting marker and never sends twice", async () => {
  const value = signedState(), f = fixture(value, { failPostSendSave: true });
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("STATE_SAVE_FAILED"));
  assert.equal(f.saved.length, 1); assert.equal(f.saved[0].status, "evm-submitting"); assert.equal(f.counts.sends, 1);
  await assert.rejects(broadcastRecoveredTransfer(value, approval, f.ports), isCode("INVALID_STATE"));
  assert.equal(f.counts.sends, 1);
});
