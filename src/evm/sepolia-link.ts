import { Interface, Signature, Transaction, getAddress, toBeHex } from "ethers";
import { VERIFIED_IDENTITIES, requireRole } from "../near/identities.js";
import type { AuthorityRole } from "../near/config.js";
import { SEPOLIA_LINK, normalizeEvmSignatureScalar } from "../evidence/verify.js";
import {
  buildUnsignedErc20Transfer, validateTransferPreflight,
  type PreparedErc20Transfer, type TransferPreflightSnapshot,
} from "./erc20-transfer.js";

const MAX = (1n << 256n) - 1n;
const abi = new Interface([
  "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const TRANSFER_TOPIC = abi.getEvent("Transfer")!.topicHash;
export const LINK_TRANSFER_AMOUNTS = Object.freeze({ treasury: 1_000_000_000_000_000_000n, investor: 100_000_000_000_000_000n });
export const SEPOLIA_READ_METHODS = Object.freeze([
  "eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getBalance",
  "eth_getTransactionCount", "eth_estimateGas", "eth_maxPriorityFeePerGas",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_blockNumber", "eth_getLogs",
] as const);
export type SepoliaReadMethod = typeof SEPOLIA_READ_METHODS[number];
export interface SepoliaReadRpc { request(method: SepoliaReadMethod, params: readonly unknown[]): Promise<unknown> }
export interface LinkFeePolicy { readonly gasLimitCap: bigint; readonly maxFeePerGasCap: bigint; readonly maxTotalFeeWei: bigint }
export interface LinkBalances { readonly treasuryLink: bigint; readonly investorLink: bigint; readonly treasuryEth: bigint; readonly investorEth: bigint }
export interface LinkTokenBalances { readonly treasuryLink: bigint; readonly investorLink: bigint }
export interface LinkPreflight {
  readonly role: AuthorityRole; readonly policy: LinkFeePolicy;
  readonly prepared: PreparedErc20Transfer; readonly snapshot: TransferPreflightSnapshot;
  readonly blockNumber: bigint; readonly blockHash: string; readonly balances: LinkBalances;
}
export interface VerifiedLinkReceipt {
  readonly transactionHash: string; readonly blockNumber: bigint; readonly blockHash: string;
  readonly confirmations: bigint; readonly actualFeeWei: bigint;
  readonly before: LinkTokenBalances; readonly after: LinkTokenBalances;
  readonly tokenDeltas: Readonly<{ treasury: bigint; investor: bigint }>;
}
export class SepoliaLinkError extends Error {
  constructor(readonly code: "INVALID_STATE" | "PREFLIGHT_FAILED" | "RPC_FAILED" | "NOT_MINED" | "RECEIPT_FAILED", message: string) {
    super(message); this.name = "SepoliaLinkError";
  }
}
function check(condition: unknown, message: string, code: SepoliaLinkError["code"] = "PREFLIGHT_FAILED"): asserts condition {
  if (!condition) throw new SepoliaLinkError(code, message);
}
function record(value: unknown): Record<string, any> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Unsupported Sepolia RPC/state object.");
  return value as Record<string, any>;
}
function uint(value: unknown, label: string, positive = false): bigint {
  check(typeof value === "bigint" && value >= (positive ? 1n : 0n) && value <= MAX, `${label} must be a bounded uint256 bigint.`);
  return value;
}
function quantity(value: unknown): bigint {
  check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid Sepolia RPC quantity.");
  return uint(BigInt(value), "RPC quantity");
}
function tag(value: bigint): string { return `0x${uint(value, "block number").toString(16)}`; }
function hash(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "Invalid Sepolia transaction or block hash.");
  return value.toLowerCase();
}
function address(value: unknown): string {
  check(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), "Invalid Sepolia address.");
  try { return getAddress(value); } catch { throw new SepoliaLinkError("INVALID_STATE", "Invalid Sepolia address checksum."); }
}
function policy(value: LinkFeePolicy): LinkFeePolicy {
  record(value);
  return Object.freeze({ gasLimitCap: uint(value.gasLimitCap, "gasLimitCap", true), maxFeePerGasCap: uint(value.maxFeePerGasCap, "maxFeePerGasCap", true), maxTotalFeeWei: uint(value.maxTotalFeeWei, "maxTotalFeeWei", true) });
}
function roles(roleValue: AuthorityRole) {
  const role = requireRole(roleValue), other = role === "treasury" ? "investor" : "treasury";
  return { role, sender: VERIFIED_IDENTITIES[role].evmAddress, recipient: VERIFIED_IDENTITIES[other].evmAddress };
}
async function read(rpc: SepoliaReadRpc, method: SepoliaReadMethod, params: readonly unknown[]): Promise<unknown> {
  try { return await rpc.request(method, params); }
  catch { throw new SepoliaLinkError("RPC_FAILED", `Sepolia read failed (${method}); check the public RPC and retry the read only.`); }
}
function decode(method: "decimals" | "balanceOf" | "transfer", value: unknown): unknown {
  check(typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value), `Invalid LINK ${method} return data.`);
  try { return abi.decodeFunctionResult(method, value)[0]; }
  catch { throw new SepoliaLinkError("PREFLIGHT_FAILED", `Unsupported LINK ${method} return data.`); }
}
async function balance(rpc: SepoliaReadRpc, owner: string, blockTag: string): Promise<bigint> {
  return uint(decode("balanceOf", await read(rpc, "eth_call", [{ to: SEPOLIA_LINK, data: abi.encodeFunctionData("balanceOf", [owner]) }, blockTag])), "LINK balance");
}
function assertCaps(prepared: PreparedErc20Transfer, limits: LinkFeePolicy): void {
  check(prepared.gasLimit <= limits.gasLimitCap, "Buffered gas limit exceeds the approved gasLimitCap.");
  check(prepared.maxFeePerGas <= limits.maxFeePerGasCap, "Selected fee exceeds the approved maxFeePerGasCap.");
  check(prepared.maximumFeeWei <= limits.maxTotalFeeWei, "Maximum transaction fee exceeds the approved maxTotalFeeWei.");
}

