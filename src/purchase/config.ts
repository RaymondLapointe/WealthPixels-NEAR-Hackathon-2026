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

/** Discovery configuration only; no live conversion rate defaults are supplied. */
export const PRICING_CONFIGURATION = Object.freeze({
  quoteConvention: "1 test USDC = 1 nominal quote-dollar; no monetary backing or production viability claim",
  ethUsd: Object.freeze({
    address: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    source: "https://docs.chain.link/data-feeds/api-reference", officialAddressVerified: true, heartbeatVerified: false,
  }),
  linkUsd: Object.freeze({
    candidateAddress: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
    source: "https://docs.chain.link/data-feeds/price-feeds/addresses", officialAddressVerified: false, heartbeatVerified: false,
  }),
  nearUsd: Object.freeze({ configured: false, source: "Required verified or explicitly approved reference before live fee eligibility" }),
});
