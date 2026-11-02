export const NEAR_TESTNET_RPC = "https://rpc.testnet.near.org";
export const MPC_CONTRACT_ID = "v1.signer-prod.testnet";
export const ECDSA_DOMAIN_ID = 0;
export const DERIVATION_PATH = "wealthpixels/sepolia/v1";
export const TARGET_CHAIN_ID = 11155111;
export type AuthorityRole = "treasury" | "investor";

export interface DerivationConfiguration {
  readonly networkId: "testnet";
  readonly rpcUrl: string;
  readonly contractId: typeof MPC_CONTRACT_ID;
  readonly domainId: typeof ECDSA_DOMAIN_ID;
  readonly derivationPath: typeof DERIVATION_PATH;
  readonly roles: Readonly<Record<AuthorityRole, string>>;
}

export function validateAccountId(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 ||
      !value.endsWith(".testnet") || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value)) {
    throw new Error("An explicit named NEAR .testnet account ID is required.");
  }
  return value;
}

export function validateRpcUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.hash || parsed.hostname.toLowerCase().includes("mainnet")) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("Use an HTTPS NEAR testnet RPC without embedded credentials.");
  }
}

export function createDerivationConfiguration(input: {
  treasuryAccountId: string;
  investorAccountId: string;
  rpcUrl?: string;
}): DerivationConfiguration {
  const treasury = validateAccountId(input.treasuryAccountId);
  const investor = validateAccountId(input.investorAccountId);
  if (treasury === investor) throw new Error("Treasury and investor must have distinct NEAR account IDs.");
  return Object.freeze({
    networkId: "testnet", rpcUrl: validateRpcUrl(input.rpcUrl ?? NEAR_TESTNET_RPC),
    contractId: MPC_CONTRACT_ID, domainId: ECDSA_DOMAIN_ID, derivationPath: DERIVATION_PATH,
    roles: Object.freeze({ treasury, investor }),
  });
}

/** Only public configuration is consumed. No .env or credential file is opened. */
export function configurationFromPublicEnvironment(
  values: Readonly<Record<string, string | undefined>>,
): DerivationConfiguration {
  const treasuryAccountId = values.TREASURY_NEAR_ACCOUNT_ID;
  const investorAccountId = values.INVESTOR_NEAR_ACCOUNT_ID;
  if (!treasuryAccountId || !investorAccountId) {
    throw new Error("Set both public TREASURY_NEAR_ACCOUNT_ID and INVESTOR_NEAR_ACCOUNT_ID; no defaults are invented.");
  }
  return createDerivationConfiguration({
    treasuryAccountId, investorAccountId, rpcUrl: values.NEAR_TESTNET_RPC_URL,
  });
}