/** Integrity and fixed-intent check; optional trusted caps authenticate the stored policy limits. */
export function assertLinkPreflight(value: LinkPreflight, expectedPolicy?: LinkFeePolicy): void {
  record(value);
  const identity = roles(value.role), limits = policy(value.policy);
  if (expectedPolicy) {
    const expected = policy(expectedPolicy);
    check(Object.keys(expected).every((key) => limits[key as keyof LinkFeePolicy] === expected[key as keyof LinkFeePolicy]), "Stored fee policy differs from the freshly supplied approved limits.", "INVALID_STATE");
  }
  record(value.prepared);
  const rebuilt = buildUnsignedErc20Transfer({
    chainId: 11155111n, senderAddress: identity.sender, recipientAddress: identity.recipient,
    tokenAddress: SEPOLIA_LINK, amount: LINK_TRANSFER_AMOUNTS[identity.role],
    nonce: value.prepared.nonce, gasLimit: value.prepared.gasLimit,
    maxFeePerGas: value.prepared.maxFeePerGas, maxPriorityFeePerGas: value.prepared.maxPriorityFeePerGas,
  });
  check(Object.entries(rebuilt).every(([key, expected]) => value.prepared[key as keyof PreparedErc20Transfer] === expected), "Stored preflight differs from the fixed verified LINK transfer intent.", "INVALID_STATE");
  assertCaps(rebuilt, limits);
  uint(value.blockNumber, "preflight block number", true); hash(value.blockHash); record(value.balances);
  for (const key of ["treasuryLink", "investorLink", "treasuryEth", "investorEth"] as const) uint(value.balances[key], key);
  validateTransferPreflight(rebuilt, value.snapshot);
  check(rebuilt.gasLimit === (value.snapshot.estimatedGas * 120n + 99n) / 100n, "Stored gas limit differs from the approved estimate buffer rule.", "INVALID_STATE");
  check(value.snapshot.tokenBalance === value.balances[identity.role === "treasury" ? "treasuryLink" : "investorLink"] && value.snapshot.nativeBalance === value.balances[identity.role === "treasury" ? "treasuryEth" : "investorEth"], "Stored sender balances disagree with the preflight snapshot.", "INVALID_STATE");
}

