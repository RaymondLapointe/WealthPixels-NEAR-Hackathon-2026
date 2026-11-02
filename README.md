## Prereqs
- Node 20+ (Hardhat v3 prefers current LTS)
- npm, git
- Mainnet RPC URL (Infura/Alchemy/etc.)

## Setup
git clone <repo-url>
cd WealthPixels-60-40-V0
cp .env.example .env   # or create .env
# set MAINNET_RPC_URL=https://mainnet.infura.io/v3/<your-key>
npm install

## Run
npx hardhat test test/portfolioSwap.test.ts

## Notes
- Hardhat v3 is configured to fork mainnet by default (`default` and `hardhat` networks) using MAINNET_RPC_URL.
- Tests impersonate mainnet whales and query Chainlink feeds on the fork.
- If you see “unexpected amount of data” or empty contract code, double-check MAINNET_RPC_URL and retry; 
     clearing `cache/edr-fork-cache` can help. 
     Pinning a `blockNumber` in `hardhat.config.ts` can improve stability on flaky RPCs.

- Event data is logged in the test via `ComponentTransferred` query.
     After the deposit, the test runs wealthToken.queryFilter(wealthToken.filters.ComponentTransferred(), receipt.blockNumber, receipt.blockNumber) and console.logs each decoded event.
     The log shows the component address (WETH/WBTC), recipient, amount, timestamp, and price for each transfer.


Sample output snippet during npx hardhat test test/portfolioSwap.test.ts:

ComponentTransferred event: {
  component: 0xC02a...6Cc2,
  to: 0x1234...,
  amount: "21048601434954511",
  timestamp: "1734468200",
  price: "323456789000"  // example price
}

When running a test, the emitted values are displayed in the console, meaning no Etherscan or extra scripts needed to see the actual portfolio swap's outcome.