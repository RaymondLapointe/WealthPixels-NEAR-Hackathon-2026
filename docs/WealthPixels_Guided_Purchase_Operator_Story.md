# WealthPixels Guided Purchase Journey — Operator Story

**Diversification Without Pooling.**

**Ownership Without Blockchain Boundaries.**

**Investing Without Barriers.**

November 11, 2026. **Completed live purchase:** `guided-purchase-20261111-003` invested **10 test USDC**, allocated 50/50 to native ETH and LINK, and delivered **0.002400960384153661 ETH** and **0.478697941598851124 LINK** directly to the Investor. The [completed public manifest](../evidence/guided-purchase-20261111-003.json) and [successful independent verification report](../evidence/guided-purchase-20261111-003-verification-001.json) record the result. Final reconciliation completed at `2026-11-11T21:46:08.630Z`; journal revision **47** has no active purchase or outstanding delivery obligation. Attempts 001 and 002 remain archived as `expired-unpaid`.

This story preserves the execution and approval guide alongside the completed evidence. Its live commands are templates for a separately authorized new purchase; **do not repeat Attempt 003 or reuse its expired approvals or occupied output paths**. Read alongside the [judge story](WealthPixels_Hackathon_Demo_Story.md), [existing operator runbook](Task03FA_Live_Operator_Runbook.md) and [readiness corrections](Portfolio_Purchase_Readiness_Corrections_20261110.md).

WealthPixels is designed to make diversified portfolio purchases as convenient as buying units in a fund: an Investor selects a portfolio model, makes a single investment and receives the eligible individual underlying assets directly. Diversification is the objective; pooling investors' capital is one mechanism for making it accessible. WealthPixels' alternative is principal inventory-based execution with direct individual-asset ownership. Explicit transaction authorization, responsible settlement controls and cross-blockchain ownership and execution as the architecture evolves are enduring product principles.

The broader vision includes portfolios of many eligible onchain assets across blockchain ecosystems. This hackathon prototype uses NEAR Testnet Chain Signatures to authorize Ethereum Sepolia transactions; both native ETH and LINK are delivered on Sepolia. The 10-test-USDC amount, 50/50 allocation, test networks, manually approved demonstration prices, single operator with two disposable identities and CLI workflow are prototype choices, not definitions of the long-term product.

**Verifiable Execution.** This supporting product principle is intended to remain fundamental beyond the hackathon. WealthPixels is designed to create independently checkable evidence connecting approved portfolio purchase terms, the Investor's payment, relevant transaction authorizations, delivery of the individual underlying assets, and resulting balances, costs and settlement outcomes. The aim is to establish what was authorized, what was delivered and whether execution matched the approved terms. Chapter 10 describes the implemented checks and their trust and data-availability limits.

## How to use this story with Codex

For a separately authorized new attempt, say **“Begin the WealthPixels Guided Purchase Journey.”** Codex should first confirm an unused purchase ID and output paths, then open Chapter 1, give the five short sections below and stop at its next required approval. This instruction starts narration; it does not approve unknown prices, a quote, credential access, MPC signing or broadcasting. A command succeeding never authorizes the next checkpoint. Stay within the current chapter when its result needs another approval.

Codex should show each fully populated proposed command through the normal VS Code command-permission process. Clicking **Allow** permits that tool command; it does not replace explicit price/quote/digest/signed-hash authorization. Put **OPERATOR ACTION REQUIRED — [ACTION]** first, followed by essential purchase/transaction terms and **COPY THIS APPROVAL INTO CODEX CHAT** with the complete exact authorization text and digest/hash. Put the five-part narration after that approval block. Once authorized, execute only that operation; never combine live stages or approve a hash automatically from command output. Report `planned`, `simulated`, `prepared`, `submitted`, `uncertain`, `confirmed` and `completed` accurately.

Action commands return compact JSON; detailed underlying terms and evidence remain in the journal and sanitized `inspect` output. Preserve `commandStartedAt` (application entry after imports), `commandCompletedAt`, `commandOutputAt` and, on failure, `commandFailedAt` plus any freshness/expiry `guardRejectedAt`. `remainingPurchaseValiditySecondsAtOutput` and `remainingPriceValiditySecondsAtOutput` describe command-output time. `operatorPresentedAt` and `operatorApprovalReceivedAt` remain null when unavailable; never infer human response latency. The `operatorActionRequired`, `approvalInstruction` and `copyApproval` fields supply the next review prompt, not permission to execute it.

