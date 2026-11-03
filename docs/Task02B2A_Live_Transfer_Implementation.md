# Task 02B-2A — Live transfer implementation

Date: November 2, 2026. Status: implementation and offline verification complete; live execution remains unapproved and untested.

## Checkpoint and validation

Reviewed Task 02B-1 public identities and all 13 changed/new files, including helpers and evidence. The repository-only secret/artifact scan found no credentials, generated artifacts or large runtime files. No external credential files were opened. The original 43 offline tests and TypeScript checks passed before checkpointing.

Local checkpoint: `5514d27942a71533014f5fc7196fcd08a70c0e25`, `milestone: Task 02B-1 verified accounts and public EVM derivation`. No remote is configured and nothing was published. Task 02B-2A source changes remain available for local review after this checkpoint.

Runtime: project-local Node 22.23.4; near-api-js 7.4.0, Ethers 6.16.0 and Hardhat 3.1.0. No dependencies or lockfile were changed. The standard CLI smoke test used the npm 10.9.9 bundled with the local runtime; the Windows launcher can reuse the existing npm installation.

Commands executed from the project root:

```text
npm test
npm run typecheck
npm run compile
npm run transfer -- --help
npm run verify:evidence
git diff --check
```

Tests/typechecking/compilation were invoked through `& .\scripts\with-node22.ps1 npm ...` in the Windows development terminal. CLI smoke tests used standard npm with the project-local Node directory prepended to that process's PATH. These wrappers are optional; the npm commands above work on supported Node installations on other platforms.

Results: baseline 43/43 tests passed; final expanded suite **77/77 passed**, zero failures/skips; TypeScript passed; Hardhat compilation passed (`No contracts to compile`, using the established cache). CLI help passed. Public evidence verification correctly returned **PENDING, exit 2, without RPC requests**. Whitespace checks passed. Intermediate test-only SDK export/decoded-byte and RPC quantity fixture failures were corrected before final validation; no SDK upgrade was required. The legacy mainnet-fork test was not rerun; its mainnet RPC prerequisite remains unchanged.

## Files added or changed

| File | Purpose |
| --- | --- |
| `src/near/identities.ts` | Reviewed public account IDs, access keys, EVM addresses and MPC root; explicit role validation. |
| `src/near/signing.ts` | Single-role credential loading, fresh public authority checks, direct MPC request preparation, single-attempt NEAR submission and final response validation. |
| `src/evm/sepolia-link.ts` | Fixed LINK intents, live read-only preflight/recheck and strict receipt/event/balance verification. |
| `src/evm/broadcast.ts` | Separately approved, single-attempt raw EVM submission transport. |
| `src/execution/state.ts` | Validated ignored runtime state, atomic saves, exclusive locks and public inspection summaries. |
| `src/execution/workflow.ts` | Separate signing/broadcast approvals and read-only interruption recovery. |
| `scripts/transfer.ts` | Cross-platform operator CLI for prepare, inspect, sign, reconcile, broadcast and public evidence export. |
| `test/near/signing.test.ts` | Mock credential/signer/RPC tests and public algebraic signature fixtures. |
| `test/near/sepolia-link.test.ts` | Mock Sepolia preflight, integrity, event isolation, balance delta and receipt rejection tests. |
| `test/near/execution.test.ts` | Approval, role, state, single-attempt submission, durability, timeout and recovery tests. |
| `test/near/evidence.test.ts` | Complete two-leg public fixture validation, including return ordering. |
| `src/evidence/verify.ts` | Completed evidence must contain exactly 1 LINK delivery and 0.1 LINK return. |
| `package.json`, `tsconfig.near.json` | Register the CLI, additional offline tests and CLI typechecking. |
| `README.md` | Current implementation status and operator entry points. |
| This report | Funding plan, human checkpoints, limitations and Task 02B-2B procedure. |

Original Solidity contracts, original portfolio test, Hardhat configuration, dependency lockfile and existing NEAR derivation modules are unchanged. `evidence/sepolia-link.json` still contains no transfer hashes and remains pending.

## Implemented authority and signing interface

