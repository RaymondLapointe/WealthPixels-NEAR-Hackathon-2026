import { assembleSignedErc20Transfer } from "../evm/erc20-transfer.js";
import { authorizeEvmBroadcast, type EvmBroadcastTransport } from "../evm/broadcast.js";
import { recheckSepoliaLinkTransfer, verifySepoliaLinkReceipt, type SepoliaReadRpc } from "../evm/sepolia-link.js";
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

export async function reconcileSigning(state: ExecutionState, nearRpcUrl: string, ports: ExecutionPorts): Promise<void> {
  if (!["near-submitting", "near-submitted", "near-uncertain"].includes(state.status) || !state.nearTransactionHash) {
    throw new Error("This operation has no unresolved NEAR signing submission.");
  }
  const verified = await ports.verifyMpc(state.role, nearRpcUrl);
  let outcome: unknown;
  try { outcome = await ports.readOutcome(state.role, state.nearTransactionHash, nearRpcUrl); }
  catch {
    state.recovery = `NEAR result is unavailable. Finalized access-key nonce: ${verified.accessKeyNonce}. Keep the saved hash; reconcile later without another sign call.`;
    await ports.save(state);
    return;
  }
  if (!outcome || typeof outcome !== "object" || !("final_execution_status" in outcome) || outcome.final_execution_status !== "FINAL") {
    state.recovery = `NEAR execution is not FINAL. Finalized access-key nonce: ${verified.accessKeyNonce}. Reconcile the saved hash later; no new signing request.`;
    await ports.save(state);
    return;
  }
  try {
    const signature = normalizeMpcOutcome(outcome, state.role, state.nearTransactionHash, state.preflight.prepared.unsignedHash);
    state.signed = assembleSignedErc20Transfer(state.preflight.prepared, signature, state.preflight.prepared.senderAddress);
    state.nearOutcome = outcome;
    state.status = "signed";
    delete state.recovery;
  } catch {
    // A failed, malformed or incompatible final result cannot authorize EVM submission.
    state.status = "near-failed";
    state.recovery = "Final NEAR result failed validation. Inspect public transaction evidence before preparing any new operation.";
  }
  await ports.save(state);
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

export async function reconcileEvm(state: ExecutionState, ports: ExecutionPorts): Promise<void> {
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
