# Task 02A — NEAR Integration Preparation

Completed November 2, 2026 (America/Toronto). SDK integration, live public MPC verification and offline tests are complete. Treasury/investor address output is pending the two actual public NEAR account IDs; no defaults were invented. Task 02B was not executed.

## Results

- Separate workspace verified: C:\projects\WealthPixels-NEAR-Hackathon-2026.
- Local pre-NEAR commit: 8e38b987d7dd3a373a1bb1f003bb575d12b0ec8b. All 17 staged baseline files were checked for private-key/RPC-token patterns and generated artifacts; no findings. No remote or publication.
- Project-local Node 22.23.4, existing npm 10.9.0, exact-pinned near-api-js 7.4.0. Official Node ZIP SHA-256 verified. No machine-wide installation, elevation or permanent PATH changes; global Node remains 22.12.0.
- Ethers 6.16.0 and Hardhat 3.1.0 retained. No existing lockfile package version changed and no audit fixes were applied.
- Offline tests: 32/32 PASS. Strict integration typecheck: PASS.
- Full forced compilation under Node 22.23.4: PASS, five Solidity files, solc 0.8.28, Cancun. Legacy Solidity, test, constants and Hardhat configuration preserved.
- A clean npm ci was blocked by VS Code holding the native EDR DLL. npm install --ignore-scripts restored the locked dependencies successfully; ignored native-library cleanup remnants remain. No unrelated process was terminated.

## Live public MPC verification

At finalized block 275852728 (4xmSMMdZYVxrsm79BSKkvaRWodf2S16KzW9vyiZzA3z6):

| Setting | Verified value |
| --- | --- |
| NEAR network / contract | testnet / v1.signer-prod.testnet |
| Contract version | 3.18.0 |
| ECDSA domain | 0, CaitSith, purpose Sign |
| Reconstruction threshold / key epoch | 11 / 27 |
| Minimum signing gas attachment | 15 Tgas, versus 10 Tgas in upstream README |
| Fixed project derivation path | wealthpixels/sepolia/v1 |
| Target EVM chain | Ethereum Sepolia, 11155111 |

The public root key matched the domain keyset. SDK calls to version/config/state/public_key/derived_public_key succeeded, and independent local public-key derivation matched the contract result. The interface probe used the existing MPC contract account, not either project role.

[Exact public key and evidence](Task02A_MPC_Public_Configuration.json). Signing format/deposit documentation was reviewed, but no signing method was called. A Running snapshot does not prove signing-service liveness.

## Reproducible commands

~~~powershell
& .\scripts\with-node22.ps1 npm run test:near
& .\scripts\with-node22.ps1 npm run typecheck:near
& .\scripts\with-node22.ps1 node node_modules/hardhat/dist/src/cli.js compile --force
& .\scripts\with-node22.ps1 npm run near:inspect

# Set actual public IDs; these placeholders are rejected.
$env:TREASURY_NEAR_ACCOUNT_ID = '<actual-treasury-account.testnet>'
$env:INVESTOR_NEAR_ACCOUNT_ID = '<actual-investor-account.testnet>'
& .\scripts\with-node22.ps1 npm run near:derive
~~~

Public derivation does not establish account existence, ownership or spending control.

## Changes

Modified package.json/package-lock.json for the pinned SDK, runtime constraint and public/offline scripts. Added .node-version, the project-local runtime launcher, public inspect/derive CLI, typed src/near configuration/authority/MPC modules, pure src/evm preparation/dry-run modules, three offline test files and tsconfig.near.json. Added this report, public evidence JSON and the detailed verification/Task 02B plan. Runtime downloads/dependencies/artifacts remain ignored. Only the requested baseline was committed; Task 02A changes remain uncommitted for review.

The adapter has no credential-loading, wallet, Account, signing or broadcast capability. Tests use fixed public fixtures. Preflight observations are supplied offline; manifest hashes detect changes but are not authentication.

## Task 02B prerequisites

Separate approval is required. Supply two public IDs; create accounts only if needed and separately authorized. Owners must hold separate testnet signing credentials outside the repository. Refresh MPC root/domain/gas views and independently confirm both full derived EOAs before funding.

Provide NEAR testnet and Sepolia RPCs, spendable test NEAR for gas/deposit, and test Sepolia ETH covering gasLimit * maxFeePerGas plus a margin. Verify official Sepolia LINK code/18 decimals at 0x779877A7B0D9E8603169DdbD7836e478b4624789. Fund treasury with the proposed 1 LINK only after identity checks.

The proposed live milestone is treasury-authorized 1 LINK delivery, with sender recovery before broadcast, then exact receipt/event/balance evidence. A separately authorized 0.1 LINK investor return proves its outgoing control. Reconcile uncertain nonces/receipts before retries. No USDC/WETH purchase or atomic settlement is included yet.

[Detailed commands, file inventory, runtime reconstruction, limitations and Task 02B plan](Task02A_Verification_and_Task02B_Plan.md).

No wallets, funding, live signatures, EVM transactions, deployments, frontend, bridge or publication occurred. Stop after Task 02A.

Final verification: git diff --check passed; a redacted scan of all 32 tracked/untracked non-ignored candidate files found no private-key/RPC-token patterns or generated paths. git diff --exit-code HEAD confirmed legacy contracts, original test/constants/Hardhat config and .env.example were unchanged. git remote remained empty.
