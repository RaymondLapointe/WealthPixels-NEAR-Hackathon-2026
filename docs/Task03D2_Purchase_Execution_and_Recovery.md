# Task 03D-2 - Purchase execution, settlement and recovery

Completed November 6, 2026. Implementation, offline tests and one basic public-network inspection only. No protected credentials were accessed, live purchase transactions prepared, MPC requests submitted, Ethereum transactions broadcast or funds requested. Task 03E/03F has not begun.

## Result and preserved baseline

Implemented an explicit-step three-leg coordinator: Investor USDC payment, finalized payment verification/atomic claim, Treasury LINK delivery, Treasury native ETH delivery, then reconciliation and actual-cost accounting. Amounts and exact asset quantities come from the approved immutable quote; the engine does not hardcode 10 USDC or example delivery quantities.

Before development, the accepted **253/253 tests and TypeScript checks passed**. Accepted Task 03D-1 was already committed at `82f054a9fd578be73663f582a709e95f1f674d7f`; it was reviewed and preserved under local tag `checkpoint/task03d1-accepted-before-03d2`. No Git remote is configured. Dependencies, lockfile, original Solidity/tests and the completed Phase 3H public evidence are unchanged.

## Modules and interfaces

| Added or changed | Responsibility |
| --- | --- |
| `src/purchase/coordinator.ts` | Explicit prepare, sign, signing reconciliation, audit, broadcast, receipt reconciliation and expired-unsigned retirement operations. No automatic workflow execution/retries. |
| `src/purchase/settlement.ts` | Typed per-leg substates, hash-bound payment authorization, audit/attempt records, obligations and structural integrity checks. |
| `src/purchase/journal.ts` | Extends the existing ignored, locked journal with atomic payment claims, settlement/history, immutable transaction records and monotonic transitions. |
| `src/purchase/legs.ts` | Quote-bound ERC-20/native preparation and rechecks; strict signed-byte/public-key verification; canonical receipts, finality, exact movements and actual EVM fees. |
| `src/purchase/readiness.ts` | Genuine read-only Sepolia/NEAR identity, balances, nonces, USDC restrictions/implementation, gas simulation, six-cost estimates and storage-reserved role funding. |
| `src/purchase/services.ts` | Production ports that reuse the existing NEAR signer, full-key MPC verification, Ethers builders, receipt checks and one-attempt broadcast transport. |
| `src/purchase/authorized-costs.ts`, `costs.ts`, `fee-eligibility.ts` | Fresh network costs at unchanged accepted-order price assumptions; shared exact valuation; actual fee accounting without renewing old observations. |
| `scripts/purchase.ts` | Platform-independent, explicit-role operator CLI. Only `sign` accepts one external credential path. Unknown/duplicate/force options are rejected. |
| `scripts/purchase-dry-run.ts` | Credential-free, isolated file-backed fixture demonstration; no executable EVM payloads or live observations. |
| Six new test files and three fixture files under `test/near` | Pricing/cost continuation, public readiness, real adapters, canonical receipts, complete lifecycle, security boundaries and recovery regressions. |
| `package.json`, `tsconfig.near.json` | Include new tests and typechecked CLI/dry-run commands; no dependency changes. |
| `README.md`, this report, `Task03D2_Public_Readiness_Observation.json` | Current status, evaluation/operating policy and timestamped public observation. |

The production driver cannot turn injected readiness fixtures into live prepayment evidence. Test signing/broadcast ports are injected through code, not a CLI flag or JSON proof bypass. Existing recorded real MPC cryptographic regressions remain in the full suite. A fresh process loads only the selected role's credential; the same human may operate both disposable roles, which does not establish production custody independence.

## Timing and economic policy

The following policy is implemented and tested; it does not assume three transactions can finish within 60 seconds.