Both disposable testnet roles may be operated by one human on one laptop. They have different NEAR signing credentials and Ethereum addresses; this demonstrates separate account authorization, not independent production custody. Each signing process loads only the selected role's file. Never paste keys, credential contents or protected file paths into the story or public evidence.

| Role | NEAR Testnet signing authority | Ethereum Sepolia address |
|---|---|---|
| Investor | `wealthpixels-investor.testnet` | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| WealthPixels Treasury | `wealthpixels-treasury.testnet` | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |

Sepolia chain ID is **11155111**. USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 decimals); LINK: `0x779877A7B0D9E8603169DdbD7836e478b4624789` (18 decimals). Refresh deployed code, USDC implementation/paused/blacklist status, both authorities, balances and nonces before a real attempt. A direct USDC `transfer` needs no spender allowance.

## Command card — templates, not current approvals

Use VS Code's PowerShell terminal at the repository root. Each later code block is a separate operator action. The argument arrays preserve npm's **`--` separator**. Platform-independent equivalents use `npm run purchase -- ...` with the same flags. Signing templates add npm's `--silent` option to suppress its command banner, which could otherwise echo the privately resolved credential path; application results and errors remain visible.

These are **reproduction placeholders**, not allocated identifiers or approvals. Replace `NEW_PURCHASE_ID` only after checking the journal, purchase-ID history and every proposed output path. If occupied, stop and agree new names. Attempt 003's real manifest and read-only verification command are in Chapter 10; its completed records must not be overwritten.

```powershell
$PurchaseId = 'NEW_PURCHASE_ID'
$PriceInput = '.local/transfers/NEW_PURCHASE_ID-prices-input-001.json'
$PriceProposal = '.local/transfers/NEW_PURCHASE_ID-prices-proposal-001.json'
$ApprovedPrices = '.local/transfers/NEW_PURCHASE_ID-prices-approved-001.json'
$PublicManifest = 'evidence/NEW_PURCHASE_ID.json'
$VerificationReport = 'evidence/NEW_PURCHASE_ID-verification-001.json'
$NetworkArgs = @('--near-rpc','https://test.rpc.fastnear.com','--evm-rpc','https://rpc.sepolia.ethpandaops.io')
```

For any new purchase, the following variables intentionally have **no preapproved values**. Codex must display the actual observations and obtain the necessary approval before they are supplied; templates containing them are not ready to execute.

| Variable | Value to supply at the relevant checkpoint |
|---|---|
| `$PriceDigest` | Exact printed demonstration-price `approvalDigest`. |
| `$MaxFeeWei`, `$TipWei` | Separately reviewed fresh EIP-1559 fee selections, exact integer strings in wei/gas. |
| `$UsdcImplementation`, `$UsdcImplementationCodeHash` | Freshly observed, explicitly reviewed proxy implementation pin; do not approve upgrades implicitly. |
| `$QuoteHash` | Exact approved immutable quote hash. |
| `$PaymentUnsignedHash`, `$LinkUnsignedHash`, `$EthUnsignedHash` | The respective newly prepared transaction digests, approved separately. |
| `$PaymentSignedHash`, `$LinkSignedHash`, `$EthSignedHash` | Independently verified signed Ethereum hashes, each requiring its own broadcast approval. |
| `$PaymentAuthorizationHash` | Original durable USDC payment-authorization hash; keep it unchanged for all broadcasts. |
| `$InvestorCredentialFile`, `$TreasuryCredentialFile` | Existing external role-file selections, configured privately only during that role's separately approved signing. No actual protected location is published here. |

The purchase CLI uses its existing ignored `.local/transfers/purchase-journal.json`; it does not accept a new arbitrary `--state` path. Never print the raw journal or signed payloads. Use its sanitized `inspect` output and final public-field exporter. Reconciliation is credential-free and read-only on the blockchain, but saves verified outcomes to this durable local journal; it is not a promise of zero local writes.

## Timing and stop card

Rehearse offline **before** opening a live quote. For new quotes (`schemaVersion: 2`), the purchase-acceptance expiry is fixed at creation: the earliest of the original approved-price expiry and any shorter requested/nominal quote limit. The approved-price window remains at most **five minutes**, beginning at its original `validFrom`, not at quote presentation. Initial fee observations retain their own expiry but no longer shorten that acceptance window. Historical version-1 quotes retain their original fee-bound deadlines and hashes; Attempts 001 and 002 remain archived as `expired-unpaid`.

