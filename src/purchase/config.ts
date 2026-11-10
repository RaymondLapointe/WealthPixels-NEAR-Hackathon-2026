/** Demonstration target only. It is not an investment minimum. No secrets or environment loading. */
export const HACKATHON_TARGET_USDC = "10";
export const BPS_DENOMINATOR = 10_000n;
export const MAX_EXPECTED_FEE_BPS = 1_000n;
export const DEFAULT_GAS_BUFFER_BPS = 2_000n;
export const USDC_DECIMALS = 6;

export const SEPOLIA_ASSETS = Object.freeze({
  USDC: Object.freeze({
    symbol: "USDC", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6,
    codeHash: "0xcd3f29e2ea9c61dadd48bfeaf8b2884b6de9dfee7bf45329452c4c33d0868ceb",
  }),
  LINK: Object.freeze({
    symbol: "LINK", address: "0x779877A7B0D9E8603169DdbD7836e478b4624789", decimals: 18,
    codeHash: "0xcafbd9135200b24454a9ffcac5a8db40947a17f8a8a542062d0f1fb48bd8b269",
  }),
} as const);

export const DEFAULT_EXECUTION_LIMITS = Object.freeze({
  gasLimitCap: 180_000n, maxFeePerGasCap: 30_000_000_000n,
  maxTotalFeeWei: 3_600_000_000_000_000n, gasBufferBps: DEFAULT_GAS_BUFFER_BPS,
});

export const USDC_PAYMENT_GAS_LIMIT_CAP = 200_000n;
type ExecutionLeg = "usdc-payment" | "link-delivery" | "eth-delivery" |
  "investor-usdc-payment" | "treasury-link-delivery" | "treasury-eth-delivery";
/** Select an asset-specific ceiling without changing the shared delivery or fee limits. */
export function purchaseExecutionPolicyForLeg<T extends { readonly gasLimitCap: bigint; readonly usdcPaymentGasLimitCap?: bigint }>(
  limits: T, leg: ExecutionLeg,
): Omit<T, "usdcPaymentGasLimitCap"> {
  if (!["usdc-payment", "link-delivery", "eth-delivery", "investor-usdc-payment", "treasury-link-delivery", "treasury-eth-delivery"].includes(leg)) {
    throw new Error("Unsupported purchase execution leg.");
  }
  const { usdcPaymentGasLimitCap = USDC_PAYMENT_GAS_LIMIT_CAP, ...base } = limits;
  if (typeof base.gasLimitCap !== "bigint" || base.gasLimitCap <= 0n || base.gasLimitCap > DEFAULT_EXECUTION_LIMITS.gasLimitCap ||
    typeof usdcPaymentGasLimitCap !== "bigint" || usdcPaymentGasLimitCap <= 0n || usdcPaymentGasLimitCap > USDC_PAYMENT_GAS_LIMIT_CAP) {
    throw new Error("Purchase gas ceilings cannot exceed the approved asset-specific limits.");
  }
  return Object.freeze({ ...base, gasLimitCap: leg === "usdc-payment" || leg === "investor-usdc-payment" ? usdcPaymentGasLimitCap : base.gasLimitCap }) as Omit<T, "usdcPaymentGasLimitCap">;
}

/** Verified source discovery only. Freshness limits are proposals for 03D; no collector or live price defaults. */
export const PRICING_CONFIGURATION = Object.freeze({
  quoteConvention: "1 test USDC = 1 nominal quote-dollar; no monetary backing or production viability claim",
  liveCollectorImplemented: false,
  ethUsd: Object.freeze({
    address: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    source: "https://docs.chain.link/data-feeds/price-feeds/addresses",
    referenceDataSource: "https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia.json",
    apiReference: "https://docs.chain.link/data-feeds/api-reference",
    officialAddressVerified: true, heartbeatVerified: true, decimals: 8,
    documentedHeartbeatSeconds: 3600, documentedDeviationBps: 100, proposedMaxAgeSeconds: 3600,
  }),
  linkUsd: Object.freeze({
    address: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
    source: "https://docs.chain.link/data-feeds/price-feeds/addresses",
    referenceDataSource: "https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia.json",
    officialAddressVerified: true, heartbeatVerified: true, decimals: 8,
    documentedHeartbeatSeconds: 3600, documentedDeviationBps: 100, proposedMaxAgeSeconds: 3600,
  }),
  nearUsd: Object.freeze({
    configured: false, liveCollectorImplemented: false, candidate: "coingecko-keyless-https",
    endpoint: "https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd&include_last_updated_at=true",
    coinId: "near", quoteCurrency: "usd", requiredTimestampField: "last_updated_at", proposedMaxAgeSeconds: 120,
    source: "https://docs.coingecko.com/demo/reference/simple-price",
    accessPolicySource: "https://docs.coingecko.com/docs/errors-and-rate-limits",
    documentedKeylessAccess: true, endpointDocumentationShowsDemoApiKey: true,
    availability: "Candidate only: observed keyless access has no uptime guarantee; reject missing, stale or unavailable rates",
    fallback: "Only an explicitly approved, time-bounded demonstration rate; no automatic substitution",
  }),
});
