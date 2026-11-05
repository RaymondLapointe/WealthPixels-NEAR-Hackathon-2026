# WealthPixels — NEAR Chain Signatures prototype

WealthPixels has demonstrated treasury-owned test LINK delivered to an investor EVM address, followed by an investor-authorized return transfer. Each address is derived from a different NEAR testnet account.

**Current status, November 5, 2026:** both live transfers are confirmed: Treasury delivered exactly 1 LINK, and Investor independently authorized a 0.1 LINK return through its separate NEAR account. Verified balances after the return are 24.1 LINK / 0.9 LINK. The completed [public two-leg evidence](evidence/sepolia-link.json) contains both NEAR and Sepolia transaction hashes; the credential-free public verification command passed. Detailed records: [Treasury delivery](evidence/treasury-link-delivery.json) and [Investor return](evidence/investor-link-return.json). Offline tests use clearly labelled recorded public responses and mock transports. Portfolio purchase functionality remains a later milestone.

The hackathon demonstrator may control both disposable testnet roles on one computer. Separate accounts and authorizations demonstrate protocol behavior, **not independent production custody**.

## Portfolio purchase development: Task 03B

The next live demonstration targets **10 test USDC**, with an illustrative 50% native ETH / 50% LINK allocation from Treasury principal inventory. The amount is configurable; 10 USDC is a demonstration target, with no production minimum implied. The earlier 100-USDC planning example is superseded. The completed live evidence above proves the two LINK transfers; a portfolio purchase has not yet executed.

Task 03B adds pure TypeScript modules for exact six-decimal USDC parsing, immutable allocation terms, Investor-to-Treasury USDC intents, quote-sized Treasury-to-Investor LINK intents, and fee accounting. `npm test` includes 1, 5, 10, 20 and 100 USDC cases, precision/rounding, role/token/recipient checks and duplicate payment-claim guards. These are offline tests with labelled fixtures. Purchase intents are not yet exposed through the live CLI, and the payment-claim guard is not yet a durable payment registry.

Before payment authorization, total expected system execution costs must be at most `MAX_EXPECTED_FEE_BPS = 1000` (10%) of the investment. This includes all three EVM transactions and all three NEAR MPC signing operations, regardless of payer. Calculations use exact rational USDC equivalents, at least 20% gas buffers, documented conversion inputs and separate expected-fee assumptions and maximum reserves. Missing, expired or unverified inputs fail closed; offline price fixtures cannot authorize payment. Fee-estimation work is a WealthPixels operating expense. The 10% testnet policy makes no claim about production economic viability.

Task 03D must collect fresh verified estimates/prices, bind the assessment into the approved quote, revalidate before payment, persist replay protection, and record actual costs and the realized fee ratio in completion evidence. After accepted payment, a fee increase must leave the delivery obligation outstanding. The accounting interface preserves that rule; the coordinator remains future work.