Quote approval, USDC preparation, digest review and first MPC submission must fit the fixed purchase-acceptance deadline. Preparation and signing obtain fresh execution observations, each subject to the unchanged **60-second** maximum age and underlying-block freshness. Recheck the relevant fresh deadline after preparation and immediately before first MPC submission. Refreshing execution observations cannot change approved prices, quantities, recipients, fee limits, reservation limits or transaction bytes, and cannot extend the quote. Broadcast retains its own fresh economic audit and separate approval. After timely initial payment authorization and submission, reconciliation and delivery obligations can continue beyond price expiry under the existing safeguards. No unknown hash is approved in advance.

Every transaction retains its original **15-minute** preparation limit. USDC's ceiling is **200000 gas**, LINK/native delivery ceilings **180000**; use fresh estimates with at least **20%** buffer, never the ceiling automatically. Preserve **30 gwei**, **0.0036 ETH/transaction**, positive Treasury operating reserve and **1000-bps** expected system-fee limits. NEAR storage-safe funding must cover full receipt-gas purchase requirements for one Investor and two Treasury calls, separately from expected burn and refunds.

- If a quoted/approved purchase expires without payment authorization or any execution, separately authorize the local guarded release: ` .\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','expire-unpaid','--quote-hash',$QuoteHash,'--approve',$QuoteHash) `. Do not run it merely because a clock expired; inspect the state first.
- A prepared unsigned leg cannot use that release command. Follow the existing guarded `retire-unsigned` route after its original expiry, with exact unsigned-hash and timestamp acknowledgment. Do not edit JSON, reset timestamps or reprice the original quote.
- If a signing/broadcast attempt exists or its outcome is uncertain, preserve it and reconcile read-only under an appropriate bounded authorization. No automatic retries, new signatures, replacement transactions or provider switching.
- For an expired **signed** leg, stop for separate purchase-bound recovery approval. The existing `audit-broadcast`/`broadcast` commands require the same quote/leg/role, exact signed hash, original payment-authorization hash, plus `--recovery --ack-prepared-at ORIGINAL_LEG_PREPARED_AT`. Broadcast creates its own fresh preserved **30-second** audit; a previous read-only audit is not reusable permission. No generic force flag exists.
- Finalized payment or partial delivery remains a settlement obligation despite expiry, restarts, fee increases or unavailable evidence services. Resume only a verified missing delivery. No automatic refund or compensation after partial delivery.

## Chapter 1 — An Investor Requests a Portfolio Purchase

**THE STORY:** An Investor asks to invest **10 test USDC** in a portfolio targeting 50% native ETH and 50% LINK. This prototype is an operator-driven CLI, not a finished investor-facing application; the investment amount is configurable and 10 USDC is not a production minimum.

**THE ACTION:** After approval of one bounded, credential-free readiness inspection, run the existing public collector; inspect the local journal separately to identify reservations or obligations:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','inspect-networks') + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','inspect')
```

**YOUR APPROVAL:** Authorize public inspection only. This does not reserve inventory, approve prices or permit any transfer. Reading this guide does not authorize or run those inspections.

**THE EVIDENCE:** Attempt 003's accepted payment was **10000000 USDC base units**. The [public manifest](../evidence/guided-purchase-20261111-003.json) preserves both role authorities and accepted purchase terms; Chapter 9 records its completed transfers. For a new journey report actual observation timestamps, funding, account keys/derivations, confirmed/pending nonces and any active reservation; stop on a failed guard. Earlier [LINK](../evidence/sepolia-link.json) and [native ETH](../evidence/native-eth-smoke.json) tests remain separate completed proofs.

**WHAT HAPPENS NEXT:** WealthPixels stages the reference prices that will define this purchase.

## Chapter 2 — WealthPixels Establishes Reference Prices

**THE STORY:** WealthPixels chooses publicly documented ETH/USD, LINK/USD and NEAR/USD reference prices for one demonstration purchase. These are explicitly approved demonstration assumptions, not automatically collected live market feeds; the pricing provider remains replaceable.

**THE ACTION:** After separate staging authorization, create the public input in `$PriceInput` through the editor. Set JSON field `purchaseId` to the value of `$PurchaseId`, include a descriptive `providerId`, `validFrom`, `expiresAt` no more than five minutes later, and `prices.ETH/LINK/NEAR`, each with `priceUsd` as a positive exact decimal string, `sourceUrl`, `sourceReference`, and the true `originalObservedAt`. Use canonical UTC timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`), with each `originalObservedAt <= validFrom`, and public HTTPS sources without credentials or secret-bearing URL parameters. Do not copy synthetic fixture prices, invent observations or refresh original source timestamps. Then generate the proposal:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','propose-prices','--input',$PriceInput,'--out',$PriceProposal)
```

Display the exact three decimal/rational rates, original timestamps and public references, purchase ID, original validity window and `approvalDigest`. Stop. Only after approval of that exact digest:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','approve-prices','--input',$PriceProposal,'--out',$ApprovedPrices,'--approve',$PriceDigest,'--reference','guided-price-human-approval')
```

