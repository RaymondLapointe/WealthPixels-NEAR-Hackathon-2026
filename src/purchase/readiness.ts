import { Interface, getAddress, keccak256 } from "ethers";
import { baseDecode } from "near-api-js";
import { DERIVATION_PATH, ECDSA_DOMAIN_ID, MPC_CONTRACT_ID, type AuthorityRole } from "../near/config.js";
import { mpcFundingInputsFromProtocolConfig, purchaseMpcFundingModel, type MpcFundingInputs, type MpcFundingModel } from "../near/mpc-funding.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../near/identities.js";
import { MPC_READ_METHODS, ReadOnlyMpcClient, type MpcViewTransport } from "../near/mpc.js";
import type { VerifiedRoleMpc } from "../near/signing.js";
import { createSepoliaReadRpc, type SepoliaReadRpc } from "../evm/sepolia-link.js";
import { DEFAULT_NATIVE_DELIVERY_POLICY, estimateNativeDeliveryFees, type NativeDeliveryPolicy, type NativeDeliverySnapshot } from "../evm/sepolia-native.js";
import { SEPOLIA_ASSETS, purchaseExecutionPolicyForLeg } from "./config.js";
import { assertPurchaseTerms, type PurchaseTerms } from "./terms.js";
import { PURCHASE_FEE_LEGS, type PurchaseFeeLeg } from "./fee-eligibility.js";
import type { CompletePurchaseCosts, EvmLegCostObservation } from "./costs.js";
import type { FundingInventorySnapshot } from "./journal.js";
import { frozen, label, purchaseId } from "./integrity.js";

const abi = new Interface([
  "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function transfer(address,uint256) returns(bool)", "function paused() view returns(bool)",
  "function isBlacklisted(address) view returns(bool)", "function implementation() view returns(address)",
]);
const ROLES = ["treasury", "investor"] as const;
const NEAR_METHODS = ["status", "block", "query", "EXPERIMENTAL_protocol_config", "gas_price"] as const;
export type NearReadMethod = typeof NEAR_METHODS[number];
export interface NearReadRpc { request(method: NearReadMethod, params: unknown): Promise<unknown> }
export interface ReadinessOptions {
  readonly evmRpcUrl: string; readonly nearRpcUrl: string; readonly maxObservationAgeMs?: number;
  /** A reviewed pin, never inferred from the same untrusted observation it is validating. */
  readonly usdcImplementationPin?: { readonly address: string; readonly codeHash: string };
}
/** Injection is explicitly labelled offline and cannot produce a live observation. */
export interface ReadinessPorts { readonly mode: "offline-fixtures"; readonly evm: SepoliaReadRpc; readonly near: NearReadRpc; readonly now: () => number }
export interface EvmRoleReadiness {
  readonly address: string; readonly ethWei: bigint; readonly usdcBaseUnits: bigint; readonly linkBaseUnits: bigint;
  readonly confirmedNonce: number; readonly pendingNonce: number;
}
export interface NearRoleReadiness {
  readonly accountId: string; readonly amountYocto: bigint; readonly lockedYocto: bigint; readonly storageBytes: bigint;
  readonly storageReserveYocto: bigint; readonly spendableYocto: bigint; readonly authority: VerifiedRoleMpc;
}
export interface PublicReadiness {
  readonly mode: "live" | "offline"; readonly sampledAt: string; readonly expiresAt: string;
  readonly inventory: FundingInventorySnapshot;
  readonly evm: {
    readonly chainId: 11155111n; readonly blockNumber: bigint; readonly blockHash: string; readonly blockTimestamp: string;
    readonly baseFeePerGasWei: bigint; readonly usdcCode: string; readonly linkCode: string;
    readonly usdcDecimals: 6; readonly linkDecimals: 18; readonly usdcPaused: false;
    readonly treasuryBlacklisted: false; readonly investorBlacklisted: false;
    readonly usdcImplementationAddress: string; readonly usdcImplementationCodeHash: string;
    readonly treasury: EvmRoleReadiness; readonly investor: EvmRoleReadiness;
  };
  readonly near: {
    readonly blockHeight: bigint; readonly blockHash: string; readonly blockTimestamp: string;
    readonly gasPriceYoctoNear: bigint; readonly storageAmountPerByteYocto: bigint;
    readonly fundingInputs: MpcFundingInputs; readonly fundingModel: MpcFundingModel;
    readonly treasury: NearRoleReadiness; readonly investor: NearRoleReadiness;
  };
}
export interface NearSigningAssumptions {
  readonly estimatedExecutionGas: bigint; readonly transactionOverheadGas: bigint; readonly executionAssumptionReference: string;
}
/** Conservative benchmark, not a signing guarantee: authentic 8Lf5... receipt gas < 10 Tgas;
 * reserve an additional 1 Tgas transaction overhead, then apply the normal >=20% estimate buffer.
 * Full protocol receipt purchase funding remains separate from this expected burn estimate.
 */
