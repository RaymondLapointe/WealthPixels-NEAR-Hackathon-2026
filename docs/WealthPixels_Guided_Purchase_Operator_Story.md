# WealthPixels Guided Purchase Journey — Operator Story

**Diversification Without Pooling.**

**Ownership Without Blockchain Boundaries.**

**Investing Without Barriers.**

November 10, 2026. Implementation checkpoint: `acdc7702ac443395157aec478b34fb18755878c3`. This is the script for a **future** 10-test-USDC, 50/50 native ETH–LINK purchase; no live purchase, price approval, quote, reservation or purchase transaction has been created by this documentation task. Read alongside the [judge story](WealthPixels_Hackathon_Demo_Story.md), [existing operator runbook](Task03FA_Live_Operator_Runbook.md) and [readiness corrections](Portfolio_Purchase_Readiness_Corrections_20261110.md).

WealthPixels is designed to make diversified portfolio purchases as convenient as buying units in a fund: an Investor selects a portfolio model, makes a single investment and receives the eligible individual underlying assets directly. Diversification is the objective; pooling investors' capital is one mechanism for making it accessible. WealthPixels' alternative is principal inventory-based execution with direct individual-asset ownership. Explicit transaction authorization, responsible settlement controls and cross-blockchain ownership and execution as the architecture evolves are enduring product principles.

The broader vision includes portfolios of many eligible onchain assets across blockchain ecosystems. This hackathon prototype uses NEAR Testnet Chain Signatures to authorize Ethereum Sepolia transactions; both native ETH and LINK are delivered on Sepolia. The 10-test-USDC amount, 50/50 allocation, test networks, manually approved demonstration prices, single operator with two disposable identities and CLI workflow are prototype choices, not definitions of the long-term product.

**Verifiable Execution.** This supporting product principle is intended to remain fundamental beyond the hackathon. WealthPixels is designed to create independently checkable evidence connecting approved portfolio purchase terms, the Investor's payment, relevant transaction authorizations, delivery of the individual underlying assets, and resulting balances, costs and settlement outcomes. The aim is to establish what was authorized, what was delivered and whether execution matched the approved terms. Chapter 10 describes the implemented checks and their trust and data-availability limits.

## How to use this story with Codex

After reviewing both documents, say **“Begin the WealthPixels Guided Purchase Journey.”** Codex should open Chapter 1, give the five short sections below and stop at its next required approval. This instruction starts narration; it does not approve unknown prices, a quote, credential access, MPC signing or broadcasting. A command succeeding never authorizes the next checkpoint. Stay within the current chapter when its result needs another approval.

Codex should show each fully populated proposed command through the normal VS Code command-permission process. Clicking **Allow** permits that tool command; it does not replace explicit price/quote/digest/signed-hash authorization. Show the public approval-critical fields first, obtain approval of the exact identifier, then run only that authorized operation. Never combine live stages into a script or approve a hash automatically from command output. Report `planned`, `simulated`, `prepared`, `submitted`, `uncertain`, `confirmed` and `completed` accurately; do not convert an unknown outcome into success or failure.

Both disposable testnet roles may be operated by one human on one laptop. They have different NEAR signing credentials and Ethereum addresses; this demonstrates separate account authorization, not independent production custody. Each signing process loads only the selected role's file. Never paste keys, credential contents or protected file paths into the story or public evidence.

| Role | NEAR Testnet signing authority | Ethereum Sepolia address |
|---|---|---|
| Investor | `wealthpixels-investor.testnet` | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| WealthPixels Treasury | `wealthpixels-treasury.testnet` | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |

Sepolia chain ID is **11155111**. USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 decimals); LINK: `0x779877A7B0D9E8603169DdbD7836e478b4624789` (18 decimals). Refresh deployed code, USDC implementation/paused/blacklist status, both authorities, balances and nonces before a real attempt. A direct USDC `transfer` needs no spender allowance.

## Command card — templates, not current approvals

Use VS Code's PowerShell terminal at the repository root. Each later code block is a separate operator action. The argument arrays preserve npm's **`--` separator**. Platform-independent equivalents use `npm run purchase -- ...` with the same flags.

These public names are **proposed, not allocated or verified unused**. Before a separately authorized live stage, check the journal, purchase-ID history and output paths without overwriting anything. If occupied, stop and agree new names.

```powershell
$PurchaseId = 'guided-purchase-20261110-001'
$PriceInput = '.local/transfers/guided-purchase-20261110-001-prices-input.json'
$PriceProposal = '.local/transfers/guided-purchase-20261110-001-prices-proposal.json'
$ApprovedPrices = '.local/transfers/guided-purchase-20261110-001-prices-approved.json'
$PublicManifest = 'evidence/guided-purchase-20261110-001.json'
$VerificationReport = 'evidence/guided-purchase-20261110-001-verification-001.json'
$NetworkArgs = @('--near-rpc','https://test.rpc.fastnear.com','--evm-rpc','https://rpc.sepolia.ethpandaops.io')
```