| Role | NEAR testnet account | Verified derived EVM address |
| --- | --- | --- |
| Treasury | `wealthpixels-treasury.testnet` | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Investor | `wealthpixels-investor.testnet` | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |

`verifyRoleMpc(role, rpcUrl)` creates a fresh read-only MPC client, checks testnet, pinned version 3.18.0, root/domain, gas configuration and role derivation, then checks the selected account's sole expected FullAccess key and nonce at that finalized block. The reviewed root and both access keys are stored in `src/near/identities.ts` and the Task 02B-1 public identity JSON.

`prepareMpcSigning({role, credentialPath, rpcUrl, digest})` accepts an explicit absolute external `<role>.json` path. It opens that file only, checks account/public-key metadata and derives its public key through the SDK. It rejects another credential/role in the same process, repository-local credentials, linked files and invalid inputs. No automatic keystore search, .env loading or second-role loading occurs. Credential JSON contains a plaintext private key; retain the existing protected store outside the repository. Do not paste it or raw SDK exceptions into chat. Same-Windows-user isolation is an operational boundary; it does not establish production custody independence.

The SDK prepares and locally authorizes one direct NEAR transaction before returning its hash and `broadcastOnce()` capability. The workflow saves the hash durably before calling the capability. The MPC request is:

```json
{"request":{"payload_v2":{"Ecdsa":"<64 hex digits of the unsigned EVM digest, without 0x>"},"path":"wealthpixels/sepolia/v1","domain_id":0}}
```

Target: `v1.signer-prod.testnet`, ECDSA domain 0, fixed path `wealthpixels/sepolia/v1`; attached gas **100 Tgas**, subject to the refreshed live minimum; attached deposit **1 yoctoNEAR**. Digests outside the contract's supported scalar range are rejected. Submission uses one raw `send_tx` request with `wait_until: NONE`; no SDK broadcast retries, nonce rebuilding or automatic resubmission.

`readMpcSigningOutcome` reads the saved hash without credentials. `normalizeMpcOutcome` requires FINAL execution, the expected signer/access key/receiver, one direct sign action with the exact approved digest/path/domain/gas/deposit, and the inline `scheme: Secp256k1` response. It normalizes R/s/recovery, including low-s handling, and requires recovery to the selected verified EVM address. `tx_status` falls back to `EXPERIMENTAL_tx_status` only when the method is unavailable.

