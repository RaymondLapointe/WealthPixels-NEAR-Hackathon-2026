# Task 02A — NEAR Integration Preparation

Completed November 2, 2026 (America/Toronto); started November 1.
Status: SDK, public MPC inspection, derivation adapter and offline tests complete. Project treasury/investor address output awaits the two explicit public account IDs. Task 02B was not executed.

## Runtime, dependencies and local Git

- Workspace verified: C:\projects\WealthPixels-NEAR-Hackathon-2026. No original-project files were changed.
- Fresh local pre-NEAR baseline commit: 8e38b987d7dd3a373a1bb1f003bb575d12b0ec8b, message "baseline: pre-NEAR Task 01 development snapshot".
- The 17 staged baseline files, including XML inside the Word document, were inspected for generated paths, private-key patterns and RPC access tokens: no findings. Ignore checks covered .env, role credentials, .local, node_modules, artifacts and cache; .env.example remained trackable.
- No remote was configured. Commit-local attribution was "WealthPixels Local Baseline <baseline@wealthpixels.invalid>"; global Git identity was not modified.
- Project-local Node 22.23.4 Windows x64 ZIP was downloaded from nodejs.org and checked against its official SHA-256:
  CBC74B5E0982C9DBB41525FD8FB5DCD32FBEE237863F7829072F4639A1CE5F20
- Runtime lives under ignored .local/runtime/node-v22.23.4-win-x64. The launcher temporarily selects it for its child command, then restores process PATH. Machine-wide Node remains 22.12.0; no installer, elevation or permanent PATH change was used.
- Project commands use existing npm 10.9.0. near-api-js is exact-pinned at 7.4.0. Ethers 6.16.0, Hardhat 3.1.0, TypeScript 5.8.3 and every pre-existing lockfile package version remain unchanged. There are 67 new lockfile entries.
- Existing npm audit totals remain 32 findings: 16 low, 5 moderate, 11 high. No audit fixes were applied.

To reconstruct the ignored runtime, download node-v22.23.4-win-x64.zip and SHASUMS256.txt from https://nodejs.org/dist/v22.23.4/, verify the ZIP against the exact checksum above, and extract into .local/runtime/. Do not substitute a different archive without updating/verifying the runtime pin.

## Commands and outcomes

Commands are relative to the workspace. The launcher uses the local Node executable with the existing npm CLI.

| Command | Outcome |
| --- | --- |
| git init --initial-branch=main . | PASS; local repository only |
| git add -- .; staged-name/stat review and redacted secret-pattern scan | PASS; 17 baseline files, no findings |
| git check-ignore --no-index -v <credential/generated sample paths> | PASS; .env.example separately confirmed trackable |
| git -c user.name="WealthPixels Local Baseline" -c user.email="baseline@wealthpixels.invalid" -c commit.gpgsign=false commit -m "baseline: pre-NEAR Task 01 development snapshot" | PASS; commit above |
| Local Node + existing npm-cli.js: install --save-exact near-api-js@7.4.0 | PASS |
| .\scripts\with-node22.ps1 npm ci | FAILED twice: Windows EPERM removing native EDR DLL loaded by VS Code |
| .\scripts\with-node22.ps1 npm install --ignore-scripts | PASS; restored dependencies from lockfile, with cleanup warnings for two old native-library directories |
| .\scripts\with-node22.ps1 npm run test:near | PASS: 32/32 offline tests |
| .\scripts\with-node22.ps1 npm run typecheck:near | PASS |
| .\scripts\with-node22.ps1 npm run compile | PASS; cached artifacts current |
| .\scripts\with-node22.ps1 npm run compile -- --force | PASS but npm consumed --force; did not force Hardhat |
| .\scripts\with-node22.ps1 node node_modules/hardhat/dist/src/cli.js compile --force | PASS: five Solidity files, solc 0.8.28, Cancun |
| .\scripts\with-node22.ps1 npm ls --depth=0 | PASS; existing versions retained |
| .\scripts\with-node22.ps1 node --version | v22.23.4 |
| .\scripts\with-node22.ps1 npm --version | 10.9.0 |
| node --version | v22.12.0, confirming global runtime unchanged |

