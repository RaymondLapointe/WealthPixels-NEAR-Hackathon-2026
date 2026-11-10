# Native ETH milestone closure and portfolio purchase readiness

Date: November 10, 2026 (America/Toronto). Baseline: `ef5d24d2508692dc57a3629b756c209d093e9afa`.

**The native ETH milestone is closed. The portfolio purchase is not ready for live preparation yet.** Funding, token identities and both NEAR authorities passed public inspection. A real USDC gas-ceiling failure, missing approved prices and two narrow recovery/funding gaps need attention first. No purchase quote, reservation, transaction, price approval or signing operation was created.

## Completed native milestone

[Public native evidence](../evidence/native-eth-smoke.json) records test `native-smoke-20261110-002`, Ethereum hash `0xa3bcc196bfdc3a47c51c720631521048ce3e5c35425a1a8fb4d0c91bf12bdc74` and NEAR hash `EHMUuAN8z1ZpoN8SrUq9P98wRfKQDzoNFZTwRpkgAvqb`. The Ethereum receipt succeeded in block **12105109**, with **10 recorded confirmations**, **21000 gas**, **1000017 wei/gas** effective price and **0.000000021000357 ETH** fee. Investor received exactly **0.000001 ETH**; Treasury lost that value plus fee.

Packaging revalidated the saved state/MPC proof and replayed all 13 receipt-verifier reads from recorded public responses. It made no new native-transaction lookup. The summary excludes credentials, sensitive local paths and executable signed payloads. This standalone transfer is separate from a USDC portfolio purchase. Original execution records and timestamps are unchanged.

## Public readiness snapshot

The existing `purchase inspect-networks` collector passed at **12:37:33.565 Toronto / 17:37:33.565 UTC**, Sepolia block **12106158**, FINAL NEAR block **277099029**. [Structured observations](Portfolio_Purchase_Readiness_20261110.json) preserve exact values, references, supplementary checks and limitations. Its original observation expiry was **17:38:24 UTC**; this report is a snapshot, not continuing payment authorization.

| Account | ETH | USDC | LINK | Confirmed / pending EVM nonce |
|---|---:|---:|---:|---:|
| Treasury | 0.09999897885594744 | 0 | 24.1 | **2 / 2** |
| Investor | 0.05000099995618284 | **20** | 0.9 | **1 / 1** |

Treasury's nonce now includes the completed native transfer. No pending nonce conflict, active purchase journal or outstanding purchase obligation was found. The old `native-smoke-20261109-001` remains the accepted, unchanged `near-uncertain` exception; it was not retried or reclassified.