async function observe(role: AuthorityRole, rpc: SepoliaReadRpc) {
  const identity = roles(role);
  check(quantity(await read(rpc, "eth_chainId", [])) === 11155111n, "The EVM RPC must report Ethereum Sepolia.");
  const block = record(await read(rpc, "eth_getBlockByNumber", ["latest", false]));
  const blockNumber = quantity(block.number), blockHash = hash(block.hash), blockTag = tag(blockNumber);
  check(blockNumber > 0n, "A mined Sepolia block is required.");
  const baseFeePerGas = quantity(block.baseFeePerGas);
  const call = { from: identity.sender, to: SEPOLIA_LINK, data: abi.encodeFunctionData("transfer", [identity.recipient, LINK_TRANSFER_AMOUNTS[role]]), value: "0x0" };
  const [tokenCode, treasuryCode, investorCode, decimals, treasuryLink, investorLink, treasuryEth, investorEth, confirmedNonce, pendingNonce, simulation, gas] = await Promise.all([
    read(rpc, "eth_getCode", [SEPOLIA_LINK, blockTag]),
    read(rpc, "eth_getCode", [VERIFIED_IDENTITIES.treasury.evmAddress, blockTag]),
    read(rpc, "eth_getCode", [VERIFIED_IDENTITIES.investor.evmAddress, blockTag]),
    read(rpc, "eth_call", [{ to: SEPOLIA_LINK, data: abi.encodeFunctionData("decimals") }, blockTag]),
    balance(rpc, VERIFIED_IDENTITIES.treasury.evmAddress, blockTag), balance(rpc, VERIFIED_IDENTITIES.investor.evmAddress, blockTag),
    read(rpc, "eth_getBalance", [VERIFIED_IDENTITIES.treasury.evmAddress, blockTag]),
    read(rpc, "eth_getBalance", [VERIFIED_IDENTITIES.investor.evmAddress, blockTag]),
    read(rpc, "eth_getTransactionCount", [identity.sender, blockTag]), read(rpc, "eth_getTransactionCount", [identity.sender, "pending"]),
    read(rpc, "eth_call", [call, blockTag]), read(rpc, "eth_estimateGas", [call, blockTag]),
  ]);
  check(typeof tokenCode === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(tokenCode), "Official Sepolia LINK must have deployed bytecode.");
  check(treasuryCode === "0x" && investorCode === "0x", "Both verified derived role addresses must remain EOAs without code.");
  check(decode("decimals", decimals) === 18n, "Official Sepolia LINK must report 18 decimals.");
  check(decode("transfer", simulation) === true, "LINK transfer simulation must return true.");
  const confirmed = quantity(confirmedNonce), pending = quantity(pendingNonce);
  check(confirmed === pending && pending <= BigInt(Number.MAX_SAFE_INTEGER), "Resolve pending transactions or an unsupported nonce before preparing a transfer.");
  const balances = Object.freeze({ treasuryLink, investorLink, treasuryEth: quantity(treasuryEth), investorEth: quantity(investorEth) });
  const estimatedGas = quantity(gas);
  check(estimatedGas > 0n, "RPC gas estimate must be positive.");
  const snapshot: TransferPreflightSnapshot = {
    chainId: 11155111n, senderAddress: identity.sender, tokenAddress: SEPOLIA_LINK, tokenCode,
    pendingNonce: Number(pending), estimatedGas, tokenBalance: role === "treasury" ? treasuryLink : investorLink,
    nativeBalance: role === "treasury" ? balances.treasuryEth : balances.investorEth, baseFeePerGas,
  };
  const canonical = record(await read(rpc, "eth_getBlockByNumber", [blockTag, false]));
  check(hash(canonical.hash) === blockHash && quantity(canonical.number) === blockNumber, "Preflight block changed during public reads; repeat preparation.");
  return { snapshot: Object.freeze(snapshot), blockNumber, blockHash, balances };
}

