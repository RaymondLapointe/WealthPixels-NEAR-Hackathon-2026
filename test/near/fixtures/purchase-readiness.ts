import { readFileSync } from "node:fs";
import { Interface, getBytes } from "ethers";
import { KeyType, PublicKey } from "near-api-js";
import { DERIVATION_PATH } from "../../../src/near/config.js";
import { VERIFIED_IDENTITIES, VERIFIED_MPC_ROOT } from "../../../src/near/identities.js";
import { deriveEvmPublicKey } from "../../../src/near/mpc.js";
import { SEPOLIA_ASSETS } from "../../../src/purchase/config.js";
import type { ReadinessOptions, ReadinessPorts } from "../../../src/purchase/readiness.js";
import { recordedState } from "./recorded-mpc.js";
import { AT } from "./purchase-quote.js";

// Synthetic public-state responses and historical public bytecode ONLY.
// No credentials, network calls, signatures or actual transaction preparation.
const abi = new Interface(["function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function transfer(address,uint256) returns(bool)", "function paused() view returns(bool)",
  "function isBlacklisted(address) view returns(bool)", "function implementation() view returns(address)"]);
const usdc = JSON.parse(readFileSync(new URL("./sepolia-usdc.json", import.meta.url), "utf8"));
export const READINESS_BLOCK_HASH = "0x" + "11".repeat(32);
export const READINESS_NEAR_HASH = "1".repeat(32);
export const READINESS_IMPLEMENTATION = "0x0000000000000000000000000000000000000001";
export const READINESS_IMPLEMENTATION_CODE = "0x60006000";
export const READINESS_OPTIONS: ReadinessOptions = { evmRpcUrl: "https://example.invalid/offline-sepolia", nearRpcUrl: "https://example.invalid/offline-near" };
export interface FakeReadinessOptions {
  chainId?: string; paused?: boolean; blacklisted?: boolean; wrongDecimals?: boolean; wrongCode?: boolean; wrongRoleCode?: boolean;
  pendingNonce?: string; canonicalChanged?: boolean; rootChanged?: boolean; wrongNearKey?: boolean; wrongNearNetwork?: boolean;
  usdcBalance?: bigint; ethBalance?: string; nearAmount?: string; storagePrice?: string; gasEstimate?: string;
  simulationFails?: boolean; failMethod?: string; stale?: boolean; clockAdvances?: boolean;
}
export function readinessFixture(options: FakeReadinessOptions = {}) {
  const requests: { chain: string; method: string; params: any }[] = [];
  let clockReads = 0;
  const nearPoint = (point: string) => new PublicKey({ keyType: KeyType.SECP256K1, data: getBytes(point).slice(1) }).toString();
  const header = { hash: READINESS_NEAR_HASH, height: 1000, timestamp_nanosec: String(BigInt(Date.parse(AT) - 2000) * 1_000_000n) };
  const ports: ReadinessPorts = {
    mode: "offline-fixtures", now: () => Date.parse(AT) + (options.clockAdvances && clockReads++ > 0 ? 60_001 : 0),
    evm: { async request(method, params) {
      requests.push({ chain: "evm", method, params });
      if (options.failMethod === method) throw new Error("https://secret.invalid/credential-DO-NOT-LEAK");
      switch (method) {
        case "eth_chainId": return options.chainId ?? "0xaa36a7";
        case "eth_getBlockByNumber": return { number: "0x64", hash: options.canonicalChanged && params[0] !== "latest" ? "0x" + "22".repeat(32) : READINESS_BLOCK_HASH,
          timestamp: "0x" + Math.floor((Date.parse(AT) - (options.stale ? 70_000 : 10_000)) / 1000).toString(16), baseFeePerGas: "0x3e8" };
        case "eth_getCode": return params[0] === SEPOLIA_ASSETS.USDC.address ? (options.wrongCode ? "0x6000" : usdc.tokenCode) : params[0] === SEPOLIA_ASSETS.LINK.address
          ? recordedState().preflight.snapshot.tokenCode : params[0] === READINESS_IMPLEMENTATION ? READINESS_IMPLEMENTATION_CODE : options.wrongRoleCode ? "0x6000" : "0x";
        case "eth_getBalance": return options.ethBalance ?? "0x16345785d8a0000";
        case "eth_getTransactionCount": return params[1] === "pending" ? options.pendingNonce ?? "0x1" : "0x1";
        case "eth_estimateGas": return options.gasEstimate ?? ((params[0] as any).data === "0x" ? "0x5208" : "0xea60");
        case "eth_call": {
          const call = params[0] as { to: string; data: string };
          if (call.data === "0x") return "0x";
          const parsed = abi.parseTransaction({ data: call.data })!;
          let value: unknown;
          switch (parsed.name) {
            case "decimals": value = call.to === SEPOLIA_ASSETS.USDC.address ? (options.wrongDecimals ? 18n : 6n) : 18n; break;
            case "balanceOf": value = call.to === SEPOLIA_ASSETS.USDC.address ? options.usdcBalance ?? 100_000_000n : 24_100_000_000_000_000_000n; break;
            case "paused": value = options.paused ?? false; break;
            case "isBlacklisted": value = options.blacklisted ?? false; break;
            case "implementation": value = READINESS_IMPLEMENTATION; break;
            case "transfer": value = !options.simulationFails; break;
            default: throw new Error("Unexpected synthetic ABI method");
          }
          return abi.encodeFunctionResult(parsed.name, [value]);
        }
        default: throw new Error("Not a fixture read method");
      }
    } },
    near: { async request(method, paramsValue) {
      const params = paramsValue as any;
      requests.push({ chain: "near", method, params });
      if (options.failMethod === method) throw new Error("https://secret.invalid/credential-DO-NOT-LEAK");
      switch (method) {
        case "status": return { chain_id: options.wrongNearNetwork ? "mainnet" : "testnet" };
        case "block": return { header };
        case "gas_price": return { gas_price: "100000000" };
        case "EXPERIMENTAL_protocol_config": return { chain_id: "testnet", protocol_version: 88,
          runtime_config: { storage_amount_per_byte: options.storagePrice ?? "10000000000000000000", min_gas_purchase_price: "1000000000",
            transaction_costs: {
              action_receipt_creation_config: { send_sir: 108059500000, send_not_sir: 108059500000, execution: 108059500000 },
              action_creation_config: {
                function_call_cost: { send_sir: 2319861500000, send_not_sir: 2319861500000, execution: 2319861500000 },
                function_call_cost_per_byte: { send_sir: 2235934, send_not_sir: 2235934, execution: 2235934 },
              }, pessimistic_gas_price_inflation_ratio: [1, 1],
            } } };
        case "query": {
          const role = params.account_id === VERIFIED_IDENTITIES.investor.accountId ? "investor" : "treasury";
          const shared = { block_hash: READINESS_NEAR_HASH, block_height: 1000 };
          if (params.request_type === "view_account") return { ...shared, amount: options.nearAmount ?? "9000000000000000000000000", locked: "0", storage_usage: 1000 };
          if (params.request_type === "view_access_key_list") return { ...shared, keys: [{ public_key: options.wrongNearKey ? VERIFIED_IDENTITIES[role === "investor" ? "treasury" : "investor"].accessPublicKey : VERIFIED_IDENTITIES[role].accessPublicKey,
            access_key: { nonce: 1001, permission: "FullAccess" } }] };
          if (params.request_type !== "call_function") throw new Error("Nonpublic fixture method");
          const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
          const root = options.rootChanged ? nearPoint("0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8") : VERIFIED_MPC_ROOT;
          const values: Record<string, unknown> = {
            version: "3.18.0", config: { sign_call_gas_attachment_requirement_tera_gas: 100 }, public_key: root,
            state: { Running: { domains: { domains: [{ id: 0, purpose: "Sign", protocol: "CaitSith", reconstruction_threshold: 11 }] },
              keyset: { epoch_id: 1, domains: [{ domain_id: 0, attempt: 1, key: { Secp256k1: { near_public_key: root } } }] } } },
            derived_public_key: args.predecessor ? nearPoint(deriveEvmPublicKey(root, args.predecessor, DERIVATION_PATH)) : null,
          };
          return { ...shared, result: [...Buffer.from(JSON.stringify(values[params.method_name]), "utf8")] };
        }
        default: throw new Error("Not a fixture NEAR read method");
      }
    } },
  };
  return { ports, requests };
}