1. **New payment:** quote approval, payment preparation and first MPC submission must remain inside the original quote/approved-price validity and fresh complete fee eligibility. Prices have at most five minutes of assumption validity; economic observations have at most 60 seconds, including any earlier underlying block deadline. Missing inputs or expected fees above 1,000 bps reject the unpaid payment.
2. **First authorization:** before the sole MPC submission, persist its NEAR hash and an immutable payment authorization binding the exact unsigned digest, quote, original price-set hash, approval reference and complete fresh eligibility. Recheck deadlines after persistence and immediately before sending.
3. **Already-authorized payment:** signing reconciliation and later broadcasting retain that authorization and original timestamps. Fresh all-six-cost eligibility is required before payment broadcast, using the original accepted rational demonstration rates as explicitly labelled historical order assumptions. This creates no new quote, current market-price claim or renewed price packet. Broadcast also requires acknowledgment of the original authorization hash and approval of the exact signed hash.
4. **Unsigned versus signed expiry:** normal transaction preparations remain valid for 15 minutes. Expired unsigned preparations cannot be signed. An unattempted unsigned payment can be explicitly retired into archived unpaid history and requires a new quote/approvals. Treasury unsigned retirement preserves the finalized settlement obligation. Existing signed bytes require the narrowly bound recovery route, never timestamp reset or re-signing.
5. **Submission uncertainty:** signed, submitting, submitted, uncertain or observed payments retain reservations. A canonical finalized receipt is required to claim payment. Expiry alone cannot release inventory while payment activity is unresolved.
6. **After payment:** original allocation/quantities remain owed despite quote expiry, increased costs, restarts or failed delivery. Remaining funding, transaction limits and canonical payment are checked freshly. LINK must be confirmed before preparing ETH with the new Treasury nonce; LINK canonicality is refreshed again before ETH signing, broadcasting and completion. No automatic full refund after partial delivery exists.

Expected fees include **all three Ethereum and three NEAR operations**, regardless of payer. The 10-USDC target therefore requires expected total costs **at most 1 nominal USDC**. Exact rational comparison accepts exactly 10% and rejects any increment above it. ETH portfolio value is excluded from fees. Estimates, maximum reserves and actual receipt costs remain separate.

The live cost collector uses at least the existing 20% gas buffer, a disclosed twice-observed-base-fee assumption plus selected priority, and explicit selected fee caps. NEAR uses the historical successful MPC benchmark of 10 Tgas execution plus 1 Tgas overhead, with the normal estimate buffer; the 100-Tgas attachment is a separate funding reserve, not predicted consumption. Missing rates or assumptions fail closed. Actual NEAR costs sum transaction/unique receipt `tokens_burnt`; absent proved deposit-refund attribution, the one-yocto deposit is conservatively counted and explicitly labelled. Actual ratios use unchanged approved demonstration conversions and record overruns without cancelling settlement. None of these testnet calculations establish production viability.

## Finality, restart and recovery

Payment verification binds the official USDC contract, Investor/Treasury, exact amount, original intent/authority, signed bytes, successful canonical receipt, exact Transfer event and observed balance deltas. The receipt block must be covered by Sepolia's canonical **`finalized`** block. Claim identity `chainId:transactionHash:TransferLogIndex` and paid state commit atomically under one journal lock; the same payment cannot fund another purchase in this journal. This is a local trusted association, not onchain enforcement or a cross-machine registry.

Durable leg stages distinguish preparation, NEAR submission/uncertainty/failure, signed bytes, EVM submission/uncertainty, observed/unfinalized receipt, confirmed delivery and failure. Top-level states distinguish executing, settling, partially delivered, completed and attention required. Raw public MPC outcomes, receipt observations, original bytes/hashes/times, approvals and actual costs survive restart. Canonical failed transactions preserve gas costs and outstanding obligations. Strict balance checks deliberately stop on unrelated activity rather than guessing.

Expired-signed recovery requires the exact purchase/leg/role, original successful finalized MPC result, full derived public key and sender, exact original digest/signed bytes, original preparation-time acknowledgment and signed-hash approval. It makes no NEAR signing request. A new audit refreshes network/token identity, signature, funding, nonce, simulation/gas, fees and known-transaction/receipt lookups. It must finish within **30 seconds** and any shorter observation deadline. Audit, signed hash and attempt are durable before the one allowed send.

A timeout, unexpected result or expiry after the durable marker leaves the existing attempt blocked for read-only reconciliation, even if no send occurred. No marker clearing or automatic resend is implemented. A previously known exact signed hash is reconciled without a new local broadcast approval. Unresolved outcomes or replacement/compensation decisions require separate operator review. A dead-process lock or interrupted-write artifact must be inspected rather than automatically removed. These conservative stops can delay settlement but never erase it.