/** Public reads only; fixed one-LINK delivery or 0.1-LINK return, never submission. */
export async function prepareSepoliaLinkTransfer(role: AuthorityRole, limits: LinkFeePolicy, rpc: SepoliaReadRpc): Promise<LinkPreflight> {
  const identity = roles(role), checkedPolicy = policy(limits), observed = await observe(role, rpc);
  const priority = quantity(await read(rpc, "eth_maxPriorityFeePerGas", []));
  const prepared = buildUnsignedErc20Transfer({
    chainId: 11155111n, senderAddress: identity.sender, recipientAddress: identity.recipient,
    tokenAddress: SEPOLIA_LINK, amount: LINK_TRANSFER_AMOUNTS[role], nonce: observed.snapshot.pendingNonce,
    gasLimit: (observed.snapshot.estimatedGas * 120n + 99n) / 100n,
    maxFeePerGas: observed.snapshot.baseFeePerGas * 2n + priority, maxPriorityFeePerGas: priority,
  });
  assertCaps(prepared, checkedPolicy); validateTransferPreflight(prepared, observed.snapshot);
  const result = Object.freeze({ role, policy: checkedPolicy, prepared, ...observed });
  assertLinkPreflight(result);
  return result;
}

/** Revalidate exact stored intent against fresh public state; never alter or resend it. */
export async function recheckSepoliaLinkTransfer(preflight: LinkPreflight, rpc: SepoliaReadRpc) {
  assertLinkPreflight(preflight);
  const current = await observe(preflight.role, rpc);
  validateTransferPreflight(preflight.prepared, current.snapshot);
  return Object.freeze({ snapshot: current.snapshot, blockNumber: current.blockNumber, blockHash: current.blockHash });
}

/** Pure exact-delta check, also usable by offline fixtures without signing anything. */
export function assertLinkTokenDeltas(role: AuthorityRole, before: LinkTokenBalances, after: LinkTokenBalances) {
  roles(role);
  const treasury = uint(after.treasuryLink, "after treasury LINK") - uint(before.treasuryLink, "before treasury LINK");
  const investor = uint(after.investorLink, "after investor LINK") - uint(before.investorLink, "before investor LINK");
  const expected = LINK_TRANSFER_AMOUNTS[role] * (role === "treasury" ? -1n : 1n);
  check(treasury === expected && investor === -expected, "Parent/current block LINK balance deltas do not equal the isolated fixed transfer.", "RECEIPT_FAILED");
  return Object.freeze({ treasury, investor });
}

/** Require the mined block to contain exactly the intended LINK movement involving either role. */
export function assertIsolatedLinkTransferLogs(role: AuthorityRole, logs: readonly unknown[], expectedHash: string, blockHash: string) {
  const identity = roles(role), relevant = new Map<string, { hash: string; from: string; to: string; amount: bigint; fingerprint: string }>();
  check(Array.isArray(logs), "LINK block logs must be an array.", "RECEIPT_FAILED");
  for (const value of logs) {
    const log = record(value);
    check(address(log.address) === SEPOLIA_LINK && log.removed === false && hash(log.blockHash) === hash(blockHash) && Array.isArray(log.topics) && log.topics[0] === TRANSFER_TOPIC, "Invalid or removed LINK block log.", "RECEIPT_FAILED");
    const decoded = abi.parseLog({ topics: log.topics, data: log.data });
    check(decoded, "LINK Transfer log cannot be decoded.", "RECEIPT_FAILED");
    const from = address(decoded.args.from), to = address(decoded.args.to), amount = uint(decoded.args.value, "Transfer amount");
    check([from, to].some((who) => who === VERIFIED_IDENTITIES.treasury.evmAddress || who === VERIFIED_IDENTITIES.investor.evmAddress), "RPC returned a log outside the requested role filters.", "RECEIPT_FAILED");
    const transactionHash = hash(log.transactionHash), index = quantity(log.logIndex).toString();
    const key = `${transactionHash}:${index}`, fingerprint = `${from}:${to}:${amount}:${hash(log.blockHash)}`;
    const previous = relevant.get(key);
    check(!previous || previous.fingerprint === fingerprint, "RPC role-filter results disagree about one LINK log.", "RECEIPT_FAILED");
    relevant.set(key, { hash: transactionHash, from, to, amount, fingerprint });
  }
  const unique = [...relevant.values()];
  check(unique.length === 1 && unique[0].hash === hash(expectedHash) && unique[0].from === identity.sender && unique[0].to === identity.recipient && unique[0].amount === LINK_TRANSFER_AMOUNTS[role], "Concurrent, missing or unexpected LINK movement touches a verified role in the mined block.", "RECEIPT_FAILED");
  return [...relevant.keys()][0];
}