**YOUR APPROVAL:** Staging/proposal generation and approval of the resulting price digest are distinct checkpoints. Price approval authorizes only those exact assumptions for the named purchase and original validity; it grants no purchase or signing authority.

**THE EVIDENCE:** Attempt 003 used approved Coinbase Exchange last-trade references of **2082.5 ETH/USD**, **10.445 LINK/USD** and **3.7154 NEAR/USD**. The [manifest](../evidence/guided-purchase-20261111-003.json) preserves the original source URLs, trade IDs, observation timestamps and exact rational values. Its price digest was `0x95b8b8b6d269d03ee7885d28f3c3b92430bf94b1a1eecd9666b1ae106ec7d52d`; approved set hash `0x9161ed26aab031ff67fdec60541456477232a275e8a6b3b0858fbfe9ae1130bd`. The original window was `2026-11-11T20:56:35.900Z`–`2026-11-11T21:01:35.900Z`, with approval at `20:57:09.826Z`. These are completed-order assumptions, now expired, not a reusable market offer. Historical sources require disclosure; expiration never triggers automatic substitution.

**WHAT HAPPENS NEXT:** WealthPixels calculates an immutable quote from the approved prices.

## Chapter 3 — WealthPixels Constructs the Portfolio Quote

**THE STORY:** The application calculates exact ETH and LINK quantities with integer arithmetic, checks Treasury inventory and screens the whole purchase's expected execution cost. Three Ethereum fees plus three NEAR signing costs, regardless of payer, must total **at most 1 nominal USDC for this 10-USDC investment**; maximum funding reserves are disclosed separately. This 10% economic eligibility safeguard is not a WealthPixels fee charged to the Investor.

**THE ACTION:** After separate live-quote/reservation authorization, use fresh reviewed fees and USDC implementation pins:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','quote','--prices',$ApprovedPrices,'--amount','10','--selected-max-fee-wei',$MaxFeeWei,'--selected-priority-wei',$TipWei,'--usdc-implementation',$UsdcImplementation,'--usdc-code-hash',$UsdcImplementationCodeHash) + $NetworkArgs)
```

Display the compact quote summary: purchase ID/hash and policy version, **10000000 USDC base units**, **5000/5000 bps**, exact ETH wei and LINK base units, total expected costs/percentage, separate maximum reserves, fixed purchase expiry and remaining validity at command output. Keep approved prices/provenance, all six cost components and protective caps in the preserved journal; inspect details when needed without flooding the approval request. Distinguish the independently expiring fee snapshot from purchase acceptance. Stop for exact quote-hash approval, then:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','approve-quote','--quote-hash',$QuoteHash,'--approve',$QuoteHash,'--reference','guided-investor-quote-approval')
```

**YOUR APPROVAL:** First permit creation of the quote and inventory reservation; then approve the exact generated quote hash as Investor. Approval cannot change allocation, prices or expiry and does not authorize signing or broadcasting.

**THE EVIDENCE:** Attempt 003's approved version-2 quote was `0x12f47956df63129eeb2ae6a8f388f2274e777ee5d62f0eb395f0cc21bfeda4a1`, created at `2026-11-11T20:57:49.975Z` and fixed to expire at `21:01:35.900Z`. It passed economic eligibility and bound **2400960384153661 wei** and **478697941598851124 LINK base units**. A successful quote reserves principal inventory and fee/operating reserves without transferring assets. Missing prices/costs, inadequate inventory/funding, fees above 10% or stale observations still stop a new unpaid purchase. Only one active purchase is allowed.

**WHAT HAPPENS NEXT:** The Investor reviews the exact USDC payment transaction while the original authorization window remains open.

## Chapter 4 — The Investor Authorizes Payment

**THE STORY:** The Investor agrees to pay exactly 10 test USDC directly to the Treasury. Preparing that payment creates an unsigned ERC-20 transfer for inspection; no assets move and no wallet key is needed yet.

