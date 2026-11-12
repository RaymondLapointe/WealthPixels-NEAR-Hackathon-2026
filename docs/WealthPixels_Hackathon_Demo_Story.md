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

Public hackathon story, November 11, 2026. The current prototype uses **NEAR Testnet Chain Signatures to authorize Ethereum Sepolia transactions**. Both native ETH and LINK are delivered on **Ethereum Sepolia**; the prototype does not demonstrate portfolio delivery across multiple destination blockchains. Its completed purchase invested **10 test USDC**, allocated **50% native ETH / 50% LINK**, and delivered assets from Treasury principal inventory through three sequential Ethereum transactions. The amount is configurable; 10 USDC is a demonstration amount, with no production minimum implied.

The test networks, manually approved demonstration prices and current CLI workflow are prototype choices. The hackathon demonstrator may control both disposable testnet roles on one computer; separate NEAR accounts and authorizations demonstrate protocol behavior without establishing independent production custody.

**Completed and publicly verified:** purchase `guided-purchase-20261111-003` delivered **0.478697941598851124 LINK** and **0.002400960384153661 native ETH** to the Investor following its 10-test-USDC payment. The [completed manifest](../evidence/guided-purchase-20261111-003.json) records settlement at **2026-11-11T21:46:08.630Z**; the [public verification report](../evidence/guided-purchase-20261111-003-verification-001.json) returned **verified** at **21:51:31.505Z**, including historical payment finality before Treasury delivery. Journal revision **47** records completion without an active purchase or outstanding obligation. Offline tests remain simulations, and earlier LINK/native tests and Experiments A/B remain separate capability evidence.

CLI action names below use `npm run purchase -- ACTION` to explain the completed sequence and preserve its approval checkpoints for future reproduction. Reading this story does not authorize another purchase or repetition of completed transactions. The matching [operator story](WealthPixels_Guided_Purchase_Operator_Story.md) supplies PowerShell templates; a new attempt requires unused identifiers, fresh observations and separately approved actual outputs.

To demonstrate how this approach works, we're starting with a deliberately simple two-asset portfolio, consisting of ETH and LINK. The objective is to prove the underlying purchase, delivery, ownership and verification mechanisms that can eventually support more complex diversified portfolios.

## Chapter 1 — An Investor Requests a Portfolio Purchase

**THE STORY:**

An Investor selects a portfolio model and requests its underlying assets directly. In the completed prototype example, they requested a 10-test-USDC purchase with equal allocation to native ETH and LINK, using an Ethereum Sepolia address controlled through their NEAR account. This is the first purchase model used to demonstrate the protocol; the intended many-asset portfolio experience remains the broader product vision.

**THE ACTION:**

