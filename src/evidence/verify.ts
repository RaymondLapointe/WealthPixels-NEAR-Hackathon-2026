import { Interface, Signature, Transaction, ZeroAddress, computeAddress, getAddress, toBeHex } from "ethers";
import { assembleSignedErc20Transfer, buildUnsignedErc20Transfer, normalizeMpcSignature } from "../evm/erc20-transfer.js";
import { deriveEvmPublicKey } from "../near/mpc.js";

export const SEPOLIA_LINK = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
const CONTRACT = "v1.signer-prod.testnet";
const PATH = "wealthpixels/sepolia/v1";
const MAX = (1n << 256n) - 1n;
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const events = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const METHODS = {
  near: new Set(["status", "tx_status", "EXPERIMENTAL_tx_status"]),
  evm: new Set(["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_blockNumber"]),
};
export type RpcChain = "near" | "evm";
export interface EvidenceTransport { request(chain: RpcChain, method: string, params: unknown): Promise<unknown> }
export class EvidenceVerificationError extends Error {
  constructor(readonly code: "PENDING" | "INVALID_EVIDENCE" | "RPC_FAILED" | "METHOD_NOT_FOUND", message: string) {
    super(message); this.name = "EvidenceVerificationError";
  }
}
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new EvidenceVerificationError("INVALID_EVIDENCE", message);
}
function object(value: unknown, label: string): Record<string, any> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value as Record<string, any>;
}
function evmAddress(value: unknown): string {
  requireThat(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), "Invalid EVM address.");
  let result: string;
  try { result = getAddress(value); } catch { throw new EvidenceVerificationError("INVALID_EVIDENCE", "Invalid EVM address checksum."); }
  requireThat(result !== ZeroAddress, "A role or token address must not be zero.");
  return result;
}
function hash(value: unknown): string {
  requireThat(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "Invalid EVM transaction or block hash.");
  return value.toLowerCase();
}
/** RPC signature scalars may be minimally encoded quantities or padded bytes. */
export function normalizeEvmSignatureScalar(value: unknown): string {
  requireThat(typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value), "Invalid EVM signature scalar encoding.");
  const scalar = BigInt(value);
  requireThat(scalar > 0n && scalar < SECP256K1_ORDER, "EVM signature scalar must be nonzero and below the secp256k1 order.");
  return toBeHex(scalar, 32);
}
function quantity(value: unknown): bigint {
  requireThat(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid EVM RPC quantity.");
  const result = BigInt(value);
  requireThat(result <= MAX, "EVM RPC quantity exceeds uint256.");
  return result;
}
function jsonBase64(value: unknown, label: string): Record<string, any> {
  requireThat(typeof value === "string" && value.length <= 32768, `${label} must be bounded base64 JSON.`);
  try {
    const bytes = Buffer.from(value, "base64");
    requireThat(bytes.toString("base64") === value, `${label} has noncanonical base64.`);
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), label);
  } catch { throw new EvidenceVerificationError("INVALID_EVIDENCE", `${label} is not supported base64 JSON.`); }
}
export interface EvidenceTransfer {
  direction: "treasury-to-investor" | "investor-to-treasury";
  amountBaseUnits: string;
  nearTransactionHash: string;
  evmTransactionHash: string;
}
export interface TransferProofContext {
  senderAccountId: string;
  senderAddress: string;
  recipientAddress: string;
  derivationPath: string;
  tokenAddress: string;
  minimumConfirmations: number;
}
export interface TransferProofObservations {
  nearTransaction: unknown; evmTransaction: unknown; receipt: unknown; headBlock: unknown;
}
export interface VerifiedTransfer extends EvidenceTransfer { confirmations: string; blockNumber: string }
function transferRecord(value: unknown): EvidenceTransfer {
  const leg = object(value, "Transfer");
  requireThat(leg.direction === "treasury-to-investor" || leg.direction === "investor-to-treasury", "Invalid transfer direction.");
  requireThat(typeof leg.amountBaseUnits === "string" && /^[1-9][0-9]{0,77}$/.test(leg.amountBaseUnits) && BigInt(leg.amountBaseUnits) <= MAX, "Use positive uint256 token base units.");
  requireThat(typeof leg.nearTransactionHash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(leg.nearTransactionHash), "Invalid NEAR transaction hash.");
  return { direction: leg.direction, amountBaseUnits: leg.amountBaseUnits, nearTransactionHash: leg.nearTransactionHash, evmTransactionHash: hash(leg.evmTransactionHash) };
}