Format references reviewed: [NEAR signing guide](https://docs.near.org/chain-abstraction/chain-signatures/implementation), [request types](https://github.com/near/mpc/blob/main/crates/near-mpc-crypto-types/src/sign.rs), [response types](https://github.com/near/mpc/blob/main/crates/near-mpc-crypto-types/src/primitives.rs), [deposit definition](https://github.com/near/mpc/blob/main/crates/near-mpc-contract-interface/src/deposits.rs). Installed SDK 7.4.0 source was checked for transaction creation, hashing, signing and encoding. Documentation/source review and mocks do not verify deployed live signing behavior. Before execution the adapter refreshes public contract configuration and fails closed on a version/root/domain mismatch.

## Sepolia execution and evidence

The treasury intent is fixed at **1 LINK = 1000000000000000000 base units** to the investor. The investor intent is **0.1 LINK = 100000000000000000 base units** to treasury. Neither recipient, amount nor token can be overridden by CLI flags.

The preflight checks chain ID 11155111, official LINK address `0x779877A7B0D9E8603169DdbD7836e478b4624789`, deployed bytecode, 18 decimals, role EOAs, token/native balances, successful transfer simulation, gas estimate and matching confirmed/pending nonce. Balances, code and simulation are pinned to a block and checked for canonical consistency. Fees use the current base fee and suggested priority fee; gas receives a 20% upward-rounded buffer. Explicit gas/per-gas/total-fee caps apply. The transaction is type 2, zero ETH value and an empty access list; maximum EVM fee is `gasLimit * maxFeePerGas`. Fresh checks run before signing and broadcasting without silently changing the approved digest.

Receipt verification reconstructs the signed transaction and checks all prepared fields, sender/hash/nonce, success, canonical block/parent, at least two confirmations, effective fee, the exact Transfer event and parent-to-receipt-block LINK balance deltas. Additional LINK movements touching either role in that block cause a conservative rejection. Evidence export freshly repeats these stricter receipt checks and the existing public NEAR-to-EVM signature proof before recording both NEAR and Sepolia hashes. The investor return must occur in a later block.

All new tests use explicitly labelled synthetic public observations, algebraic signatures or injected signer/RPC implementations. No production credential file or real signing method was invoked during this task. Full successful receipt execution for these actual role addresses remains to be proven in Task 02B-2B.

## Funding plan — approval required before any action

| Destination | Proposed initial allocation | Purpose |
| --- | --- | --- |
| Treasury EVM `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` | **2 test LINK** (minimum 1) and **0.005 Sepolia ETH** | Treasury sends exactly 1 LINK; ETH pays its EVM gas. |
| Investor EVM `0x07FE574EdB1B2f537F9be452312C15A5b9427820` | **0.005 Sepolia ETH**, no initial LINK required | It receives 1 LINK and later returns 0.1 LINK. |
| Each named NEAR account | Recheck the existing 10 test NEAR observed in Task 02B-1 | NEAR transaction gas/storage reserve plus one-yocto deposit; no new NEAR funding is presently proposed. |

LINK token contract is the official Sepolia contract above, with 18 decimals, documented by [Chainlink](https://docs.chain.link/resources/link-token-contracts). LINK funding destinations are the role EOAs, not the LINK contract or NEAR MPC contract.

Use the [Chainlink Sepolia faucet](https://faucets.chain.link/sepolia) for test ETH/LINK if its current UI supports an explicit destination. Do not assume it supports arbitrary derived recipients or signature-free requests. If it requires wallet authentication, use an existing operator-controlled disposable Sepolia wallet and transfer the requested small test amounts to the full verified EOAs after funding approval. This task has not created such a wallet or authorized access to one. Never supply a NEAR credential to an EVM faucet, import a derived EVM private key (none is held), or request an MPC signature just to satisfy a faucet. Faucet limits, authentication and availability must be checked at execution time.

Planning estimate only: a simple LINK transfer often needs roughly 50,000–80,000 gas before the buffer; the actual estimate must come from the execution RPC. An illustrative cap of 120,000 gas at 30 gwei allows at most **0.0036 test ETH** per transaction. The proposed 0.005 ETH balance provides margin under that cap, not an unconditional fee guarantee. Stop if measured gas/fees exceed any approved cap. NEAR gas prices/storage affordability are not computed by this implementation; the operator must confirm spendable NEAR before signing. The MPC gas attachment check is implemented.

Before each funding operation: refresh public role/key/MPC derivation checks; compare complete destination addresses with Task 02B-1 evidence; verify the funding wallet/RPC is Sepolia and the token is the exact official LINK contract; approve the exact amount/destination; then retain the funding transaction hash and re-read balances. No funding occurred in Task 02B-2A.

## Task 02B-2B procedure and approval checkpoints

These are future operator instructions, **not authorization to execute them**. Use a fresh terminal/process for each role. Judges need only `npm ci`, `npm test`, `npm run typecheck` and, after genuine evidence is published, `npm run verify:evidence`; none loads credentials or requires Windows.

1. **Funding approval:** approve the exact test-only funding destinations and amounts above. Recheck live public identities and fund only after that separate approval. Configure public HTTPS endpoints; defaults are `https://archival-rpc.testnet.fastnear.com` and `https://ethereum-sepolia-rpc.publicnode.com`. No mainnet RPC is used.
2. **Read-only preparation:** after funding, prepare treasury with explicit fee caps, then inspect every field and maximum fee:

```text
npm run transfer -- prepare --role treasury --state .local/transfers/treasury-link.json --gas-limit-cap 120000 --max-fee-gwei 30 --max-total-fee-eth 0.0036
npm run transfer -- inspect --role treasury --state .local/transfers/treasury-link.json
```

3. **NEAR signing approval:** approve exactly the displayed unsigned hash, role, recipient, 1 LINK amount, nonce, gas/fee fields, direct MPC request, 100 Tgas and one-yocto deposit. Supply only the local path to the selected role file. The path is not a private key. Run locally only after approval:

```text
npm run transfer -- sign --role treasury --state .local/transfers/treasury-link.json --credential "<absolute external treasury.json path>" --approve-sign <displayed unsignedHash>
npm run transfer -- reconcile --role treasury --state .local/transfers/treasury-link.json
```

Read-only reconciliation may need repeating while NEAR is not FINAL. It does not call sign again. Inspect the verified recovered sender and saved hashes; signed bytes stay in ignored local state and are not printed.

4. **Separate EVM broadcast approval:** approve the exact displayed signed EVM transaction hash after signature recovery and fresh preflight. Only then:

```text
npm run transfer -- broadcast --role treasury --state .local/transfers/treasury-link.json --approve-broadcast <displayed signed EVM hash>
npm run transfer -- reconcile --role treasury --state .local/transfers/treasury-link.json
```

5. **Treasury acceptance:** require FINAL NEAR success, expected sender, successful Sepolia receipt, at least two confirmations, exactly one matching 1 LINK Transfer and exact treasury/investor LINK deltas of -1/+1, plus both hashes and actual fee. Preserve state and public observations. Stop on disagreement.
6. **Separate investor approval:** only after the treasury transfer is confirmed, review the 0.1 LINK return and authorize it separately. Use a new Node process, `--role investor`, a new `.local/transfers/investor-link.json` file and the external `investor.json` credential path. Repeat prepare/inspect, distinct unsigned-hash signing approval, reconcile, distinct signed-hash broadcast approval and reconcile. The CLI fixes the return amount but does not itself require the earlier treasury state as an input; the operator enforces this sequence and export checks its block order.
7. **Investor acceptance:** require its separate NEAR account/key authorization, a later confirmed Sepolia block and exact investor/treasury LINK deltas -0.1/+0.1. With the proposed initial 2 LINK treasury inventory and no other LINK movements, final balances are treasury 1.1 LINK and investor 0.9 LINK.
8. **Publish public evidence locally:** after both transfers satisfy acceptance:

```text
npm run transfer -- export --treasury-state .local/transfers/treasury-link.json --investor-state .local/transfers/investor-link.json
npm run verify:evidence
```

The export command reads public operation state only, freshly verifies both receipts/balance deltas and NEAR/MPC/EVM proof links, then updates the existing public manifest. No repository publication is performed.

## Recovery, compatibility and limits

- No failed/uncertain operation automatically requests another signature or broadcasts again. Its saved hash precedes submission. Reconcile that hash and confirmed/pending nonce first; a missing RPC response is not evidence that submission failed. Prepared state is valid for 15 minutes; stale signed/uncertain operations require manual review and fresh explicit authorization, not automatic rebuilding.
- State files, signed payloads and locks live under ignored `.local/transfers/`. A crash can leave a `.lock` or `.tmp` file. Verify no prior process is running and reconcile public hashes before manually repairing those local files. Do not delete uncertain state or reuse its nonce blindly.
- RPCs are trusted data sources, not light-client proofs; outages/rate limits/history gaps block verification. Two EVM confirmations are a prototype threshold with reorg risk. Concurrent relevant LINK transfers cause the exact-balance verifier to fail closed.
- MPC version/root/domain changes fail closed and require a reviewed compatibility update. The one-yocto/current response format is source-verified and mocked, not demonstrated through live signing. The upstream documentation's earlier 10-Tgas guidance is not used; fresh live configuration controls the minimum accepted attachment.
- SDK 7.4.0's type declarations advertise a `CryptoSignature` export absent under that name at runtime; the test mock uses structural signature bytes. Production uses supported exported transaction/signer APIs. No unresolved compile/type/runtime-import blocker remains.
- Credential files are plaintext, protected externally by the existing Windows ACL procedure. No Windows account separation is required. The demonstrator may operate both roles; distinct cryptographic authorization is demonstrated only after the two independently signed live transfers, and production custody independence is not claimed.

No accounts, keys, funding, live MPC signing requests, EVM broadcasts, deployments, frontend or additional chain integrations were introduced during this task. Stop here pending explicit Task 02B-2B approval.