Record the requested amount, allocation and public Investor destination. The [offline purchase dry-run](../scripts/purchase-dry-run.ts) rehearses this request without live transaction execution. CLI actions: `inspect-networks` and `inspect`; see the [operator story's PowerShell commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

The request expresses intent. Live prices, the eventual quote, payment signing and every transaction broadcast each have their own approval checkpoint.

**THE EVIDENCE:**

[Allocation terms](../src/purchase/terms.ts) bind exact six-decimal USDC input, weights, public destinations and integer asset quantities. The [completed purchase manifest](../evidence/guided-purchase-20261111-003.json) preserves the **10000000-USDC-base-unit** request, equal weights and Investor address `0x07FE574EdB1B2f537F9be452312C15A5b9427820`.

**WHAT HAPPENS NEXT:**

WealthPixels establishes explicitly approved reference prices for this purchase.

## Chapter 2 — WealthPixels Establishes Reference Prices

**THE STORY:**

The investor needs to know how their allocation becomes quantities of two different assets. For the hackathon, WealthPixels uses explicitly approved demonstration prices with visible sources and observation times; these are disclosed assumptions rather than production real-time market prices.

**THE ACTION:**

Stage purchase-specific ETH/USD, LINK/USD and NEAR/USD references, preserve their provenance and calculate the exact proposal digest for review. ETH and LINK rates size delivery; ETH and NEAR rates also convert execution costs into USDC equivalents. CLI actions: `propose-prices` and `approve-prices`; see the [operator commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

A separate approval must match the exact price proposal digest and purchase ID within its validity, which cannot exceed five minutes. Attempt 003's recorded approval applied only to its original price set and window; it cannot authorize a later purchase.

**THE EVIDENCE:**

Attempt 003 approved Coinbase Exchange last-trade references of **ETH/USD 2082.5**, **LINK/USD 10.445** and **NEAR/USD 3.7154**. Original URLs, trade IDs, source timestamps and approval are preserved in the [manifest](../evidence/guided-purchase-20261111-003.json); its price window ran from **20:56:35.900Z to 21:01:35.900Z on November 11, 2026**. The [price provider checks](../src/purchase/prices.ts) reject unapproved or expired inputs. These saved order assumptions are not current market offers; future providers can use the same interface, without an automatic live-price fallback.

**WHAT HAPPENS NEXT:**

Approved prices and fresh public network observations can support a quote, subject to a separately authorized live preparation step.

## Chapter 3 — WealthPixels Constructs the Portfolio Quote

**THE STORY:**

The investor should see the exact bargain before committing funds. The accepted 10-USDC quote assigned five nominal quote-dollars to each asset and froze the resulting quantities, reference prices, destinations, initial cost evidence and purchase expiry together. New quotes allow review within the remaining approved-price window while shorter-lived network-fee observations are checked independently before execution.

**THE ACTION:**

Use fresh cost and inventory observations to construct the immutable quote and reserve the required Treasury inventory and maximum funding. The completed quote fixed **0.002400960384153661 native ETH** and **0.478697941598851124 LINK**, retaining integer-rounding evidence. CLI actions: `quote` and `approve-quote`; see the [operator commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Review the exact quote hash, quantities, assumptions, fees and expiry before approving it. Total expected costs for all three Ethereum transactions and all three NEAR signing operations, regardless of payer, must be at most 10% of the investment: at most one nominal USDC for this target. This is an economic eligibility safeguard, not a WealthPixels fee charged to the Investor.

**THE EVIDENCE:**

The approved quote hash is `0x12f47956df63129eeb2ae6a8f388f2274e777ee5d62f0eb395f0cc21bfeda4a1`. Created at **20:57:49.975Z**, its original acceptance deadline remained **21:01:35.900Z on November 11**. The [quote engine](../src/purchase/quote.ts) binds the terms and safeguards. Version-2 quotes preserve a fixed purchase deadline capped by the original approved-price expiry; historical version-1 quotes retain their original fee-bound expiry and hash. Fee observations remain independently limited to 60 seconds, and refreshing them cannot alter approved portfolio terms. The [November 10 corrections](Portfolio_Purchase_Readiness_Corrections_20261110.md) implement the USDC-specific gas ceiling, complete NEAR upfront funding reserves and guarded unpaid expiry; expected execution costs and maximum reserves remain distinct.

**WHAT HAPPENS NEXT:**

The Investor reviews the payment intent while the original quote remains eligible. Its acceptance deadline never restarts; fresh execution checks have their own shorter validity.

## Chapter 4 — The Investor Authorizes Payment

**THE STORY:**

The investor decides whether the quoted portfolio and its costs meet their expectations. Their payment was a direct transfer of 10 test USDC to the Treasury, with no spender allowance transaction required.

**THE ACTION:**

After exact quote approval, prepare the Investor payment and inspect its amount, Treasury destination, token, chain and unsigned transaction digest. Fresh checks must confirm Investor funding, Treasury inventory and complete execution funding before payment authorization. CLI action: `prepare` with `--leg usdc-payment --role investor`; see the [operator command and approval gate](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Quote approval and exact-digest signing approval are separate decisions. A payment eligibility record alone has `executionAuthorized: false`; it cannot sign or send a transaction.

**THE EVIDENCE:**

The [purchase coordinator](../src/purchase/coordinator.ts) and [operator runbook](Task03FA_Live_Operator_Runbook.md) enforce these checkpoints. The [manifest](../evidence/guided-purchase-20261111-003.json) preserves the approved payment digest `0xca0777146e29faf9ecaa95d337164754fe73e0056a334a363c340ad4b171daaa`, its transaction fields and the original payment authorization.

**WHAT HAPPENS NEXT:**

Only after explicit approval of that exact digest may the Investor's own NEAR authority request its MPC signature.

## Chapter 5 — NEAR Chain Signatures Signs the Investor Payment

**THE STORY:**

The Investor's NEAR Testnet account can authorize an Ethereum Sepolia transaction through NEAR Chain Signatures. This demonstrates authorization across the two networks while retaining an identifiable Investor authority for the payment; asset delivery in this prototype remains on Sepolia.

**THE ACTION:**

Submit the separately approved digest through the Investor's NEAR role, then reconcile the exact NEAR outcome and verify the returned signature against the full trusted derived Investor public key. The quote approval, payment preparation, digest approval and first MPC submission must fit the fixed original purchase deadline, capped by approved-price expiry. Execution observations are refreshed independently, remain at most 60 seconds old and are rechecked after preparation and immediately before submission; they never extend the purchase deadline. CLI actions: `sign` and `reconcile-signing` with `--leg usdc-payment --role investor`; see the [operator commands and separate approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Signing approves the unsigned digest. Broadcasting requires another approval bound to the resulting exact signed Ethereum hash and the original payment authorization; obtaining a signature does not authorize broadcasting.

**THE EVIDENCE:**

The [purchase verification report](../evidence/guided-purchase-20261111-003-verification-001.json) verified the Investor's actual NEAR MPC authorization, returned signature against the full trusted derived key, and matching Ethereum payment. Chapter 10 lists its NEAR and Ethereum transaction hashes. [Experiment B](../evidence/experiment-b-near-mpc-diagnostic.json) remains a separate earlier diagnostic signature, not this payment.

**WHAT HAPPENS NEXT:**

After signed-hash approval and fresh eligibility checks, submit the payment once and reconcile its public receipt. Uncertain attempts retain their identity and require reconciliation.

## Chapter 6 — The Investor's USDC Reaches the Treasury

**THE STORY:**

The payment established the Treasury's delivery obligation after the exact USDC transfer became canonical and finalized. At that point WealthPixels owes the quoted asset deliveries, even if prices expire or execution fees rise later.

**THE ACTION:**

Verify the successful USDC transfer, exact amount and destinations against public Ethereum records. Claim its chain ID, transaction hash and transfer-log index together with the durable paid state before releasing Treasury inventory. CLI actions: `broadcast` and `reconcile` with `--leg usdc-payment --role investor`; see the [operator commands and approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

The payment broadcast requires its own exact signed-hash approval. Finality checks and reconciliation are read-only observations; they do not grant authority to sign the Treasury's deliveries.

**THE EVIDENCE:**

The [manifest](../evidence/guided-purchase-20261111-003.json) records the finalized **10-USDC** payment in block **12114259**, transfer-log index **91**. Investor USDC decreased from 20 to 10 and Treasury USDC increased from 0 to 10 at that receipt's historical block boundaries. The [settlement implementation](../src/purchase/settlement.ts) and [payment claims](../src/purchase/claims.ts) enforce the local sequence and duplicate-payment guard; public verification also checked that payment was already finalized before LINK delivery.

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

The [completed purchase manifest](../evidence/guided-purchase-20261111-003.json) records delivery of **0.478697941598851124 LINK** in block **12114445**, with the required canonical two-confirmation receipt check. Investor LINK rose from **0.9** to **1.378697941598851124** at that receipt's historical block boundaries. Chapter 10 lists both authorization and delivery hashes. The [earlier two-way LINK demonstration](../evidence/sepolia-link.json) remains separate evidence.

**WHAT HAPPENS NEXT:**

After the quoted LINK receipt is confirmed and freshly checked, prepare the missing native ETH obligation with another fresh Treasury nonce.

## Chapter 8 — WealthPixels Delivers Native ETH

**THE STORY:**

The Treasury then delivers native ETH to the same Investor address. The completed delivery gave the Investor ETH itself alongside LINK, without wrapping or a portfolio receipt token.

**THE ACTION:**

Prepare the exact quoted wei value with empty calldata, verify remaining funds and reserve, and follow separate signing, broadcast and receipt-reconciliation checkpoints. Native accounting must show the Investor's balance increase and Treasury's value-plus-fee decrease at the receipt's historical block boundaries. CLI actions: `prepare`, `sign`, `reconcile-signing`, `broadcast` and `reconcile` with `--leg eth-delivery --role treasury`; see the [operator commands and separate approval gates](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Approve this leg's exact unsigned digest and, separately, its signed hash. Prior LINK approval supplies no authority for the ETH transfer; a partial purchase retains the missing obligation rather than automatically repeating earlier delivery.

**THE EVIDENCE:**

The [completed purchase manifest](../evidence/guided-purchase-20261111-003.json) records **0.002400960384153661 native ETH** delivered in block **12114479**, with the required canonical two-confirmation receipt check. Investor ETH rose from **0.050000999801823597** to **0.052401960185977258** at that receipt's historical block boundaries; Treasury paid the value plus execution gas. The earlier [0.000001-ETH smoke transfer](../evidence/native-eth-smoke.json) remains a separate test.

**WHAT HAPPENS NEXT:**

Reconcile all three purchase legs, actual costs and remaining obligations before declaring the portfolio completed.

## Chapter 9 — The Investor Owns the Portfolio

**THE STORY:**

The completed purchase delivered individual native ETH and LINK directly to the Investor's NEAR-controlled Ethereum address. The assets can be managed through that Investor authority without redeeming a share in a WealthPixels pool.

**THE ACTION:**

Check the exact accepted quantities, all three receipts and actual execution costs; the final successful reconciliation records completion only when no delivery obligation remains. Preserve the approved assumptions alongside the delivered assets and fees. CLI action: `inspect`; see the [operator command and completion checks](WealthPixels_Guided_Purchase_Operator_Story.md).

**YOUR APPROVAL:**

Any later Investor asset transfer requires its own authorization. The hackathon's single demonstrator may operate both testnet roles; separate accounts do not establish separate human custody.

**THE EVIDENCE:**

Attempt 003 reached **completed** at **2026-11-11T21:46:08.630Z**, with all three legs confirmed and no outstanding obligation; the local journal reached revision **47**. Actual execution costs, valued using the original approved prices and rounded upward to USDC base units, totalled **0.009738 nominal USDC**. The report's rounded-up whole-basis-point ratio is **10 bps (0.1%)**, below the **1000-bps** eligibility limit. This is blockchain execution cost, not a WealthPixels platform fee. The [manifest and balances](../evidence/guided-purchase-20261111-003.json) describe historical receipt observations, not a fresh current-balance check. The prior [0.1-LINK Investor return](../evidence/investor-link-return.json) demonstrates separate Investor authorization after an earlier delivery. Local quote association and sequential settlement remain subject to the trust limits in Chapter 10.

**WHAT HAPPENS NEXT:**

The completed public export and saved verification result let judges review the exact claims and, subject to public data availability, independently rerun the verifier.

## Chapter 10 — Hackathon Evidence and Verification

**THE STORY:**

Verifiable Execution is intended to remain a fundamental WealthPixels product capability beyond the hackathon. WealthPixels is designed to create independently checkable evidence connecting approved portfolio purchase terms, the Investor's payment, relevant transaction authorizations, delivery of the individual underlying assets, and resulting balances, costs and settlement outcomes. The objective is to establish what was authorized, what was delivered and whether execution matched the approved terms, beyond simply showing that transactions occurred.

For this demonstration, judges can distinguish working code and simulated journeys from the completed live purchase. Its saved public verification includes the approved quote, three authorized transactions, delivered assets, execution costs and historical payment-finality check. The implemented checks have the trust and data-availability limits described below.

**THE ACTION:**

CLI tools: `purchase:export-evidence` for the operator after completion and `verify:purchase` for public read-only checks; see the [operator PowerShell commands and export gate](WealthPixels_Guided_Purchase_Operator_Story.md). From the repository root, use Node 22.23.4, or a supported Node 22 patch at least 22.22.2, and npm. These commands work on Windows, macOS and Linux; install dependencies with `npm ci` first if needed, then run:

```text
npm test
npm run typecheck
npm run purchase:dry-run
```

**Current offline packaging validation, November 11:** **667/667 tests passed**, with zero failures, skips or cancellations; TypeScript validation passed. The version-2 fixture dry-run completed with three simulated NEAR submissions, three simulated Ethereum submissions and no outstanding fixture obligations. These offline results are separate from the live purchase evidence.

**Historical offline fixture validation, November 10:** the then-current 635/635 tests and typecheck passed; the dry-run progressed `settling` → `partially-delivered` → `completed`, with three mock NEAR and three mock Ethereum submissions and no outstanding obligations. This is simulation evidence only.

Tests use offline fixtures. The dry-run uses an isolated temporary journal and simulated prices, approvals, signing, broadcasts, balances and receipts; its `completed` state proves the software rehearsal, not live delivery. The separate live result below is supported by its actual manifest and public verification report.

For the separately completed two-way LINK demonstration, this read-only public check needs no signing identity or funding:

```text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
```

For the completed portfolio purchase, this credential-free command reads the actual [exported manifest](../evidence/guided-purchase-20261111-003.json) and pins the exact quote approved by the Investor. It requires public RPC access, no private keys, funded accounts or transaction approval, and does not overwrite the saved report:

```text
npm run verify:purchase -- --manifest evidence/guided-purchase-20261111-003.json --expected-quote-hash 0x12f47956df63129eeb2ae6a8f388f2274e777ee5d62f0eb395f0cc21bfeda4a1 --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io --beacon-rpc https://ethereum-sepolia-beacon-api.publicnode.com
```

The [saved verification report](../evidence/guided-purchase-20261111-003-verification-001.json) already records the successful original run. To save a later verification, supply `--report` with a newly checked, unused public evidence filename; preserve the original report unchanged. For the purchase verifier, exit **0** means every implemented public check passed, **2** means incomplete or unavailable history, and **1** means invalid or contradictory evidence or an invalid-option, path or input/output failure. The LINK verifier uses exit **1** for RPC failure; the diagnostic and native summary schemas are not accepted by either manifest verifier.

**YOUR APPROVAL:**

Offline evaluation and public verification need no transfer authorization. All future live price approval, quote preparation, signing and broadcasting remain separate operator checkpoints in the [operator runbook](Task03FA_Live_Operator_Runbook.md).

**THE EVIDENCE:**

The [completed purchase manifest](../evidence/guided-purchase-20261111-003.json) has hash `0xc75b2734a25a4dc8d5c5f851ab6633389d244ed2a668294d03b27405f5d5c320`. Its [verification report](../evidence/guided-purchase-20261111-003-verification-001.json) returned **verified / complete / VERIFIED** at **2026-11-11T21:51:31.505Z**, with all seven check groups passed: immutable quote/approvals/six-cost structure and manifest integrity; public network identities; each of the three legs' MPC authorization, signed bytes, canonical receipt, movements, nonce and costs; historical finalized payment before LINK delivery; and realized fees/complete settlement. No required check was unresolved in that run.

| Purchase leg | Amount | NEAR transaction hash | Ethereum Sepolia transaction hash | Block |
|---|---|---|---|---|
| Investor USDC payment | 10 test USDC | `Ay4eMaZPUqThzG5gxDTn4ep41sMqcmC47sJeFxr3FMsa` | `0x39b905c753e842495f3ac7a7585f11130c37e290c9c816cb1ce323c9c4c1418f` | `12114259` |
| Treasury LINK delivery | 0.478697941598851124 LINK | `AjYP9rD5hkBdeupHBp99fPhXCq6GQbR5Sv5GZg37Ja86` | `0x5c5360ffa9e39f588c4c6ad6464f3507b006895978d44c05b281ee4f120ae6de` | `12114445` |
| Treasury native ETH delivery | 0.002400960384153661 ETH | `8YGwnW3XrKuybU1a3c26RDjbAPCFf6zG2bo784JnDbMp` | `0xac8536ac4f9d7616a0a7195166cee218d150471f0a980efe0fe7041c6f970d07` | `12114479` |

The three actual Ethereum fees were **154359243**, **43755676** and **21357000 wei**, respectively. Both public files preserve the three NEAR signing costs and resulting **0.009738 nominal USDC** rounded-up total realized execution cost under the approved price assumptions.

The following earlier artifacts remain separate capability evidence. Updating this story performed no fresh network checks:

| Saved artifact | Recorded live result | NEAR transaction hash | Sepolia transaction hash |
| --- | --- | --- | --- |
| [Two-way LINK manifest](../evidence/sepolia-link.json), [delivery details](../evidence/treasury-link-delivery.json) | Treasury delivered 1 LINK | `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs` | `0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719` |
| [Investor LINK return](../evidence/investor-link-return.json) | Investor returned 0.1 LINK | `4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z` | `0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86` |
| [Native ETH smoke summary](../evidence/native-eth-smoke.json) | Treasury delivered 0.000001 native ETH | `EHMUuAN8z1ZpoN8SrUq9P98wRfKQDzoNFZTwRpkgAvqb` | `0xa3bcc196bfdc3a47c51c720631521048ce3e5c35425a1a8fb4d0c91bf12bdc74` |
| [Experiment A summary](../evidence/experiment-a-near-self-transfer.json) | Ordinary Investor 1-yoctoNEAR self-transfer, FINAL success | `GtjwK1T6j2yfAfcV3VSHjj9uVeD6nEf9odKvYR6G1MwP` | None; no Ethereum transfer |
| [Experiment B summary](../evidence/experiment-b-near-mpc-diagnostic.json) | Investor MPC signature verified for a diagnostic message | `CvbiuJEoKXyfppXZUs5Qc6gswXHyNmovbewLLCfkYLdE` | None; no Ethereum transfer |

The historical [portfolio placeholder](../evidence/portfolio-purchase.pending.json) remains unchanged and contains no transaction evidence; it is not the manifest or current status of Attempt 003. The [public evidence guide](../evidence/README.md) explains the schemas, checks and limits. Summaries retain public parameters and observations while excluding credentials, executable transaction serializations and private runtime records.

### Technical verification limitations

**Historical payment finality passed for Attempt 003.** The consensus state anchored at LINK release showed finality through execution block **12114359**, covering payment block **12114259** before LINK block **12114445**. The [earlier archive investigation](Task03FA_Archive_RPC_Investigation.json) records data-availability limits for earlier evidence; successful retrieval for this purchase does not guarantee later independent retrieval. A current finalized head, cached report or synthetic fixture cannot replace unavailable historical data in a new verification run.

Public execution, NEAR and Beacon RPC responses remain trust inputs. The verifier checked the parent-header root but records `consensusProofVerified: false`: it does not verify BLS consensus signatures or BeaconState/body Merkle proofs and is not a light client. Human approval references, historical gas estimates and local purchase association remain operator assertions; demonstration prices are approved order assumptions. Report any later incomplete or failed check accurately, without changing the successful saved result or presenting missing evidence as verified.

**WHAT HAPPENS NEXT:**

Review the completed purchase and its saved verification evidence, or run the credential-free public checks above. Any new purchase or later asset movement requires fresh, separate authorization. Preserve these completed records and all historical attempts; broader portfolios and multiple destination blockchains remain the product vision.

**Diversification Without Pooling.**

**Ownership Without Blockchain Boundaries.**

**Investing Without Barriers.**
