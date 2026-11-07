# Task 03F-A - Native ETH entry point and final execution readiness

November 7, 2026. Development, offline validation, documentation and local checkpointing only. No protected credentials, live transaction preparation, MPC submissions, Ethereum broadcasts, funding or live purchases occurred.

## Baseline and result

Accepted Task 03E is **`4d39bce263c7e8c531caa283b0fef3c056d34a74`**, with an initially clean working tree and no remote. Before changes, all **447 tests and TypeScript checks passed**. It is additionally preserved by tag `checkpoint/task03e-accepted-before-03fa`.

Implemented a standalone Treasury-to-Investor Sepolia native ETH test entry point with independent amount-bound intent/state, explicit signing/broadcast approvals, durable one-attempt records, public reconciliation and controlled expired-signed recovery. It creates no USDC terms, payment, price quote or portfolio settlement. The production CLI refuses standalone preparation/signing/broadcast while a purchase has an active reservation or outstanding obligation; its purchase-journal lock is read without committing any journal change.

The historical Beacon archive dependency remains **unresolved**. Two new providers were reviewed through official documentation; neither established a qualifying public HTTPS Sepolia archive route, so there were **zero new endpoint probes** and no repeat of the three failed Task03E requests. The investigation stopped as instructed.

## Source changes and reuse

| Files | Change |
| --- | --- |
| `src/evm/standalone-native.ts` | Exact wei test intent/hash and preflight, fixed public authorities/chain, immutable policy, native-only observations and rechecks. |
| `src/execution/standalone-native.ts` | Strict state/codec/locks, public summaries, one-MPC submission, signing reconciliation, new 30-second audits, one EVM send and receipt/uncertainty reconciliation. |
| `scripts/native-test.ts` | Prepare/inspect/sign/reconcile-signing/audit/broadcast/reconcile CLI, early argument validation, Treasury-only credential selection, ignored native namespace and active-purchase guard. |
| `scripts/native-test-dry-run.ts` | Fixed synthetic native preparation, no files, credentials or network; no simulated signature is presented as authentic. |
| `src/evm/sepolia-native.ts` | Small shared extraction of exact-amount observation and validation helpers; the original purchase wrapper still validates its approved terms. |
| `src/near/signing.ts` | Optional immutable caller-derived submission deadline, checked before credentials and after the last authority read immediately before `send_tx`. No retry or new signing architecture. |
| `src/purchase/coordinator.ts`, `services.ts`, `settlement.ts` | Forward the earliest original preparation/quote/fee/funding deadline into the same signing adapter; no timestamp extension or repricing. |
| Three new standalone test files and one fixture; existing signing/coordinator tests | Preparation, CLI, active-purchase guard, one-attempt/expiry/recovery gates, negative real LINK-as-native proof and wire-deadline regressions. |
| `package.json`, `tsconfig.near.json`, README and these reports/runbook | Commands, typechecking and operating instructions. No dependency/runtime upgrade. |

Reused the accepted Ethers EIP-1559 native builder, full trusted Treasury-key signature verification, NEAR SDK 7.4.0 direct signer, fresh authority/access nonce checks, generic canonical native receipt/balance checks, one-use broadcast transport, ignored-path validation, file locks and durable atomic writer. Node remains 22.23.4. Original Solidity/tests, public purchase verifier requirements and prior live LINK JSON evidence are unchanged.

## Standalone controls

The intent binds test ID, exact positive wei amount, Sepolia 11155111, Treasury/Investor addresses, MPC account/root/domain/path, 100 Tgas/one-yocto attachment and protective policy. No automatic amount/fee choice or protocol investment minimum is introduced. Fresh observations require code-free EOAs, matching confirmed/pending Treasury nonce, empty native calldata, successful simulation, buffered gas within caps and funds for value, maximum fee and operating reserve.

Defaults retain a minimum 20% buffer, 180,000 gas ceiling, 30 gwei/gas ceiling, 0.0036 ETH total fee ceiling and 0.001 ETH operating reserve. User-selected fees must satisfy fresh conditions; limits cannot be silently increased. The offline example uses 1,000,000,000,000 wei (0.000001 ETH), a 21,000 gas fixture estimate, 25,200 buffered gas, 1,000 wei priority and 5,000 wei maximum. Its maximum fixture fee is 126,000,000 wei. These are example assumptions, not approved live parameters or observations.

Signing requires exact unsigned-digest approval and one absolute external Treasury credential path. Only that signing command can select credentials. Fresh registered public-key/MPC checks and full trusted derived-key recovery are retained. The NEAR hash is durable before submission. An expired original preparation, including a deadline crossed during the adapter's last public read, prevents `send_tx`; a consumed attempt remains preserved for reconciliation.

Broadcast requires independent exact signed-hash approval. Both ordinary and expired-signed broadcasting generate a new audit; an inspection audit cannot later authorize sending. Recovery additionally acknowledges the original expired timestamp and binds the same intent, original MPC result and unchanged bytes. The audit is durable before the EVM attempt and is checked again after persistence against 30 seconds. A timeout, unexpected response or post-marker expiry leaves an uncertain operation with no automatic retry. No replacement, re-sign, generic force flag or timestamp reset exists.

Reconciliation validates the canonical transaction/receipt/parent, two confirmations, original signature/nonce/value/calldata/fees and exact Investor increase over existing ETH. Treasury debit includes value and actual gas. Reverted transactions retain failure/gas evidence. Known hashes are reconciled without broadcast. A confirmed/failed terminal record cannot be downgraded because later RPC data is missing or contradictory.

