// utils/constants.ts

// --- ERC-20 token addresses (Ethereum mainnet) ---

// Mainnet token addresses
export const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";

// Whale addresses you provided
export const USDC_WHALE  = "0xffA69C0080582098aF595156240214b742735a5e";
export const WETH_WHALE  = "0x312e67b47A2A29AE200184949093D92369F80B53";
export const WBTC_WHALE  = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

// Minimal ERC20 ABI (only what we need in tests)
export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

// --- Chainlink USD price feeds (Ethereum mainnet) ---
export const USDC_PRICEPROVIDER =
  "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6"; // USDC / USD
export const WETH_PRICEPROVIDER =
  "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // ETH / USD (for WETH)
export const WBTC_PRICEPROVIDER =
  "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c"; // WBTC / USD

// 60/40 portfolio composition
export const COMPONENT_TOKENS = [WETH_ADDRESS, WBTC_ADDRESS];
export const COMPONENT_WEIGHTS = [60, 40]; // 60% WETH, 40% WBTC
