# Portfolio purchase readiness corrections

Date: November 10, 2026. Accepted baseline: `781402925ed9f0b8ea8d16c42efc49e028d73f40`.

The three authorized corrections are implemented and validated offline. No live purchase, quotation, inventory reservation, price approval, signing operation or broadcast was created. No public RPC requests or protected credential reads were performed in this increment. The prior readiness report and public LINK/native ETH evidence remain unchanged.

## Corrections

**USDC-specific gas ceiling.** A quote now binds `usdcPaymentGasLimitCap = 200000` separately from the unchanged LINK/native delivery ceiling of `180000`. Cost collection, six-cost normalization, ERC-20 preparation/rechecks, immutable quote validation and public purchase evidence verification use the applicable per-leg ceiling. The actual limit remains `ceil(estimate * 12000 / 10000)` with exact integer arithmetic. The recorded estimate **154151** therefore selects **184982**, not 200000. Boundary tests accept 200000 buffered gas and reject 200001.

The **30-gwei** per-gas ceiling, **0.0036-ETH** total transaction-fee ceiling and **1000-bps** expected system-fee threshold remain independent guards. Increasing the USDC gas ceiling never grants permission to exceed either fee ceiling. A higher buffered gas limit can consequently require a maximum fee per gas below 30 gwei to satisfy the total-fee ceiling. LINK/native policies and original standalone transaction formats are unchanged.

**Guarded unpaid expiry CLI.** The new local-only command delegates to `expireUnpaidPurchase`, including its existing journal lock, integrity validation and atomic archival transition:

```text
npm run purchase -- expire-unpaid --quote-hash REVIEWED_EXPIRED_QUOTE_HASH --approve REVIEWED_EXPIRED_QUOTE_HASH
```

Both exact hashes must agree before journal access. RPC/credential options are rejected. Only expired quoted/approved records without payment authorization or any execution record qualify. Payment-authorized, prepared-for-signing, signing, signed, submitted, uncertain, paid and partially delivered records remain blocked. Successful expiry retains the immutable quote/approval/history, releases the reservation and cannot run twice for the same active record. A prepared unsigned leg still requires its separately guarded retirement route; an uncertain or paid obligation must reconcile instead. No manual journal editing is supported.

**Complete NEAR upfront funding.** The tested Experiment B calculator is extracted to `src/near/mpc-funding.ts`; the original Experiment B API is a compatibility facade with unchanged output. Purchases require explicit supported protocol inputs and recompute the model rather than trusting supplied totals. The reviewed direct `sign` request is 154 bytes including method name, with 100 Tgas and one yoctoNEAR. For the supported protocol-88 schedule:

```text
P = observed block gas price
A = 2 * P                                      (existing conservative price-growth allowance)
Q = max(A, protocol min_gas_purchase_price)      (receipt purchase price)
S = receipt send + FunctionCall send + per-byte send gas
R = receipt execution + FunctionCall execution + per-byte execution gas + 100 Tgas
upfront per call = S * A + R * Q + 1 yoctoNEAR
```

Send gas and receipt purchase gas are priced separately. The documented protocol-88 zero refund-penalty schedule is recorded; a contradictory exposed penalty or unsupported/missing pricing input fails closed. Available balance is account `amount` less protocol storage reserve, clamped at zero. Affordability requires one complete Investor call and two complete Treasury calls without crediting future refunds. After payment, fresh remaining-delivery checks reserve two Treasury calls before LINK and one before native ETH, excluding signing requests already recorded rather than requesting them again.

Fee assessments, immutable observation data and inventory reservations now preserve the full funding reserve. Expected execution burn retains the existing measured/assumed execution-gas calculation and buffer; it is not replaced by the full 100-Tgas upfront purchase. Native delivery value is not an execution fee. The six-cost expected-fee screen and actual receipt accounting remain separate from maximum reserves.

For context, the preserved November 10 public snapshot's protocol inputs imply **0.100951484392258000000001 NEAR per call**, rather than the former **0.010100000000000000000001** reserve. This is historical, not a fresh estimate. The new synthetic regression schedule independently yields **0.102913918400603200000001 NEAR per call**, or **0.205827836801206400000002** for two Treasury calls. These fixture figures are not funding instructions or live approvals. Fresh supported public inputs determine actual future reserves.

## Changed files