During implementation, isolated test files also ran with node --import tsx --test test/near/erc20-transfer.test.ts and test/near/mpc.test.ts. The authoritative final combined result is 32/32 under Node 22.23.4.

The blocked clean reinstall was an editor file lock, not an SDK compatibility failure. No process was terminated. npm restored active packages and left ignored cleanup remnants until VS Code releases the old native DLLs; a fully clean npm ci should be retried after that release, not with Administrator privileges as a first workaround. The legacy mainnet-fork test was not run.

## Live public MPC evidence

See [Task02A_MPC_Public_Configuration.json](Task02A_MPC_Public_Configuration.json) for exact public key, block and probe results.

- RPC: https://rpc.testnet.near.org; status chain_id verified as testnet.
- Contract v1.signer-prod.testnet, version 3.18.0, finalized block 275852728:
  4xmSMMdZYVxrsm79BSKkvaRWodf2S16KzW9vyiZzA3z6.
- ECDSA domain 0: CaitSith, purpose Sign, reconstruction threshold 11, key epoch 27, attempt 1.
- public_key({"domain_id":0}) returned a valid secp256k1 root matching the Running domain keyset.
- Live signing gas attachment minimum is 15 Tgas. Upstream README says 10 Tgas: use refreshed live configuration for Task 02B.
- version, config, state, public_key and derived_public_key were exercised as read-only methods, pinned to one finalized block in the SDK probe.
- The derivation interface probe used the existing public MPC contract account as predecessor. Local SHA3-based additive public-key derivation matched the contract exactly. Its resulting EOA is only an interface probe, not a project role or funding destination.
- Signing payload_v2/domain_id and deposit requirements were reviewed in official/upstream documentation, not exercised live. No sign method, Account/Signer/Wallet constructor, broadcast or credential loading is exposed by this adapter.

For public address derivation, set both actual public IDs, then run:

~~~powershell
$env:TREASURY_NEAR_ACCOUNT_ID = '<actual-treasury-account.testnet>'
$env:INVESTOR_NEAR_ACCOUNT_ID = '<actual-investor-account.testnet>'
& .\scripts\with-node22.ps1 npm run near:derive
~~~

The placeholders are not defaults and will be rejected. IDs must be distinct. The fixed path is wealthpixels/sepolia/v1, domain is 0, and target EVM chain is Sepolia 11155111. No IDs were supplied during Task 02A, so no project addresses were invented. Derivation alone does not establish account existence or spending control.

Public inspection can be repeated with .\scripts\with-node22.ps1 npm run near:inspect. The evidence probe used ReadOnlyMpcClient.inspect() followed by derive("v1.signer-prod.testnet", "wealthpixels/sepolia/v1"), then saved the public results to JSON.

## Source/configuration changes

Modified:
- package.json: exact SDK pin, Node 22 engine constraint and isolated public/offline scripts.
- package-lock.json: SDK dependencies and matching runtime metadata; no existing package versions changed.

Added:
- .node-version: exact project runtime.
- scripts/with-node22.ps1: temporary project-local runtime launcher.
- scripts/near-public.ts: read-only inspect/derive CLI; no secret-file loading.
- src/near/config.ts: typed testnet configuration and mandatory distinct role IDs.
- src/near/authority.ts: verified public role manifests and configuration-change detection.
- src/near/mpc.ts: allowlisted public views, finalized snapshots, domain/root validation and independent derivation.
- src/evm/erc20-transfer.ts: pure unsigned builder, supplied-snapshot preflight, signature normalization and expected-sender verification.
- src/evm/dry-run.ts: unsigned offline role transfer plans.
- test/near/config.test.ts, erc20-transfer.test.ts and mpc.test.ts: 32 offline tests using fixed public fixtures.
- tsconfig.near.json: isolated strict typecheck.
- This report and the public evidence JSON.

