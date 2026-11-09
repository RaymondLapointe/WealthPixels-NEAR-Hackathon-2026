import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AuthorityRole } from "../near/config.js";
import { requireRole } from "../near/identities.js";
import type { LinkPreflight } from "../evm/sepolia-link.js";
import { assertLinkPreflight } from "../evm/sepolia-link.js";
import { assertNearSubmissionRecord, type NearSubmissionRecord } from "../near/submission.js";
import type { AssembledErc20Transfer } from "../evm/erc20-transfer.js";

export type ExecutionStatus = "prepared" | "near-submitting" | "near-submitted" | "near-uncertain" | "near-failed" | "signed" | "evm-submitting" | "evm-submitted" | "evm-uncertain" | "confirmed";
export interface ExecutionState {
  schemaVersion: 1;
  role: AuthorityRole;
  status: ExecutionStatus;
  preflight: LinkPreflight;
  createdAt: string;
  nearTransactionHash?: string;
  nearSubmission?: NearSubmissionRecord;
  nearOutcome?: unknown;
  signed?: AssembledErc20Transfer;
  receipt?: unknown;
  recovery?: string;
  recoveryBroadcastAudit?: {
    auditSha256: string;
    checkedAt: string;
    expiredPreparationAcknowledgment: string;
    approvedSignedHash: string;
    auditFile?: string;
  };
}
const statuses: ReadonlySet<string> = new Set([
  "prepared", "near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed",
  "evm-submitting", "evm-submitted", "evm-uncertain", "confirmed",
]);

/** Only this ignored runtime directory may hold executable signed payloads. */
export async function runtimeStatePath(file: string, root = process.cwd(), create = false): Promise<string> {
  const runtimeRoot = resolve(root, ".local", "transfers");
  const target = resolve(file);
  const rel = relative(runtimeRoot, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !target.endsWith(".json")) {
    throw new Error("Transfer state must be a .json file inside .local/transfers/.");
  }
  const actualRoot = await realpath(root);
  let parent = actualRoot;
  // Check every ancestor before creating any directory. Reject all reparse/symlink traversal.
  for (const part of relative(resolve(root), dirname(target)).split(sep)) {
    parent = resolve(parent, part);
    try {
      const entry = await lstat(parent);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Runtime state cannot traverse a linked or non-directory path.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !create) throw error;
      await mkdir(parent, { mode: 0o700 });
    }
    if (await realpath(parent) !== parent) throw new Error("Runtime state directory resolved outside its expected path.");
  }
  try {
    const entry = await lstat(resolve(parent, basename(target)));
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("Runtime state cannot be a link or nonregular file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

export function encodeState(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? { $bigint: item.toString() } : item, 2) + "\n";
}
/** Inspection exposes transaction parameters and hashes, never executable signed bytes. */
export function publicExecutionSummary(state: ExecutionState): unknown {
  const { unsignedSerialized: _bytes, ...parameters } = state.preflight.prepared;
  return {
    role: state.role, status: state.status, createdAt: state.createdAt,
    parameters, feePolicy: state.preflight.policy,
    nearTransactionHash: state.nearTransactionHash,
    nearSubmission: state.nearSubmission,
    evmTransactionHash: state.signed?.hash,
    recoveredSender: state.signed?.senderAddress,
    recoveryBroadcastAudit: state.recoveryBroadcastAudit,
    receipt: state.receipt, recovery: state.recovery,
  };
}
/** Shared bounded bigint codec; asset-specific validators must validate the returned object. */
export function decodeEncodedState(text: string): unknown {
  if (text.length > 2_000_000) throw new Error("Transfer state is too large.");
  const value = JSON.parse(text, (_key, item: unknown) => {
    if (item && typeof item === "object" && "$bigint" in item) {
      const digits = (item as { $bigint: unknown }).$bigint;
      if (Object.keys(item).length !== 1 || typeof digits !== "string" || !/^-?(0|[1-9][0-9]{0,77})$/.test(digits)) throw new Error("Invalid bigint in transfer state.");
      return BigInt(digits);
    }
    return item;
  });
  return value;
}
export function decodeState(text: string): ExecutionState {
  const value = decodeEncodedState(text) as ExecutionState;
  if (!value || value.schemaVersion !== 1 || !statuses.has(value.status) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Unsupported transfer state.");
  requireRole(value.role);
  assertLinkPreflight(value.preflight);
  if (value.role !== value.preflight.role) throw new Error("Transfer state role mismatch.");
  if (value.status !== "prepared" && (!value.nearTransactionHash || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.nearTransactionHash))) throw new Error("Missing NEAR transaction hash; manual reconciliation is required.");
  if (value.nearSubmission !== undefined) {
    if (value.status === "prepared" || !value.nearTransactionHash) throw new Error("Prepared state cannot contain NEAR submission metadata.");
    assertNearSubmissionRecord(value.nearSubmission, { role: value.role, transactionHash: value.nearTransactionHash, digest: value.preflight.prepared.unsignedHash });
  }
  return value;
}

export async function readState(file: string, role: AuthorityRole): Promise<ExecutionState> {
  const state = decodeState(await readFile(file, "utf8"));
  if (state.role !== role) throw new Error("Selected role differs from the saved operation.");
  return state;
}
export async function saveState(file: string, state: ExecutionState): Promise<void> {
  await saveEncodedState(file, state);
}
/** Shared durable writer; callers retain the runtime-path checks, lock and asset-specific validation. */
export async function saveEncodedState(file: string, state: unknown): Promise<void> {
  const temporary = file + ".tmp";
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(encodeState(state), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
}
export async function withStateLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  let handle;
  try { handle = await open(file + ".lock", "wx", 0o600); }
  catch { throw new Error("Transfer state is locked. Confirm the previous process stopped and reconcile before removing a stale lock."); }
  try { return await action(); }
  finally { await handle.close(); await unlink(file + ".lock"); }
}