**THE ACTION:** After explicit payment-preparation authorization:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','prepare','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor','--reference','guided-payment-preparation') + $NetworkArgs)
```

**YOUR APPROVAL:** Authorize this preparation only. Review the full Investor/Treasury addresses, official USDC contract, **10000000** units, chain ID, fresh nonce, estimated/buffered gas, EIP-1559 fees, maximum fee, unsigned digest and original preparation/payment deadline. Separate exact-digest signing authorization is still required.

**THE EVIDENCE:** Attempt 003's USDC unsigned digest was `0xca0777146e29faf9ecaa95d337164754fe73e0056a334a363c340ad4b171daaa`; the [manifest](../evidence/guided-purchase-20261111-003.json) preserves its actual transaction fields and payment authorization. During a new execution report its new digest and original preparation time. A prepared execution record must be retained; the clean unpaid-expiry command cannot discard it.

**WHAT HAPPENS NEXT:** The Investor's own NEAR authority may authorize this exact Ethereum digest.

## Chapter 5 — NEAR Chain Signatures Signs the Investor Payment

**THE STORY:** The Investor's NEAR account asks the MPC service to sign the approved Ethereum digest for its independently derived address. This is a NEAR authorization transaction; the resulting Ethereum signature alone does not send the USDC.

**THE ACTION:** After explicit authorization for exactly one Investor signing/submission attempt:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('--silent','run','purchase','--','sign','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor','--approve',$PaymentUnsignedHash,'--reference','guided-investor-mpc-approval','--credential',$InvestorCredentialFile) + $NetworkArgs)
```

After that attempt, use the separately covered bounded read-only reconciliation; do not repeat `sign`:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','reconcile-signing','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor') + $NetworkArgs)
```

**YOUR APPROVAL:** Bind approval to the exact purchase/quote and `$PaymentUnsignedHash`, selected Investor credential and **one** request from `wealthpixels-investor.testnet` to `v1.signer-prod.testnet`, domain **0**, path `wealthpixels/sepolia/v1`, **100 Tgas + 1 yoctoNEAR**. Fresh authority/funding/nonce/fee/simulation checks, the fixed purchase-acceptance deadline and the current execution-observation deadline must pass immediately before submission. No Treasury file and no Ethereum broadcast are authorized.

**THE EVIDENCE:** Attempt 003's Investor NEAR authorization reached FINAL success, and the [verification report](../evidence/guided-purchase-20261111-003-verification-001.json) validated the full trusted-key MPC signature and matching Ethereum payment. Chapter 9 lists its actual NEAR and Ethereum hashes. The original payment authorization is `0x0c84c34e8ed5f0fdc309dd3b63658fa706d38f960fb079b41e306bb0553dd12b`. For every attempt preserve hashes/attempt markers on timeout; an unavailable lookup is not proof of non-submission.

**WHAT HAPPENS NEXT:** The Investor separately decides whether to broadcast the verified signed USDC transaction.

## Chapter 6 — The Investor's USDC Reaches the Treasury

**THE STORY:** The exact signed payment is submitted to Sepolia only after its own broadcast approval. WealthPixels verifies canonical successful execution, the exact USDC Transfer event and balance movements, then waits for finality before releasing inventory.

**THE ACTION:** After exact signed-hash approval and original authorization acknowledgment, use normal broadcast only while the preparation is eligible; otherwise stop for the explicit recovery checkpoint on the timing card:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','broadcast','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor','--approve',$PaymentSignedHash,'--ack-authorization',$PaymentAuthorizationHash) + $NetworkArgs)
```

