// hardhat.config.ts
import { configVariable, defineConfig } from "hardhat/config";
import * as dotenv from "dotenv";

import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

dotenv.config();

const forkedMainnet = {
  type: "edr-simulated" as const,
  forking: { url: configVariable("MAINNET_RPC_URL") },
};

export default defineConfig({
  // Register test/ethers helpers; required in Hardhat 3 plugin system.
  plugins: [
    hardhatEthers,
    hardhatMocha,
    hardhatEthersChaiMatchers,
    hardhatNetworkHelpers,
  ],
  solidity: "0.8.28",
  // Keep tests in the default "test" directory; the mocha plugin will map TS files there.
  paths: { tests: "test" },
  // Override the default network so tests run against the fork unless a network is explicitly passed.
  networks: {
    default: forkedMainnet,
    hardhat: forkedMainnet,
  },
});