/** Pure one-leg verifier; public role context is validated by verifyEvidence before use. */
export function verifyTransferProof(
  value: EvidenceTransfer, context: TransferProofContext, observed: TransferProofObservations,
): VerifiedTransfer {
  const leg = transferRecord(value);
  const sender = evmAddress(context.senderAddress), recipient = evmAddress(context.recipientAddress);
  requireThat(sender !== recipient && evmAddress(context.tokenAddress) === SEPOLIA_LINK, "Proof requires distinct roles and official Sepolia LINK.");
  requireThat(Number.isSafeInteger(context.minimumConfirmations) && context.minimumConfirmations >= 2, "Require at least two EVM confirmations.");
  const raw = object(observed.evmTransaction, "EVM transaction");
  requireThat(quantity(raw.type) === 2n && quantity(raw.chainId) === 11155111n, "Evidence must be an EIP-1559 Sepolia transaction.");
  requireThat(hash(raw.hash) === leg.evmTransactionHash && evmAddress(raw.from) === sender && evmAddress(raw.to) === SEPOLIA_LINK && quantity(raw.value) === 0n, "EVM hash, sender, token, or ETH value mismatch.");
  requireThat(Array.isArray(raw.accessList) && raw.accessList.length === 0, "Only the prepared empty access list is supported.");
  const txNonce = quantity(raw.nonce);
  requireThat(txNonce <= BigInt(Number.MAX_SAFE_INTEGER), "Transaction nonce exceeds the supported safe integer range.");
  const prepared = buildUnsignedErc20Transfer({
    chainId: 11155111n, senderAddress: sender, tokenAddress: SEPOLIA_LINK,
    recipientAddress: recipient, amount: BigInt(leg.amountBaseUnits), nonce: Number(txNonce),
    gasLimit: quantity(raw.gas), maxFeePerGas: quantity(raw.maxFeePerGas), maxPriorityFeePerGas: quantity(raw.maxPriorityFeePerGas),
  });
  requireThat(raw.input === prepared.data, "EVM calldata does not encode the declared LINK transfer.");
  const parity = quantity(raw.v);
  requireThat(parity === 0n || parity === 1n || parity === 27n || parity === 28n, "Invalid type-2 signature recovery value.");
  const evmSignature = Signature.from({ r: normalizeEvmSignatureScalar(raw.r), s: normalizeEvmSignatureScalar(raw.s), v: Number(parity) });
  const transaction = Transaction.from(prepared.unsignedSerialized);
  transaction.signature = evmSignature;
  requireThat(transaction.hash === leg.evmTransactionHash && transaction.from === sender, "EVM signature/hash reconstruction failed.");

  const near = object(observed.nearTransaction, "NEAR final result");
  requireThat(near.final_execution_status === "FINAL", "NEAR execution and all receipts must be FINAL.");
  const nearTx = object(near.transaction, "NEAR transaction");
  requireThat(nearTx.hash === leg.nearTransactionHash && nearTx.signer_id === context.senderAccountId && nearTx.receiver_id === CONTRACT, "NEAR hash, signer, or MPC receiver mismatch.");
  requireThat(Array.isArray(nearTx.actions) && nearTx.actions.length === 1, "Require one direct MPC sign action.");
  const directAction = object(nearTx.actions[0], "NEAR action");
  requireThat(Object.keys(directAction).length === 1 && "FunctionCall" in directAction, "Require one unambiguous direct function-call action.");
  const action = object(directAction.FunctionCall, "NEAR function call");
  requireThat(action.method_name === "sign", "The NEAR action must call MPC sign directly.");
  const request = object(jsonBase64(action.args, "NEAR sign arguments").request, "MPC request");
  const payload = object(request.payload_v2, "MPC payload_v2");
  requireThat(request.path === context.derivationPath && context.derivationPath === PATH && request.domain_id === 0, "MPC path or ECDSA domain mismatch.");
  requireThat(request.payload === undefined && request.key_version === undefined && Object.keys(payload).length === 1 && typeof payload.Ecdsa === "string" && /^[0-9a-fA-F]{64}$/.test(payload.Ecdsa) && `0x${payload.Ecdsa.toLowerCase()}` === prepared.unsignedHash, "MPC digest does not match the EVM unsigned transaction hash.");
  const finalStatus = object(near.status, "NEAR final status");
  requireThat(Object.keys(finalStatus).length === 1 && "SuccessValue" in finalStatus, "NEAR final status must be an unambiguous SuccessValue.");
  const result = jsonBase64(finalStatus.SuccessValue, "MPC final return");
  requireThat(result.scheme === "Secp256k1", "Unsupported MPC final signature wrapper or scheme.");
  const mpcSignature = normalizeMpcSignature(result);
  requireThat(mpcSignature.serialized === evmSignature.serialized, "MPC returned signature differs from the executed EVM signature.");
  requireThat(assembleSignedErc20Transfer(prepared, result, sender).hash === leg.evmTransactionHash, "MPC signature does not assemble the executed EVM transaction.");

  const receipt = object(observed.receipt, "EVM receipt");
  const block = quantity(receipt.blockNumber), head = quantity(observed.headBlock);
  requireThat(quantity(receipt.status) === 1n && hash(receipt.transactionHash) === leg.evmTransactionHash && hash(receipt.blockHash) === hash(raw.blockHash) && block === quantity(raw.blockNumber), "EVM receipt failed or does not match the mined transaction.");
  requireThat(evmAddress(receipt.from) === sender && evmAddress(receipt.to) === SEPOLIA_LINK, "Receipt role or token mismatch.");
  requireThat(head >= block && head - block + 1n >= BigInt(context.minimumConfirmations), "EVM evidence has insufficient confirmations.");
  requireThat(Array.isArray(receipt.logs), "Receipt logs are missing.");
  const transfers = receipt.logs.filter((value: unknown) => {
    const log = object(value, "EVM log");
    if (evmAddress(log.address) !== SEPOLIA_LINK || !Array.isArray(log.topics) || log.topics[0] !== events.getEvent("Transfer")!.topicHash) return false;
    requireThat(log.removed === false && hash(log.transactionHash) === leg.evmTransactionHash && hash(log.blockHash) === hash(receipt.blockHash), "Transfer log is removed or belongs to different evidence.");
    const decoded = events.parseLog({ topics: log.topics, data: log.data });
    return decoded?.args.from === sender && decoded.args.to === recipient && decoded.args.value === BigInt(leg.amountBaseUnits);
  });
  requireThat(transfers.length === 1, "Require exactly one matching LINK Transfer event.");
  return { ...leg, confirmations: (head - block + 1n).toString(), blockNumber: block.toString() };
}