Then perform the authorized bounded read-only reconciliation:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','reconcile','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor') + $NetworkArgs)
```

**YOUR APPROVAL:** Authorize one broadcast of `$PaymentSignedHash` only, conditional on its own fresh audit and complete fee screen. Reconciliation cannot resend. If awaiting finality, pause and obtain/retain the proper bounded read-only authorization before another check; no polling loop or automatic retry.

**THE EVIDENCE:** Attempt 003's payment succeeded in Sepolia block **12114259**, with finalized **10-test-USDC (10000000-base-unit)** transfer at log index **91** and actual Ethereum fee **154359243 wei**. Its recorded Investor USDC balance changed from 20 to 10 USDC and Treasury balance from 0 to 10 USDC. The manifest retains canonical block/hash, balances and costs; Chapter 9 lists the transaction identities. `chainId:transactionHash:TransferLogIndex` is claimed atomically with paid state so one payment cannot fund two local purchases. A pending, submitted, observed or uncertain payment is not finalized payment. Finalized payment establishes a durable delivery obligation; uncertainty already protects the reservation. This is local association, not trustless or atomic enforcement.

**WHAT HAPPENS NEXT:** After finalized payment, Treasury delivers the quoted LINK from its own inventory.

## Chapter 7 — WealthPixels Delivers LINK

**THE STORY:** WealthPixels fulfils the first portfolio allocation using Treasury-owned LINK. The Treasury's separate NEAR authority must approve this new digest; the Investor's payment signature cannot authorize Treasury inventory movement.

**THE ACTION:** Run each line as a separate stage with the approvals below, never as an automatic sequence:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','prepare','--quote-hash',$QuoteHash,'--leg','link-delivery','--role','treasury','--reference','guided-link-preparation') + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('--silent','run','purchase','--','sign','--quote-hash',$QuoteHash,'--leg','link-delivery','--role','treasury','--approve',$LinkUnsignedHash,'--reference','guided-link-mpc-approval','--credential',$TreasuryCredentialFile) + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','reconcile-signing','--quote-hash',$QuoteHash,'--leg','link-delivery','--role','treasury') + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','broadcast','--quote-hash',$QuoteHash,'--leg','link-delivery','--role','treasury','--approve',$LinkSignedHash,'--ack-authorization',$PaymentAuthorizationHash) + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','reconcile','--quote-hash',$QuoteHash,'--leg','link-delivery','--role','treasury') + $NetworkArgs)
```

**YOUR APPROVAL:** Separately approve preparation, then exactly one Treasury MPC submission bound to `$LinkUnsignedHash`, then one broadcast bound to `$LinkSignedHash` and the original payment authorization. Signing uses only Treasury's file and the established MPC contract/domain/path/gas/deposit. Reconcile each outcome; expiry requires explicit recovery approval, not an automatic new signature.

**THE EVIDENCE:** Attempt 003 delivered **478697941598851124 LINK base units** in block **12114445** with the required two-confirmation receipt check. Investor LINK rose from **0.9** to **1.378697941598851124** at the receipt's historical block boundaries; actual Ethereum fee was **43755676 wei**. The [manifest](../evidence/guided-purchase-20261111-003.json) and Chapter 9 retain its NEAR/Ethereum identities, nonce, signature and exact deltas. At that intermediate checkpoint the purchase was partially delivered and the ETH obligation remained.

**WHAT HAPPENS NEXT:** Treasury obtains another fresh nonce and delivers the native ETH allocation.

## Chapter 8 — WealthPixels Delivers Native ETH

**THE STORY:** Treasury fulfils the second allocation by sending native ETH directly to the Investor. Its Ethereum value field contains the exact quoted wei, with empty calldata; no wrapping or portfolio token is involved.

**THE ACTION:** Only after confirmed LINK and fresh payment/canonicality/funding checks, follow these separate stages:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','prepare','--quote-hash',$QuoteHash,'--leg','eth-delivery','--role','treasury','--reference','guided-eth-preparation') + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('--silent','run','purchase','--','sign','--quote-hash',$QuoteHash,'--leg','eth-delivery','--role','treasury','--approve',$EthUnsignedHash,'--reference','guided-eth-mpc-approval','--credential',$TreasuryCredentialFile) + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','reconcile-signing','--quote-hash',$QuoteHash,'--leg','eth-delivery','--role','treasury') + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','broadcast','--quote-hash',$QuoteHash,'--leg','eth-delivery','--role','treasury','--approve',$EthSignedHash,'--ack-authorization',$PaymentAuthorizationHash) + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','reconcile','--quote-hash',$QuoteHash,'--leg','eth-delivery','--role','treasury') + $NetworkArgs)
```

**YOUR APPROVAL:** Separately approve preparation, exact `$EthUnsignedHash` for one Treasury MPC submission, and exact `$EthSignedHash` for one broadcast. Do not reuse LINK's nonce, digest or signature. Preserve the original acknowledgment and use recovery only after its own explicit authorization.

**THE EVIDENCE:** Attempt 003 delivered **2400960384153661 wei** in block **12114479** with the required two-confirmation receipt check and actual Ethereum fee **21357000 wei**. Investor ETH rose from **0.050000999801823597** to **0.052401960185977258** at that receipt's historical block boundaries; Treasury's debit equalled delivery value plus gas. The [manifest](../evidence/guided-purchase-20261111-003.json) preserves the signed parameters and exact accounting; Chapter 9 lists both transaction hashes. Pending/uncertain ETH would instead leave a partial delivery obligation, without repeating LINK.

**WHAT HAPPENS NEXT:** WealthPixels reconciles the whole purchase and the Investor's individual asset ownership.

## Chapter 9 — The Investor Owns the Portfolio

**THE STORY:** After both deliveries reconcile, the Investor holds the quoted native ETH and LINK directly in its NEAR-controlled Ethereum address. No pooled fund, portfolio claim token or third-party custody claim is created; settlement is sequential rather than atomic.

**THE ACTION:** Inspect the sanitized completed record; obtain a separately authorized bounded public balance snapshot if current balances are needed:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','inspect')
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','inspect-networks') + $NetworkArgs)
```

