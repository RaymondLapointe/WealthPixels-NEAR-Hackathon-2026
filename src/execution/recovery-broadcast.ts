import { createHash } from "node:crypto";
import { Interface, SigningKey, Transaction, keccak256 } from "ethers";
import { assembleSignedErc20Transfer, normalizeMpcSignature } from "../evm/erc20-transfer.js";
import { authorizeEvmBroadcast, type EvmBroadcastTransport } from "../evm/broadcast.js";
import { assertLinkPreflight, recheckSepoliaLinkTransfer, type SepoliaReadRpc } from "../evm/sepolia-link.js";
import { normalizeMpcOutcome, type readMpcSigningOutcome, type verifyRoleMpc } from "../near/signing.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { deriveEvmPublicKey } from "../near/mpc.js";
import { encodeState, type ExecutionState } from "./state.js";

export const RECOVERY_NEAR_HASH = "8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs";
export const RECOVERY_UNSIGNED_HASH = "0xd092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4";
export const RECOVERY_SIGNED_HASH = "0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719";
export const RECOVERY_CREATED_AT = "2026-11-04T22:05:28.617Z";
const TOKEN = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
const PATH = "wealthpixels/sepolia/v1";
const ORIGINAL_LINK_CODE_HASH = "0xcafbd9135200b24454a9ffcac5a8db40947a17f8a8a542062d0f1fb48bd8b269";
const AUDIT_MAX_AGE_MS = 30_000;
const balancesAbi = new Interface(["function balanceOf(address) view returns(uint256)"]);