Legacy contracts, test/portfolioSwap.test.ts, utils/constants.ts, Hardhat configuration and .env.example were preserved. Runtime archives, dependencies and generated artifacts remain ignored. Task 02A changes remain uncommitted for review; only the requested pre-NEAR baseline was committed.

## Offline evidence and limits

Tests cover exact type-2 digest/encoding, Sepolia restriction, token/address/amount validation, gas/nonce/inventory boundaries, malformed MPC points/scalars/parity, canonical high-s handling, sender recovery/mismatch, tampering, root/domain/path/account changes, role separation and unsigned dry runs. MPC tests use injected public fixtures, not network access.

Preflight checks caller-supplied observations; it does not establish fresh balances, token identity or execution success. Authority binding hashes are integrity checksums, not authentication: Task 02B must freshly rederive and compare trusted expected identities, never authorize a self-consistent imported manifest solely by its hash. A Running-state snapshot is not proof of signing-service liveness.

## Task 02B prerequisites and proposed live plan

Requires separate approval; none of the following was executed.

1. Choose both public IDs. Create accounts only if separately authorized and needed. Each owner independently holds a NEAR testnet signing authority permitted to attach a deposit, usually a testnet full-access key. Keep keys outside this repository and out of chat; the treasury process must not access investor credentials.
2. Recheck testnet MPC version, domain, key and gas configuration. Rederive both EOAs independently and compare full addresses and trusted manifest bindings before funding. Confirm owner access to each NEAR account.
3. Provide testnet NEAR and Sepolia RPCs, privately configured if authentication is needed. Verify NEAR testnet and EVM chain ID 11155111 before any action.
4. Fund only the verified testnet identities, in small amounts. NEAR spendable balance must cover signing gas above storage reserve and the documented one-yoctoNEAR deposit. A proposed attachment is 100 Tgas, subject to current configuration (15 Tgas minimum observed); recheck fee affordability.
5. Fund each EOA with test Sepolia ETH sufficient for estimated gasLimit * maxFeePerGas plus a margin. 0.01 test ETH is a convenience starting target, not a guaranteed budget. Check the exact full recipient address before each faucet/funding action.
6. Verify Sepolia LINK code and decimals through RPC against Chainlink's official listing: 0x779877A7B0D9E8603169DdbD7836e478b4624789, 18 decimals. This was documentation-verified, not EVM-RPC-verified in Task 02A. Treasury needs at least 1 LINK for the proposed transfer. USDC and WETH are deferred.
7. Add a separately authorized signing/relay layer. Fetch fresh pending nonce, balances, code and fee/gas estimates; freeze one transaction; call MPC directly from treasury with its exact path/domain and the unsigned transaction digest. Normalize the response and require recovery to the trusted treasury EOA before broadcast.
8. Minimum milestone: 1 LINK treasury -> investor, successful receipt, matching Transfer event and exact token deltas. Independent-control demonstration: investor separately authorizes a 0.1 LINK return. Record NEAR/EVM hashes; reconcile uncertain receipts/nonces before retrying.

No wallets, funding, live signing, EVM broadcasts, deployed contracts, frontend, bridge or publication occurred. Original-code public reuse authorization remains separate. Stop after Task 02A.

References: [NEAR signing](https://docs.near.org/chain-abstraction/chain-signatures/implementation), [NEAR API](https://docs.near.org/tools/near-api), [MPC source](https://github.com/near/mpc/tree/main/crates/contract), [public KDF](https://github.com/near/mpc/blob/main/crates/near-mpc-crypto-types/src/kdf.rs), [Chainlink LINK](https://docs.chain.link/resources/acquire-link), [Node release archive](https://nodejs.org/dist/v22.23.4/).

Final verification: git diff --check passed; a redacted scan of all 32 tracked/untracked non-ignored candidate files found no private-key/RPC-token patterns or generated paths. git diff --exit-code HEAD confirmed legacy contracts, original test/constants/Hardhat config and .env.example were unchanged. git remote remained empty.