## Offline results and dry-run

The final full offline suite passed **364/364**, preserving all 253 accepted tests and adding 111; no failures, skips or cancellations (59.93 seconds). TypeScript passed. The targeted coordinator suite passed **35/35** tests, including variable 1/5/10/20/100-USDC quantities; below/exactly/above-10% economics; stale/altered observations and quote; wrong payment; unfinalized/reorged payment; duplicate claims; funding/nonce failures; independent roles/approvals; restart after signing/submission; uncertain outcomes; partial settlement; all three expired-signed recoveries; short deadlines before/after markers; LINK reorgs before ETH/completion; and tampered realized accounting. Service/receipt tests additionally exercise authentic recorded MPC responses and full-key verification.

`npm run purchase:dry-run` passed. All prices, approvals, MPC results, broadcasts, receipts and balances in this example are **labelled synthetic fixtures**, not an onchain purchase. It creates and cleans an isolated temporary journal rather than using the real workspace state.

| Stage | Fixture result |
| --- | --- |
| Fixed demonstration assumptions | ETH/USD 2500, LINK/USD 10, NEAR/USD 1; simulated approval only |
| Purchase | 10 USDC, 50/50; 0.002 ETH and 0.5 LINK |
| Payment confirmed | `settling`, one atomic claim; operation continues after the initial 60-second window |
| LINK confirmed | `partially-delivered`, ETH remains owed |
| ETH confirmed | Archived `completed`; no outstanding obligation; three mock signing and three mock broadcast calls |
| Final fixture balances | Treasury/Investor USDC 10/10; LINK 23.6/1.4; ETH 0.047999999838/0.0519999999 |
| Realized fixture fees | Rounded up 0.002701 nominal USDC; displayed ceiling 3 bps; not live fee evidence |

Cross-platform evaluation commands are `npm test`, `npm run typecheck`, `npm run purchase:dry-run` and `npm run purchase -- --help`. Offline tests require no credentials, RPC access or funding.

## Public readiness and remaining live prerequisites

One basic inspection succeeded **November 6, 2026 at 00:16:09 Toronto / 05:16:09.457 UTC**, at Sepolia block `12074439` and NEAR finalized block `276444567`. Its original observation deadline was `05:17:00Z`; it is now historical, not usable live authorization. Full public details and sources are in [the observation record](Task03D2_Public_Readiness_Observation.json).

| Role | USDC | LINK | Sepolia ETH | Confirmed/pending nonce |
| --- | --- | --- | --- | --- |
| Treasury | 0 | 24.1 | 0.04999999985630444 | 1 / 1 |
| Investor | **20** | 0.9 | 0.04999999995618284 | 1 / 1 |

Investor already has sufficient USDC for the 10-USDC target; **no additional USDC faucet allocation is needed**. Both NEAR roles have about 9.9974 spendable test NEAR after storage reserve. Their distinct sole FullAccess keys, local/contract derivations, EVM addresses and MPC version `3.18.0`, root key, domain 0 and `wealthpixels/sepolia/v1` path matched. Configured signing remains 100 Tgas and one yoctoNEAR; observed minimum is 15 Tgas. Sepolia base fee was 16 wei. These observations do not approve any transaction-specific fee selection.

