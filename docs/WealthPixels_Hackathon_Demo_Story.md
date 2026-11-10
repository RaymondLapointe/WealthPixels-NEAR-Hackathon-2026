# WealthPixels Guided Purchase Journey

**Diversification Without Pooling.**

**Ownership Without Blockchain Boundaries.**

**Investing Without Barriers.**

Investment funds have long made diversification accessible by pooling investors' capital and investing across portfolios of underlying assets.

But what if investors could enjoy the convenience of purchasing a diversified portfolio without having to own shares in a pooled fund?

WealthPixels is building a portfolio purchasing protocol designed to make diversified investing as straightforward as buying units in a fund, while fundamentally changing what the investor owns.

Rather than receiving a fund share representing a claim on pooled assets, the Investor receives the individual underlying assets directly into their own blockchain-controlled accounts.

The vision is a single, convenient investment experience: investors select a portfolio model, make one investment and receive its assets wherever they are available and eligible for onchain delivery, without having to execute each individual asset purchase themselves. Diversification is the investment objective; pooling is one way to make it accessible.

This vision could encompass portfolios of 10, 20, 30, 50 or more assets, including cryptocurrencies, tokenized securities and other eligible real-world assets, potentially spanning multiple blockchain ecosystems. This broader asset and network coverage is a product vision, not functionality already supported by the hackathon prototype.

WealthPixels' enduring principles include principal inventory-based portfolio execution, direct ownership without investor pooling, explicit transaction authorization and responsible settlement controls. Cross-blockchain ownership and execution capabilities are intended to expand as the architecture evolves.

**Verifiable Execution.** As a supporting product principle, independently checkable evidence should connect approved terms to payment, authorizations, asset delivery and settlement. Chapter 10 explains this enduring capability and the limits of the current checks.

Public hackathon story, November 10, 2026. The current prototype uses **NEAR Testnet Chain Signatures to authorize Ethereum Sepolia transactions**. Both native ETH and LINK are delivered on **Ethereum Sepolia**; the prototype does not demonstrate portfolio delivery across multiple destination blockchains. Its next planned purchase targets **10 test USDC**, allocated **50% native ETH / 50% LINK**, delivered from Treasury principal inventory through three sequential Ethereum transactions. The amount is configurable; 10 USDC is a demonstration target, with no production minimum implied.

The test networks, manually approved demonstration prices and current CLI workflow are prototype choices. The hackathon demonstrator may control both disposable testnet roles on one computer; separate NEAR accounts and authorizations demonstrate protocol behavior without establishing independent production custody.

**Current status:** no live portfolio purchase has executed. The following chapters describe the planned journey through implemented software; prices, portfolio quantities, quote approval and purchase transaction hashes remain pending. Offline tests and the dry-run simulate that journey. Existing live LINK transfers, the standalone native ETH smoke test and Experiments A/B are separate evidence of specific capabilities, not a completed portfolio purchase.

CLI action names below use `npm run purchase -- ACTION`; they describe future authorized operator steps, not commands to execute as part of reading this story. The matching [operator story](WealthPixels_Guided_Purchase_Operator_Story.md) gives PowerShell command forms and approval gates; populate unknown values from actual reviewed outputs at each checkpoint.

To demonstrate how this approach works, we're starting with a deliberately simple two-asset portfolio, consisting of ETH and LINK. The objective is to prove the underlying purchase, delivery, ownership and verification mechanisms that can eventually support more complex diversified portfolios.

## Chapter 1 — An Investor Requests a Portfolio Purchase

**THE STORY:**

An Investor selects a portfolio model and requests its underlying assets directly. In this planned prototype example, they request a 10-test-USDC purchase with equal allocation to native ETH and LINK, using an Ethereum Sepolia address controlled through their NEAR account. This is the first purchase model used to demonstrate the protocol; the intended many-asset portfolio experience remains the broader product vision.

**THE ACTION:**