| Files | Purpose |
|---|---|
| `src/purchase/config.ts`, `quote.ts` | Per-leg USDC ceiling and immutable policy binding. |
| `src/evm/asset-intent.ts`, `src/purchase/legs.ts` | Buffered ERC-20 construction, integrity and fresh rechecks use the leg's policy. |
| `src/evidence/purchase-leg.ts`, `purchase-manifest.ts` | Public evidence accepts the approved USDC-specific ceiling and still enforces delivery/fee limits. |
| `scripts/purchase.ts` | Exact-hash guarded, local-only `expire-unpaid` command and help. |
| `src/near/mpc-funding.ts`, `experiment-b-fees.ts` | Shared protocol funding calculator/parser/integrity checks; Experiment B compatibility facade. |
| `src/purchase/costs.ts`, `fee-eligibility.ts`, `readiness.ts` | Explicit funding observations, full maximum reserves, separate expected burn and storage-safe role affordability. |
| `src/purchase/services.ts`, `settlement.ts`, `coordinator.ts` | Fresh funding inputs reach remaining-delivery guards. |
| `test/near/usdc-gas-policy.test.ts`, `purchase-prefunding.test.ts`, `expire-unpaid-cli.test.ts` | New focused boundary, rejection, integrity, recovery and no-side-effect regressions. |
| Nine existing purchase test/fixture files | Explicit synthetic funding inputs, corrected maximum reserves and propagation assertions. Authentic recorded MPC fixtures are unchanged. |
| `package.json` | New focused test command; all new tests also run in the full offline suite. No dependency or lockfile change. |
| `README.md`, `docs/Task03FA_Live_Operator_Runbook.md`, this report | Current correction status, guarded expiry instructions and next operator sequence. |

Nine existing test/fixture files: `fee-eligibility.test.ts`, `prepayment-journal.test.ts`, `purchase-coordinator.test.ts`, `purchase-readiness.test.ts`, `purchase-services.test.ts`, `quote.test.ts`, and `fixtures/purchase-quote.ts`, `fixtures/purchase-readiness.ts`, `fixtures/purchase-execution.ts` (all under `test/near`).

The new immutable quote shape explicitly requires the USDC policy and protocol funding observations. A pre-fix purchase quote is not silently migrated or authorized using obsolete reserve assumptions. The accepted readiness snapshot found no existing purchase journal/reservation to migrate; all original standalone and diagnostic records remain in their original formats.

## Offline validation and preservation