Configured [Circle Sepolia USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, **6 decimals**; LINK is `0x779877A7B0D9E8603169DdbD7836e478b4624789`, **18 decimals**. Both deployed-code pins passed. USDC was unpaused, neither role was blacklisted and both derived role addresses were code-free EOAs. The direct Investor `transfer(Treasury, 10000000)` needs **no spender allowance or approval transaction**.

Observed USDC implementation remains `0xDa317C1d3E835dD5F1BE459006471aCAA1289068`, code hash `0xf4898b096a273d86cda13cce6503404da4005565fae6026a94919b231229d85b`, matching earlier recorded observations. That candidate must still be explicitly reviewed and bound in the future quote; a public observation does not approve an upgrade.

Both NEAR accounts retain their expected sole FullAccess keys. Treasury key nonce is **275945855000002**, Investor **275946428000003**. MPC version **3.18.0**, trusted root, domain **0**, path `wealthpixels/sepolia/v1`, full role derivations and **15-Tgas minimum** matched; planned signing attachment remains **100 Tgas + 1 yoctoNEAR**. Storage-safe balances were approximately **9.9965711324 NEAR** Treasury and **9.9965274300 NEAR** Investor.

Current primary connectivity passed through `https://test.rpc.fastnear.com` and `https://rpc.sepolia.ethpandaops.io`. No endpoint default changed. No further faucet allocation is indicated by this snapshot: Investor already holds enough USDC for the target. Quote-sized inventory and all fee reserves still require fresh validation after prices are approved.

## Blockers and narrowly scoped corrections

1. **USDC payment exceeds the existing gas ceiling.** At the recorded block, the exact 10-USDC simulation returns `true`, but `eth_estimateGas` is **154151**. The required buffer gives `ceil(154151 × 1.20) = 184982`, above **180000** by **4982**. The existing guard rejects this before quotation/reservation. No cap was increased. Initial supplemental reads used a transcribed older block tag; two corrected reads at the actual readiness block returned the same result. Both observations are preserved and the older one is excluded from the readiness verdict.

   There is no existing per-leg gas-cap CLI override: all three legs share `quote.policy.execution`, and the quote cannot weaken the configured cap. Recommend a separately authorized **USDC-payment-only ceiling of 200000**, retaining LINK/native limits, the 20% buffer, the **30-gwei** per-gas ceiling and **0.0036-ETH** total ceiling. This is a proposal requiring implementation review and tests, not permission or a current feature. The actual transaction gas limit must continue to be the fresh buffered estimate. Higher gas ceilings never automatically increase either fee ceiling.

2. **No approved live price set exists.** No purchase price input/proposal/approved set was found in runtime records. The approved pricing architecture supplies no current numeric prices. Existing test prices and approvals are synthetic and expired; they cannot authorize a purchase. A future purchase-scoped ETH/USD, LINK/USD and NEAR/USD proposal needs positive exact rational rates, public provenance, original observation timestamps, an exact-digest human approval and at most five minutes' validity. No live price collector is needed.

3. **Expired unprepared quotes lack an operator CLI release path.** The guarded `expireUnpaidPurchase` library function exists, but `purchase` has no corresponding command. `retire-unsigned` requires an already prepared leg and its 15-minute expiry. A quote that expires before successful payment preparation can therefore leave a reservation that blocks the next quote. No reservation is stuck now. Recommend a small, separately approved CLI wrapper around the existing expiry function, preserving its rejection of payment-authorized, signed, submitted, uncertain or paid states. Do not edit journal JSON manually.

4. **Purchase NEAR upfront reserves omit the receipt purchase floor.** The collector, fee-reserve interface/journal and remaining-delivery checks use `(100 Tgas + 1 Tgas) × observed gas price + deposit`. At the pinned inputs this is **0.010100000000000000000001 NEAR/call**. The already tested diagnostic model separates send burn and receipt-gas purchase funding; its corresponding full upfront requirement is **0.100951484392258000000001 NEAR/call**. One Investor call and two Treasury calls are comfortably funded, so this is a latent safeguard defect, not an actual balance shortage. Recommend a separately authorized correction reusing that pricing model, without changing expected execution burn or relying on refunds for affordability.

Relevant implementation: [limits](../src/purchase/config.ts), [quote policy](../src/purchase/quote.ts), [cost collection](../src/purchase/readiness.ts), [native fee guard](../src/evm/sepolia-native.ts), [coordinator](../src/purchase/coordinator.ts), [journal expiry](../src/purchase/journal.ts), [fee reserves](../src/purchase/fee-eligibility.ts), [correct funding model](../src/near/experiment-b-fees.ts).

## Quantities and economic eligibility

The target is **10000000 USDC base units**, allocated **5000/5000 bps**, or five nominal quote-dollars per asset. For approved whole-asset USD rates `N/D`:

```text
ethWei        = floor(5 × 10^18 × ETH_USD.denominator / ETH_USD.numerator)
linkBaseUnits = floor(5 × 10^18 × LINK_USD.denominator / LINK_USD.numerator)
```

Actual live quantities are **not yet defined**, because no price set is approved. Integer rounding and remainders are preserved in the immutable terms. No commission, spread, pooled token or platform-fee deduction is implemented in this path; the full 10-USDC amount funds allocation terms. This is a configurable target, not an investment minimum.

`MAX_EXPECTED_FEE_BPS = 1000` means the exact rational sum of **three EVM gas costs and three NEAR signing costs**, regardless of payer, must be **≤1 nominal USDC**. Equality passes; missing inputs fail closed. EVM estimates use buffered gas and a conservative assumed base fee plus selected tip; maximum reserves use buffered gas times maximum fee. Native ETH delivery value is not an execution fee. NEAR expected burn is separate from gas prefunding. Actual costs and the realized ratio come from completed receipts at original accepted conversion assumptions.

**No numerical eligibility pass exists now.** Approved ETH/NEAR conversion prices, allocation quantities, quantity-specific delivery gas observations and selected purchase fees are missing, and the USDC gas guard already fails. The existing offline fixture dry-run passes; it does not supply these live inputs or establish production economics.

## Precise execution sequence after separate fixes and approvals

Carry explicit `--near-rpc https://test.rpc.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io` on every applicable command; omission selects older defaults. No command below has been executed against a live purchase.

Command shorthand below means **`npm run purchase -- ...`**, **`npm run purchase:export-evidence -- ...`** and **`npm run verify:purchase -- ...`**. Preserve npm's `--` separator, including in PowerShell argument arrays. Public price input/proposal/approved JSON placeholders must resolve to files under ignored `.local/transfers`; output files must be unused.

1. Review/authorize the narrow gas, unpaid-expiry and NEAR-reserve corrections; validate their guards and existing regressions. Then choose one purchase ID and stage public price input, command templates and separate protected role-file locations. Do not read keys for readiness.
2. After price-proposal authorization, run `purchase propose-prices --input PUBLIC_INPUT --out NEW_PROPOSAL`. Review its exact digest and separately approve `purchase approve-prices --input NEW_PROPOSAL --out NEW_APPROVED --approve PRICE_DIGEST --reference PRICE_APPROVAL`. Never refresh timestamps or substitute rates automatically.
3. After separate purchase-preparation authorization, run `purchase quote --prices NEW_APPROVED --amount 10 --selected-max-fee-wei MAX_WEI --selected-priority-wei TIP_WEI --usdc-implementation REVIEWED_ADDRESS --usdc-code-hash REVIEWED_HASH`. This freshly collects all six costs, enforces ≤10%, pins the implementation and reserves inventory. Review the immutable quote, exact quantities, prices, fee ratio and effective expiry.
4. Within the **original effective quote window**, run `purchase approve-quote --quote-hash QUOTE_HASH --approve QUOTE_HASH --reference QUOTE_APPROVAL`, then separately authorized `purchase prepare --quote-hash QUOTE_HASH --leg usdc-payment --role investor --reference PAYMENT_PREPARATION`. Inspect its exact unsigned digest. Only after explicit digest approval run `purchase sign` for that leg with the Investor's external credential and approval/reference. No Treasury credential belongs in this process.
5. Reconcile the single Investor MPC request with `purchase reconcile-signing`. Review the signed payment hash and recorded payment-authorization hash. Separately authorize `purchase broadcast --quote-hash QUOTE_HASH --leg usdc-payment --role investor --approve SIGNED_PAYMENT_HASH --ack-authorization ORIGINAL_AUTHORIZATION_HASH`. Its own fresh audit rechecks the full fee screen. Reconcile with `purchase reconcile` until USDC payment is canonical and covered by Ethereum's finalized head. Payment identity `(chainId, transactionHash, TransferLogIndex)` is claimed atomically with durable paid state; it cannot fund a second order.
6. Treasury `purchase prepare ... --leg link-delivery --role treasury`, inspect, separately approve `sign`, reconcile MPC, separately approve `broadcast`, then reconcile the exact quoted LINK event/quantity. Refresh the Treasury nonce; **2** is the current observation, not a future promise.
7. After confirmed LINK and a fresh canonical payment check, repeat those separate prepare/sign/reconcile/broadcast/reconcile checkpoints for `eth-delivery`. It follows LINK and obtains another fresh Treasury nonce, rather than preparing both deliveries with the same nonce.
8. After all three legs complete, run `purchase:export-evidence --purchase-id PURCHASE_ID --out evidence/NEW_PURCHASE.json`, then `verify:purchase --manifest evidence/NEW_PURCHASE.json --expected-quote-hash QUOTE_HASH` with the explicitly selected public endpoints and an unused report filename. This verifier needs no credentials or private journal. The historical Beacon archive requirement remains unresolved; verify promptly, disclose retention limits, and report incomplete data honestly rather than substituting fixtures.

In steps 4–7, `purchase sign` always requires exact `--approve UNSIGNED_HASH --reference APPROVAL --credential ABSOLUTE_EXTERNAL_ROLE_FILE`; every broadcast requires exact `--approve SIGNED_HASH --ack-authorization ORIGINAL_AUTHORIZATION_HASH`. A separate human approval is required for each signing and each broadcast. Preserve the existing [operator runbook](Task03FA_Live_Operator_Runbook.md) for full command shapes, substituting the explicitly selected endpoints.

## Timing, uncertainty and deadline

The initial quote/payment-authorization window is the earliest original price expiry and original fee-observation expiry, with fees at most **60 seconds** old. New observations cannot extend the original quote. All quote approval, payment preparation, digest approval and the first MPC submission must fit that window. The successful native workflow used longer human pauses; it proves no reliable 60-second operating cadence. Pre-stage commands and use a present operator's VS Code terminal for rapid, explicit hash reviews rather than relying on multiple leisurely chat round trips. Rehearse this sequence before opening the live quote window; do not relax the policy to make timing easier.

After a timely original payment authorization and MPC submission are recorded, later reconciliation, payment broadcast and delivery do not all need to finish in that minute. Existing code explicitly permits fresh network-cost assessment using the original accepted prices after their expiry. A marker alone never authorizes a late MPC submission; failed or uncertain submission must reconcile. Each preparation still has its original 15-minute limit. Valid expired signed legs use the purchase-bound recovery route with original timestamp acknowledgment, exact signed hash/authorization and a new 30-second audit; never reset timestamps or request a replacement signature automatically.

The literal recovery additions are `--recovery --ack-prepared-at EXACT_ORIGINAL_UTC_TIMESTAMP`, alongside the exact quote/leg/role, signed-hash approval and original payment-authorization acknowledgment. They are not a generic force flag or permission to bypass fresh checks.

Uncertain transactions retain hashes/attempts and must reconcile. Finalized payment creates an outstanding delivery obligation. A partial purchase resumes only the missing asset after checking previous receipts; fee increases, restarts, expiry or evidence-service failure do not erase settlement. There is no automatic full refund after partial delivery. Local quote/payment association is not trustless onchain enforcement; settlement is sequential, and the demonstrator may control both disposable roles.

With four calendar days to November 14, the focused path remains plausible, but these fixes, price approval and the short initial operator window are real prerequisites. Funding, new accounts, a frontend, another blockchain and new market-data infrastructure are not the next work.

## Validation and preservation

`npm run purchase:dry-run` passed with explicitly simulated three-leg execution; `npm run typecheck` passed. A focused offline check confirmed the observed USDC estimate is rejected by the unchanged production gas guard. The accepted **613-test** suite remains the source baseline; no application source changed, so it was not rerun for this documentation-only increment. Native public evidence passed the existing production validators and recorded-read replay.

All **60 existing runtime JSON files** and prior public transaction records remain unchanged. Only public native evidence, documentation/index updates and the structured readiness snapshot are included in the local milestone checkpoint; no private state or executable signed bytes are staged. The exact commit and final clean Git status accompany the completion report.

Recommended next authorization: the three narrowly scoped safety/operability corrections and their offline tests. Do not create a live quote or accept payment until those are reviewed and an actual demonstration price proposal is approved.