Record the requested amount, allocation and public Investor destination. The [offline purchase dry-run](../scripts/purchase-dry-run.ts) rehearses this request without live transaction execution. CLI actions: `inspect-networks` and `inspect`; see the [operator story's PowerShell commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

The request expresses intent. Live prices, the eventual quote, payment signing and every transaction broadcast each have their own approval checkpoint.

**THE EVIDENCE:**

[Allocation terms](../src/purchase/terms.ts) bind exact six-decimal USDC input, weights, public destinations and integer asset quantities. The [pending purchase manifest](../evidence/portfolio-purchase.pending.json) records that no live purchase exists yet.

**WHAT HAPPENS NEXT:**

WealthPixels establishes explicitly approved reference prices for this purchase.

## Chapter 2 — WealthPixels Establishes Reference Prices

**THE STORY:**

The investor needs to know how their allocation becomes quantities of two different assets. For the hackathon, WealthPixels uses explicitly approved demonstration prices with visible sources and observation times; these are disclosed assumptions rather than production real-time market prices.

**THE ACTION:**

Stage purchase-specific ETH/USD, LINK/USD and NEAR/USD references, preserve their provenance and calculate the exact proposal digest for review. ETH and LINK rates size delivery; ETH and NEAR rates also convert execution costs into USDC equivalents. CLI actions: `propose-prices` and `approve-prices`; see the [operator commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

A separate approval must match the exact price proposal digest and purchase ID within its validity, which cannot exceed five minutes. No numeric price set has been selected or approved for this planned live purchase.

**THE EVIDENCE:**

The [price provider interface and demonstration-price checks](../src/purchase/prices.ts) preserve original observations and reject unapproved or expired inputs. Future production data providers can use this interface; the hackathon has no automatic live-price fallback.

**WHAT HAPPENS NEXT:**

Approved prices and fresh public network observations can support a quote, subject to a separately authorized live preparation step.

## Chapter 3 — WealthPixels Constructs the Portfolio Quote

**THE STORY:**

The investor should see the exact bargain before committing funds. The planned 10-USDC quote assigns five nominal quote-dollars to each asset and freezes the resulting quantities, reference prices, destinations, costs and expiry together.

**THE ACTION:**

Use fresh cost and inventory observations to construct the immutable quote and reserve the required Treasury inventory and maximum funding. Exact native ETH and LINK quantities remain undefined until approved prices exist; integer rounding is retained in the quote. CLI actions: `quote` and `approve-quote`; see the [operator commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Review the exact quote hash, quantities, assumptions, fees and expiry before approving it. Total expected costs for all three Ethereum transactions and all three NEAR signing operations, regardless of payer, must be at most 10% of the investment: at most one nominal USDC for this target.

**THE EVIDENCE:**

The [quote engine](../src/purchase/quote.ts) binds the terms and safeguards. The [November 10 corrections](Portfolio_Purchase_Readiness_Corrections_20261110.md) implement the USDC-specific gas ceiling, complete NEAR upfront funding reserves and guarded unpaid expiry; expected execution costs and maximum reserves remain distinct.

**WHAT HAPPENS NEXT:**

The Investor reviews the payment intent while the original quote remains eligible. Price validity and fee observations bound that window; a new command does not restart it.

## Chapter 4 — The Investor Authorizes Payment

**THE STORY:**

The investor decides whether the quoted portfolio and its costs meet their expectations. Their planned payment is a direct transfer of 10 test USDC to the Treasury, with no spender allowance transaction required.

**THE ACTION:**

After exact quote approval, prepare the Investor payment and inspect its amount, Treasury destination, token, chain and unsigned transaction digest. Fresh checks must confirm Investor funding, Treasury inventory and complete execution funding before payment authorization. CLI action: `prepare` with `--leg usdc-payment --role investor`; see the [operator command and approval gate](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Quote approval and exact-digest signing approval are separate decisions. A payment eligibility record alone has `executionAuthorized: false`; it cannot sign or send a transaction.

**THE EVIDENCE:**

The [purchase coordinator](../src/purchase/coordinator.ts) and [operator runbook](Task03FA_Live_Operator_Runbook.md) enforce these checkpoints. No Investor USDC payment digest or purchase signing approval exists for this planned run.

**WHAT HAPPENS NEXT:**

Only after explicit approval of that exact digest may the Investor's own NEAR authority request its MPC signature.

## Chapter 5 — NEAR Chain Signatures Signs the Investor Payment

**THE STORY:**

The Investor's NEAR Testnet account can authorize an Ethereum Sepolia transaction through NEAR Chain Signatures. This demonstrates authorization across the two networks while retaining an identifiable Investor authority for the payment; asset delivery in this prototype remains on Sepolia.

**THE ACTION:**

Submit the separately approved digest through the Investor's NEAR role, then reconcile the exact NEAR outcome and verify the returned signature against the full trusted derived Investor public key. The quote approval, payment preparation, digest approval and first MPC submission must fit the earliest original price/fee expiry; fee observations can be at most 60 seconds old. CLI actions: `sign` and `reconcile-signing` with `--leg usdc-payment --role investor`; see the [operator commands and separate approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Signing approves the unsigned digest. Broadcasting requires another approval bound to the resulting exact signed Ethereum hash and the original payment authorization; obtaining a signature does not authorize broadcasting.

**THE EVIDENCE:**

[Experiment B](../evidence/experiment-b-near-mpc-diagnostic.json) records a successful direct Investor MPC signature for a diagnostic message. It establishes that separate capability, not an Ethereum payment; no purchase MPC outcome is available yet.

**WHAT HAPPENS NEXT:**

After signed-hash approval and fresh eligibility checks, submit the payment once and reconcile its public receipt. Uncertain attempts retain their identity and require reconciliation.

## Chapter 6 — The Investor's USDC Reaches the Treasury

**THE STORY:**

The planned payment becomes an accepted purchase only after the exact USDC transfer is canonical and finalized. At that point WealthPixels owes the quoted asset deliveries, even if prices expire or execution fees rise later.

**THE ACTION:**

Verify the successful USDC transfer, exact amount and destinations against public Ethereum records. Claim its chain ID, transaction hash and transfer-log index together with the durable paid state before releasing Treasury inventory. CLI actions: `broadcast` and `reconcile` with `--leg usdc-payment --role investor`; see the [operator commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

The payment broadcast requires its own exact signed-hash approval. Finality checks and reconciliation are read-only observations; they do not grant authority to sign the Treasury's deliveries.

**THE EVIDENCE:**

The [settlement implementation](../src/purchase/settlement.ts) and [payment claims](../src/purchase/claims.ts) enforce the local sequence and duplicate-payment guard. No live portfolio USDC receipt or finalized purchase claim has been published.

**WHAT HAPPENS NEXT:**

Treasury prepares the quoted LINK delivery. The whole purchase need not finish in the original short quote window after timely payment authorization and submission; outstanding delivery obligations persist.

## Chapter 7 — WealthPixels Delivers LINK

**THE STORY:**

The Treasury delivers the quoted LINK directly to the Investor's Ethereum Sepolia address from its own principal inventory. This illustrates an enduring WealthPixels execution principle: supply the individual underlying assets directly, with each quantity tied to the accepted quote, without pooling investors into a fund.

**THE ACTION:**

Recheck canonical finalized payment and remaining Treasury funding, then prepare, separately sign, separately broadcast and reconcile the exact LINK transfer. Treasury uses its own NEAR authority and a fresh Ethereum nonce. CLI actions: `prepare`, `sign`, `reconcile-signing`, `broadcast` and `reconcile` with `--leg link-delivery --role treasury`; see the [operator commands and separate approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Treasury signing needs the exact LINK unsigned digest; broadcasting needs the exact signed transaction hash. The Investor's earlier payment approval authorizes neither Treasury operation.

**THE EVIDENCE:**

The [completed two-way LINK manifest](../evidence/sepolia-link.json) records a separate live 1-LINK Treasury delivery and 0.1-LINK Investor return. Those transactions demonstrate delivery and subsequent Investor authorization, without establishing this planned portfolio's LINK leg.

**WHAT HAPPENS NEXT:**

After the quoted LINK receipt is confirmed and freshly checked, prepare the missing native ETH obligation with another fresh Treasury nonce.

## Chapter 8 — WealthPixels Delivers Native ETH

**THE STORY:**

The Treasury then delivers native ETH to the same Investor address. The result is intended to be ownership of ETH itself alongside LINK, rather than a wrapped ETH allocation or a portfolio receipt token.

**THE ACTION:**

Prepare the exact quoted wei value with empty calldata, verify remaining funds and reserve, and follow separate signing, broadcast and receipt-reconciliation checkpoints. Native accounting must show the Investor's balance increase and Treasury's value-plus-fee decrease at the receipt's historical block boundaries. CLI actions: `prepare`, `sign`, `reconcile-signing`, `broadcast` and `reconcile` with `--leg eth-delivery --role treasury`; see the [operator commands and separate approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Approve this leg's exact unsigned digest and, separately, its signed hash. Prior LINK approval supplies no authority for the ETH transfer; a partial purchase retains the missing obligation rather than automatically repeating earlier delivery.

**THE EVIDENCE:**

The [standalone native smoke summary](../evidence/native-eth-smoke.json) records a separate live transfer of exactly **0.000001 ETH**, with a successful receipt and exact balance accounting. Its **10 recorded confirmations** meet that test's confirmation threshold without establishing Ethereum consensus finality or a portfolio purchase.

**WHAT HAPPENS NEXT:**

Reconcile all three purchase legs, actual costs and remaining obligations before declaring the portfolio completed.

## Chapter 9 — The Investor Owns the Portfolio

**THE STORY:**

After verified completion, the planned outcome is individual native ETH and LINK held at the Investor's NEAR-controlled Ethereum address. The assets can be managed through that Investor authority without redeeming a share in a WealthPixels pool.

**THE ACTION:**

Check the exact accepted quantities, all three receipts and actual execution costs; the final successful reconciliation records completion only when no delivery obligation remains. Preserve the approved assumptions alongside the delivered assets and fees. CLI action: `inspect`; see the [operator command and completion checks](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Any later Investor asset transfer requires its own authorization. The hackathon's single demonstrator may operate both testnet roles; separate accounts do not establish separate human custody.

**THE EVIDENCE:**

The prior [0.1-LINK Investor return](../evidence/investor-link-return.json) demonstrates an Investor-authorized transfer after a separate delivery. The planned purchase remains pending, and local quote association and sequential settlement do not establish trustless or atomic portfolio execution.

**WHAT HAPPENS NEXT:**

Export the completed purchase's public evidence and let judges independently check its exact claims using public network data.

## Chapter 10 — Hackathon Evidence and Verification

**THE STORY:**

Verifiable Execution is intended to remain a fundamental WealthPixels product capability beyond the hackathon. WealthPixels is designed to create independently checkable evidence connecting approved portfolio purchase terms, the Investor's payment, relevant transaction authorizations, delivery of the individual underlying assets, and resulting balances, costs and settlement outcomes. The objective is to establish what was authorized, what was delivered and whether execution matched the approved terms, beyond simply showing that transactions occurred.

For this demonstration, judges should also be able to distinguish working code, simulated journeys and recorded live transfers. WealthPixels publishes that distinction so a completed capability is visible without implying that the pending portfolio purchase has already happened. The implemented checks have the trust and data-availability limits described below.

**THE ACTION:**

CLI tools: `purchase:export-evidence` for the operator after completion and `verify:purchase` for public read-only checks; see the [operator PowerShell commands and export gate](WealthPixels_Guided_Purchase_Operator_Story.md). From the repository root, use Node 22.23.4, or a supported Node 22 patch at least 22.22.2, and npm. These commands work on Windows, macOS and Linux; install dependencies with `npm ci` first if needed, then run:

```text
npm test
npm run typecheck
npm run purchase:dry-run
npm run verify:purchase -- --manifest evidence/portfolio-purchase.pending.json
```

**Recorded offline fixture validation:** 635/635 tests and typecheck passed; the dry-run progressed `settling` → `partially-delivered` → `completed`, with three mock NEAR and three mock Ethereum submissions and no outstanding obligations. This is simulation evidence only.

Tests use offline fixtures. The dry-run uses an isolated temporary journal and simulated prices, approvals, signing, broadcasts, balances and receipts; its `completed` state proves the software rehearsal, not live delivery. The pending verifier makes no RPC calls, reports **incomplete / PENDING** and exits **2**.

For the separately completed two-way LINK demonstration, this read-only public check needs no signing identity or funding:

```text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
```

After the operator exports a real completed purchase manifest, verify the actual resulting file supplied for review. The [operator command card](WealthPixels_Guided_Purchase_Operator_Story.md#command-card--templates-not-current-approvals) proposes `$PublicManifest = 'evidence/guided-purchase-20261110-001.json'`; if a different unused name is agreed, substitute that actual export path below. This is a **future command template**; no completed manifest for this purchase exists today:

```text
npm run verify:purchase -- --manifest evidence/guided-purchase-20261110-001.json --expected-quote-hash APPROVED_QUOTE_HASH --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io --beacon-rpc https://ethereum-sepolia-beacon-api.publicnode.com
```

Replace `APPROVED_QUOTE_HASH` with the actual approved quote hash preserved separately at the operator's approval checkpoint. If that value is unavailable, omit `--expected-quote-hash APPROVED_QUOTE_HASH` and disclose that independent quote pinning was not performed. For the purchase verifier, exit **0** means every implemented public check passed, **2** means incomplete or unavailable history, and **1** means invalid or contradictory evidence or an invalid-option, path or input/output failure. The LINK verifier uses exit **1** for RPC failure; the diagnostic and native summary schemas are not accepted by either manifest verifier.

**YOUR APPROVAL:**

Offline evaluation and public verification need no transfer authorization. All future live price approval, quote preparation, signing and broadcasting remain separate operator checkpoints in the [operator runbook](Task03FA_Live_Operator_Runbook.md).

**THE EVIDENCE:**

These are saved public artifacts and actual transaction hashes, not fresh network verification performed for this story:

| Saved artifact | Recorded live result | NEAR transaction hash | Sepolia transaction hash |
| --- | --- | --- | --- |
| [Two-way LINK manifest](../evidence/sepolia-link.json), [delivery details](../evidence/treasury-link-delivery.json) | Treasury delivered 1 LINK | `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs` | `0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719` |
| [Investor LINK return](../evidence/investor-link-return.json) | Investor returned 0.1 LINK | `4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z` | `0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86` |
| [Native ETH smoke summary](../evidence/native-eth-smoke.json) | Treasury delivered 0.000001 native ETH | `EHMUuAN8z1ZpoN8SrUq9P98wRfKQDzoNFZTwRpkgAvqb` | `0xa3bcc196bfdc3a47c51c720631521048ce3e5c35425a1a8fb4d0c91bf12bdc74` |
| [Experiment A summary](../evidence/experiment-a-near-self-transfer.json) | Ordinary Investor 1-yoctoNEAR self-transfer, FINAL success | `GtjwK1T6j2yfAfcV3VSHjj9uVeD6nEf9odKvYR6G1MwP` | None; no Ethereum transfer |
| [Experiment B summary](../evidence/experiment-b-near-mpc-diagnostic.json) | Investor MPC signature verified for a diagnostic message | `CvbiuJEoKXyfppXZUs5Qc6gswXHyNmovbewLLCfkYLdE` | None; no Ethereum transfer |

The separate [portfolio placeholder](../evidence/portfolio-purchase.pending.json) contains no purchase transaction evidence. The [public evidence guide](../evidence/README.md) explains the schemas, checks and limits. Summaries retain public parameters and observations while excluding credentials, executable transaction serializations and private runtime records.

### Technical verification limitations

Historical Beacon archive availability is **unresolved**, as preserved in the [archive investigation](Task03FA_Archive_RPC_Investigation.json). The purchase verifier needs the historical consensus state anchored at LINK release to check that payment was already finalized; today's finalized head, a cached report and synthetic fixtures cannot replace missing history. Prompt verification after a future purchase may help while recent history is available, but later independent retrieval is not guaranteed. Public RPC responses remain trust inputs; the verifier is not a light client or a BLS/SSZ state-proof verifier. Report any incomplete or failed check with its actual status; a completed local record or successful export does not make missing evidence independently verified.

**WHAT HAPPENS NEXT:**

Complete the separately approved live journey, publish its real manifest and preserve an honest verification result. Fee increases, partial settlement and unavailable history must retain their actual status; none creates evidence of completion.

**Diversification Without Pooling.**

**Ownership Without Blockchain Boundaries.**

**Investing Without Barriers.**
