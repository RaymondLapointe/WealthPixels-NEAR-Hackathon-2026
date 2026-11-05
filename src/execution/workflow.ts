import { baseDecode } from "near-api-js";
import { assembleSignedErc20Transfer } from "../evm/erc20-transfer.js";
import { authorizeEvmBroadcast, type EvmBroadcastTransport } from "../evm/broadcast.js";
import { assertLinkPreflight, recheckSepoliaLinkTransfer, verifySepoliaLinkReceipt, type SepoliaReadRpc } from "../evm/sepolia-link.js";
import { normalizeMpcOutcome, type prepareMpcSigning, type verifyRoleMpc, type readMpcSigningOutcome } from "../near/signing.js";
import type { ExecutionState } from "./state.js";

export interface ExecutionPorts {
  evm: SepoliaReadRpc;
  verifyMpc: typeof verifyRoleMpc;
  prepareSigning: typeof prepareMpcSigning;
  readOutcome: typeof readMpcSigningOutcome;
  broadcast: EvmBroadcastTransport;
  /** Must durably save state; an error aborts BEFORE any external mutation. */
  save(state: ExecutionState): Promise<void>;
}

/** Reconciliation can read public proof and persist locally; it has no signing or submission ports. */
export type ReconciliationPorts = Pick<ExecutionPorts, "verifyMpc" | "readOutcome" | "save">;
export type EvmReconciliationPorts = Pick<ExecutionPorts, "evm" | "save">;

function assertFresh(state: ExecutionState): void {
  const age = Date.now() - Date.parse(state.createdAt);
  if (age < -30_000 || age > 15 * 60_000) throw new Error("Prepared transaction expired. Do not reuse a signed/uncertain operation; reconcile it first.");
}

export async function requestSignature(
  state: ExecutionState, input: { credentialPath: string; nearRpcUrl: string; approval: string }, ports: ExecutionPorts,
): Promise<void> {
  if (state.status !== "prepared") throw new Error("A signature was already attempted for this operation. Reconcile its NEAR hash.");
  if (input.approval !== state.preflight.prepared.unsignedHash) throw new Error("Explicit signing approval must equal the inspected unsigned transaction digest.");
  assertFresh(state);
  await recheckSepoliaLinkTransfer(state.preflight, ports.evm);
  const signing = await ports.prepareSigning({
    role: state.role, credentialPath: input.credentialPath, rpcUrl: input.nearRpcUrl,
    digest: state.preflight.prepared.unsignedHash,
  });
  state.nearTransactionHash = signing.transactionHash;
  state.status = "near-submitting";
  await ports.save(state); // If this fails, broadcastOnce is never invoked.
  try {
    await signing.broadcastOnce();
    state.status = "near-submitted";
  } catch {
    state.status = "near-uncertain";
    state.recovery = "Read the saved NEAR hash and access-key nonce; no automatic signing retry is allowed.";
  }
  await ports.save(state);
}

export async function reconcileSigning(state: ExecutionState, nearRpcUrl: string, ports: ReconciliationPorts): Promise<void> {
  if (!["near-submitting", "near-submitted", "near-uncertain", "near-failed", "signed"].includes(state.status)) {
    throw new Error("This operation has no recorded NEAR signing submission to reconcile.");
  }
  const nearHash = state.nearTransactionHash;
  try {
    if (typeof nearHash !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(nearHash) || baseDecode(nearHash).length !== 32) throw new Error();
  } catch {
    throw new Error("A valid existing NEAR transaction hash is required; state was not changed.");
  }
  assertLinkPreflight(state.preflight);
  if (state.role !== state.preflight.role) throw new Error("Saved authority role differs from the original prepared intent.");
  let outcome: unknown;
  try {
    await ports.verifyMpc(state.role, nearRpcUrl);
    outcome = await ports.readOutcome(state.role, nearHash, nearRpcUrl);
  } catch {
    throw new Error("Public NEAR reconciliation reads failed. Keep the saved hash; state was not changed and no new signing request was made.");
  }
  if (!outcome || typeof outcome !== "object" || !("final_execution_status" in outcome) || outcome.final_execution_status !== "FINAL") {
    throw new Error("NEAR execution is not FINAL. Reconcile the saved hash later; state was not changed.");
  }
  let signed: ReturnType<typeof assembleSignedErc20Transfer>;
  try {
    const signature = normalizeMpcOutcome(outcome, state.role, nearHash, state.preflight.prepared.unsignedHash);
    signed = assembleSignedErc20Transfer(state.preflight.prepared, signature, state.preflight.prepared.senderAddress);
    if (state.status === "signed") {
      if (!state.signed || !state.nearOutcome) throw new Error();
      const priorSignature = normalizeMpcOutcome(state.nearOutcome, state.role, nearHash, state.preflight.prepared.unsignedHash);
      const prior = assembleSignedErc20Transfer(state.preflight.prepared, priorSignature, state.preflight.prepared.senderAddress);
      const same = (entry: typeof signed) => entry.hash === signed.hash && entry.serialized === signed.serialized && entry.senderAddress === signed.senderAddress;
      if (!same(prior) || !same(state.signed)) throw new Error();
      // Both saved and freshly fetched FINAL proofs authorize these exact bytes.
      // Preserve the complete existing state, including public RPC metadata order.
      return;
    }
  } catch {
    throw new Error("Final NEAR proof or saved signed bytes do not validate the original approved transaction; state was not changed.");
  }
  const candidate: ExecutionState = {
    ...structuredClone(state), status: "signed", signed, nearOutcome: structuredClone(outcome),
  };
  delete candidate.recovery;
  try { await ports.save(candidate); }
  catch { throw new Error("Verified MPC result could not be saved; the original in-memory state was not changed."); }
  Object.assign(state, candidate);
  delete state.recovery;
}