export function createReadOnlyEvidenceTransport(options: { nearRpcUrl?: string; evmRpcUrl?: string } = {}): EvidenceTransport {
  const urls = {
    near: options.nearRpcUrl ?? "https://archival-rpc.testnet.near.org",
    evm: options.evmRpcUrl ?? "https://ethereum-sepolia-rpc.publicnode.com",
  };
  for (const endpoint of Object.values(urls)) {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new EvidenceVerificationError("INVALID_EVIDENCE", "Invalid public RPC URL."); }
    requireThat(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "Use public HTTPS RPC URLs without credentials, query strings, or fragments.");
  }
  return Object.freeze({ async request(chain: RpcChain, method: string, params: unknown): Promise<unknown> {
    requireThat(METHODS[chain]?.has(method), "RPC method is outside the read-only evidence allowlist.");
    try {
      const response = await fetch(urls[chain], {
        method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      const body = object(await response.json(), "RPC response");
      if (body.jsonrpc !== "2.0" || body.id !== 1) throw new Error();
      if (body.error?.code === -32601) throw new EvidenceVerificationError("METHOD_NOT_FOUND", "Public RPC method is unavailable.");
      if (body.error || !("result" in body)) throw new Error();
      return body.result;
    } catch (error) {
      if (error instanceof EvidenceVerificationError && error.code === "METHOD_NOT_FOUND") throw error;
      throw new EvidenceVerificationError("RPC_FAILED", "Public read-only RPC request failed; check endpoint availability and transaction history.");
    }
  } });
}

export async function verifyEvidence(value: unknown, options: {
  transport?: EvidenceTransport; allowFixtures?: boolean; nearRpcUrl?: string; evmRpcUrl?: string;
} = {}): Promise<{ status: "verified"; operatorModel: "single-operator-demo"; transfers: VerifiedTransfer[] }> {
  const manifest = object(value, "Evidence manifest");
  requireThat(manifest.schemaVersion === 1 && (manifest.kind === "live" || (manifest.kind === "fixture" && options.allowFixtures === true && options.transport)), "Use schemaVersion 1 live evidence; fixtures are confined to injected offline tests.");
  if (manifest.status === "pending") {
    throw new EvidenceVerificationError("PENDING", "Evidence is pending. After separately authorized transfers, record both public NEAR signing hashes, both Sepolia LINK transfer hashes, root key and role addresses, set status to complete, then rerun. No RPC requests were made.");
  }
  requireThat(manifest.status === "complete" && manifest.operatorModel === "single-operator-demo", "Require complete evidence and the disclosed single-operator-demo model.");
  const near = object(manifest.near, "NEAR configuration"), evm = object(manifest.evm, "EVM configuration");
  requireThat(near.networkId === "testnet" && near.contractId === CONTRACT && near.domainId === 0 && near.derivationPath === PATH, "Unsupported NEAR network, MPC contract, domain or path.");
  requireThat(evm.chainId === 11155111 && evmAddress(evm.tokenAddress) === SEPOLIA_LINK && evm.decimals === 18 && Number.isSafeInteger(evm.minimumConfirmations) && evm.minimumConfirmations >= 2, "Require Sepolia LINK, 18 decimals and at least two confirmations.");
  const roles = object(manifest.roles, "Roles");
  const treasury = object(roles.treasury, "Treasury role"), investor = object(roles.investor, "Investor role");
  requireThat(treasury.nearAccountId !== investor.nearAccountId, "NEAR role accounts must be distinct.");
  for (const role of [treasury, investor]) {
    const derived = computeAddress(deriveEvmPublicKey(near.rootPublicKey, role.nearAccountId, PATH));
    requireThat(derived === evmAddress(role.evmAddress), "Recorded role address does not match account/path/root public derivation.");
  }
  requireThat(evmAddress(treasury.evmAddress) !== evmAddress(investor.evmAddress), "EVM role addresses must be distinct.");
  requireThat(Array.isArray(manifest.transfers) && manifest.transfers.length === 2, "Require treasury delivery and investor return evidence.");
  const legs = manifest.transfers.map(transferRecord);
  requireThat(legs[0].direction === "treasury-to-investor" && legs[1].direction === "investor-to-treasury" && legs[0].nearTransactionHash !== legs[1].nearTransactionHash && legs[0].evmTransactionHash !== legs[1].evmTransactionHash, "Require two distinct, ordered treasury and investor authorizations.");
  const transport = options.transport ?? createReadOnlyEvidenceTransport(options);
  requireThat(object(await transport.request("near", "status", []), "NEAR node status").chain_id === "testnet", "NEAR RPC must report testnet.");
  requireThat(quantity(await transport.request("evm", "eth_chainId", [])) === 11155111n, "EVM RPC must report Sepolia.");
  const headBlock = await transport.request("evm", "eth_blockNumber", []);
  const transfers: VerifiedTransfer[] = [];
  for (const [index, leg] of legs.entries()) {
    const sender = index === 0 ? treasury : investor, recipient = index === 0 ? investor : treasury;
    const params = { tx_hash: leg.nearTransactionHash, sender_account_id: sender.nearAccountId, wait_until: "FINAL" };
    let nearTransaction: unknown;
    try { nearTransaction = await transport.request("near", "tx_status", params); }
    catch (error) {
      if (!(error instanceof EvidenceVerificationError) || error.code !== "METHOD_NOT_FOUND") throw error;
      nearTransaction = await transport.request("near", "EXPERIMENTAL_tx_status", params);
    }
    const evmTransaction = await transport.request("evm", "eth_getTransactionByHash", [leg.evmTransactionHash]);
    const receipt = await transport.request("evm", "eth_getTransactionReceipt", [leg.evmTransactionHash]);
    transfers.push(verifyTransferProof(leg, {
      senderAccountId: sender.nearAccountId, senderAddress: sender.evmAddress, recipientAddress: recipient.evmAddress,
      derivationPath: PATH, tokenAddress: SEPOLIA_LINK, minimumConfirmations: evm.minimumConfirmations,
    }, { nearTransaction, evmTransaction, receipt, headBlock }));
  }
  requireThat(BigInt(transfers[1].blockNumber) > BigInt(transfers[0].blockNumber), "Investor return must be mined in a later block than treasury delivery.");
  return { status: "verified", operatorModel: "single-operator-demo", transfers };
}