The following variables intentionally have **no current values**. Codex must display the actual observations and obtain the necessary approval before they are supplied; templates containing them are not ready to execute.

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

Rehearse offline **before** opening a live quote. Price approval lasts no more than five minutes. Initial quote approval, USDC preparation, digest review and first MPC submission must fit the earliest **original** price/fee deadline; fee observations are at most **60 seconds** old, not a new minute per command. Read the actual printed expiry; collection time consumes that window. Use a present operator and pre-staged command forms. No advance authorization of unknown hashes and no deadline extension is permitted to make the story fit. The entire settlement need not finish in that minute after timely initial authorization/submission.

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

**YOUR APPROVAL:** Authorize public inspection only. This does not reserve inventory, approve prices or permit any transfer. The current documentation authorization does not run these live inspections.

**THE EVIDENCE:** Planned payment is **10000000 USDC base units**. During the live journey report actual observation timestamps, funding, account keys/derivations, confirmed/pending nonces and any active reservation; stop on a failed guard. Earlier [LINK](../evidence/sepolia-link.json) and [native ETH](../evidence/native-eth-smoke.json) evidence are separate completed proofs, not this purchase's payment or delivery.

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

**THE EVIDENCE:** **All live rate values, source timestamps, price digest and approval are pending.** After execution record the actual proposal, `setHash`, approval reference and expiry. Historical sources are acceptable only when disclosed as demonstration assumptions; expiration never triggers automatic substitution.

**WHAT HAPPENS NEXT:** WealthPixels calculates an immutable quote from the approved prices.

## Chapter 3 — WealthPixels Constructs the Portfolio Quote

**THE STORY:** The application calculates exact ETH and LINK quantities with integer arithmetic, checks Treasury inventory and screens the whole purchase's expected execution cost. Three Ethereum fees plus three NEAR signing costs, regardless of payer, must total **at most 1 nominal USDC for this 10-USDC investment**; maximum funding reserves are disclosed separately.

**THE ACTION:** After separate live-quote/reservation authorization, use fresh reviewed fees and USDC implementation pins:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','quote','--prices',$ApprovedPrices,'--amount','10','--selected-max-fee-wei',$MaxFeeWei,'--selected-priority-wei',$TipWei,'--usdc-implementation',$UsdcImplementation,'--usdc-code-hash',$UsdcImplementationCodeHash) + $NetworkArgs)
```

Display the full quote: purchase ID/hash, **10000000 USDC base units**, **5000/5000 bps**, exact ETH wei and LINK base units, prices/provenance, six expected cost components, total/percentage, separate reserves/caps and effective expiry. Stop for exact quote-hash approval, then:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase','--','approve-quote','--quote-hash',$QuoteHash,'--approve',$QuoteHash,'--reference','guided-investor-quote-approval')
```

**YOUR APPROVAL:** First permit creation of the quote and inventory reservation; then approve the exact generated quote hash as Investor. Approval cannot change allocation, prices or expiry and does not authorize signing or broadcasting.

**THE EVIDENCE:** Quote hash, live quantities and economic pass are **pending**. A successful quote reserves principal LINK, native delivery value and fee/operating reserves in the durable journal; it transfers nothing onchain. Missing prices/costs, inadequate inventory/funding, fees above 10% or stale observations stop the unpaid purchase. Only one active purchase is allowed.

**WHAT HAPPENS NEXT:** The Investor reviews the exact USDC payment transaction while the original authorization window remains open.

## Chapter 4 — The Investor Authorizes Payment

**THE STORY:** The Investor agrees to pay exactly 10 test USDC directly to the Treasury. Preparing that payment creates an unsigned ERC-20 transfer for inspection; no assets move and no wallet key is needed yet.

**THE ACTION:** After explicit payment-preparation authorization:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','prepare','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor','--reference','guided-payment-preparation') + $NetworkArgs)
```

**YOUR APPROVAL:** Authorize this preparation only. Review the full Investor/Treasury addresses, official USDC contract, **10000000** units, chain ID, fresh nonce, estimated/buffered gas, EIP-1559 fees, maximum fee, unsigned digest and original preparation/payment deadline. Separate exact-digest signing authorization is still required.

**THE EVIDENCE:** During execution report `$PaymentUnsignedHash`, actual fields and saved preparation time; they are **not yet available**. A prepared execution record must be retained; the clean unpaid-expiry command cannot discard it.

**WHAT HAPPENS NEXT:** The Investor's own NEAR authority may authorize this exact Ethereum digest.

## Chapter 5 — NEAR Chain Signatures Signs the Investor Payment

**THE STORY:** The Investor's NEAR account asks the MPC service to sign the approved Ethereum digest for its independently derived address. This is a NEAR authorization transaction; the resulting Ethereum signature alone does not send the USDC.

**THE ACTION:** After explicit authorization for exactly one Investor signing/submission attempt:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','sign','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor','--approve',$PaymentUnsignedHash,'--reference','guided-investor-mpc-approval','--credential',$InvestorCredentialFile) + $NetworkArgs)
```

