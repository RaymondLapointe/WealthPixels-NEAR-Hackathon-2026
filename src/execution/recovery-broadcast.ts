import { createHash } from "node:crypto";
import { Interface, SigningKey, Transaction, keccak256 } from "ethers";
import { assembleSignedErc20Transfer, normalizeMpcSignature, TransferPreflightError } from "../evm/erc20-transfer.js";
import { authorizeEvmBroadcast, type EvmBroadcastTransport } from "../evm/broadcast.js";
import { assertLinkPreflight, recheckSepoliaLinkTransfer, SepoliaLinkError, type SepoliaReadRpc, type SepoliaReadMethod } from "../evm/sepolia-link.js";
import { normalizeMpcOutcome, type readMpcSigningOutcome, type verifyRoleMpc } from "../near/signing.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { deriveEvmPublicKey } from "../near/mpc.js";
import { encodeState, type ExecutionState } from "./state.js";

export const RECOVERY_NEAR_HASH = "8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs";
export const RECOVERY_UNSIGNED_HASH = "0xd092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4";
export const RECOVERY_SIGNED_HASH = "0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719";
export const RECOVERY_CREATED_AT = "2026-11-04T22:05:28.617Z";
export const INVESTOR_RECOVERY_NEAR_HASH = "4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z";
export const INVESTOR_RECOVERY_UNSIGNED_HASH = "0x5dc09f64bf1751de61ce3cf3c3bdea6561ce2e38d992393eef57c3dca10641f9";
export const INVESTOR_RECOVERY_SIGNED_HASH = "0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86";
export const INVESTOR_RECOVERY_CREATED_AT = "2026-11-05T16:17:00.756Z";
// Closed allowlist of the two already-authorized, recorded transactions. No caller-supplied recovery intent.
const RECORDED_RECOVERIES = Object.freeze({
  treasury: Object.freeze({
    role: "treasury", kind: "recorded-treasury-recovery-broadcast", nearHash: RECOVERY_NEAR_HASH,
    unsignedHash: RECOVERY_UNSIGNED_HASH, signedHash: RECOVERY_SIGNED_HASH, createdAt: RECOVERY_CREATED_AT,
    amountBaseUnits: "1000000000000000000", gasLimit: "170424", maxFeePerGasWei: "1028", maximumFeeWei: "175195872",
  }),
  investor: Object.freeze({
    role: "investor", kind: "recorded-investor-recovery-broadcast", nearHash: INVESTOR_RECOVERY_NEAR_HASH,
    unsignedHash: INVESTOR_RECOVERY_UNSIGNED_HASH, signedHash: INVESTOR_RECOVERY_SIGNED_HASH, createdAt: INVESTOR_RECOVERY_CREATED_AT,
    amountBaseUnits: "100000000000000000", gasLimit: "52001", maxFeePerGasWei: "5000", maximumFeeWei: "260005000",
  }),
} as const);
type RecordedRecovery = typeof RECORDED_RECOVERIES[keyof typeof RECORDED_RECOVERIES];
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
  kind: "recorded-treasury-recovery-broadcast" | "recorded-investor-recovery-broadcast";
  status: "passed";
  checkedAt: string;
  completedAt: string;
  expiresAt: string;
  originalCreatedAt: string;
  originalPreparationExpired: boolean;
  originalStateSha256: string;
  role: "treasury" | "investor";
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
    amountBaseUnits: "1000000000000000000" | "100000000000000000"; nonce: "0"; gasLimit: "170424" | "52001";
    maxFeePerGasWei: "1028" | "5000"; maxPriorityFeePerGasWei: "1000"; maximumFeeWei: "175195872" | "260005000";
    feePolicy: { gasLimitCap: "180000"; maxFeePerGasCap: "30000000000"; maxTotalFeeWei: "3600000000000000" };
    blockNumber: string; blockHash: string; tokenCodeHash: string; tokenCodeBytes: number;
    senderLinkBalance: string; senderEthBalanceWei: string; investorLinkBalance: string; investorEthBalanceWei: string;
    treasuryLinkBalance: string; treasuryEthBalanceWei: string;
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
function recordedRecovery(role: unknown): RecordedRecovery {
  requireThat(role === "treasury" || role === "investor", "INVALID_STATE", "Select one of the two recorded recovery roles.");
  return RECORDED_RECOVERIES[role];
}
function clock(ports: RecoveryReadPorts): number {
  const value = ports.now ? ports.now() : Date.now();
  requireThat(Number.isSafeInteger(value) && value >= 0, "INVALID_STATE", "The recovery audit clock is invalid.");
  return value;
}
function publicFailureDetail(error: unknown): string {
  if (error instanceof SepoliaLinkError) return `${error.code}: ${error.message}`;
  if (error instanceof TransferPreflightError) return `STATE_VALIDATION: ${error.message}`;
  return "unclassified failure; raw provider details suppressed";
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
function assertRecordedState(state: ExecutionState): RecordedRecovery {
  try {
    const profile = recordedRecovery(state.role);
    assertLinkPreflight(state.preflight);
    const prepared = state.preflight.prepared, limits = state.preflight.policy;
    const tx = Transaction.from(state.signed!.serialized);
    const sender = VERIFIED_IDENTITIES[profile.role];
    const recipient = VERIFIED_IDENTITIES[profile.role === "treasury" ? "investor" : "treasury"];
    requireThat(state.schemaVersion === 1 && state.role === state.preflight.role && state.status === "signed" &&
      state.createdAt === profile.createdAt && state.nearTransactionHash === profile.nearHash && state.nearOutcome &&
      state.signed?.hash === profile.signedHash && state.signed.senderAddress === sender.evmAddress &&
      prepared.unsignedHash === profile.unsignedHash && tx.unsignedHash === profile.unsignedHash &&
      tx.hash === profile.signedHash && keccak256(state.signed.serialized) === profile.signedHash &&
      tx.from === sender.evmAddress && tx.chainId === 11155111n && tx.type === 2 && tx.nonce === 0 &&
      tx.to === TOKEN && tx.data === prepared.data && tx.value === 0n && tx.accessList?.length === 0 &&
      prepared.tokenAddress === TOKEN && prepared.senderAddress === sender.evmAddress &&
      prepared.recipientAddress === recipient.evmAddress && prepared.amount === BigInt(profile.amountBaseUnits) &&
      tx.gasLimit === BigInt(profile.gasLimit) && tx.maxFeePerGas === BigInt(profile.maxFeePerGasWei) && tx.maxPriorityFeePerGas === 1_000n &&
      prepared.maximumFeeWei === BigInt(profile.maximumFeeWei) && keccak256(state.preflight.snapshot.tokenCode) === ORIGINAL_LINK_CODE_HASH &&
      state.recoveryBroadcastAudit === undefined && state.recovery === undefined && limits.gasLimitCap === 180_000n &&
      limits.maxFeePerGasCap === 30_000_000_000n && limits.maxTotalFeeWei === 3_600_000_000_000_000n && state.receipt === undefined,
    "INVALID_STATE", "This recovery route accepts only the exact recorded transaction for the selected role and unchanged fee caps.");
    const signature = normalizeMpcOutcome(state.nearOutcome, profile.role, profile.nearHash, profile.unsignedHash);
    const assembled = assembleSignedErc20Transfer(prepared, signature, sender.evmAddress);
    requireThat(assembled.hash === profile.signedHash && assembled.serialized === state.signed.serialized,
      "PROOF_MISMATCH", "Saved MPC proof does not authorize the exact recorded EVM bytes.");
    return profile;
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
  const profile = assertRecordedState(snapshot);
  const sender = VERIFIED_IDENTITIES[profile.role];
  const recipientRole = profile.role === "treasury" ? "investor" : "treasury";
  const recipient = VERIFIED_IDENTITIES[recipientRole];
  const checkedAt = clock(ports); // Earliest public observation, including read latency in the 30-second budget.
  let verified: Awaited<ReturnType<typeof verifyRoleMpc>>, outcome: unknown;
  try {
    verified = await ports.verifyMpc(profile.role, input.nearRpcUrl);
    outcome = await ports.readOutcome(profile.role, profile.nearHash, input.nearRpcUrl);
  } catch { throw new RecoveryBroadcastError("PUBLIC_READ_FAILED", "Fresh public NEAR/MPC evidence could not be verified; nothing was submitted."); }
  let publicKey: string;
  try {
    const signature = normalizeMpcOutcome(outcome, profile.role, profile.nearHash, profile.unsignedHash);
    const normalized = normalizeMpcSignature(signature);
    publicKey = SigningKey.recoverPublicKey(profile.unsignedHash, normalized);
    const expectedKey = deriveEvmPublicKey(VERIFIED_MPC_ROOT, sender.accountId, PATH);
    const assembled = assembleSignedErc20Transfer(snapshot.preflight.prepared, signature, sender.evmAddress);
    requireThat(publicKey === expectedKey && assembled.hash === profile.signedHash && assembled.serialized === snapshot.signed!.serialized &&
      verified.role === profile.role && verified.accessPublicKey === sender.accessPublicKey &&
      verified.inspection.networkId === "testnet" && verified.inspection.contractId === "v1.signer-prod.testnet" &&
      verified.inspection.domainId === 0 && verified.inspection.rootPublicKey === VERIFIED_MPC_ROOT &&
      verified.derivation.nearAccountId === sender.accountId &&
      verified.derivation.derivationPath === PATH && verified.derivation.domainId === 0 &&
      verified.derivation.derivedPublicKeySec1 === expectedKey && verified.derivation.evmAddress === sender.evmAddress &&
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
  let confirmedNonce: unknown, pendingNonce: unknown, knownTransaction: unknown, knownReceipt: unknown, recipientLink: unknown, recipientEth: unknown;
  let operation = "Sepolia signed-transaction preflight";
  const lookup = async (label: string, method: SepoliaReadMethod, params: readonly unknown[]) => {
    try { return await ports.evm.request(method, params); }
    catch (error) { throw new SepoliaLinkError("RPC_FAILED", `${label} (${method}): ${publicFailureDetail(error)}`); }
  };
  try {
    current = await recheckSepoliaLinkTransfer(snapshot.preflight, ports.evm);
    operation = `Sepolia public transaction lookups and ${recipientRole} balances`;
    const blockTag = `0x${current.blockNumber.toString(16)}`;
    [confirmedNonce, pendingNonce, knownTransaction, knownReceipt, recipientLink, recipientEth] = await Promise.all([
      lookup("confirmed nonce", "eth_getTransactionCount", [sender.evmAddress, "latest"]),
      lookup("pending nonce", "eth_getTransactionCount", [sender.evmAddress, "pending"]),
      lookup("signed transaction lookup", "eth_getTransactionByHash", [profile.signedHash]),
      lookup("signed receipt lookup", "eth_getTransactionReceipt", [profile.signedHash]),
      lookup(`${recipientRole} LINK balance`, "eth_call", [{ to: TOKEN, data: balancesAbi.encodeFunctionData("balanceOf", [recipient.evmAddress]) }, blockTag]),
      lookup(`${recipientRole} ETH balance`, "eth_getBalance", [recipient.evmAddress, blockTag]),
    ]);
  } catch (error) { throw new RecoveryBroadcastError("PREFLIGHT_FAILED", `${operation} failed [${publicFailureDetail(error)}]; nothing was submitted.`); }
  requireThat(quantity(confirmedNonce) === 0n && quantity(pendingNonce) === 0n,
    "NONCE_CHANGED", "Selected sender confirmed and pending nonces must both remain zero; reconcile instead of submitting.");
  requireThat(knownTransaction === null && knownReceipt === null,
    "ALREADY_KNOWN", "The recorded EVM transaction or receipt is already known; reconcile it without another submission.");
  requireThat(current.snapshot.tokenCode === snapshot.preflight.snapshot.tokenCode && keccak256(current.snapshot.tokenCode) === ORIGINAL_LINK_CODE_HASH,
    "PREFLIGHT_FAILED", "LINK bytecode changed from the original verified preparation.");
  let recipientLinkBalance: bigint;
  try {
    requireThat(typeof recipientLink === "string", "PUBLIC_READ_FAILED", "Invalid public LINK balance result.");
    recipientLinkBalance = balancesAbi.decodeFunctionResult("balanceOf", recipientLink)[0];
    requireThat(typeof recipientLinkBalance === "bigint" && recipientLinkBalance >= 0n, "PUBLIC_READ_FAILED", "Invalid recipient LINK balance.");
  } catch { throw new RecoveryBroadcastError("PUBLIC_READ_FAILED", "Fresh recipient balance could not be decoded."); }
  try {
    const block = await ports.evm.request("eth_getBlockByNumber", [`0x${current.blockNumber.toString(16)}`, false]);
    requireThat(block && typeof block === "object" && "hash" in block && block.hash === current.blockHash &&
      "number" in block && quantity(block.number) === current.blockNumber,
    "PREFLIGHT_FAILED", "The pinned Sepolia block changed during recovery audit reads.");
  } catch (error) {
    if (error instanceof RecoveryBroadcastError) throw error;
    throw new RecoveryBroadcastError("PREFLIGHT_FAILED", `The final canonical-block recovery check failed [${publicFailureDetail(error)}].`);
  }
  const completedAt = clock(ports), prepared = snapshot.preflight.prepared;
  requireThat(completedAt >= checkedAt && completedAt - checkedAt <= AUDIT_MAX_AGE_MS,
    "AUDIT_EXPIRED", "Recovery public reads exceeded 30 seconds; no passed audit or submission is permitted.");
  return freezeAudit({
    schemaVersion: 1, kind: profile.kind, status: "passed",
    checkedAt: new Date(checkedAt).toISOString(), completedAt: new Date(completedAt).toISOString(), expiresAt: new Date(checkedAt + AUDIT_MAX_AGE_MS).toISOString(),
    originalCreatedAt: profile.createdAt, originalPreparationExpired: checkedAt - Date.parse(profile.createdAt) > 900_000,
    originalStateSha256: createHash("sha256").update(encodeState(snapshot), "utf8").digest("hex"), role: profile.role,
    nearTransactionHash: profile.nearHash, unsignedHash: profile.unsignedHash, signedTransactionHash: profile.signedHash,
    near: {
      networkId: "testnet", accountId: sender.accountId, accessPublicKey: sender.accessPublicKey,
      contractId: "v1.signer-prod.testnet", domainId: 0, derivationPath: PATH, rootPublicKey: VERIFIED_MPC_ROOT,
      recoveredPublicKeySec1: publicKey, mpcVersion: verified.inspection.version, mpcBlockHash: verified.inspection.blockHash,
      mpcBlockHeight: verified.inspection.blockHeight, finalizedAccessKeyNonce: verified.accessKeyNonce,
    },
    evm: {
      chainId: "11155111", tokenAddress: TOKEN, senderAddress: sender.evmAddress,
      recipientAddress: recipient.evmAddress, amountBaseUnits: profile.amountBaseUnits, nonce: "0", gasLimit: profile.gasLimit,
      maxFeePerGasWei: profile.maxFeePerGasWei, maxPriorityFeePerGasWei: "1000", maximumFeeWei: profile.maximumFeeWei,
      feePolicy: { gasLimitCap: "180000", maxFeePerGasCap: "30000000000", maxTotalFeeWei: "3600000000000000" },
      blockNumber: current.blockNumber.toString(), blockHash: current.blockHash,
      tokenCodeHash: keccak256(current.snapshot.tokenCode), tokenCodeBytes: (current.snapshot.tokenCode.length - 2) / 2,
      senderLinkBalance: current.snapshot.tokenBalance.toString(), senderEthBalanceWei: current.snapshot.nativeBalance.toString(),
      investorLinkBalance: profile.role === "investor" ? current.snapshot.tokenBalance.toString() : recipientLinkBalance.toString(),
      investorEthBalanceWei: profile.role === "investor" ? current.snapshot.nativeBalance.toString() : quantity(recipientEth).toString(),
      treasuryLinkBalance: profile.role === "treasury" ? current.snapshot.tokenBalance.toString() : recipientLinkBalance.toString(),
      treasuryEthBalanceWei: profile.role === "treasury" ? current.snapshot.nativeBalance.toString() : quantity(recipientEth).toString(),
      gasEstimate: current.snapshot.estimatedGas.toString(), baseFeePerGasWei: current.snapshot.baseFeePerGas.toString(),
      confirmedNonce: "0", pendingNonce: "0", knownTransaction: false, knownReceipt: false,
    },
  });
}

/** Closed opt-in submission path for the two recorded expired preparations. No NEAR signing port exists. */
export async function broadcastRecoveredTransfer(state: ExecutionState, input: {
  nearRpcUrl: string; approval: string; expiredPreparationAcknowledgment: string;
}, ports: RecoveryBroadcastPorts): Promise<void> {
  const profile = recordedRecovery(state.role);
  requireThat(input.approval === profile.signedHash && input.expiredPreparationAcknowledgment === profile.createdAt,
    "INVALID_APPROVAL", "Approve the exact recorded signed hash and acknowledge its exact original creation timestamp before any recovery reads.");
  const original = structuredClone(state);
  assertRecordedState(original);
  const inspected = await inspectRecoveryBroadcast(original, input, ports);
  requireThat(inspected.originalPreparationExpired, "INVALID_STATE", "This exceptional route applies only to the recorded preparation after its original 15-minute window expired.");
  const audit = freezeAudit({ ...inspected, approvedSignedHash: input.approval, expiredPreparationAcknowledgment: input.expiredPreparationAcknowledgment });
  const sendOnce = authorizeEvmBroadcast(original.signed!.serialized, profile.signedHash, input.approval, ports.broadcast);
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