export const RECORDED_MPC_SIGNING_ASSUMPTIONS: NearSigningAssumptions = Object.freeze({
  estimatedExecutionGas: 10_000_000_000_000n, transactionOverheadGas: 1_000_000_000_000n,
  executionAssumptionReference: "Historical successful MPC receipt benchmark <10 Tgas plus 1 Tgas explicit overhead; https://testnet.nearblocks.io/txns/8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs; estimate receives >=20% buffer; not an upper execution guarantee",
});
export interface CostCollectionOptions extends ReadinessOptions {
  readonly purchaseId: string;
  readonly fees: { readonly maxFeePerGasWei: bigint; readonly maxPriorityFeePerGasWei: bigint };
  readonly feesByLeg?: Readonly<Record<PurchaseFeeLeg, { readonly maxFeePerGasWei: bigint; readonly maxPriorityFeePerGasWei: bigint }>>;
  readonly nearSigningAssumptions: NearSigningAssumptions; readonly executionPolicy?: NativeDeliveryPolicy;
}
export class ReadinessError extends Error {
  constructor(readonly code: "INVALID_CONFIG" | "RPC_FAILED" | "INVALID_OBSERVATION" | "INSUFFICIENT_FUNDS" | "LIMIT_EXCEEDED", message: string) {
    super(message); this.name = "ReadinessError";
  }
}
function check(condition: unknown, message: string, code: ReadinessError["code"] = "INVALID_OBSERVATION"): asserts condition {
  if (!condition) throw new ReadinessError(code, message);
}
function object(value: unknown): Record<string, any> { check(value && typeof value === "object" && !Array.isArray(value), "Missing or malformed public RPC object."); return value as Record<string, any>; }
function uint(value: unknown): bigint { check(typeof value === "bigint" && value >= 0n && value < 1n << 256n, "Invalid bounded public integer."); return value; }
function quantity(value: unknown): bigint { check(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), "Invalid EVM RPC quantity."); return uint(BigInt(value)); }
function decimal(value: unknown): bigint { check(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), "Invalid NEAR RPC integer."); return uint(BigInt(value)); }
function integer(value: unknown): bigint { check(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "Invalid public integer."); return BigInt(value); }
function hexHash(value: unknown): string { check(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "Invalid public block/code hash."); return value.toLowerCase(); }
function nearHash(value: unknown): string { check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32, "Invalid NEAR block hash."); return value; }
function tag(value: bigint): string { return "0x" + uint(value).toString(16); }
function nonce(value: unknown): number { const n = quantity(value); check(n <= BigInt(Number.MAX_SAFE_INTEGER), "Unsupported EVM nonce."); return Number(n); }
function code(value: unknown): string { check(typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value), "Expected deployed contract bytecode."); return value; }
function url(value: string): string {
  try { const parsed = new URL(value); check(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && !parsed.hostname.toLowerCase().includes("mainnet"), "Unsafe RPC URL."); return parsed.toString(); }
  catch { throw new ReadinessError("INVALID_CONFIG", "Use a public HTTPS testnet RPC without credentials, query strings or fragments."); }
}
async function read<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { if (error instanceof ReadinessError) throw error; throw new ReadinessError("RPC_FAILED", `Public readiness read failed (${stage}); raw details suppressed; no retry attempted.`); }
}
function result(method: string, value: unknown): any {
  try { check(typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value), "Malformed token result."); return abi.decodeFunctionResult(method, value)[0]; }
  catch { throw new ReadinessError("INVALID_OBSERVATION", `Malformed token ${method} response.`); }
}
/** Separate read-only transport. No send/sign method or SDK retry path is available. */
export function createNearReadRpc(endpoint: string): NearReadRpc {
  const target = url(endpoint);
  return Object.freeze({ async request(method: NearReadMethod, params: unknown): Promise<unknown> {
    check(NEAR_METHODS.includes(method), "NEAR method is outside the public read allowlist.", "INVALID_CONFIG");
    if (method === "query") {
      const query = object(params);
      check(["view_account", "view_access_key_list", "call_function"].includes(query.request_type), "NEAR query is outside the readiness read allowlist.", "INVALID_CONFIG");
      if (query.request_type === "call_function") check(query.account_id === MPC_CONTRACT_ID && MPC_READ_METHODS.includes(query.method_name),
        "Only verified public MPC view methods are available; signature requests are unavailable.", "INVALID_CONFIG");
    }
    return read(method, async () => {
      const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
        signal: AbortSignal.timeout(20_000), body: JSON.stringify({ jsonrpc: "2.0", id: "wealthpixels-readiness", method, params }) });
      if (!response.ok) throw new Error();
      const body = object(await response.json());
      if (body.jsonrpc !== "2.0" || body.id !== "wealthpixels-readiness" || body.error || !("result" in body)) throw new Error();
      return body.result;
    });
  } });
}
function services(options: ReadinessOptions, ports?: ReadinessPorts) {
  const evmRpcUrl = url(options.evmRpcUrl), nearRpcUrl = url(options.nearRpcUrl);
  check(!ports || ports.mode === "offline-fixtures", "Injected public observations must be labelled offline.", "INVALID_CONFIG");
  const maximumAge = options.maxObservationAgeMs ?? 60_000;
  check(Number.isSafeInteger(maximumAge) && maximumAge > 0 && maximumAge <= 60_000, "Readiness freshness cannot exceed 60 seconds.", "INVALID_CONFIG");
  return { evmRpcUrl, nearRpcUrl, maximumAge, evm: ports?.evm ?? createSepoliaReadRpc(evmRpcUrl), near: ports?.near ?? createNearReadRpc(nearRpcUrl), now: ports?.now ?? Date.now,
    mode: ports ? "offline" as const : "live" as const };
}
function fresh(timestamp: number, sampled: number, maximumAge: number, chain: string): string {
  check(Number.isSafeInteger(timestamp) && timestamp <= sampled + 1000 && sampled - timestamp < maximumAge,
    `${chain} public block is stale, missing or in the future.`); return new Date(timestamp).toISOString();
}
async function inspectEvm(s: ReturnType<typeof services>, sampled: number) {
  const rpc = s.evm, er = (method: Parameters<SepoliaReadRpc["request"]>[0], params: readonly unknown[]) => read(method, () => rpc.request(method, params));
  check(quantity(await er("eth_chainId", [])) === 11155111n, "Readiness requires Ethereum Sepolia chain ID 11155111.");
  const block = object(await er("eth_getBlockByNumber", ["latest", false])), blockNumber = quantity(block.number), blockHash = hexHash(block.hash), blockTag = tag(blockNumber);
  check(blockNumber > 0n, "A mined Sepolia block is required.");
  const blockTimestamp = fresh(Number(quantity(block.timestamp) * 1000n), sampled, s.maximumAge, "Sepolia"), baseFeePerGasWei = quantity(block.baseFeePerGas);
  const call = async (token: string, method: string, args: readonly unknown[] = []) => result(method, await er("eth_call", [{ to: token, data: abi.encodeFunctionData(method, args) }, blockTag]));
  const [usdcCode, linkCode, usdcDecimals, linkDecimals, paused, treasuryBlacklisted, investorBlacklisted, implementation, roleRows] = await Promise.all([
    er("eth_getCode", [SEPOLIA_ASSETS.USDC.address, blockTag]), er("eth_getCode", [SEPOLIA_ASSETS.LINK.address, blockTag]),
    call(SEPOLIA_ASSETS.USDC.address, "decimals"), call(SEPOLIA_ASSETS.LINK.address, "decimals"), call(SEPOLIA_ASSETS.USDC.address, "paused"),
    call(SEPOLIA_ASSETS.USDC.address, "isBlacklisted", [VERIFIED_IDENTITIES.treasury.evmAddress]), call(SEPOLIA_ASSETS.USDC.address, "isBlacklisted", [VERIFIED_IDENTITIES.investor.evmAddress]),
    call(SEPOLIA_ASSETS.USDC.address, "implementation"),
    Promise.all(ROLES.map(async role => {
      const address = VERIFIED_IDENTITIES[role].evmAddress;
      const [accountCode, eth, usdc, link, confirmed, pending] = await Promise.all([er("eth_getCode", [address, blockTag]), er("eth_getBalance", [address, blockTag]),
        call(SEPOLIA_ASSETS.USDC.address, "balanceOf", [address]), call(SEPOLIA_ASSETS.LINK.address, "balanceOf", [address]),
        er("eth_getTransactionCount", [address, blockTag]), er("eth_getTransactionCount", [address, "pending"])]);
      check(accountCode === "0x", "Both derived Ethereum role addresses must remain code-free EOAs.");
      const confirmedNonce = nonce(confirmed), pendingNonce = nonce(pending);
      check(confirmedNonce === pendingNonce, "Resolve pending Ethereum transactions before new payment readiness.");
      return [role, { address, ethWei: quantity(eth), usdcBaseUnits: uint(usdc), linkBaseUnits: uint(link), confirmedNonce, pendingNonce }] as const;
    })),
  ]);
  check(keccak256(code(usdcCode)) === SEPOLIA_ASSETS.USDC.codeHash && keccak256(code(linkCode)) === SEPOLIA_ASSETS.LINK.codeHash, "Official USDC/LINK deployed code identity changed.");
  check(usdcDecimals === 6n && linkDecimals === 18n, "USDC/LINK token decimals changed.");
  check(paused === false && treasuryBlacklisted === false && investorBlacklisted === false, "USDC is paused or a purchase role is blacklisted.");
  const usdcImplementationAddress = getAddress(implementation), usdcImplementationCodeHash = keccak256(code(await er("eth_getCode", [usdcImplementationAddress, blockTag])));
  check(usdcImplementationAddress !== "0x0000000000000000000000000000000000000000", "USDC proxy implementation is missing.");
  const rows = Object.fromEntries(roleRows) as Record<AuthorityRole, EvmRoleReadiness>;
  const canonical = object(await er("eth_getBlockByNumber", [blockTag, false]));
  check(quantity(canonical.number) === blockNumber && hexHash(canonical.hash) === blockHash, "Sepolia readiness block changed during observations.");
  return { chainId: 11155111n as const, blockNumber, blockHash, blockTimestamp, baseFeePerGasWei, usdcCode: code(usdcCode), linkCode: code(linkCode),
    usdcDecimals: 6 as const, linkDecimals: 18 as const, usdcPaused: false as const, treasuryBlacklisted: false as const, investorBlacklisted: false as const,
    usdcImplementationAddress, usdcImplementationCodeHash, ...rows };
}
async function inspectNear(s: ReturnType<typeof services>, sampled: number) {
  const nr = (method: NearReadMethod, params: unknown) => read(method, () => s.near.request(method, params));
  let header: Record<string, any> | undefined;
  const transport: MpcViewTransport = {
    viewNodeStatus: () => nr("status", []),
    async viewBlock(query) { const value = object(await nr("block", query)); header = object(value.header); return value; },
    async callFunction(request) {
      check(MPC_READ_METHODS.includes(request.method), "Nonpublic MPC method is unavailable.");
      const response = object(await nr("query", { request_type: "call_function", account_id: request.contractId,
        method_name: request.method, args_base64: Buffer.from(JSON.stringify(request.args), "utf8").toString("base64"), block_id: request.blockQuery.blockId }));
      check(response.block_hash === request.blockQuery.blockId && Array.isArray(response.result) && response.result.length <= 1_000_000 &&
        response.result.every((item: unknown) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255), "MPC view lacks canonical public block association.");
      try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(response.result))); }
      catch { throw new ReadinessError("INVALID_OBSERVATION", "Malformed public MPC view JSON."); }
    },
  };
  const client = new ReadOnlyMpcClient({ rpcUrl: s.nearRpcUrl }, transport);
  const inspection = await read("MPC inspection", () => client.inspect());
  check(inspection.version === "3.18.0" && inspection.rootPublicKey === VERIFIED_MPC_ROOT && inspection.minimumGasTgas <= 100 && inspection.minimumGasTgas > 0,
    "Live MPC version, root public key or gas requirements differ from the verified signing adapter.");
  const blockHash = nearHash(inspection.blockHash), blockHeight = BigInt(inspection.blockHeight);
  const blockTimestamp = fresh(Number(decimal(header?.timestamp_nanosec ?? header?.timestamp) / 1_000_000n), sampled, s.maximumAge, "NEAR");
  const [protocol, gas, roleRows] = await Promise.all([
    nr("EXPERIMENTAL_protocol_config", { block_id: blockHash }), nr("gas_price", [blockHash]),
    Promise.all(ROLES.map(async role => {
      const identity = VERIFIED_IDENTITIES[role];
      const [derivation, accountRaw, keyRaw] = await Promise.all([client.derive(identity.accountId, DERIVATION_PATH),
        nr("query", { request_type: "view_account", account_id: identity.accountId, block_id: blockHash }),
        nr("query", { request_type: "view_access_key_list", account_id: identity.accountId, block_id: blockHash })]);
      const account = object(accountRaw), keys = object(keyRaw);
      check(account.block_hash === blockHash && keys.block_hash === blockHash && BigInt(account.block_height) === blockHeight && BigInt(keys.block_height) === blockHeight,
        "NEAR account observations differ from the finalized MPC block.");
      check(Array.isArray(keys.keys) && keys.keys.length === 1 && keys.keys[0]?.public_key === identity.accessPublicKey && keys.keys[0]?.access_key?.permission === "FullAccess",
        "Each NEAR role must retain its distinct registered sole FullAccess public key.");
      const accessNonce = keys.keys[0].access_key.nonce;
      const accessKeyNonce = typeof accessNonce === "string" ? decimal(accessNonce) : integer(accessNonce);
      check(accessKeyNonce < (1n << 64n) - 1n && derivation.evmAddress === identity.evmAddress && derivation.localMatchesContract && derivation.blockHash === blockHash,
        "Role MPC derivation or registered access-key nonce is invalid.");
      const authority: VerifiedRoleMpc = { role, inspection, derivation, accessPublicKey: identity.accessPublicKey, accessKeyNonce: accessKeyNonce.toString() };
      return [role, { accountId: identity.accountId, amountYocto: decimal(account.amount), lockedYocto: decimal(account.locked), storageBytes: integer(account.storage_usage), authority }] as const;
    })),
  ]);
  const p = object(protocol), gasPriceYoctoNear = decimal(object(gas).gas_price), storageAmountPerByteYocto = decimal(object(p.runtime_config).storage_amount_per_byte);
  check(p.chain_id === "testnet" && gasPriceYoctoNear > 0n && storageAmountPerByteYocto > 0n, "NEAR gas price, storage price or protocol identity is unavailable.");
  let fundingInputs: MpcFundingInputs, fundingModel: MpcFundingModel;
  try {
    fundingInputs = mpcFundingInputsFromProtocolConfig(p, gasPriceYoctoNear);
    fundingModel = purchaseMpcFundingModel(fundingInputs, gasPriceYoctoNear);
  } catch { throw new ReadinessError("INVALID_OBSERVATION", "Complete supported protocol-88 MPC FunctionCall prefunding inputs are required."); }
  const rows = Object.fromEntries(roleRows.map(([role, value]) => {
    const storageReserveYocto = value.storageBytes * storageAmountPerByteYocto;
    // Conservative: locked validation stake is never treated as liquid signing funding.
    return [role, { ...value, storageReserveYocto, spendableYocto: value.amountYocto > storageReserveYocto ? value.amountYocto - storageReserveYocto : 0n }];
  })) as Record<AuthorityRole, NearRoleReadiness>;
  const canonical = object(object(await nr("block", { block_id: blockHash })).header);
  check(nearHash(canonical.hash) === blockHash && BigInt(canonical.height) === blockHeight, "NEAR finalized observation block changed.");
  return { blockHeight, blockHash, blockTimestamp, gasPriceYoctoNear, storageAmountPerByteYocto, fundingInputs, fundingModel, ...rows };
}
/** Public account/contract inspection only. No terms, transfer call, gas simulation or transaction is created. */
export async function inspectReadiness(options: ReadinessOptions, ports?: ReadinessPorts): Promise<PublicReadiness> {
  const s = services(options, ports), sampled = s.now();
  const [evm, near] = await Promise.all([inspectEvm(s, sampled), inspectNear(s, sampled)]);
  check(s.now() >= sampled && s.now() - sampled < s.maximumAge, "Readiness collection outlived its freshness window.");
  if (options.usdcImplementationPin) check(evm.usdcImplementationAddress === getAddress(options.usdcImplementationPin.address) &&
    evm.usdcImplementationCodeHash === hexHash(options.usdcImplementationPin.codeHash), "USDC implementation differs from the reviewed public pin.");
  const sampledAt = new Date(sampled).toISOString(), expiresAt = new Date(Math.min(sampled + s.maximumAge,
    Date.parse(evm.blockTimestamp) + s.maximumAge, Date.parse(near.blockTimestamp) + s.maximumAge)).toISOString();
  check(s.now() < Date.parse(expiresAt), "Underlying public-block observations expired while readiness was collected.");
  const inventory: FundingInventorySnapshot = {
    mode: s.mode, observedAt: sampledAt, chainId: 11155111n, treasuryAddress: VERIFIED_IDENTITIES.treasury.evmAddress, investorAddress: VERIFIED_IDENTITIES.investor.evmAddress,
    linkTokenAddress: SEPOLIA_ASSETS.LINK.address, usdcTokenAddress: SEPOLIA_ASSETS.USDC.address,
    treasuryNearAccountId: VERIFIED_IDENTITIES.treasury.accountId, investorNearAccountId: VERIFIED_IDENTITIES.investor.accountId,
    blockNumber: evm.blockNumber, blockHash: evm.blockHash, nearBlockHeight: near.blockHeight, nearBlockHash: near.blockHash,
    sourceUrl: s.evmRpcUrl, reference: `Sepolia ${evm.blockHash}; finalized NEAR ${near.blockHash}; ${s.nearRpcUrl}; ${s.mode === "offline" ? "INJECTED OFFLINE FIXTURES ONLY" : "public read-only observations"}`,
    treasuryEthWei: evm.treasury.ethWei, treasuryLinkBaseUnits: evm.treasury.linkBaseUnits, investorEthWei: evm.investor.ethWei, investorUsdcBaseUnits: evm.investor.usdcBaseUnits,
    treasurySpendableNearYocto: near.treasury.spendableYocto, investorSpendableNearYocto: near.investor.spendableYocto,
  };
  return frozen({ mode: s.mode, sampledAt, expiresAt, inventory, evm, near });
}
/** Role-specific public authority verification without EVM transfer or credential access. */
export async function inspectNearSigningAuthority(options: ReadinessOptions, role: AuthorityRole, ports?: ReadinessPorts): Promise<VerifiedRoleMpc> {
  check(role === "treasury" || role === "investor", "Select one explicit NEAR signing role.", "INVALID_CONFIG");
  const s = services(options, ports), sampled = s.now(), near = await inspectNear(s, sampled);
  check(s.now() >= sampled && s.now() < Math.min(sampled + s.maximumAge, Date.parse(near.blockTimestamp) + s.maximumAge),
    "Public NEAR authority observations expired.");
  return frozen(near[role].authority);
}
/** Pre-quote public simulations/estimates, not unsigned transaction preparation. This task invokes it with mocks only.
 * Nonces are observations, not future nonce promises: LINK and ETH execution must each re-observe separately.
 */