export async function broadcastTransfer(
  state: ExecutionState, input: { approval: string; nearRpcUrl: string }, ports: ExecutionPorts,
): Promise<void> {
  if (state.status !== "signed" || !state.signed || !state.nearTransactionHash || !state.nearOutcome) {
    throw new Error("Only a verified MPC-signed operation may be broadcast; reconcile pending submissions first.");
  }
  if (input.approval !== state.signed.hash) throw new Error("Explicit broadcast approval must equal the inspected signed transaction hash.");
  assertFresh(state);
  await ports.verifyMpc(state.role, input.nearRpcUrl);
  const signature = normalizeMpcOutcome(state.nearOutcome, state.role, state.nearTransactionHash, state.preflight.prepared.unsignedHash);
  const checked = assembleSignedErc20Transfer(state.preflight.prepared, signature, state.preflight.prepared.senderAddress);
  if (checked.hash !== state.signed.hash || checked.serialized !== state.signed.serialized || checked.senderAddress !== state.signed.senderAddress) {
    throw new Error("Saved signed transaction no longer matches the verified MPC result.");
  }
  await recheckSepoliaLinkTransfer(state.preflight, ports.evm);
  const sendOnce = authorizeEvmBroadcast(checked.serialized, checked.hash, input.approval, ports.broadcast);
  state.status = "evm-submitting";
  await ports.save(state);
  try {
    await sendOnce();
    state.status = "evm-submitted";
  } catch {
    state.status = "evm-uncertain";
    state.recovery = "Read the saved EVM hash and confirmed/pending nonce. Do not request another signature or broadcast automatically.";
  }
  await ports.save(state);
}

export async function reconcileEvm(state: ExecutionState, ports: EvmReconciliationPorts): Promise<void> {
  if (!["evm-submitting", "evm-submitted", "evm-uncertain", "confirmed"].includes(state.status) || !state.signed) {
    throw new Error("This operation has no EVM submission to reconcile.");
  }
  const chain = await ports.evm.request("eth_chainId", []);
  if (typeof chain !== "string" || BigInt(chain) !== 11155111n) throw new Error("Recovery requires Ethereum Sepolia.");
  const receipt = await ports.evm.request("eth_getTransactionReceipt", [state.signed.hash]);
  if (!receipt) {
    const [transaction, latestNonce, pendingNonce] = await Promise.all([
      ports.evm.request("eth_getTransactionByHash", [state.signed.hash]),
      ports.evm.request("eth_getTransactionCount", [state.preflight.prepared.senderAddress, "latest"]),
      ports.evm.request("eth_getTransactionCount", [state.preflight.prepared.senderAddress, "pending"]),
    ]);
    state.recovery = `No receipt. Known transaction: ${transaction ? "yes" : "no"}; latest nonce ${String(latestNonce)}, pending nonce ${String(pendingNonce)}, approved nonce ${state.preflight.prepared.nonce}. Reconcile; no automatic retry.`;
    await ports.save(state);
    return;
  }
  state.receipt = await verifySepoliaLinkReceipt(state.preflight, state.signed.hash, ports.evm);
  state.status = "confirmed";
  delete state.recovery;
  await ports.save(state);
}
