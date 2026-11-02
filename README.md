# WealthPixels — NEAR Chain Signatures prototype

WealthPixels is preparing a testnet demonstration of treasury-owned LINK delivered to an investor EVM address, followed by an investor-authorized return transfer. Each address is derived from a different NEAR testnet account.

**Current status, November 2, 2026:** both NEAR testnet accounts are registered with distinct supplied FullAccess keys and observed balances of 10 test NEAR each. Their EVM addresses are verified by public MPC views, local derivation and independent public math. No live MPC signatures or Sepolia transfers have been demonstrated. The transfer-evidence manifest remains pending. The eventual 100-USDC, 60/40 WETH/LINK purchase remains a later milestone.

The hackathon demonstrator may control both disposable testnet roles on one computer. Separate accounts and authorizations demonstrate protocol behavior, **not independent production custody**.

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
| Optional live reproduction | Future separately approved operator workflow | Two disposable NEAR testnet identities and test funds |

### 1. Offline tests

~~~text
npm test
npm run typecheck
~~~

Tests use fixed, explicitly labelled public fixtures and injected RPC responses. They check public derivation, role/configuration binding, unsigned EIP-1559 preparation, preflight guards, signature normalization/recovery, and public-evidence validation. Fixture tests are not live blockchain execution or proof of asset delivery.

The original derivation/transfer tests remain available as npm run test:near. Public evidence tests do not make RPC requests.

### 2. Read-only verification of published transactions

~~~text
npm run verify:evidence
~~~

The command reads evidence/sepolia-link.json. It never loads a credential file or .env, requests a signature, creates an account or broadcasts a transaction.

**Until real transactions are completed and published, it reports PENDING, makes no RPC requests and exits 2.** No transaction hashes have been invented. Exit 0 is reserved for complete evidence that passes all checks; exit 1 means invalid evidence, failed verification or unavailable RPC data.

Once completed evidence exists, verification checks both the treasury-to-investor transfer and investor return using public NEAR/Sepolia RPCs. It binds the NEAR signer, direct MPC request digest and returned signature to the recorded EVM transaction, then checks the successful receipt, exact LINK transfer calldata/event and published amounts. It verifies the recorded role derivations; it does not assert that different humans control the two accounts.

Public endpoints can be overridden without private credentials:

~~~text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.near.org --evm-rpc https://ethereum-sepolia-rpc.publicnode.com
~~~

Public archival services can be rate limited or unavailable. A network failure is reported as an inability to verify, not silently treated as success. Verification trusts the queried RPC providers; it is not a light-client proof or an exact historical balance audit.

See [evidence format and verification limits](evidence/README.md). Public MPC inspection remains available with npm run near:inspect; npm run near:derive additionally needs the two public account IDs, but no private credentials.

### 3. Optional live reproduction

Judges do not need to run this mode. It is not implemented or authorized by the evaluation-workflow revision.

The recommended setup is **one laptop, one Windows user, two disposable NEAR accounts, two separate credential files, and a fresh explicitly selected process for each role**. A future live invocation must select one --role and one --credential-file; it must not load a directory, both files, a shared private-key environment variable or a fallback identity.

Example storage locations, to be created only after separate approval:

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