/** Check one mined transaction and its isolated parent/current token state. No polling or broadcasting. */
export async function verifySepoliaLinkReceipt(preflight: LinkPreflight, expectedTxHash: string, rpc: SepoliaReadRpc): Promise<VerifiedLinkReceipt> {
  assertLinkPreflight(preflight);
  const expectedHash = hash(expectedTxHash), identity = roles(preflight.role), prepared = preflight.prepared;
  check(quantity(await read(rpc, "eth_chainId", [])) === 11155111n, "The EVM RPC must report Sepolia.");
  const [transactionValue, receiptValue, headValue] = await Promise.all([
    read(rpc, "eth_getTransactionByHash", [expectedHash]), read(rpc, "eth_getTransactionReceipt", [expectedHash]), read(rpc, "eth_blockNumber", []),
  ]);
  check(transactionValue !== null && receiptValue !== null, "Transaction or receipt is not mined yet; repeat verification only, never resend automatically.", "NOT_MINED");
  const raw = record(transactionValue), receipt = record(receiptValue);
  check(quantity(raw.type) === 2n && quantity(raw.chainId) === 11155111n && hash(raw.hash) === expectedHash && address(raw.from) === identity.sender && address(raw.to) === SEPOLIA_LINK && quantity(raw.value) === 0n && raw.input === prepared.data, "Mined transaction chain, role, token, ETH value or calldata differs from the approved transfer.", "RECEIPT_FAILED");
  check(quantity(raw.nonce) === BigInt(prepared.nonce) && quantity(raw.gas) === prepared.gasLimit && quantity(raw.maxFeePerGas) === prepared.maxFeePerGas && quantity(raw.maxPriorityFeePerGas) === prepared.maxPriorityFeePerGas && Array.isArray(raw.accessList) && raw.accessList.length === 0, "Mined transaction nonce, gas or fee fields differ from preparation.", "RECEIPT_FAILED");
  const parity = quantity(raw.v);
  check([0n, 1n, 27n, 28n].includes(parity), "Unsupported transaction signature recovery value.", "RECEIPT_FAILED");
  const tx = Transaction.from(prepared.unsignedSerialized);
  tx.signature = Signature.from({ r: normalizeEvmSignatureScalar(raw.r), s: normalizeEvmSignatureScalar(raw.s), v: Number(parity) });
  check(tx.hash === expectedHash && tx.from === identity.sender, "Mined signature does not reconstruct the approved sender/hash.", "RECEIPT_FAILED");
  const blockNumber = quantity(receipt.blockNumber), blockHash = hash(receipt.blockHash), head = quantity(headValue);
  check(quantity(receipt.status) === 1n && hash(receipt.transactionHash) === expectedHash && blockHash === hash(raw.blockHash) && blockNumber === quantity(raw.blockNumber) && address(receipt.from) === identity.sender && address(receipt.to) === SEPOLIA_LINK, "Receipt failed or does not match the mined transaction.", "RECEIPT_FAILED");
  check(blockNumber > preflight.blockNumber && head >= blockNumber && head - blockNumber + 1n >= 2n, "Receipt requires a later mined block and at least two confirmations.", "RECEIPT_FAILED");
  const gasUsed = quantity(receipt.gasUsed), gasPrice = quantity(receipt.effectiveGasPrice), actualFeeWei = gasUsed * gasPrice;
  check(gasUsed > 0n && gasUsed <= prepared.gasLimit && gasPrice <= prepared.maxFeePerGas && actualFeeWei <= preflight.policy.maxTotalFeeWei, "Receipt gas or actual fee exceeds approved bounds.", "RECEIPT_FAILED");
  const blockTag = tag(blockNumber), parentTag = tag(blockNumber - 1n);
  const [block, parent] = await Promise.all([read(rpc, "eth_getBlockByNumber", [blockTag, false]), read(rpc, "eth_getBlockByNumber", [parentTag, false])]);
  check(hash(record(block).hash) === blockHash && quantity(record(block).number) === blockNumber && hash(record(block).parentHash) === hash(record(parent).hash) && quantity(record(parent).number) === blockNumber - 1n, "Receipt block or parent is no longer canonical.", "RECEIPT_FAILED");
  const minedBaseFee = quantity(record(block).baseFeePerGas);
  const uncappedPrice = minedBaseFee + prepared.maxPriorityFeePerGas;
  const expectedPrice = uncappedPrice < prepared.maxFeePerGas ? uncappedPrice : prepared.maxFeePerGas;
  check(minedBaseFee <= prepared.maxFeePerGas && gasPrice === expectedPrice, "Receipt effective gas price disagrees with mined EIP-1559 fee fields.", "RECEIPT_FAILED");
  const roleTopics = [VERIFIED_IDENTITIES.treasury.evmAddress, VERIFIED_IDENTITIES.investor.evmAddress].map((who) => toBeHex(BigInt(who), 32));
  const [beforeTreasury, beforeInvestor, afterTreasury, afterInvestor, fromLogs, toLogs] = await Promise.all([
    balance(rpc, VERIFIED_IDENTITIES.treasury.evmAddress, parentTag), balance(rpc, VERIFIED_IDENTITIES.investor.evmAddress, parentTag),
    balance(rpc, VERIFIED_IDENTITIES.treasury.evmAddress, blockTag), balance(rpc, VERIFIED_IDENTITIES.investor.evmAddress, blockTag),
    read(rpc, "eth_getLogs", [{ address: SEPOLIA_LINK, fromBlock: blockTag, toBlock: blockTag, topics: [TRANSFER_TOPIC, roleTopics] }]),
    read(rpc, "eth_getLogs", [{ address: SEPOLIA_LINK, fromBlock: blockTag, toBlock: blockTag, topics: [TRANSFER_TOPIC, null, roleTopics] }]),
  ]);
  check(Array.isArray(fromLogs) && Array.isArray(toLogs) && Array.isArray(receipt.logs), "Receipt/block LINK logs are missing.", "RECEIPT_FAILED");
  const blockLog = assertIsolatedLinkTransferLogs(preflight.role, [...fromLogs, ...toLogs], expectedHash, blockHash);
  const receiptRoleLogs = receipt.logs.filter((value: unknown) => {
    const log = record(value);
    return address(log.address) === SEPOLIA_LINK && Array.isArray(log.topics) && log.topics[0] === TRANSFER_TOPIC;
  });
  const receiptLog = assertIsolatedLinkTransferLogs(preflight.role, receiptRoleLogs, expectedHash, blockHash);
  check(blockLog === receiptLog, "Receipt and canonical block disagree on the LINK event index.", "RECEIPT_FAILED");
  const before = Object.freeze({ treasuryLink: beforeTreasury, investorLink: beforeInvestor }), after = Object.freeze({ treasuryLink: afterTreasury, investorLink: afterInvestor });
  const tokenDeltas = assertLinkTokenDeltas(preflight.role, before, after);
  check(hash(record(await read(rpc, "eth_getBlockByNumber", [blockTag, false])).hash) === blockHash, "Receipt block changed during balance verification.", "RECEIPT_FAILED");
  return Object.freeze({ transactionHash: expectedHash, blockNumber, blockHash, confirmations: head - blockNumber + 1n, actualFeeWei, before, after, tokenDeltas });
}

/** Actual fetch adapter, exposing only the enumerated public EVM reads. No retries. */
export function createSepoliaReadRpc(publicHttpsUrl = "https://ethereum-sepolia-rpc.publicnode.com"): SepoliaReadRpc {
  let url: URL;
  try { url = new URL(publicHttpsUrl); } catch { throw new SepoliaLinkError("INVALID_STATE", "Use a valid public Sepolia HTTPS RPC URL."); }
  check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "Use a public HTTPS RPC URL without credentials, query strings or fragments.", "INVALID_STATE");
  return Object.freeze({ async request(method: SepoliaReadMethod, params: readonly unknown[]): Promise<unknown> {
    check((SEPOLIA_READ_METHODS as readonly string[]).includes(method), "RPC method is outside the Sepolia read-only allowlist.", "INVALID_STATE");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, redirect: "error", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error();
      const result = record(await response.json());
      if (result.jsonrpc !== "2.0" || result.id !== 1 || result.error || !("result" in result)) throw new Error();
      return result.result;
    } catch { throw new SepoliaLinkError("RPC_FAILED", `Sepolia read failed (${method}); check public endpoint availability.`); }
  } });
}
