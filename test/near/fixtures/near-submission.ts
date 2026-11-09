import { appendNearSubmissionEvent, createNearSubmissionRecord, type NearSubmissionRecord } from "../../../src/near/submission.js";
import type { AuthorityRole } from "../../../src/near/config.js";

/** Synthetic public metadata only. No key generation, signing, credential or RPC access. */
export function offlineNearSubmission(role: AuthorityRole, digest: string, transactionHash: string,
  at = new Date().toISOString(), submissionDeadlineAt: string | null = null): NearSubmissionRecord {
  return createNearSubmissionRecord({ role, digest, transactionHash, precedingAccessKeyNonce: "7",
    referenceBlock: { hash: "1".repeat(32), height: 123 }, rpcUrl: "https://offline.invalid/not-requested",
    preparedAt: at, submissionDeadlineAt });
}

/** Simulated stage notifications; these never stand in for live transaction evidence. */
export async function runOfflineNearSubmission<T>(initial: NearSubmissionRecord,
  persist: (record: NearSubmissionRecord) => Promise<void>, action: () => Promise<T>,
  at: () => string = () => new Date().toISOString()): Promise<T> {
  let record = initial;
  const emit = async (stage: "public-checks" | "send-intent" | "rpc-response" | "rpc-uncertain") => {
    record = appendNearSubmissionEvent(record, { stage, at: at(),
      ...(["rpc-response", "rpc-uncertain"].includes(stage) ? { diagnostic: { category: stage === "rpc-response" ? "RPC_RESPONSE" as const : "TIMEOUT" as const } } : {}) });
    await persist(record);
  };
  await emit("public-checks"); await emit("send-intent");
  let result: T;
  try { result = await action(); }
  catch (error) { await emit("rpc-uncertain"); throw error; }
  await emit("rpc-response"); return result;
}
