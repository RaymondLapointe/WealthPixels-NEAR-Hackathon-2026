# WealthPixels 60/40 V0 — Existing-Code Assessment and Codex Kickoff

**Review date:** 2026-10-31  
**Source:** `WealthPixels-60-40-V0.zip` (local upload)  
**Target:** November 1–14, 2026 NEAR Hackathon  
**Status:** Source review complete; no successful executable test in review environment.

## Executive conclusion

The existing project provides useful reference implementations for a stablecoin-funded, two-asset portfolio purchase, Chainlink-based quotes, ERC-20 handling, events, and a Hardhat 3 test. **It is not yet a NEAR-based project and cannot be deployed as-is for the proposed NEAR-controlled treasury architecture.** The smallest credible new proof is separate NEAR-controlled EVM accounts for WealthPixels treasury and investor, followed by a NEAR-authorized EVM asset transfer; expand to a 100-USDC 60/40 WETH/LINK delivery only after that succeeds.

## Files inspected

- `contracts/WealthPixel/WealthToken.sol`: core `depositToken`, balances and events.
- `contracts/WealthPixel/PriceProvider.sol`: Chainlink V3 aggregator integration.
- `contracts/WealthPixel/Interfaces/*.sol`: helper interfaces.
- `test/portfolioSwap.test.ts`: single end-to-end Ethereum **mainnet-fork** happy-path test.
- `utils/constants.ts`: current Ethereum-mainnet USDC/WETH/WBTC addresses, whale addresses, and feeds.
- `hardhat.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `.gitignore`.
- ZIP additionally contains `.git/`, caches, artifacts, `node_modules/`, and `.env` — do NOT copy these blindly into a new public repository.

## Existing behavior (verified by source review, not a fresh execution)

1. Hardhat forks Ethereum **mainnet** when configured with `MAINNET_RPC_URL` (`hardhat.config.ts:12–32`).
2. The test impersonates existing token-holding mainnet addresses to populate a freshly deployed **Solidity contract** with 10 WETH and 1 WBTC (`test/portfolioSwap.test.ts:68–85`).
3. It funds an investor with 1,000 USDC and has them approve and deposit **100 USDC** (`test/portfolioSwap.test.ts:86–106`).
4. `WealthToken.depositToken()` transfers USDC **to the contract**, reads oracle prices, computes components, and transfers WETH/WBTC **from the contract** to the caller (`WealthToken.sol:117–152`). This makes USDC input plus component delivery atomic within a single EVM contract call on the fork; it is not yet a NEAR-controlled inventory flow.
5. It emits `ComponentTransferred` for each transfer. The test checks only that investor USDC decreases and WETH/WBTC increase; it does **not** assert exact allocations or emitted events (`test/portfolioSwap.test.ts:120–142`).

## Reuse / modify / replace

| Feature | Recommendation | Why |
|---|---|---|
| TypeScript + Ethers.js + Hardhat 3 tooling | **Reuse** | Familiar EVM test harness. |
| `portfolioSwap.test.ts` test flow | **Adapt** | Good source of transaction sequencing; replace impersonation and mainnet-fork reliance for Sepolia. |
| 60/40 model and ERC-20 decimal awareness | **Adapt / rewrite safely** | Current math contains hardcoded assumptions; create unit tests with 6- and 18-decimal assets and feeds with differing decimals. |
| Chainlink oracle wrapper | **Reference and harden** | Valid use of `latestRoundData`, but weak access controls and error propagation. |
| `ComponentTransferred` event | **Reuse concept** | Useful audit trail; onchain asset-transfer receipts provide stronger evidence in new implementation. |
| Original `WealthToken` custody and `depositToken()` | **Do not transplant blindly** | It holds inventory in the Solidity contract, contrary to the desired NEAR-controlled EVM treasury wallet model. |
| Mainnet contract/token/feed/whale constants | **Replace** | These addresses and impersonation techniques are mainnet-fork-only. |
| NEAR Chain Signatures adapter | **Build** | No NEAR code currently exists in the ZIP. |
| Frontend | **Defer** | None supplied; CLI demo and verified receipts are sufficient for first proof. |

## Specific issues to address before real funds or public deployment

1. **Feed administration lacks access control:** `PriceProvider.sol:59–96` allows arbitrary callers to set feeds, heartbeats and emergency manager. An attacker could redirect pricing. Only `setComponentsProportions` (`:181`) has `onlyOwner`.
2. **Price validity flag ignored:** `WealthToken.sol:138–141` discards the boolean returned by `getAggregatorPrice`. Must reject invalid/stale/zero prices before calculating sizes.
3. **Fragile allocation math:** `WealthToken.sol:141` assumes 6-decimal USDC, percent integer weights, and effectively equal base/quote oracle decimal scales. Compute with normalized precision and explicit checks instead.
4. **Contract custody rather than treasury wallet:** `WealthToken.sol:120, 142–148` receives stablecoin and holds component inventory at `address(this)`; the new principal inventory model uses the separate NEAR-controlled EVM treasury address.
5. **Fixed platform address:** `WealthToken.sol:23–24` embeds a literal platform wallet unrelated to a derived NEAR address.
6. **Unchecked ERC-20 return values in several paths:** `WealthToken.sol:108–115, 143–147` uses `transfer` directly; use `SafeERC20` consistently and properly handle empty or insufficient balances (including equality).
7. **Misleading accounting names:** `tokensIssued` in `WealthToken.sol:45, 130` counts input stablecoins; no portfolio token is minted. `TokenDeposited` is declared but not emitted.
8. **Test coverage is shallow:** a single happy path on a mainnet fork, checking balance direction rather than exact amounts; no failures/unauthorized requests/NEAR signatures tested.
9. **Sensitive configuration included in archive:** `.env` contains a `MAINNET_RPC_URL` setting. Treat that URL/token as sensitive; exclude `.env`, `.git`, caches and dependencies from any new public upload. Do not print or expose its value.
10. **Reproducibility issue in this Linux review environment:** archived `node_modules` includes Windows-native `esbuild`, preventing the TypeScript Hardhat configuration from loading on Linux. This is an environment portability issue, not demonstrated application failure. Run `npm ci` for the target OS and verify compile/tests with an authorized RPC connection.

## Recommended hackathon architecture: sequential testnet proof

**One chain for assets:** Ethereum Sepolia.  
**Two NEAR accounts:** separate credentials/authorization for Treasury NEAR account and Investor NEAR account.  
**Derived EVM wallets:** one address per NEAR account via Chain Signatures.  
**Test assets:** mock USDC where needed, WETH for ETH price exposure and ERC-20 LINK (official Sepolia test token or explicitly disclosed mock).  
**Transaction example:** pay 100 test USDC, calculate $60 of WETH and $40 of LINK, have WealthPixels authorize token transfers **from treasury-derived EVM address** to investor-derived EVM address via NEAR.  
**Evidence:** NEAR signing transaction(s), EVM tx hashes, before/after token balances, and recorded quote.  
**Security notes:** operator-controlled demo, one transaction at a time, no public automatic treasury signing, test funds only; sequential transfers do not provide atomic USDC-for-assets settlement.

### Alternative architecture (only if time allows)

An audited, narrowly scoped EVM settlement contract could pull WETH/LINK from the NEAR-controlled treasury using **bounded ERC-20 allowances approved via NEAR Chain Signatures**, while pulling USDC from the investor and delivering both assets atomically. This better preserves the old atomic settlement behavior, but adds authorization/allowance complexity and means treasury signing is predominantly an approval step rather than each delivery. Defer until the simplest NEAR-signed EVM transfer is working.

## Proposed hard acceptance gates

**Gate A — Nov 2–4:** Two separately authorized NEAR accounts derive distinct EVM addresses. A transaction signed through the **treasury** NEAR account results in a **real Sepolia ERC-20 token transfer** to the investor address. Verify receipt and balances. Demonstrate investor NEAR account (not treasury) can independently authorize a later EVM transaction from its own derived address, with appropriate gas.

**Gate B — Nov 5–9:** Complete testnet 100-USDC -> 60/40 WETH/LINK portfolio delivery, using inventory in treasury address. Assert exact token amounts within explicit rounding tolerances, sufficient inventory and verified receipts. Document that sequential settlement is non-atomic.

**Gate C — Nov 10–12:** Build minimal CLI demo with a reproducible README; only build a web UI if A and B are complete.

**Gate D — Nov 13–14:** Record demo, upload clean public GitHub repository, write clear pre-existing-code disclosure and submit by 2026-11-14 23:59 UTC. Confirm organizer rules for reusing the 2024 code before copying it verbatim.

## Codex Task 00 — initial instruction (copy/paste)

> Inspect the attached existing WealthPixels repository without changing the original source or revealing `.env` secrets. Produce (1) a map of all files needed for the existing swap workflow; (2) the exact onchain balance flow and custody account at each step; (3) a report of math, security and test issues; and (4) a proposed minimal NEAR Chain Signatures proof using two distinct NEAR testnet accounts that derive and control EVM addresses on Sepolia. Start by creating a clean, forked working directory and reproducible installation instructions; omit `.env`, `.git`, `node_modules`, `cache`, `artifacts`, and any secrets from public output. Do not deploy, spend funds, connect to an external wallet, or change the execution architecture until I approve it. Identify the currently maintained NEAR SDK/examples from official docs, and propose a test showing independently authorized treasury-to-investor ERC-20 transfer. Provide commands to verify tests, list all blockers, and do not claim any onchain action succeeded unless transaction hashes and observable balances prove it.

## Official public references

- NEAR Chain Signatures sample: https://github.com/near-examples/chainsig-script
- NEAR MPC repository: https://github.com/near/mpc
- Chainlink Sepolia token info: https://docs.chain.link/resources/link-token-contracts
- Chainlink feeds: https://docs.chain.link/data-feeds/using-data-feeds
- NEAR Hackathon: https://nearhackathon.com/