After that attempt, use the separately covered bounded read-only reconciliation; do not repeat `sign`:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','reconcile-signing','--quote-hash',$QuoteHash,'--leg','usdc-payment','--role','investor') + $NetworkArgs)
```

**YOUR APPROVAL:** Bind approval to the exact purchase/quote and `$PaymentUnsignedHash`, selected Investor credential and **one** request from `wealthpixels-investor.testnet` to `v1.signer-prod.testnet`, domain **0**, path `wealthpixels/sepolia/v1`, **100 Tgas + 1 yoctoNEAR**. Fresh authority/funding/nonce/fee/simulation checks and the final original deadline check must pass before submission. No Treasury file and no Ethereum broadcast are authorized.

**THE EVIDENCE:** Report the actual durable NEAR hash/stage, FINAL outcome, full trusted-key signature validation, recovered Investor address, `$PaymentSignedHash` and `$PaymentAuthorizationHash`. All are **pending** for this purchase. Preserve hashes/attempt markers on timeout; an unavailable lookup is not proof of non-submission.

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

**THE EVIDENCE:** Report actual receipt block/hash/status, finality, Transfer log index, **10000000** USDC movement, canonical pre/post balances and actual gas fee. `chainId:transactionHash:TransferLogIndex` is claimed atomically with paid state so one payment cannot fund two local purchases. A pending, submitted, observed or uncertain payment is not finalized payment. Finalized payment establishes a durable delivery obligation; uncertainty already protects the reservation. This is local association, not trustless or atomic enforcement.

**WHAT HAPPENS NEXT:** After finalized payment, Treasury delivers the quoted LINK from its own inventory.

## Chapter 7 — WealthPixels Delivers LINK

**THE STORY:** WealthPixels fulfils the first portfolio allocation using Treasury-owned LINK. The Treasury's separate NEAR authority must approve this new digest; the Investor's payment signature cannot authorize Treasury inventory movement.

**THE ACTION:** Run each line as a separate stage with the approvals below, never as an automatic sequence:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','prepare','--quote-hash',$QuoteHash,'--leg','link-delivery','--role','treasury','--reference','guided-link-preparation') + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','sign','--quote-hash',$QuoteHash,'--leg','link-delivery','--role','treasury','--approve',$LinkUnsignedHash,'--reference','guided-link-mpc-approval','--credential',$TreasuryCredentialFile) + $NetworkArgs)
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

**THE EVIDENCE:** Show the exact quoted LINK quantity, fresh Treasury nonce, gas/fees, NEAR hash, recovered Treasury signer, signed EVM hash, canonical successful receipt, at least two confirmations, Transfer event and exact token deltas. These purchase results are **pending**. Once LINK confirms, the purchase is partially delivered and the ETH obligation remains.

**WHAT HAPPENS NEXT:** Treasury obtains another fresh nonce and delivers the native ETH allocation.

## Chapter 8 — WealthPixels Delivers Native ETH

**THE STORY:** Treasury fulfils the second allocation by sending native ETH directly to the Investor. Its Ethereum value field contains the exact quoted wei, with empty calldata; no wrapping or portfolio token is involved.

**THE ACTION:** Only after confirmed LINK and fresh payment/canonicality/funding checks, follow these separate stages:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','prepare','--quote-hash',$QuoteHash,'--leg','eth-delivery','--role','treasury','--reference','guided-eth-preparation') + $NetworkArgs)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments (@('run','purchase','--','sign','--quote-hash',$QuoteHash,'--leg','eth-delivery','--role','treasury','--approve',$EthUnsignedHash,'--reference','guided-eth-mpc-approval','--credential',$TreasuryCredentialFile) + $NetworkArgs)
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

**THE EVIDENCE:** Report actual quoted wei, fresh nonce, signed gas parameters, NEAR hash/signature verification, EVM hash, successful canonical receipt with at least two confirmations, gas consumed and fee. Verify Investor's ETH increase equals the delivery value over its previously held ETH, and Treasury's debit equals value plus gas while preserving its reserve. Pending/uncertain ETH leaves the purchase partially delivered, with no duplicate LINK delivery.

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

**THE EVIDENCE:** Present one purchase summary with its approved quote/prices, 10-USDC payment, exact quoted and received LINK/ETH quantities, all **three NEAR hashes**, all **three Ethereum hashes**, canonical balance changes, timestamped current balances, three actual EVM fees, three actual NEAR costs, total nominal USDC-equivalent cost and realized fee percentage. Separate expected fees, maximum reserves and realized costs; explain any overrun without erasing settlement. **No completed live portfolio or its hashes/balances exists yet.** Earlier LINK/native tests remain separate evidence.

**WHAT HAPPENS NEXT:** The public evidence is exported so judges can verify the result without credentials.

## Chapter 10 — Hackathon Evidence and Verification

**THE STORY:** Verifiable Execution makes the relationship between approved terms and actual outcomes independently checkable, subject to the limits below. A completed purchase's public manifest records the quote, demonstration assumptions, payment and delivery authorizations, asset movements, resulting balances, costs and final settlement without exposing keys or executable signed payloads.

**THE ACTION:** After completion and separate local-export authorization, write an unused public manifest, then run separately authorized credential-free public verification:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase:export-evidence','--','--purchase-id',$PurchaseId,'--out',$PublicManifest)
```

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','verify:purchase','--','--manifest',$PublicManifest,'--expected-quote-hash',$QuoteHash,'--near-rpc','https://archival-rpc.testnet.near.org','--evm-rpc','https://rpc.sepolia.ethpandaops.io','--beacon-rpc','https://ethereum-sepolia-beacon-api.publicnode.com','--report',$VerificationReport)
```

After export, give the judges the actual `$PublicManifest` path and the approved `$QuoteHash` preserved at its approval checkpoint. The shared proposed path is `evidence/guided-purchase-20261110-001.json`; if an alternative unused name was agreed, use that actual path in the [judge story's verification template](WealthPixels_Hackathon_Demo_Story.md#chapter-10--hackathon-evidence-and-verification). No separate `evidence/portfolio-purchase.json` is assumed to exist.

**YOUR APPROVAL:** Approve extraction of public fields and bounded public reads, not repository publication or any asset operation. Export reads only the completed local record; successful export alone is not independent verification.

**THE EVIDENCE:** Report the actual manifest hash, verification status/report and every unresolved check. Exit **0** means all implemented checks verified; **2** means pending/incomplete/unavailable history; **1** means contradictory/invalid evidence or an invalid-option, path or input/output failure. No live portfolio manifest is available yet; the existing pending file and fixture dry-run cannot establish a completed purchase.

### Technical verification limitations

Historical Ethereum execution balances/state and Beacon finality-checkpoint/block history require archive-capable services. Historical Beacon availability remains **unresolved**, as recorded in the [archive investigation](Task03FA_Archive_RPC_Investigation.json). The purchase verifier needs the historical consensus state anchored at LINK release to check that payment was already finalized. Verify promptly, but never replace missing history with today's finalized head, fixtures or unproven cached responses; later independent retrieval is not guaranteed.

RPC facts, local operator approvals and demonstration-price assumptions are different trust categories. Public RPC responses remain trust inputs; the verifier is not a light client or a BLS/SSZ state-proof verifier. Report incomplete or failed checks accurately even when the local purchase record is completed; export success cannot establish independent verification of missing evidence.

**WHAT HAPPENS NEXT:** Present the verified result—or its explicit limitations—to the judges without further asset operations.

## Offline rehearsal and present stopping point

These existing commands are safe rehearsal/evaluation entry points; they do not execute the chapter commands above:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','purchase:dry-run')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

The dry-run uses isolated temporary state and labelled synthetic prices, approvals, signatures, balances and network ports. It demonstrates the three intended legs and `settling` → `partially-delivered` → `completed` flow; it does not measure a guaranteed 60-second human/public-RPC operating cadence. The offline suite covers original deadlines, exact approvals, fee/inventory gates, finality, uncertainty, restart and recovery behavior. No source change is required for this narrative; the chapter-by-chapter guide is documentation for Codex, not a new executable wizard.

**Observed offline rehearsal result, November 10:** the existing dry-run passed through `settling` → `partially-delivered` → `completed`, with three simulated NEAR submissions, three simulated Ethereum submissions and no outstanding fixture obligations. The full existing suite passed **635/635** and TypeScript validation passed. No live price staging, quote/reservation, credential access, NEAR submission or Ethereum broadcast was performed. Only these two Guided Journey Markdown documents change; original runtime and historical evidence remain preserved. This rehearsal does not establish live execution or measured human/RPC timing.

**Next approval checkpoint:** review both stories, then authorize Chapter 1's bounded readiness inspection and, separately, Chapter 2's public reference-price staging/proposal generation. Review the actual proposal digest before approving prices. “Begin” by itself is not a transaction or price approval.

**Diversification Without Pooling.**

**Ownership Without Blockchain Boundaries.**

**Investing Without Barriers.**