**YOUR APPROVAL:** Read-only review only; this authorizes no new signature, broadcast, refund or settlement change. `completed` is reported only after all actual receipt checks pass. An outstanding obligation must be displayed and preserved rather than narrated away.

**THE EVIDENCE:** Attempt 003 completed at **2026-11-11T21:46:08.630Z**, journal revision **47**, with no active purchase or outstanding delivery obligation. The approved quote and all three actual transfers are preserved in the [completed manifest](../evidence/guided-purchase-20261111-003.json):

| Purchase leg | Amount | NEAR transaction hash | Ethereum Sepolia transaction hash | Block |
|---|---|---|---|---|
| Investor USDC payment | 10 test USDC | `Ay4eMaZPUqThzG5gxDTn4ep41sMqcmC47sJeFxr3FMsa` | `0x39b905c753e842495f3ac7a7585f11130c37e290c9c816cb1ce323c9c4c1418f` | `12114259` |
| Treasury LINK delivery | 0.478697941598851124 LINK | `AjYP9rD5hkBdeupHBp99fPhXCq6GQbR5Sv5GZg37Ja86` | `0x5c5360ffa9e39f588c4c6ad6464f3507b006895978d44c05b281ee4f120ae6de` | `12114445` |
| Treasury native ETH delivery | 0.002400960384153661 ETH | `8YGwnW3XrKuybU1a3c26RDjbAPCFf6zG2bo784JnDbMp` | `0xac8536ac4f9d7616a0a7195166cee218d150471f0a980efe0fe7041c6f970d07` | `12114479` |

The three Ethereum fees were **154359243**, **43755676** and **21357000 wei**, respectively. The manifest also preserves all three actual NEAR signing costs. Total realized execution cost, converted using the original approved assumptions and rounded upward to USDC base units, was **0.009738 nominal USDC**; the report's whole-basis-point ceiling is **10 bps (0.1%)** of the investment, below the **1000-bps** eligibility limit. This is execution cost, not a WealthPixels purchase fee. Expected fees, maximum reserves and realized costs remain distinct. Saved balances are historical receipt observations, not a fresh current-balance snapshot. Earlier LINK/native tests remain separate evidence.

**WHAT HAPPENS NEXT:** The public evidence is exported so judges can verify the result without credentials.

## Chapter 10 — Hackathon Evidence and Verification

**THE STORY:** Verifiable Execution makes the relationship between approved terms and actual outcomes independently checkable, subject to the limits below. A completed purchase's public manifest records the quote, demonstration assumptions, payment and delivery authorizations, asset movements, resulting balances, costs and final settlement without exposing keys or executable signed payloads.

**THE ACTION:** After completion and separate local-export authorization, write an unused public manifest, then run separately authorized credential-free public verification:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase:export-evidence','--','--purchase-id',$PurchaseId,'--out',$PublicManifest)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','verify:purchase','--','--manifest',$PublicManifest,'--expected-quote-hash',$QuoteHash,'--near-rpc','https://archival-rpc.testnet.fastnear.com','--evm-rpc','https://rpc.sepolia.ethpandaops.io','--beacon-rpc','https://ethereum-sepolia-beacon-api.publicnode.com','--report',$VerificationReport)
```

The export and first verification for Attempt 003 are already complete. Do not rerun its export or overwrite `evidence/guided-purchase-20261111-003-verification-001.json`. For a separately authorized new public verification, this command reads the actual manifest and pins its approved quote; it creates no report file:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('--silent','run','verify:purchase','--','--manifest','evidence/guided-purchase-20261111-003.json','--expected-quote-hash','0x12f47956df63129eeb2ae6a8f388f2274e777ee5d62f0eb395f0cc21bfeda4a1','--near-rpc','https://archival-rpc.testnet.fastnear.com','--evm-rpc','https://rpc.sepolia.ethpandaops.io','--beacon-rpc','https://ethereum-sepolia-beacon-api.publicnode.com')
```

