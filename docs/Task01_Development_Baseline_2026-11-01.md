# WealthPixels — Task 01 Development Baseline

Date: November 1, 2026 (America/Toronto)
Workspace: C:\projects\WealthPixels-NEAR-Hackathon-2026
Status: dependency installation and Solidity compilation PASS; legacy fork test BLOCKED by missing RPC; Task 02 NOT IMPLEMENTED.

## Scope and isolation

This task installed the existing dependency lockfile, compiled the legacy contracts, made two necessary configuration changes and reviewed current NEAR integration requirements. No wallets, funding, blockchain transactions, deployments or signing requests occurred. No private credentials were accessed or printed.

The workspace has no .git metadata and git rev-parse --show-toplevel reported "not a git repository". It therefore has no Git remote pointing to the original repository. The project root and contracts/scripts/test/utils directories are not junctions or symbolic links. No Git repository was initialized, no original-project directory was changed and nothing was published.

## A. Versions and compatibility

| Item | Observed / installed version |
| --- | --- |
| Node.js | v22.12.0 |
| npm | 10.9.0 |
| Hardhat | 3.1.0 |
| Solidity | 0.8.28, EVM target Cancun |
| Ethers | 6.16.0 |
| TypeScript | 5.8.3 |
| tsx | 4.21.0 |
| OpenZeppelin contracts | 4.9.6 |
| Chainlink contracts | 0.4.2 |
| dotenv | 17.2.3 |
| Mocha / Chai | 11.7.5 / 5.3.3 |
| hardhat-ethers | 4.0.3 |
| hardhat-ethers-chai-matchers | 3.0.2 |
| hardhat-mocha | 3.0.8 |
| hardhat-network-helpers | 3.0.3 |
| @types/node / @types/chai / @types/mocha | 22.19.3 / 5.2.3 / 10.0.10 |

The installed Hardhat 3.1.0 source defines its minimum Node version as [22,10,0] in node_modules/hardhat/dist/src/internal/cli/node-version.js. Current Node 22.12.0 satisfies the pinned baseline. No Node, npm or dependency version was upgraded.

This corrects the earlier assessment's reliance on newer Hardhat documentation for the frozen dependency set: no Node update is required to compile this baseline.

npm ci reported 32 audit findings: 16 low, 5 moderate and 11 high. No audit fix or dependency update was applied. Detailed remediation remains separate work; compilation success does not clear those findings or establish security of the legacy contracts.