export async function collectPurchaseCosts(terms: PurchaseTerms, options: CostCollectionOptions, ports?: ReadinessPorts): Promise<{
  readiness: PublicReadiness; costs: CompletePurchaseCosts; nativeSnapshot: NativeDeliverySnapshot;
}> {
  assertPurchaseTerms(terms); purchaseId(options.purchaseId);
  const s = services(options, ports), assumptions = options.nearSigningAssumptions, limits = options.executionPolicy ?? DEFAULT_NATIVE_DELIVERY_POLICY;
  check(s.mode === "offline" || options.usdcImplementationPin, "A live purchase estimate requires an explicitly reviewed USDC implementation pin.", "INVALID_CONFIG");
  check(assumptions && uint(assumptions.estimatedExecutionGas) > 0n && uint(assumptions.transactionOverheadGas) > 0n &&
    assumptions.estimatedExecutionGas + assumptions.transactionOverheadGas <= 100_000_000_000_000n, "Explicit bounded NEAR signing execution and overhead assumptions are required.", "INVALID_CONFIG");
  label(assumptions.executionAssumptionReference, "Documented NEAR gas assumption");
  const readiness = await inspectReadiness(options, ports), blockTag = tag(readiness.evm.blockNumber), baseFee = readiness.evm.baseFeePerGasWei;
  const assumedBaseFee = baseFee * 2n;
  if (options.feesByLeg) check(Object.keys(options.feesByLeg).sort().join() === [...PURCHASE_FEE_LEGS].sort().join(), "Per-leg selected fees must cover exactly the three purchase legs.", "INVALID_CONFIG");
  const evm: EvmLegCostObservation[] = [];
  let nativeSnapshot: NativeDeliverySnapshot | undefined;
  for (const leg of PURCHASE_FEE_LEGS) {
    const selected = options.feesByLeg?.[leg] ?? options.fees;
    const maxFee = uint(selected.maxFeePerGasWei), priority = uint(selected.maxPriorityFeePerGasWei);
    check(maxFee > 0n && assumedBaseFee + priority <= maxFee, "Selected fee parameters cannot cover the conservative twice-base-fee assumption.", "LIMIT_EXCEEDED");
    const payer = leg === "investor-usdc-payment" ? "investor" as const : "treasury" as const;
    const asset = leg === "investor-usdc-payment" ? "USDC" as const : leg === "treasury-link-delivery" ? "LINK" as const : "ETH" as const;
    const senderAddress = VERIFIED_IDENTITIES[payer].evmAddress, recipientAddress = VERIFIED_IDENTITIES[payer === "investor" ? "treasury" : "investor"].evmAddress;
    const amountBaseUnits = asset === "USDC" ? terms.investmentUsdcBaseUnits : asset === "LINK" ? terms.quantities.linkBaseUnits : terms.quantities.ethWei;
    const call = asset === "ETH" ? { from: senderAddress, to: recipientAddress, value: tag(amountBaseUnits), data: "0x" } :
      { from: senderAddress, to: SEPOLIA_ASSETS[asset].address, value: "0x0", data: abi.encodeFunctionData("transfer", [recipientAddress, amountBaseUnits]) };
    const [simulation, estimateRaw] = await Promise.all([read(`${leg} simulation`, () => s.evm.request("eth_call", [call, blockTag])),
      read(`${leg} gas estimate`, () => s.evm.request("eth_estimateGas", [call, blockTag]))]);
    check(asset === "ETH" ? simulation === "0x" : result("transfer", simulation) === true, `${leg} transfer simulation failed.`);
    const estimatedGas = quantity(estimateRaw);
    estimateNativeDeliveryFees({ estimatedGas, baseFeePerGas: baseFee }, { maxFeePerGas: maxFee, maxPriorityFeePerGas: priority },
      { assumedBaseFeePerGasWei: assumedBaseFee, assumedPriorityFeePerGasWei: priority }, purchaseExecutionPolicyForLeg(limits, leg));
    evm.push({ leg, payer, senderAddress, recipientAddress, asset, tokenAddress: asset === "ETH" ? null : SEPOLIA_ASSETS[asset].address,
      decimals: asset === "USDC" ? 6 : 18, amountBaseUnits, estimatedGas, observedBaseFeePerGasWei: baseFee,
      assumedBaseFeePerGasWei: assumedBaseFee, maxFeePerGasWei: maxFee, maxPriorityFeePerGasWei: priority });
    if (asset === "ETH") nativeSnapshot = { chainId: 11155111n, senderAddress, recipientAddress, senderCode: "0x", recipientCode: "0x",
      confirmedNonce: readiness.evm.treasury.confirmedNonce, pendingNonce: readiness.evm.treasury.pendingNonce,
      treasuryBalanceWei: readiness.evm.treasury.ethWei, investorBalanceWei: readiness.evm.investor.ethWei, estimatedGas, baseFeePerGas: baseFee,
      simulationResult: simulation as string, blockNumber: readiness.evm.blockNumber, blockHash: readiness.evm.blockHash };
  }
  const reserve = (item: EvmLegCostObservation) => (item.estimatedGas * (10_000n + limits.gasBufferBps) + 9999n) / 10_000n * item.maxFeePerGasWei;
  check(readiness.inventory.investorUsdcBaseUnits >= terms.investmentUsdcBaseUnits && readiness.inventory.treasuryLinkBaseUnits >= terms.quantities.linkBaseUnits,
    "Investor USDC or Treasury LINK inventory is insufficient.", "INSUFFICIENT_FUNDS");
  check(readiness.inventory.investorEthWei >= reserve(evm[0]!) && readiness.inventory.treasuryEthWei >= terms.quantities.ethWei + reserve(evm[1]!) + reserve(evm[2]!) + limits.operatingReserveWei,
    "ETH funding cannot cover purchase values, maximum buffered fees and Treasury operating reserve.", "INSUFFICIENT_FUNDS");
  const nearReserve = BigInt(readiness.near.fundingModel.requiredSpendableYocto);
  check(readiness.inventory.investorSpendableNearYocto >= nearReserve && readiness.inventory.treasurySpendableNearYocto >= 2n * nearReserve,
    "Storage-reserved NEAR funding cannot cover one Investor and two Treasury full upfront MPC receipt purchases.", "INSUFFICIENT_FUNDS");
  const canonical = object(await read("cost canonical block", () => s.evm.request("eth_getBlockByNumber", [blockTag, false])));
  check(hexHash(canonical.hash) === readiness.evm.blockHash && quantity(canonical.number) === readiness.evm.blockNumber, "Cost observation block was reorganized.");
  for (const role of ROLES) check(nonce(await read(`${role} final pending nonce`, () => s.evm.request("eth_getTransactionCount", [VERIFIED_IDENTITIES[role].evmAddress, "pending"]))) === readiness.evm[role].confirmedNonce,
    "An Ethereum nonce changed during cost observations.");
  check(s.now() >= Date.parse(readiness.sampledAt) && s.now() < Date.parse(readiness.expiresAt), "Complete cost collection expired; no payment authorization is available.");
  const costs: CompletePurchaseCosts = { schemaVersion: 1, kind: "six-cost-observations", purchaseId: options.purchaseId, termsHash: terms.termsHash,
    mode: readiness.mode, sampledAt: readiness.sampledAt, expiresAt: readiness.expiresAt,
    reference: `${readiness.mode === "offline" ? "INJECTED OFFLINE FIXTURES ONLY; " : ""}Three public simulations and gas estimates; original observation deadlines retained`,
    evmObservation: { chainId: 11155111n, blockNumber: readiness.evm.blockNumber, blockHash: readiness.evm.blockHash, sourceUrl: s.evmRpcUrl,
      reference: `Pinned canonical block ${readiness.evm.blockHash}; USDC implementation ${readiness.evm.usdcImplementationAddress} code ${readiness.evm.usdcImplementationCodeHash}` },
    nearObservation: { networkId: "testnet", blockHeight: readiness.near.blockHeight, blockHash: readiness.near.blockHash,
      sourceUrl: s.nearRpcUrl, reference: `Finalized MPC, accounts, protocol storage, FunctionCall receipt pricing and gas_price observations at ${readiness.near.blockHash}`, gasPriceYoctoNear: readiness.near.gasPriceYoctoNear,
      fundingInputs: readiness.near.fundingInputs },
    assetIdentity: { usdcImplementation: { address: readiness.evm.usdcImplementationAddress, codeHash: readiness.evm.usdcImplementationCodeHash } },
    evm, near: PURCHASE_FEE_LEGS.map((leg, index) => ({ leg, payer: index === 0 ? "investor" : "treasury", accountId: VERIFIED_IDENTITIES[index === 0 ? "investor" : "treasury"].accountId,
      contractId: MPC_CONTRACT_ID, domainId: ECDSA_DOMAIN_ID, derivationPath: DERIVATION_PATH, ...assumptions, attachedGas: 100_000_000_000_000n, attachedDepositYoctoNear: 1n })) };
  check(nativeSnapshot, "Native fee observation is missing.");
  return frozen({ readiness, costs, nativeSnapshot });
}