export interface RecoveryReadPorts {
  evm: SepoliaReadRpc;
  verifyMpc: typeof verifyRoleMpc;
  readOutcome: typeof readMpcSigningOutcome;
  now?: () => number;
}
export interface RecoveryBroadcastPorts extends RecoveryReadPorts {
  saveAudit(audit: RecoveryBroadcastAudit): Promise<void>;
  save(state: ExecutionState): Promise<void>;
  broadcast: EvmBroadcastTransport;
}
export interface RecoveryBroadcastAudit {
  schemaVersion: 1;
  kind: "recorded-treasury-recovery-broadcast";
  status: "passed";
  checkedAt: string;
  completedAt: string;
  expiresAt: string;
  originalCreatedAt: string;
  originalPreparationExpired: boolean;
  originalStateSha256: string;
  role: "treasury";
  nearTransactionHash: string;
  unsignedHash: string;
  signedTransactionHash: string;
  approvedSignedHash?: string;
  expiredPreparationAcknowledgment?: string;
  near: {
    networkId: "testnet"; accountId: string; accessPublicKey: string; contractId: string;
    domainId: 0; derivationPath: string; rootPublicKey: string; recoveredPublicKeySec1: string;
    mpcVersion: string; mpcBlockHash: string; mpcBlockHeight: number; finalizedAccessKeyNonce: string;
  };
  evm: {
    chainId: "11155111"; tokenAddress: string; senderAddress: string; recipientAddress: string;
    amountBaseUnits: "1000000000000000000"; nonce: "0"; gasLimit: "170424";
    maxFeePerGasWei: "1028"; maxPriorityFeePerGasWei: "1000"; maximumFeeWei: "175195872";
    feePolicy: { gasLimitCap: "180000"; maxFeePerGasCap: "30000000000"; maxTotalFeeWei: "3600000000000000" };
    blockNumber: string; blockHash: string; tokenCodeHash: string; tokenCodeBytes: number;
    senderLinkBalance: string; senderEthBalanceWei: string; investorLinkBalance: string; investorEthBalanceWei: string;
    gasEstimate: string; baseFeePerGasWei: string; confirmedNonce: "0"; pendingNonce: "0";
    knownTransaction: false; knownReceipt: false;
  };
}
export class RecoveryBroadcastError extends Error {
  constructor(readonly code: "INVALID_APPROVAL" | "INVALID_STATE" | "PUBLIC_READ_FAILED" | "PROOF_MISMATCH" |
    "PREFLIGHT_FAILED" | "NONCE_CHANGED" | "ALREADY_KNOWN" | "AUDIT_EXPIRED" | "AUDIT_SAVE_FAILED" |
    "STATE_SAVE_FAILED" | "SUBMISSION_UNKNOWN", message: string) {
    super(message); this.name = "RecoveryBroadcastError";
  }
}
function requireThat(condition: unknown, code: RecoveryBroadcastError["code"], message: string): asserts condition {
  if (!condition) throw new RecoveryBroadcastError(code, message);
}
function clock(ports: RecoveryReadPorts): number {
  const value = ports.now ? ports.now() : Date.now();
  requireThat(Number.isSafeInteger(value) && value >= 0, "INVALID_STATE", "The recovery audit clock is invalid.");
  return value;
}
function quantity(value: unknown): bigint {
  requireThat(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "PUBLIC_READ_FAILED", "Invalid public EVM quantity.");
  const parsed = BigInt(value);
  requireThat(parsed <= (1n << 256n) - 1n, "PUBLIC_READ_FAILED", "Public EVM quantity exceeds uint256.");
  return parsed;
}
function freezeAudit<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeAudit); Object.freeze(value);
  }
  return value;
}
function assertRecordedState(state: ExecutionState): void {
  try {
    assertLinkPreflight(state.preflight);
    const prepared = state.preflight.prepared, limits = state.preflight.policy;
    const tx = Transaction.from(state.signed!.serialized);
    const expected = VERIFIED_IDENTITIES;
    requireThat(state.schemaVersion === 1 && state.role === "treasury" && state.status === "signed" &&
      state.createdAt === RECOVERY_CREATED_AT && state.nearTransactionHash === RECOVERY_NEAR_HASH && state.nearOutcome &&
      state.signed?.hash === RECOVERY_SIGNED_HASH && state.signed.senderAddress === expected.treasury.evmAddress &&
      prepared.unsignedHash === RECOVERY_UNSIGNED_HASH && tx.unsignedHash === RECOVERY_UNSIGNED_HASH &&
      tx.hash === RECOVERY_SIGNED_HASH && keccak256(state.signed.serialized) === RECOVERY_SIGNED_HASH &&
      tx.from === expected.treasury.evmAddress && tx.chainId === 11155111n && tx.type === 2 && tx.nonce === 0 &&
      tx.to === TOKEN && tx.data === prepared.data && tx.value === 0n && tx.accessList?.length === 0 &&
      prepared.tokenAddress === TOKEN && prepared.senderAddress === expected.treasury.evmAddress &&
      prepared.recipientAddress === expected.investor.evmAddress && prepared.amount === 1_000_000_000_000_000_000n &&
      tx.gasLimit === 170_424n && tx.maxFeePerGas === 1_028n && tx.maxPriorityFeePerGas === 1_000n &&
      prepared.maximumFeeWei === 175_195_872n && keccak256(state.preflight.snapshot.tokenCode) === ORIGINAL_LINK_CODE_HASH &&
      state.recoveryBroadcastAudit === undefined && limits.gasLimitCap === 180_000n &&
      limits.maxFeePerGasCap === 30_000_000_000n && limits.maxTotalFeeWei === 3_600_000_000_000_000n && state.receipt === undefined,
    "INVALID_STATE", "This recovery route accepts only the original recorded treasury transaction and unchanged fee caps.");
    const signature = normalizeMpcOutcome(state.nearOutcome, "treasury", RECOVERY_NEAR_HASH, RECOVERY_UNSIGNED_HASH);
    const assembled = assembleSignedErc20Transfer(prepared, signature, expected.treasury.evmAddress);
    requireThat(assembled.hash === RECOVERY_SIGNED_HASH && assembled.serialized === state.signed.serialized,
      "PROOF_MISMATCH", "Saved MPC proof does not authorize the exact recorded EVM bytes.");
  } catch (error) {
    if (error instanceof RecoveryBroadcastError) throw error;
    throw new RecoveryBroadcastError("INVALID_STATE", "The recorded recovery state or saved MPC proof failed validation.");
  }
}
function freshAudit(audit: RecoveryBroadcastAudit, ports: RecoveryReadPorts): void {
  const age = clock(ports) - Date.parse(audit.checkedAt);
  requireThat(age >= 0 && age <= AUDIT_MAX_AGE_MS, "AUDIT_EXPIRED", "The recovery audit exceeded 30 seconds; no submission is permitted from this audit.");
}
export function encodeRecoveryBroadcastAudit(audit: RecoveryBroadcastAudit): string {
  return JSON.stringify(audit, null, 2) + "\n";
}
export function recoveryBroadcastAuditSha256(audit: RecoveryBroadcastAudit): string {
  return createHash("sha256").update(encodeRecoveryBroadcastAudit(audit), "utf8").digest("hex");
}