## Commands and offline validation

Credential-free commands:

```text
npm test
npm run typecheck
npm run test:native-standalone
npm run native:test -- --help
npm run native:test:dry-run
npm run purchase:dry-run
npm run verify:purchase -- --manifest evidence/portfolio-purchase.pending.json
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
```

The purchase placeholder correctly reports incomplete/PENDING without RPC calls, not purchase success. Existing LINK verification uses public network access; it was preserved rather than repeated unnecessarily. The native/purchase dry-runs are labelled fixtures and prove no live transfer. A genuine Treasury-native MPC success remains untested until separate live approval; strict crypto was not replaced with a fixture bypass. Existing generic native algebraic receipt/signature positives and authentic LINK regressions remain in the suite.

Final results: **492/492 full offline tests**, **39/39 standalone tests**, TypeScript, the native fixture example and the purchase dry-run passed. This preserves all 447 baseline tests and adds 45. The six deadline regressions also passed in the 54-test combined signing/coordinator run, covering valid/expired/mutated deadlines, final-read expiry, zero credential reads on expiry, single-attempt consumption and purchase deadline forwarding.

Exact validation commands executed on Windows:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:native-standalone') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','native:test','--','--help')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','native:test:dry-run')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase:dry-run') | Select-Object -First 12
git diff --check
```

No `prepare`, `sign`, `audit` or `broadcast` operator command was run against a live network.

## Archive finding and public reproducibility

[Task03FA_Archive_RPC_Investigation.json](Task03FA_Archive_RPC_Investigation.json) records the bounded set: ethPandaOps API-access documentation and BlockReq network/public-endpoint documentation. The reviewed ethPandaOps material did not establish an unauthenticated public Sepolia Beacon archive route; BlockReq's current pages did not establish Sepolia Beacon history support. No hostnames were guessed and neither was probed. PublicNode, Lodestar and Nimbus failures from Task03E were not repeated. There was no paid-account setup, private API credential, TLS bypass, HTTP downgrade, new node infrastructure or light-client/proof system.

The required reference remains state `0xa58da6009159dacf76d5a965b760b954fd5a2c630eaf28f4b4b4df2294603113`, anchored by the earlier execution reference in the preserved report. Exact historical checkpoints and their checkpoint blocks/envelopes remain mandatory. Today's finalized head, unproven cached responses or fixture data cannot replace them.

Offline tests and examples remain platform-independent and credential-free. Public signatures, transactions, canonical receipts/events and historical EVM movements require compatible NEAR/Ethereum services. Purchase finality-before-delivery additionally requires historical Beacon state/block/envelope access. Provider URLs are configurable, and missing/pruned/rate-limited history remains incomplete. Standard readers need no WealthPixels keys, private journal or paid account.

A separately approved purchase can still execute under the established checks, then be independently verified promptly **if** the required recent data remains available. Save that exact verification result with its observation time, but disclose that it does not guarantee later judges can rerun the queries. An unavailable provider after finalized payment does not cancel settlement obligations. Durable delayed verification remains an explicit unresolved infrastructure dependency.

## Exact future sequence and prerequisites

The [operator runbook](Task03FA_Live_Operator_Runbook.md) supplies all 12 command stages and approval stops: standalone prepare; one Treasury MPC approval; signing reconciliation; one EVM approval; receipt/balance reconciliation; fresh account/nonce review; approved demonstration prices/10-USDC quotation; first Investor authorization; finalized payment; LINK; native ETH; completed export and prompt public verification. Commands are templates only and were not executed here.

Before a native test, separately approve its amount/fees, check current public authorities/funding and use an unused ignored state file. The protected Treasury credential must remain external with its existing permissions and is loaded only after signing approval. After the test, refresh Treasury nonce and both balances; the purchase already queries current state and must not reuse any prior native/LINK digest or assumed nonce. Last Task 03E balances were historical 20 USDC at Investor and about 0.05 ETH per role; they are not live funding authorization.

Before quoting, have the operator and RPCs ready and approve one documented price packet for at most five minutes. Quote, quote-hash approval, payment preparation, exact-digest approval and the final MPC submission must fit the earliest original deadline, at most 60 seconds for economic observations. The immutable minimum now reaches the actual `send_tx` boundary. No completion-time guarantee is inferred from offline tests. If the window expires before an attempt, preserve/retire the unsigned preparation under existing rules and obtain new approvals. If any attempt exists, reconcile it first. Never silently reprice or extend timestamps. Subsequent signing reconciliation and hash-approved broadcasting of that already-authorized payment can continue under unchanged accepted-order assumptions and fresh cost checks; all three legs need not finish within 60 seconds.

No paid purchase can be erased by expiry, increased fees or an execution/evidence error. Partial delivery resumes only the outstanding obligation after reconciliation, with independent approvals for each signing and broadcast. One operator may handle both disposable roles in separate processes; production custody independence is not claimed.

## Deadline and checkpoint

November 14 remains a feasible live-demonstration target if preparation/approval sessions are coordinated and the first native test succeeds. Prompt verification is conditional on public data availability; delayed independent judging remains at risk until suitable archive retention is established. The unresolved archive issue was not hidden or allowed to expand this increment. No live action is authorized by this completion report.

The accepted Task03E commit/tag above is preserved. The new reviewed source/test/documentation checkpoint uses subject `milestone: Task 03F-A standalone native test and live readiness`; its exact commit ID and clean Git status are reported at handoff. No remote is configured or publication performed. Private credentials, ignored runtime state and executable signed payloads are excluded.