If saving another report is separately authorized, first verify an unused path and add `--report` with that path. Use this same manifest and quote hash in the [judge story's public verification command](WealthPixels_Hackathon_Demo_Story.md#chapter-10--hackathon-evidence-and-verification). No generic `evidence/portfolio-purchase.json` is assumed to exist.

**YOUR APPROVAL:** Approve extraction of public fields and bounded public reads, not repository publication or any asset operation. Export reads only the completed local record; successful export alone is not independent verification.

**THE EVIDENCE:** The [saved public verification report](../evidence/guided-purchase-20261111-003-verification-001.json) returned **verified / complete / VERIFIED** at **2026-11-11T21:51:31.505Z**, matching manifest hash `0xc75b2734a25a4dc8d5c5f851ab6633389d244ed2a668294d03b27405f5d5c320`. All seven check groups passed: immutable quote/approvals/six-cost structure and manifest integrity; network identities; the USDC, LINK and native ETH authorization/receipt/movement/nonce/cost groups; historical finalized payment before LINK delivery; and realized costs/complete settlement. The exact expected quote hash was supplied. No required check was unresolved in this run.

Exit **0** means all implemented checks verified; **2** means pending/incomplete/unavailable history; **1** means contradictory/invalid evidence or an invalid-option, path or input/output failure. Preserve any later result honestly; neither a pending placeholder nor fixture completion proves live delivery.

### Technical verification limitations

Historical Ethereum execution balances/state and Beacon finality-checkpoint/block history require archive-capable services. **Attempt 003's historical payment-finality check passed**: the consensus state anchored at LINK release showed finality through execution block **12114359**, covering payment block **12114259** before LINK block **12114445**. The [earlier archive investigation](Task03FA_Archive_RPC_Investigation.json) records availability limitations for earlier evidence; this successful retrieval does not guarantee future availability. Never replace missing history in a later independent run with today's finalized head, fixtures or a cached report.

RPC facts, local operator approvals and demonstration-price assumptions are different trust categories. Public RPC responses remain trust inputs. The report verifies the parent-header root but explicitly records `consensusProofVerified: false`; it does not verify BLS consensus signatures or BeaconState/body Merkle proofs and is not a light client. Report incomplete or failed checks accurately even when the local purchase record is completed; export success cannot establish independent verification of missing evidence.

**WHAT HAPPENS NEXT:** Present the verified result—or its explicit limitations—to the judges without further asset operations.

## Offline rehearsal and completed stopping point

These existing commands are safe rehearsal/evaluation entry points; they do not execute the chapter commands above:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase:dry-run')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

The dry-run uses isolated temporary state and labelled synthetic prices, approvals, signatures, balances and network ports. It demonstrates the three intended legs and `settling` → `partially-delivered` → `completed` flow; it does not establish a guaranteed human/public-RPC operating cadence within either validity window. The offline suite covers original deadlines, exact approvals, fee/inventory gates, finality, uncertainty, restart and recovery behavior. No source change is required for this narrative; the chapter-by-chapter guide is documentation for Codex, not a new executable wizard.

**Historical offline rehearsal result, November 10:** the then-current dry-run passed through `settling` → `partially-delivered` → `completed`, with three simulated NEAR submissions, three simulated Ethereum submissions and no outstanding fixture obligations. That suite passed **635/635** and TypeScript validation passed. No live operations occurred in that rehearsal. It remains simulation evidence, separate from the November 11 completed purchase and public verification recorded above.

**Current offline packaging validation, November 11:** **667/667 tests passed**, with zero failures, skips or cancellations; TypeScript validation passed. The version-2 fixture dry-run completed with three simulated NEAR submissions, three simulated Ethereum submissions and no outstanding fixture obligations. These checks made no live purchase transactions.

**Completed stopping point:** Attempt 003's payment, both deliveries, evidence export and public verification are complete. Reviewing these artifacts requires no new asset operation. Any new purchase starts with a separately authorized unused ID, Chapter 1 readiness checks and fresh price/quote approvals; “Begin” alone never approves a transaction or price.

**Diversification Without Pooling.**

**Ownership Without Blockchain Boundaries.**

**Investing Without Barriers.**