Official [Circle Sepolia USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, six decimals. Deployed USDC/LINK code pins passed; USDC was unpaused and neither role blacklisted. Circle's [contract repository](https://github.com/circlefin/stablecoin-evm) documents pause, blacklist and upgrade controls. Observed USDC implementation was `0xDa317C1d3E835dD5F1BE459006471aCAA1289068`, code hash `0xf4898b096a273d86cda13cce6503404da4005565fae6026a94919b231229d85b`. The operator must explicitly review and bind that implementation in the approved quote; observation does not approve an upgrade. The [Circle faucet](https://faucet.circle.com/) currently advertises 20 test USDC per address/blockchain every two hours; no request was made.

No live purchase quote, transfer simulation or gas estimate was produced under this task. Real full-six-cost collection, performance inside the unchanged timing limits, approved prices/quantities, current funds and transaction-specific fees remain mandatory before separately authorized live preparation. Public RPC availability, finality latency, fee changes and strict isolated balance verification can pause the workflow. The final public purchase manifest/verifier remains Task 03E, not this implementation's fixture output.

## Future operator sequence - separate approval required

1. Review the USDC implementation and approve one purchase-scoped demonstration-price proposal. `propose-prices` and `approve-prices` preserve proposal digest, public sources and expiry. No rate set has been approved for a real purchase here.
2. After authorization to prepare a live purchase, `quote` collects fresh six-cost/funding observations using selected fees and the reviewed implementation pin; `approve-quote` records the Investor's exact quote-hash approval. Do not create the short-lived quote before the operator is ready to review it.
3. `prepare --leg usdc-payment --role investor`, inspect the full digest/parameters, then separately approve `sign` for that exact digest while quote/observations remain valid. Only this invocation selects the Investor's external credential.
4. `reconcile-signing` is credential-free. Review the resulting signed hash. Separately approve `broadcast --approve SIGNED_HASH --ack-authorization AUTHORIZATION_HASH`; it runs its own fresh audit. Poll/read-only `reconcile` until canonical finalized payment is claimed. Do not repeat a submission after uncertainty.
5. With finalized payment, separately prepare/inspect/sign/reconcile/broadcast/reconcile `link-delivery --role treasury`. Each signing and broadcasting approval is independent.
6. After LINK confirmation and fresh canonical recheck, repeat for `eth-delivery --role treasury` with the newly fetched Treasury nonce. Completion records exact delivered quantities and realized costs. Any expired signed leg additionally requires `--recovery --ack-prepared-at ORIGINAL_TIMESTAMP`; normal safeguards stay unchanged.
7. Preserve all journal data for Task 03E's independent public evidence export/verifier. Do not present this task's fixture hashes as live transaction evidence.

Use `npm run purchase -- --help` for exact options. On Windows, preserve npm's separator with `.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--',...)`. None of the future prepare/sign/broadcast steps was executed in this task.

## Schedule and native ETH risk reduction

There is no observed USDC funding blocker. A November 12 demonstration remains feasible, subject to approval turnaround, a successful real native transfer path and public RPC/finality behavior. Remaining increments are Task 03E's public purchase evidence manifest/verifier and the separately approved Task 03F live rehearsal/purchase; these have not started. Avoid adding market-data infrastructure or extra product scope.

A separately approved **small Treasury-to-Investor native ETH test would materially reduce risk** before accepting USDC. It would exercise the native value-field MPC signature, real gas/nonce/receipt accounting and Investor balance delta, which currently have offline coverage but no live proof. It would not prove the whole coordinator or payment economics. Its amount, fees and signing/broadcast approvals must be reviewed separately, and later purchase nonces must be refreshed; no such transfer is authorized or prepared here.

## Final verification checkpoint

Exact final Windows commands executed:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase:dry-run')
.\scripts\with-node22.ps1 -Tool node -ToolArguments @('--import','tsx','scripts/purchase.ts','--help')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','inspect-networks','--near-rpc','https://archival-rpc.testnet.fastnear.com','--evm-rpc','https://rpc.sepolia.ethpandaops.io')
git diff --check
git remote -v
git ls-files -ci --exclude-standard
git diff --name-only -- contracts test/portfolioSwap.test.ts package-lock.json evidence
Get-FileHash -Algorithm SHA256 -LiteralPath evidence/treasury-link-delivery.json,evidence/investor-link-return.json
```

All verification passed. The public inspection ran once, without retries. No remote, tracked ignored artifacts or changes to legacy contracts/tests, dependency lockfile or live evidence were found. Original Phase 3H SHA-256 values remain:

- Treasury delivery: `e99d120a99da474392387f3203400734ec4fd8ff47a2d273827a40e147b7ca39`.
- Investor return: `8813bce5d1591b95b454c3e19b9d5ca06bc16b62aee17f197825ebf866cf9f8b`.

The implementation is recorded by local commit subject `milestone: Task 03D-2 purchase execution settlement and recovery` after staged source/secret/artifact review; the accepted-baseline tag above remains unchanged. No remote publication or Task 03E/03F activity is authorized by this report.