Exact final validation commands in this Windows workspace:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:purchase-corrections')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase:dry-run')
```

These correspond to platform-independent `npm run test:purchase-corrections`, `npm test`, `npm run typecheck` and `npm run purchase:dry-run`. Targeted correction tests: **22 passed**. Full offline suite: **635 passed**, including all 613 previous cases. TypeScript passed. The three-leg fixture dry-run passed and reported `settling`, `partially-delivered`, then `completed`, with no outstanding fixture obligations. All prices, approvals, signatures, broadcasts and balances in that dry-run are simulated. No result is represented as a live purchase.

Additional focused validation ran the new USDC tests and the prefunding tests directly with `node --import tsx --test`. The final deposit regression confirms that generic fee accounting cannot reduce the MPC's minimum upfront deposit reserve, while purchase observations require exactly one yoctoNEAR. An intermediate over-restrictive deposit check failed 17 generic accounting cases; it was corrected without changing their expected-fee or exact-threshold assertions. The final results above supersede that intermediate run. The existing Experiment B compatibility, quote/fee arithmetic, journal, coordinator, readiness and public evidence tests remain covered in the full suite. No dependency install, upgrade, compile or legacy contract rewrite was needed.

Preservation verification compares SHA-256 for every one of the **60 original runtime JSON files**, including `native-smoke-20261109-001` in its unchanged `near-uncertain` state. Public evidence, recorded live signatures, legacy Solidity/tests and the lockfile remain unchanged. Reviewed source, tests and documentation only belong in the local Git checkpoint; runtime state, keys, executable signed bytes and generated artifacts are excluded. No remote is configured. The exact resulting checkpoint hash and final Git status accompany the completion response.

## Next operator stage — proposal only

The commands below are future operator templates. They were not run against a live purchase in this increment and grant no price, signing or broadcasting authorization.

1. **Stage public demonstration observations after separate authorization.** Choose one unused purchase ID and unused ignored input/proposal/approved filenames under `.local/transfers`. Manually record ETH/USD, LINK/USD and NEAR/USD reference prices as positive exact decimal strings from public sources the operator can inspect. Record each public URL, source/observation reference and the true `originalObservedAt`. Historical rates are acceptable only when expressly labelled demonstration assumptions. Keep the source observations unchanged; do not copy synthetic fixture values or approvals. The input contains `purchaseId`, `providerId`, `validFrom`, `expiresAt` (at most five minutes later), and `prices.ETH/LINK/NEAR` with `priceUsd`, `sourceUrl`, `sourceReference`, `originalObservedAt`.

2. **Generate a proposal, then stop for approval of its digest.** Use new files; neither command can overwrite an existing output:

   ```text
   npm run purchase -- propose-prices --input PUBLIC_INPUT_JSON --out NEW_PRICE_PROPOSAL_JSON
   npm run purchase -- approve-prices --input NEW_PRICE_PROPOSAL_JSON --out NEW_APPROVED_PRICE_JSON --approve REVIEWED_PRICE_DIGEST --reference EXPLICIT_HUMAN_PRICE_APPROVAL
   ```

   The second command is a separate human-approved step. Approval binds exact values, sources, purchase ID and original validity. If the approval window expires, stop and obtain a new explicitly reviewed proposal; never refresh original observations, timestamps or prices silently.

3. **Rehearse before opening the live quote window.** Use `npm run purchase:dry-run`, `npm run test:purchase-corrections`, and the existing timing/expiry coordinator tests to practice the sequence without credentials or network activity. Have the operator present in VS Code, command templates ready, reviewed current USDC implementation pin, explicitly selected RPCs/fee choices and separate role-file locations. Do not load either credential for rehearsal. Fixture completion proves control flow, not that public RPC plus human latency fits 60 seconds; actual timing remains an operational risk. Never automate approval of a digest that has not yet been reviewed.

4. **After separate live quote/preparation authorization**, use the approved prices and freshly reviewed fee selections:

   ```text
   npm run purchase -- quote --prices NEW_APPROVED_PRICE_JSON --amount 10 --selected-max-fee-wei REVIEWED_MAX_WEI --selected-priority-wei REVIEWED_TIP_WEI --usdc-implementation REVIEWED_USDC_IMPLEMENTATION --usdc-code-hash REVIEWED_IMPLEMENTATION_HASH --near-rpc https://test.rpc.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
   npm run purchase -- approve-quote --quote-hash QUOTE_HASH --approve QUOTE_HASH --reference EXPLICIT_QUOTE_APPROVAL
   npm run purchase -- prepare --quote-hash QUOTE_HASH --leg usdc-payment --role investor --reference AUTHORIZED_PAYMENT_PREPARATION --near-rpc https://test.rpc.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
   ```

   Review the exact quote/quantities/six costs and displayed unsigned digest. Only after separate hash-bound signing approval run the following with **only the Investor credential**:

   ```text
   npm run purchase -- sign --quote-hash QUOTE_HASH --leg usdc-payment --role investor --approve REVIEWED_USDC_UNSIGNED_DIGEST --reference EXPLICIT_PAYMENT_SIGNING_APPROVAL --credential EXTERNAL_INVESTOR_FILE --near-rpc https://test.rpc.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
   ```

   Quote approval, payment preparation, digest review/approval and the final MPC submission must fit the **earliest original price/fee expiry**, with the fee assessment at most 60 seconds old. It is not a new 60 seconds per command. Credential access and MPC submission are separate future authorizations. Slow reads fail closed at the original deadline; no automatic retry, reprice or timestamp extension is allowed. A clean expired unpaid reservation can use `expire-unpaid`; already prepared/authorized/uncertain states follow their existing guarded retirement or reconciliation rules.

5. **Finish the three legs through independent approvals.** Read-only `reconcile-signing` verifies the original Investor MPC outcome. Review its signed hash and payment-authorization hash, separately approve `broadcast`, then `reconcile` the exact USDC payment to canonical finality. Only then prepare Treasury LINK, separately approve its digest for Treasury signing, reconcile signing, separately approve its signed hash for broadcast, and verify the exact LINK event/quantity. Obtain a fresh Treasury nonce, then repeat those separate approvals/reconciliation for native ETH. Use the same exact quote, role and leg throughout; only one role credential is available to each signing process. Every broadcast binds `--approve SIGNED_HASH --ack-authorization ORIGINAL_PAYMENT_AUTHORIZATION_HASH`.

   The whole purchase need not finish in 60 seconds after timely initial authorization/submission. Subsequent fee observations are fresh but preserve the accepted original prices/quote. Expired signed preparations require the existing purchase-bound recovery acknowledgment, unchanged signed bytes and a fresh 30-second audit; this is not a force flag. Preserve uncertain attempts and reconcile before further action. Finalized payment and partial delivery remain outstanding obligations; no automatic duplicate delivery, refund or replacement is authorized.

6. **Export and verify promptly after completion.** Use `purchase:export-evidence` for the completed purchase, then credential-free `verify:purchase` against the exact quote hash and configurable public endpoints. Historical Beacon availability remains unresolved; missing archival state must yield incomplete verification. No additional archive investigation was performed here.

For Windows launcher use argument arrays, retaining npm's separator, for example `@('run','purchase','--','inspect')`. Do not chain live stages into an automatic script. See the [12-stage operator runbook](Task03FA_Live_Operator_Runbook.md) for full reconciliation, broadcast and recovery command forms.

**Recommended next checkpoint:** authorize staging public demonstration-price inputs and generating their exact proposal for review, with an offline short-window rehearsal. Approving those inputs does not itself authorize a live quote/reservation, credential access, signing or broadcasting. No numeric demonstration prices are selected or approved by this report.