/** Public reads only. Never accepts a previously generated audit or a signing capability. */
export async function inspectRecoveryBroadcast(
  state: ExecutionState, input: { nearRpcUrl: string }, ports: RecoveryReadPorts,
): Promise<RecoveryBroadcastAudit> {
  const snapshot = structuredClone(state);
  assertRecordedState(snapshot);
  const checkedAt = clock(ports); // Earliest public observation, including read latency in the 30-second budget.
  let verified: Awaited<ReturnType<typeof verifyRoleMpc>>, outcome: unknown;
  try {
    verified = await ports.verifyMpc("treasury", input.nearRpcUrl);
    outcome = await ports.readOutcome("treasury", RECOVERY_NEAR_HASH, input.nearRpcUrl);
  } catch { throw new RecoveryBroadcastError("PUBLIC_READ_FAILED", "Fresh public NEAR/MPC evidence could not be verified; nothing was submitted."); }
  let publicKey: string;
  try {
    const signature = normalizeMpcOutcome(outcome, "treasury", RECOVERY_NEAR_HASH, RECOVERY_UNSIGNED_HASH);
    const normalized = normalizeMpcSignature(signature);
    publicKey = SigningKey.recoverPublicKey(RECOVERY_UNSIGNED_HASH, normalized);
    const expectedKey = deriveEvmPublicKey(VERIFIED_MPC_ROOT, VERIFIED_IDENTITIES.treasury.accountId, PATH);
    const assembled = assembleSignedErc20Transfer(snapshot.preflight.prepared, signature, VERIFIED_IDENTITIES.treasury.evmAddress);
    requireThat(publicKey === expectedKey && assembled.hash === RECOVERY_SIGNED_HASH && assembled.serialized === snapshot.signed!.serialized &&
      verified.role === "treasury" && verified.accessPublicKey === VERIFIED_IDENTITIES.treasury.accessPublicKey &&
      verified.inspection.networkId === "testnet" && verified.inspection.contractId === "v1.signer-prod.testnet" &&
      verified.inspection.domainId === 0 && verified.inspection.rootPublicKey === VERIFIED_MPC_ROOT &&
      verified.derivation.nearAccountId === VERIFIED_IDENTITIES.treasury.accountId &&
      verified.derivation.derivationPath === PATH && verified.derivation.domainId === 0 &&
      verified.derivation.derivedPublicKeySec1 === expectedKey && verified.derivation.evmAddress === VERIFIED_IDENTITIES.treasury.evmAddress &&
      verified.derivation.localMatchesContract === true && verified.derivation.blockHash === verified.inspection.blockHash &&
      verified.derivation.blockHeight === verified.inspection.blockHeight && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(verified.inspection.blockHash) &&
      Number.isSafeInteger(verified.inspection.blockHeight) && verified.inspection.blockHeight > 0 &&
      typeof verified.inspection.version === "string" && verified.inspection.version.length > 0 &&
      typeof verified.accessKeyNonce === "string" && /^(0|[1-9][0-9]*)$/.test(verified.accessKeyNonce),
    "PROOF_MISMATCH", "Fresh MPC evidence differs from the original role, full public key or signed transaction.");
  } catch (error) {
    if (error instanceof RecoveryBroadcastError) throw error;
    throw new RecoveryBroadcastError("PROOF_MISMATCH", "Fresh FINAL MPC evidence does not authorize the recorded recovery transaction.");
  }
  let current: Awaited<ReturnType<typeof recheckSepoliaLinkTransfer>>;
  let confirmedNonce: unknown, pendingNonce: unknown, knownTransaction: unknown, knownReceipt: unknown, investorLink: unknown, investorEth: unknown;
  try {
    current = await recheckSepoliaLinkTransfer(snapshot.preflight, ports.evm);
    const blockTag = `0x${current.blockNumber.toString(16)}`;
    [confirmedNonce, pendingNonce, knownTransaction, knownReceipt, investorLink, investorEth] = await Promise.all([
      ports.evm.request("eth_getTransactionCount", [VERIFIED_IDENTITIES.treasury.evmAddress, "latest"]),
      ports.evm.request("eth_getTransactionCount", [VERIFIED_IDENTITIES.treasury.evmAddress, "pending"]),
      ports.evm.request("eth_getTransactionByHash", [RECOVERY_SIGNED_HASH]),
      ports.evm.request("eth_getTransactionReceipt", [RECOVERY_SIGNED_HASH]),
      ports.evm.request("eth_call", [{ to: TOKEN, data: balancesAbi.encodeFunctionData("balanceOf", [VERIFIED_IDENTITIES.investor.evmAddress]) }, blockTag]),
      ports.evm.request("eth_getBalance", [VERIFIED_IDENTITIES.investor.evmAddress, blockTag]),
    ]);
  } catch { throw new RecoveryBroadcastError("PREFLIGHT_FAILED", "Fresh Sepolia preflight or public transaction lookups failed; nothing was submitted."); }
  requireThat(quantity(confirmedNonce) === 0n && quantity(pendingNonce) === 0n,
    "NONCE_CHANGED", "Treasury confirmed and pending nonces must both remain zero; reconcile instead of submitting.");
  requireThat(knownTransaction === null && knownReceipt === null,
    "ALREADY_KNOWN", "The recorded EVM transaction or receipt is already known; reconcile it without another submission.");
  requireThat(current.snapshot.tokenCode === snapshot.preflight.snapshot.tokenCode && keccak256(current.snapshot.tokenCode) === ORIGINAL_LINK_CODE_HASH,
    "PREFLIGHT_FAILED", "LINK bytecode changed from the original verified preparation.");
  let investorLinkBalance: bigint;
  try {
    requireThat(typeof investorLink === "string", "PUBLIC_READ_FAILED", "Invalid public LINK balance result.");
    investorLinkBalance = balancesAbi.decodeFunctionResult("balanceOf", investorLink)[0];
    requireThat(typeof investorLinkBalance === "bigint" && investorLinkBalance >= 0n, "PUBLIC_READ_FAILED", "Invalid investor LINK balance.");
  } catch { throw new RecoveryBroadcastError("PUBLIC_READ_FAILED", "Fresh investor balance could not be decoded."); }
  try {
    const block = await ports.evm.request("eth_getBlockByNumber", [`0x${current.blockNumber.toString(16)}`, false]);
    requireThat(block && typeof block === "object" && "hash" in block && block.hash === current.blockHash &&
      "number" in block && quantity(block.number) === current.blockNumber,
    "PREFLIGHT_FAILED", "The pinned Sepolia block changed during recovery audit reads.");
  } catch (error) {
    if (error instanceof RecoveryBroadcastError) throw error;
    throw new RecoveryBroadcastError("PREFLIGHT_FAILED", "The final canonical-block recovery check failed.");
  }
  const completedAt = clock(ports), prepared = snapshot.preflight.prepared;
  requireThat(completedAt >= checkedAt && completedAt - checkedAt <= AUDIT_MAX_AGE_MS,
    "AUDIT_EXPIRED", "Recovery public reads exceeded 30 seconds; no passed audit or submission is permitted.");
  return freezeAudit({
    schemaVersion: 1, kind: "recorded-treasury-recovery-broadcast", status: "passed",
    checkedAt: new Date(checkedAt).toISOString(), completedAt: new Date(completedAt).toISOString(), expiresAt: new Date(checkedAt + AUDIT_MAX_AGE_MS).toISOString(),
    originalCreatedAt: RECOVERY_CREATED_AT, originalPreparationExpired: checkedAt - Date.parse(RECOVERY_CREATED_AT) > 900_000,
    originalStateSha256: createHash("sha256").update(encodeState(snapshot), "utf8").digest("hex"), role: "treasury",
    nearTransactionHash: RECOVERY_NEAR_HASH, unsignedHash: RECOVERY_UNSIGNED_HASH, signedTransactionHash: RECOVERY_SIGNED_HASH,
    near: {
      networkId: "testnet", accountId: VERIFIED_IDENTITIES.treasury.accountId, accessPublicKey: VERIFIED_IDENTITIES.treasury.accessPublicKey,
      contractId: "v1.signer-prod.testnet", domainId: 0, derivationPath: PATH, rootPublicKey: VERIFIED_MPC_ROOT,
      recoveredPublicKeySec1: publicKey, mpcVersion: verified.inspection.version, mpcBlockHash: verified.inspection.blockHash,
      mpcBlockHeight: verified.inspection.blockHeight, finalizedAccessKeyNonce: verified.accessKeyNonce,
    },
    evm: {
      chainId: "11155111", tokenAddress: TOKEN, senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
      recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress, amountBaseUnits: "1000000000000000000", nonce: "0", gasLimit: "170424",
      maxFeePerGasWei: "1028", maxPriorityFeePerGasWei: "1000", maximumFeeWei: prepared.maximumFeeWei.toString() as "175195872",
      feePolicy: { gasLimitCap: "180000", maxFeePerGasCap: "30000000000", maxTotalFeeWei: "3600000000000000" },
      blockNumber: current.blockNumber.toString(), blockHash: current.blockHash,
      tokenCodeHash: keccak256(current.snapshot.tokenCode), tokenCodeBytes: (current.snapshot.tokenCode.length - 2) / 2,
      senderLinkBalance: current.snapshot.tokenBalance.toString(), senderEthBalanceWei: current.snapshot.nativeBalance.toString(),
      investorLinkBalance: investorLinkBalance.toString(), investorEthBalanceWei: quantity(investorEth).toString(),
      gasEstimate: current.snapshot.estimatedGas.toString(), baseFeePerGasWei: current.snapshot.baseFeePerGas.toString(),
      confirmedNonce: "0", pendingNonce: "0", knownTransaction: false, knownReceipt: false,
    },
  });
}

