# Task 03F-A - Future live operator sequence

**These are reviewed command templates, not authorization to execute them.** Task 03F-A ran offline tests/examples and documentation research only. Every live preparation, signing, broadcast and funding action needs separate approval. No private key contents belong in commands, logs, Git or chat.

Use one laptop and two disposable NEAR testnet identities. Each signing command starts a fresh Node process and selects only its own external credential file. The demonstrator may control both roles; this is not independent production custody. Native testing is separate from a portfolio purchase and never fabricates a USDC payment.

**November 11 timing update:** new purchase quotes use `schemaVersion: 2`, separating the fixed purchase-acceptance deadline from independently expiring execution observations. Version-1 historical quotes retain their original rules and hashes; no old quote is extended or recreated.

## Before starting

Use Node 22.23.4 (or a supported Node 22 patch >=22.22.2) and the existing lockfile. Standard commands below are platform-independent. Replace uppercase hash/path placeholders with the freshly reviewed public values; a placeholder is not an approval. The protected credential **path**, not its contents, is passed to a separately approved signing command. Carry chosen RPC overrides onto subsequent commands; omitted URLs use the documented FastNEAR/ethPandaOps defaults.

Keep npm's `--` separator when using the optional Windows launcher. For example, the future preparation command in step1 translates exactly to:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','native:test','--','prepare','--role','treasury','--id','native-smoke-001','--amount-wei','1000000000000','--max-fee-wei','5000','--priority-fee-wei','1000','--state','.local/transfers/native-tests/native-smoke-001.json','--near-rpc','https://archival-rpc.testnet.fastnear.com','--evm-rpc','https://rpc.sepolia.ethpandaops.io')
```

That command is **not run or approved here**. The illustrative amount is 0.000001 ETH; selected priority/max fees are 1,000/5,000 wei per gas. Both amount and fees require review before live use. If fresh checks reject them, stop; do not raise fees or change the amount automatically. Fixed protective ceilings remain 180,000 gas, 30 gwei/gas and 0.0036 ETH total fee; the minimum 20% buffer and 0.001 ETH operating reserve remain. The buffered gas limit is calculated, not automatically set to the ceiling.

Finish the native test before creating a purchase quote. Native `prepare`, `sign` and `broadcast` hold the purchase reservation lock and refuse any active quote/reservation/paid obligation without changing its journal. Inspection and reconciliation remain available. Use unused state/audit filenames under `.local/transfers/native-tests/`; never overwrite old or uncertain state.

## 1. Separately approve native ETH preparation

Review Treasury `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`, Investor `0x07FE574EdB1B2f537F9be452312C15A5b9427820`, Sepolia 11155111 and the exact amount/fees. After explicit preparation approval:

```text
npm run native:test -- prepare --role treasury --id native-smoke-001 --amount-wei 1000000000000 --max-fee-wei 5000 --priority-fee-wei 1000 --state .local/transfers/native-tests/native-smoke-001.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
npm run native:test -- inspect --role treasury --state .local/transfers/native-tests/native-smoke-001.json
```

Review the new intent hash, unsigned digest, nonce, value, empty calldata, fresh balances, raw/buffered gas, fees, maximum fee, reserve, original preparation time and 15-minute expiry. The Node process has read no signing credentials. Do not use the offline example's digest as live approval.

## 2. Separately approve exactly one Treasury MPC submission

Approve the displayed unsigned digest while preparation remains valid. Treasury authority is `wealthpixels-treasury.testnet`; signer contract `v1.signer-prod.testnet`, domain 0, path `wealthpixels/sepolia/v1`, 100 Tgas and 1 yoctoNEAR. Select only the existing external Treasury file:

```text
npm run native:test -- sign --role treasury --state .local/transfers/native-tests/native-smoke-001.json --intent-hash REVIEWED_INTENT_HASH --approve REVIEWED_UNSIGNED_DIGEST --reference OPERATOR_SIGNING_APPROVAL_REFERENCE --credential ABSOLUTE_EXTERNAL_TREASURY_JSON --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
```

On this Windows setup, the existing path is beneath `%LOCALAPPDATA%\WealthPixels\testnet-credentials\treasury.json`; retain its protected permissions. Do not print/read it for inspection. The signing adapter checks its public key and fresh registered authority. The NEAR hash is durable before the sole submission. A final immutable deadline is checked after the adapter's last public authority read, immediately before `send_tx`.

If the result is failed, timed out or uncertain, preserve the hash/marker. Do not run `sign` again. Reconcile read-only; any replacement requires a separately reviewed decision.

## 3. Reconcile signing and review the signed hash

```text
npm run native:test -- reconcile-signing --role treasury --state .local/transfers/native-tests/native-smoke-001.json --intent-hash REVIEWED_INTENT_HASH --near-rpc https://archival-rpc.testnet.fastnear.com
```

Require a successful FINAL direct MPC result, a signature that recovers the complete trusted Treasury public key/address, and exact original signed bytes/digest. Record the NEAR signing hash and signed Ethereum hash. The command loads no credentials and submits nothing. Review the actual signed gas parameters and original expiry before deciding on broadcast.

## 4. Separately approve exactly one Ethereum broadcast

An optional read-only inspection audit can be saved first:

```text
npm run native:test -- audit --role treasury --state .local/transfers/native-tests/native-smoke-001.json --intent-hash REVIEWED_INTENT_HASH --approve REVIEWED_SIGNED_HASH --reference INSPECTION_ONLY_REFERENCE --audit .local/transfers/native-tests/evidence/native-inspection-001.json
```

This does not authorize a later send. After separate human approval of the exact signed hash:

```text
npm run native:test -- broadcast --role treasury --state .local/transfers/native-tests/native-smoke-001.json --intent-hash REVIEWED_INTENT_HASH --approve REVIEWED_SIGNED_HASH --reference OPERATOR_BROADCAST_APPROVAL_REFERENCE --audit .local/transfers/native-tests/evidence/native-broadcast-001.json
```

Broadcast generates its **own** fresh audit, revalidates the MPC result, original bytes, Sepolia, EOAs, nonce, funds/reserve, simulation, gas and fees, and rejects a known transaction/receipt. It preserves the audit and attempt before its sole send; the audit must remain within 30 seconds, including after persistence.

If the original 15-minute preparation expired, use the same command only after explicit recovery approval, adding:

```text
--recovery --ack-prepared-at EXACT_ORIGINAL_UTC_TIMESTAMP
```

Use a new audit filename. Recovery accepts only existing valid signed bytes bound to the same intent/hash; it cannot sign, reset timestamps, change fees or replace the transaction. An expired unsigned preparation cannot be signed. A timeout, expired audit after the marker, RPC error or unexpected response retains an uncertain attempt requiring reconciliation. Do not clear a marker, resubmit or create a replacement automatically, even when no send appears to have occurred.

## 5. Reconcile receipt and exact balance movement

```text
npm run native:test -- reconcile --role treasury --state .local/transfers/native-tests/native-smoke-001.json --intent-hash REVIEWED_INTENT_HASH --evm-rpc https://rpc.sepolia.ethpandaops.io
```

Require a successful canonical receipt with at least two confirmations, exact native value and original signed hash, empty calldata, Treasury debit=value+actualgas, and Investor increase=value over its previous ETH holdings. Save both public transaction hashes and actual gas/fee observations. One confirmation remains pending; changed or missing terminal evidence must fail reconciliation without erasing the earlier record. A reverted transaction records gas spent and requires a separate decision. Never rebroadcast a known hash.

## 6. Refresh identities, funding and nonces

```text
npm run purchase -- inspect-networks --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
```

This is public inspection only. A successful native test consumes a Treasury nonce and value/gas; it does not consume the Investor's EVM nonce. Do not assume either nonce or any balance from an earlier report. The purchase coordinator will query them again. Resolve all pending/uncertain native activity before quoting a purchase.

## 7. Approve original demonstration prices and prepare a 10-USDC quote

First review ETH/USD, LINK/USD and NEAR/USD exact decimal/rational reference values, public sources, original observation times and one purchase ID. Historical references are acceptable only as labelled demonstration assumptions. No market prices or real price set were selected/approved in Task03F-A.

Place public input JSON at `.local/transfers/purchase-prices-input.json` with `purchaseId`, `providerId`, fresh UTC `validFrom`, `expiresAt` no more than five minutes later, and `prices.ETH/LINK/NEAR` objects containing `priceUsd` as an exact decimal string, `sourceUrl`, `sourceReference`, `originalObservedAt`. This file contains no credentials.

```text
npm run purchase -- propose-prices --input .local/transfers/purchase-prices-input.json --out .local/transfers/purchase-prices-proposal.json
npm run purchase -- approve-prices --input .local/transfers/purchase-prices-proposal.json --out .local/transfers/purchase-prices-approved.json --approve REVIEWED_PRICE_PROPOSAL_DIGEST --reference OPERATOR_PRICE_APPROVAL_REFERENCE
```

`approve-prices` requires separate explicit approval of that proposal; source timestamps and rates cannot be silently refreshed. Before opening the price window, have the human operator, public RPCs, reviewed USDC implementation, command forms and private Investor credential selection ready. Use new filenames for another attempt. A version-2 quote fixes acceptance expiry at creation to the earliest of the original approved-price expiry and any shorter requested/nominal quote limit. Its initial fee snapshot expires independently; a new command never restarts the approved-price window or extends purchase acceptance.

After separate authorization to prepare the live purchase:

```text
npm run purchase -- quote --prices .local/transfers/purchase-prices-approved.json --amount 10 --selected-max-fee-wei 5000 --selected-priority-wei 1000 --usdc-implementation REVIEWED_USDC_IMPLEMENTATION_ADDRESS --usdc-code-hash REVIEWED_USDC_IMPLEMENTATION_CODE_HASH
```

The 10-USDC amount is configurable and is not a production minimum. The quote freezes 50/50 native ETH/LINK quantities and all six expected costs under the approved prices. Official Sepolia USDC is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, six decimals; LINK is `0x779877A7B0D9E8603169DdbD7836e478b4624789`, 18 decimals. Review current USDC proxy implementation rather than copying its old pin blindly. The quote requires fresh 20%-buffered gas, funding and expected total fees at most 1 USDC for a 10-USDC investment. Maximum reserves remain separate from expected fees; native delivery value is not a fee. The 10% expected execution-cost threshold is an economic eligibility safeguard, not a WealthPixels charge to the Investor.

November 10 readiness corrections: USDC payment has its own 200,000-gas ceiling; LINK/native delivery ceilings remain 180,000. Actual limits remain freshly buffered estimates, with unchanged 30-gwei and 0.0036-ETH protective fee ceilings. NEAR affordability reserves full protocol receipt purchase funding plus deposit for one Investor and two Treasury signing calls after account storage reserves; anticipated refunds cannot fund these checks. The 5,000/1,000-wei command above is illustrative, not a current fee recommendation: obtain separately reviewed fee selections for the actual attempt. See [correction checkpoint and short-window rehearsal](Portfolio_Purchase_Readiness_Corrections_20261110.md).

## 8. Authorize the exact Investor payment within the fixed purchase window

Immediately review the compact purchase ID, amount, quantities, expected fees, quote hash, policy version and fixed purchase deadline. `remainingPurchaseValiditySecondsAtOutput` measures time at `commandOutputAt`, not operator message receipt. Preserve `commandStartedAt`, `commandCompletedAt` and failure/guard timestamps; application start is after module imports, and unavailable operator presentation/response timestamps remain null. Put **OPERATOR ACTION REQUIRED — [ACTION]** and **COPY THIS APPROVAL INTO CODEX CHAT** with the exact full authorization text/hash before supplementary narration. Detailed terms and cost evidence remain preserved in the journal and sanitized `inspect` output. Signing commands use npm `--silent` to avoid printing the privately selected credential path in npm's banner.

The operator separately approves that exact quote, authorizes payment preparation and reviews the resulting unsigned digest:

```text
npm run purchase -- approve-quote --quote-hash REVIEWED_QUOTE_HASH --approve REVIEWED_QUOTE_HASH --reference OPERATOR_QUOTE_APPROVAL_REFERENCE
npm run purchase -- prepare --quote-hash REVIEWED_QUOTE_HASH --leg usdc-payment --role investor --reference OPERATOR_PAYMENT_PREPARATION_REFERENCE
npm run purchase -- inspect
```

After explicit approval of the displayed payment digest:

```text
npm --silent run purchase -- sign --quote-hash REVIEWED_QUOTE_HASH --leg usdc-payment --role investor --approve REVIEWED_PAYMENT_UNSIGNED_HASH --reference OPERATOR_PAYMENT_SIGNING_REFERENCE --credential ABSOLUTE_EXTERNAL_INVESTOR_JSON
```

Use only `wealthpixels-investor.testnet`'s distinct external file. All local reviews and the first MPC submission must fit the **fixed original purchase-acceptance deadline**, which cannot exceed approved-price expiry. Preparation and signing each obtain fresh execution observations under the unchanged **60-second** maximum age and underlying-block freshness limits. Preparation rechecks its current eligibility deadline after preparing the transaction. Signing retains the earlier of fixed purchase expiry, fresh execution eligibility and the original 15-minute preparation deadline, including checks after durable attempt recording and after the final public authority read immediately before submission. Fresh observations cannot change approved prices, quantities, fee selections, immutable reservation limits or the exact approved transaction digest. Missing/stale inputs or fees above 10% stop the unpaid operation; public RPC plus human latency has no guaranteed bound.

If validity expires before any payment authorization or execution, explicitly release the expired quoted/approved reservation using `npm run purchase -- expire-unpaid --quote-hash REVIEWED_QUOTE_HASH --approve REVIEWED_QUOTE_HASH`. The local-only command refuses payment-authorized or any execution-bearing state. If an unsigned payment was already prepared, preserve it and use the existing explicit expired-unsigned retirement/new-quote process and new approvals; this route waits for the preparation's original 15-minute expiry. Do not reset dates or reprice an accepted quote. If a signing/submission marker exists, reconcile it before any release/new attempt. After timely initial payment authorization and submission, the three-leg purchase may complete beyond the original price window using the existing reconciliation, fresh broadcast checks and delivery-obligation rules.

## 9. Reconcile the authorized USDC payment to finality

```text
npm run purchase -- reconcile-signing --quote-hash REVIEWED_QUOTE_HASH --leg usdc-payment --role investor
```

Review the exact signed payment hash and recorded payment-authorization hash. After separate EVM broadcast approval:

```text
npm run purchase -- broadcast --quote-hash REVIEWED_QUOTE_HASH --leg usdc-payment --role investor --approve REVIEWED_PAYMENT_SIGNED_HASH --ack-authorization ORIGINAL_PAYMENT_AUTHORIZATION_HASH
npm run purchase -- reconcile --quote-hash REVIEWED_QUOTE_HASH --leg usdc-payment --role investor
```

Broadcast requires a fresh complete six-cost screen using unchanged accepted demonstration assumptions. If the signed preparation has expired, recovery additionally needs `--recovery --ack-prepared-at EXACT_ORIGINAL_PAYMENT_PREPARED_AT` and separate explicit approval. Reconcile without retries until payment is canonical and covered by Ethereum's finalized head; one payment claim commits atomically. Treasury must not release inventory earlier.

## 10. Deliver the quoted LINK from Treasury inventory

```text
npm run purchase -- prepare --quote-hash REVIEWED_QUOTE_HASH --leg link-delivery --role treasury --reference OPERATOR_LINK_PREPARATION_REFERENCE
```

Inspect the printed parameters/digest; separately approve signing:

```text
npm --silent run purchase -- sign --quote-hash REVIEWED_QUOTE_HASH --leg link-delivery --role treasury --approve REVIEWED_LINK_UNSIGNED_HASH --reference OPERATOR_LINK_SIGNING_REFERENCE --credential ABSOLUTE_EXTERNAL_TREASURY_JSON
npm run purchase -- reconcile-signing --quote-hash REVIEWED_QUOTE_HASH --leg link-delivery --role treasury
```

After independent approval of the resulting signed hash:

```text
npm run purchase -- broadcast --quote-hash REVIEWED_QUOTE_HASH --leg link-delivery --role treasury --approve REVIEWED_LINK_SIGNED_HASH --ack-authorization ORIGINAL_PAYMENT_AUTHORIZATION_HASH
npm run purchase -- reconcile --quote-hash REVIEWED_QUOTE_HASH --leg link-delivery --role treasury
```

Require exact quoted Transfer quantity and confirmed canonical receipt. Quote expiry or later fee changes do not cancel the accepted settlement obligation. Use acknowledged expired-signed recovery only when necessary; do not re-sign/retry automatically.

## 11. Deliver the quoted native ETH

After confirmed LINK and a fresh Treasury nonce/funding/canonical-payment check:

```text
npm run purchase -- prepare --quote-hash REVIEWED_QUOTE_HASH --leg eth-delivery --role treasury --reference OPERATOR_ETH_PREPARATION_REFERENCE
```

Review the new ETH value/digest/gas and independently approve signing:

```text
npm --silent run purchase -- sign --quote-hash REVIEWED_QUOTE_HASH --leg eth-delivery --role treasury --approve REVIEWED_ETH_UNSIGNED_HASH --reference OPERATOR_ETH_SIGNING_REFERENCE --credential ABSOLUTE_EXTERNAL_TREASURY_JSON
npm run purchase -- reconcile-signing --quote-hash REVIEWED_QUOTE_HASH --leg eth-delivery --role treasury
```

After independent signed-hash broadcast approval:

```text
npm run purchase -- broadcast --quote-hash REVIEWED_QUOTE_HASH --leg eth-delivery --role treasury --approve REVIEWED_ETH_SIGNED_HASH --ack-authorization ORIGINAL_PAYMENT_AUTHORIZATION_HASH
npm run purchase -- reconcile --quote-hash REVIEWED_QUOTE_HASH --leg eth-delivery --role treasury
```

Require exact quoted ETH increase, Treasury value+gas debit, canonical receipts and complete settlement. If LINK completed but ETH did not, resume only the missing obligation after reconciliation. No automatic full refund, compensation or replacement is authorized.

## 12. Export and promptly verify public evidence

After all three legs reconcile as completed:

```text
npm run purchase:export-evidence -- --purchase-id APPROVED_PURCHASE_ID --out evidence/portfolio-purchase.json
npm run verify:purchase -- --manifest evidence/portfolio-purchase.json --expected-quote-hash REVIEWED_QUOTE_HASH --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io --beacon-rpc https://ethereum-sepolia-beacon-api.publicnode.com --report evidence/purchase-verification-prompt.json
```

Use unused report/output filenames and separate publication approval. This verifier uses no credentials or local journal. Run it promptly while recent Beacon state may remain available; this is not a guarantee that the service still has every needed state even then. Preserve the exact result. Public RPC providers remain configurable. Missing historical state means **incomplete**, never success; an earlier report or cached RPC response does not replace later independent queries. If data expires after accepted payment, the delivery obligation remains; complete/reconcile settlement rather than cancelling it because the evidence provider is unavailable.

The bounded Task03F-A review did not resolve archival availability. Delayed judging remains conditional on suitable historical public services. There is no new light client/proof system, paid account, TLS bypass or HTTP downgrade. The existing two-way LINK proof remains separate and can still be checked with:

```text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
```

Offline judge commands remain `npm test`, `npm run typecheck`, `npm run purchase:dry-run`, `npm run native:test:dry-run`, and the targeted offline suites. Neither fixture dry-run is live execution evidence.