Official Sepolia USDC is [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://developers.circle.com/stablecoins/usdc-contract-addresses), with six decimals. The read-only November 5 check found 0 USDC at both roles. One approved [Circle faucet](https://faucet.circle.com/) allocation of 20 test USDC to Investor would cover the 10-USDC target. Funding has not been requested. Fresh balances are required before any future live preparation.

See the [Task 03B implementation report](docs/Task03B_ERC20_Intents_and_Fee_Eligibility.md) for pricing gaps, module interfaces and the Task 03C–03F sequence. Native ETH execution, complete quoting and three-leg orchestration remain to be implemented and reviewed.

## Quick start for judges

Use Node **22.23.4** (pinned in .node-version), or another supported Node 22 patch >=22.22.2, and npm. These commands work on Windows, macOS and Linux:

~~~text
npm ci
npm test
npm run typecheck
~~~

Dependency installation needs internet or a populated npm cache. The tests themselves need no RPC, credentials, account creation, blockchain funding or Windows-specific setup. PowerShell and the development-only Windows Node launcher are optional.

## Three evaluation modes

| Mode | Command / status | Credentials or funding |
| --- | --- | --- |
| Offline automated tests | npm test or npm run test:offline | None |
| Public transaction verification | npm run verify:evidence | None; public RPC access |
| Optional live reproduction | Separately approved operator workflow | Two disposable NEAR testnet identities and test funds |

### 1. Offline tests

~~~text
npm test
npm run typecheck
~~~

Tests use fixed, explicitly labelled public fixtures and injected RPC responses. They check public derivation, role/configuration binding, unsigned EIP-1559 preparation, preflight guards, signature normalization/recovery, and public-evidence validation. Fixture tests are not live blockchain execution or proof of asset delivery.

The original derivation/transfer tests remain available as npm run test:near. Public evidence tests do not make RPC requests.

### 2. Read-only verification of published transactions

~~~text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
~~~

The command reads evidence/sepolia-link.json. It never loads a credential file or .env, requests a signature, creates an account or broadcasts a transaction.

The published manifest is complete and contains real transaction hashes. Exit 0 means both live proofs passed verification; exit 1 means invalid evidence, failed verification or unavailable RPC data. A manifest marked PENDING makes no RPC requests and exits 2.

Verification checks both the treasury-to-investor transfer and investor return using public NEAR/Sepolia RPCs. It binds the NEAR signer, direct MPC request digest and returned signature to the recorded EVM transaction, then checks the successful receipt, exact LINK transfer calldata/event and published amounts. It verifies the recorded role derivations; it does not assert that different humans control the two accounts.

Public endpoints can be overridden without private credentials:

~~~text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
~~~

Public archival services can be rate limited or unavailable. A network failure is reported as an inability to verify, not silently treated as success. Verification trusts the queried RPC providers; it is not a light-client proof or an exact historical balance audit.

See [evidence format and verification limits](evidence/README.md). Public MPC inspection remains available with npm run near:inspect; npm run near:derive additionally needs the two public account IDs, but no private credentials.

### 3. Optional live reproduction

Judges do not need to run this mode. The operator CLI completed both live transfers, and its offline execution tests use mocks. Any further funding, live MPC signing or EVM broadcasting requires separate approval.

The recommended setup is **one laptop, one Windows user, two disposable NEAR accounts, two separate credential files, and a fresh explicitly selected process for each role**. Each signing invocation must select one `--role` and one explicit `--credential` path. It cannot load a directory or both role files. The current live adapter pins the reviewed WealthPixels public identities; using different identities requires a separately reviewed public configuration change.

~~~text
npm run transfer -- --help
~~~

Read the [Task 02B-2A implementation report and execution runbook](docs/Task02B2A_Live_Transfer_Implementation.md) for preparation, exact fee caps, funding destinations, separate signing/broadcast approvals and recovery. Help and offline tests never load credentials.

The [Treasury recovery report](docs/Task02B2B_Phase3F_Controlled_Broadcast_Recovery.md) and [Investor recovery report](docs/Task02B2B_Phase3H_Investor_Recovery_Readiness.md) describe `recovery-audit` and `broadcast-recovered`. Recovery is restricted to those two exact recorded transactions and requires the signed hash, acknowledgment of the original expired timestamp and a new durable audit. Both transactions are now confirmed; their saved state and attempt markers block another broadcast. Inspection audits cannot authorize a later send, and the normal preparation-age rule remains enforced.

Existing operator credential locations (plaintext private keys; keep the protected store outside the repository):

~~~text
%LOCALAPPDATA%\WealthPixels\testnet-credentials\treasury.json
%LOCALAPPDATA%\WealthPixels\testnet-credentials\investor.json
~~~

A same-user process could technically read both files. This is operator-controlled demo separation, not an operating-system or production custody boundary. Separate OS users/devices remain an optional enhancement.

Treasury transactions must originate from the treasury NEAR authority; investor returns must originate from the investor NEAR authority. One shared signer must never impersonate the other role. Actual key creation, account registration, funding and every live signing/broadcast step require explicit approval.

See the [revised Task 02B runbook](docs/Task02B1_Account_Setup_and_Derivation.md) and [one-laptop operator guide](docs/Task02B1_Windows_Operator_Instructions.md).

## Existing Solidity application

The pre-existing contracts implement a contract-custodied USDC-to-WETH/WBTC purchase. They are reference code, not the NEAR-controlled LINK transfer milestone. No Solidity source or original test has been rewritten.

Optional compilation:

~~~text
npm run compile
~~~

The legacy mainnet-fork test is separate from judging defaults:

~~~text
npm run test:legacy -- --network hardhat
~~~

It requires a privately configured MAINNET_RPC_URL and simulates deployments/transactions locally using impersonation. It is not a live-mainnet operation, a NEAR test or a credential-free offline test.

## Reproducibility and source history

- SDK: exact-pinned near-api-js 7.4.0; Ethers 6.16.0; Hardhat 3.1.0.
- Pre-NEAR baseline: 8e38b987d7dd3a373a1bb1f003bb575d12b0ec8b.
- Task 02A checkpoint: e332575412e167fa47090f62d3428fcc1a1b6e06.
- Runtime/dependencies/generated files and local secrets are excluded from Git.
- Account availability in prior reports is a timestamped observation, not a reservation or proof of ownership.
- Public reuse/submission of the pre-existing code still needs the owner's authorization and accurate disclosure.

Windows developers may retain scripts/with-node22.ps1 as a convenience. An open editor can lock native Hardhat libraries and block npm ci; close the relevant project/editor before a clean reinstall rather than requiring judges to use that launcher.