/** Narrow opt-in submission path for this one recorded, expired preparation. No NEAR signing port exists. */
export async function broadcastRecoveredTransfer(state: ExecutionState, input: {
  nearRpcUrl: string; approval: string; expiredPreparationAcknowledgment: string;
}, ports: RecoveryBroadcastPorts): Promise<void> {
  requireThat(input.approval === RECOVERY_SIGNED_HASH && input.expiredPreparationAcknowledgment === RECOVERY_CREATED_AT,
    "INVALID_APPROVAL", "Approve the exact recorded signed hash and acknowledge its exact original creation timestamp before any recovery reads.");
  const original = structuredClone(state);
  assertRecordedState(original);
  const inspected = await inspectRecoveryBroadcast(original, input, ports);
  requireThat(inspected.originalPreparationExpired, "INVALID_STATE", "This exceptional route applies only to the recorded preparation after its original 15-minute window expired.");
  const audit = freezeAudit({ ...inspected, approvedSignedHash: input.approval, expiredPreparationAcknowledgment: input.expiredPreparationAcknowledgment });
  const sendOnce = authorizeEvmBroadcast(original.signed!.serialized, RECOVERY_SIGNED_HASH, input.approval, ports.broadcast);
  freshAudit(audit, ports);
  try { await ports.saveAudit(audit); }
  catch { throw new RecoveryBroadcastError("AUDIT_SAVE_FAILED", "Recovery audit could not be saved; state was unchanged and nothing was submitted."); }
  freshAudit(audit, ports);
  const candidate: ExecutionState = freezeAudit({
    ...structuredClone(original), status: "evm-submitting",
    recoveryBroadcastAudit: { auditSha256: recoveryBroadcastAuditSha256(audit), checkedAt: audit.checkedAt,
      expiredPreparationAcknowledgment: input.expiredPreparationAcknowledgment, approvedSignedHash: input.approval },
    recovery: undefined,
  });
  try { await ports.save(candidate); }
  catch { throw new RecoveryBroadcastError("STATE_SAVE_FAILED", "Recovery submitting state could not be saved; original in-memory state was unchanged and no submission was attempted."); }
  Object.assign(state, candidate); delete state.recovery;
  // A durable submitting marker is retained if storage took too long. Never roll it back or send from a stale audit.
  freshAudit(audit, ports);
  try {
    await sendOnce();
    state.status = "evm-submitted";
  } catch {
    state.status = "evm-uncertain";
    state.recovery = "Recorded EVM submission may have reached the network. Reconcile its saved hash and nonce; do not retry automatically.";
  }
  try { await ports.save(freezeAudit(structuredClone(state))); }
  catch { throw new RecoveryBroadcastError("STATE_SAVE_FAILED", "Post-attempt status could not be saved. Keep the persisted submitting marker and reconcile the recorded EVM hash; never retry automatically."); }
  if (state.status === "evm-uncertain") throw new RecoveryBroadcastError("SUBMISSION_UNKNOWN", "Recorded EVM submission is uncertain; reconcile the saved hash without another submission.");
}