Published npm metadata was also checked, without installation:
- near-api-js 7.4.0 requires Node >=22.22.2.
- chainsig.js 1.1.16 depends on older modular @near-js/* ^2.2.4, Viem and multiple chain adapters.

Recommendation for Task 02: approve a Node 22 patch update to >=22.22.2 and add an exact pinned near-api-js 7.4.0 dependency, subject to TypeScript compatibility checks. Retain existing Ethers 6 and Hardhat versions. No new package manager, framework or additional blockchain is proposed. The NEAR SDK is a new dependency, not an upgrade to a current project dependency.

## B. Commands and actual outcomes

All commands ran from the workspace shown above.

| Command | Outcome |
| --- | --- |
| node --version | PASS: v22.12.0 |
| npm --version | PASS: 10.9.0 |
| npm ci | PASS: 230 packages added; 231 audited |
| npm ls --depth=0 | PASS: installed top-level dependencies resolve without missing/invalid entries |
| npm run compile (initial attempt) | FAIL: HHE15, both fork URLs were empty strings without MAINNET_RPC_URL |
| npm run compile (after configuration fix) | PASS: "Compiled 5 Solidity files with solc 0.8.28 (evm target: cancun)" |
| npm test -- --network hardhat test/portfolioSwap.test.ts | NOT EXECUTED: no safely configured mainnet RPC |
| npm view near-api-js@7.4.0 version engines --json | PASS: published version and Node engine verified |
| npm view chainsig.js@1.1.16 version engines dependencies --json | PASS: published version and dependency graph verified |

The project already uses npm ci; no npm install, npm update, npm audit fix or global installation was run.

The test command to use later, only after an authorized mainnet read RPC is configured privately, is:

~~~powershell
npm test -- --network hardhat test/portfolioSwap.test.ts
~~~

The complete existing suite currently contains the same single test:

~~~powershell
npm test -- --network hardhat
~~~

Neither test command was executed in Task 01. No private .env was created, no RPC URL was solicited and no external EVM private key was used.

## C. Remaining legacy-test blockers

Primary blocker: .env is absent and the MAINNET_RPC_URL process variable is not configured. Only .env.example exists. Credential values were not read.

The test requires an Ethereum mainnet JSON-RPC endpoint serving code, storage, block data and calls. The fork is a local Hardhat simulator: impersonation, test deployments and token movements must remain local. This test must not be pointed at a live Sepolia HTTP network.

The fork has no fixed block. Whale balances, oracle freshness and simulator support for current hardforks can affect execution. Historical block pinning would need compatible historical-state access. These are possible follow-up blockers, not observed test failures, because the test was not run.

The legacy test uses USDC/WETH/WBTC and checks balance directions. It does not prove LINK delivery, exact 60/40 quantities or NEAR authorization. Time was not spent troubleshooting an unavailable fork.

## D. File changes and preservation evidence

Modified:
1. hardhat.config.ts
   - Added configVariable to the existing hardhat/config import.
   - Replaced process.env.MAINNET_RPC_URL || "" with configVariable("MAINNET_RPC_URL").
   - This lazily resolves a required RPC at network use. Compilation works without an RPC, while both existing networks retain their fork configuration. No silent unforked fallback or dummy endpoint was introduced.
2. .gitignore
   - Added .env.* with an exception for .env.example.
   - Added .near-credentials/, near-credentials/, .credentials/, credentials/, .secrets/, secrets/ and .local/.
   - Added treasury.credentials.*, investor.credentials.*, key/certificate/keystore/mnemonic extensions and private-key/seed-phrase filename patterns.
   - Existing node_modules, artifacts, cache, dist, types and coverage exclusions remain.

Added:
3. docs/Task01_Development_Baseline_2026-11-01.md
   - This execution record, limitations and proposed Task 02 plan.

Generated local directories:
- node_modules/ — lockfile dependencies.
- artifacts/ — compiled artifacts, build information and generated declarations.
- cache/ — compiler cache and build information.
These directories are ignored.

SHA-256 comparisons before and after the configuration changes and compilation matched for every legacy Solidity file, portfolioSwap.test.ts, utils/constants.ts, package.json and package-lock.json. Only hardhat.config.ts and .gitignore changed among the compared files.

No legacy Solidity source, test, constants, manifest, lockfile, README, tsconfig or environment template was edited. There is no Git index or commit in this copy. Ignore rules were inspected; Git check-ignore was not run because no Git repository exists. Ignoring files is not a substitute for reviewing future staged changes before any publication.

## E. Proposed NEAR adapter architecture

PROPOSED ONLY — no modules or directories below were implemented in Task 01.

~~~text
scripts/
  near-transfer.ts                 CLI: derive, prepare, explicitly send
src/
  near/
    config.ts                      Public network/account/path/domain settings
    authority.ts                   One role's externally held NEAR signer
    mpc.ts                         Public views, request/response normalization
  evm/
    erc20-transfer.ts              Ethers build, recover, broadcast, verify
test/
  near/
    erc20-transfer.test.ts         Offline tests using Node's existing runner
.local/                            Ignored transaction/recovery journal
~~~

Retain TypeScript/ESM and Ethers for EVM operations. Use the published near-api-js v7 API directly for NEAR calls. Current upstream migration documentation marks modular @near-js packages deprecated. Do not mix a v7 Account with an older chainsig.js signer interface without an adapter/typecheck. [1, 4]

Use two distinct NEAR testnet accounts:
- Treasury authority: controls the treasury EVM EOA and owns active LINK inventory.
- Investor authority: controls the investor EVM EOA and independently authorizes its spending.

Use separate signer processes/credential access. Treasury automation must not read the investor key. Public account IDs and a fixed derivation path can be shared; private signer access cannot.

Call MPC directly from each account. The actual NEAR predecessor determines the derived signing key; a helper NEAR contract would become that predecessor. [3]

Current documented testnet contract: v1.signer-prod.testnet. [1]
Proposed curve/domain: ECDSA/secp256k1, explicit domain_id 0, after live confirmation.
Proposed fixed path: wealthpixels/sepolia/v1 for each authority. Different NEAR account IDs must derive distinct EOAs.

Current upstream public-key API: [2]

~~~json
public_key: {"domain_id": 0}
derived_public_key: {
  "path": "wealthpixels/sepolia/v1",
  "predecessor": "<specific-account.testnet>",
  "domain_id": 0
}
~~~

Current upstream sign format: [3]

~~~json
{
  "request": {
    "payload_v2": {"Ecdsa": "<32-byte unsigned EVM transaction digest as hex>"},
    "path": "wealthpixels/sepolia/v1",
    "domain_id": 0
  }
}
~~~

The payload is the transaction digest, without personal-message prefixing or another hash. Normalize big_r, s and recovery_id into an Ethers signature and verify the recovered sender.

Upstream documentation specifies at least 1 yoctoNEAR deposit and 10 Tgas. Actual deployed settings must be checked before sending. Older payload/key_version examples may be backward compatible; their age alone does not prove rejection. [3]

Documented/upstream verified: the contract identifier, public-key view parameters, request schema, predecessor binding and library metadata.
NOT live-verified: deployed version/configuration, actual domain/root key, derived addresses, RPC/service availability, signing latency, funded accounts or successful EVM delivery. No public-chain view RPC or signing request was made during Task 01.

## F. Task 02 implementation plan — requires explicit approval

### Proposed approval scope

Approve the Node 22 patch update required by near-api-js 7.4.0, installation of that pinned SDK, the small proposed adapter and offline tests, and the subsequent explicitly authorized testnet operations. No legacy contract rewrite, new deployed contract, frontend, bridge or additional blockchain is required.

### Prerequisites to supply or arrange later

1. Two distinct NEAR testnet account IDs, each with owner-controlled signing capability that can attach the MPC deposit. Ordinarily this is a separately held full-access testnet credential. Keep credentials in external local storage; do not paste them into chat or commit them.
2. Spendable test NEAR in each account for its signing-call gas and deposit, beyond storage reserves. Final funding adequacy must be checked against deployed configuration and gas estimates.
3. A NEAR testnet read/write RPC for authorized calls and a Sepolia RPC for reads and raw-transaction broadcast. RPC credentials remain private.
4. Derived EOA addresses verified before funding. No EVM private keys are created or required.
5. Sepolia ETH in each EOA for its outgoing ERC-20 transfer. Require balance >= gasLimit * maxFeePerGas plus a stated margin per planned transaction. 0.01 test ETH each is an initial convenience target, not a guarantee; the preflight estimate is authoritative.
6. Verified Sepolia LINK inventory in the treasury EOA. Proposed first amount: 1 LINK after reading token decimals and verifying the token against Chainlink's official listing. No USDC, WETH or oracle integration is needed for this milestone. [5]

None of these accounts, credentials, funds or transactions was created, accessed or arranged in Task 01.

### Implementation sequence

1. Update the approved runtime and pin the SDK. Typecheck the adapter against TypeScript 5.8.3; retain Ethers 6.16.0. Use the installed tsx and Node test runner for isolated offline tests so missing legacy fork RPC does not block new tests.
2. Query public deployed version/config/state and ECDSA domain/root. Query derived_public_key for each explicit account/path/domain. Validate the returned curve, convert to EVM addresses with Ethers and record public configuration. Never fund an address based solely on a cached root.
3. Implement read-only derive/prepare CLI operations. Preparation checks chain ID 11155111, verified token code/decimals, amount, recipient, inventory, nonce, gas and fees. It must not request a signature.
4. Implement explicit send: prepare an EIP-1559 transaction targeting the token contract, value 0, and ERC-20 transfer calldata. Directly request the treasury signature through its NEAR authority; normalize and recover the exact expected EOA before broadcasting.
5. Record the NEAR signing transaction, EVM hash, receipt, Transfer log and before/after token balances. Reconcile nonces and receipts before retrying an uncertain broadcast.
6. Minimum transfer checkpoint: treasury sends 1 LINK to investor. Complete the independent-control gate with a separately authorized investor return of 0.1 LINK. That control demonstration is a second EVM transfer and NEAR signing call; it is included in the proposed approval scope, not silently performed.

### Acceptance tests

Offline:
- Correct typed-transaction digest/serialization and signature normalization.
- Sender mismatch rejects before broadcast.
- Wrong chain, token, recipient, amount, malformed signature, missing credentials and changed derivation configuration fail clearly.
- Dry-run does not sign or broadcast; uncertain prior transaction state cannot trigger duplicate sending.
- A fixed signature fixture tests investor/treasury separation without an extra live signing request.

Authorized testnet proof:
- Repeated public derivation is stable; treasury and investor EOAs are distinct.
- Treasury signature recovers to treasury EOA, with chain ID 11155111.
- Successful receipt and exact LINK debit/credit plus matching Transfer event establish delivery.
- Investor's separate signer proves outgoing control through the return transfer.
- Evidence links each NEAR signing hash to its EVM hash; no private material appears in logs or the journal.

### Known risks and stopping conditions

- The selected current SDK requires the approved Node patch update; its TypeScript fit remains untested.
- Upstream and deployed MPC versions/configuration may differ; verify live views before funding/signing.
- MPC/RPC timeout, root/domain changes, gas inadequacy and nonce races require explicit recovery.
- A returned NEAR signature is not proof of EVM execution.
- A signature over a treasury transaction requested by the investor can recover to the investor-derived key instead of being rejected by NEAR; always compare recovered sender.
- The existing audit findings and legacy contract flaws remain unresolved; the initial transfer does not use or deploy those contracts.
- The later three-leg portfolio purchase is non-atomic; this token-transfer milestone does not solve settlement risk.
- Original-code public reuse authorization remains separate. No public repository or submission is authorized by Task 01.

Task 01 stops here. Wait for explicit approval before Task 02 source implementation, runtime changes, account operations, signing or testnet transactions.

## Sources reviewed

1. NEAR signing documentation: https://docs.near.org/chain-abstraction/chain-signatures/implementation
2. NEAR MPC public-key source: https://github.com/near/mpc/blob/main/crates/contract/src/api/keys.rs
3. NEAR MPC contract/signing source: https://github.com/near/mpc/tree/main/crates/contract and https://github.com/near/mpc/blob/main/crates/contract/src/api/sign.rs
4. NEAR API migration guide: https://github.com/near/near-api-js/blob/master/MIGRATION.md
5. Chainlink LINK token listings: https://docs.chain.link/resources/link-token-contracts

Published SDK metadata was additionally verified using the exact npm view commands recorded above. These checks do not establish live MPC behavior.
