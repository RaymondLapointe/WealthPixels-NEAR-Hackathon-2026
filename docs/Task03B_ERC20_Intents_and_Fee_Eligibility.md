# Task 03B — ERC-20 intents and economic fee eligibility

Date: November 5, 2026. Implementation and offline verification only.

The demonstration target is **10 test USDC**, with an illustrative 50% native ETH / 50% LINK allocation. This supersedes the historical 100-USDC example in Task 03A. Purchase amounts are configurable; neither figure is a production minimum. This milestone supplies reusable calculation/validation modules. It does not implement or authorize a live purchase.

## Preserved milestone and verification

Before source changes, the existing **122 offline tests** and TypeScript check passed. After reviewing the staged changes for credentials, generated output, ignored files and large artifacts, the completed Phase 3H implementation and public evidence were committed locally:

`3f73c20442ff2d1de9638be48296a42085fd071d`

Commit label: `milestone: completed Phase 3H LINK round trip and accepted Task 03A plan`.

There is no Git remote. Protected credential files were not read. The two published delivery records remain byte-for-byte unchanged:

| Public record | SHA-256 |
| --- | --- |
| `evidence/treasury-link-delivery.json` | `e99d120a99da474392387f3203400734ec4fd8ff47a2d273827a40e147b7ca39` |
| `evidence/investor-link-return.json` | `8813bce5d1591b95b454c3e19b9d5ca06bc16b62aee17f197825ebf866cf9f8b` |

The existing Solidity contracts, legacy test, NEAR signer, transaction recovery, completed evidence and dependency lockfile were preserved. Runtime: Node 22.23.4; SDK: near-api-js 7.4.0. No dependency or runtime upgrade was performed.

## Changes

| File | Purpose |
| --- | --- |
| `src/purchase/config.ts` | Official asset metadata, 10-USDC illustrative target, 1,000-bps fee threshold, existing transaction caps and minimum 20% gas buffer; explicit pricing-verification gaps. |
| `src/purchase/amounts.ts` | Exact decimal-string USDC parsing/formatting and uint256 guards. |
| `src/purchase/terms.ts` | Deeply frozen allocation terms and deterministic integrity hash binding amount, assets, identities, MPC configuration, rational prices, allocation quantities and rounding remainders. |
| `src/evm/asset-intent.ts` | Investor USDC payment and Treasury quote-sized LINK intents, existing EIP-1559 builder reuse, strict intent/policy integrity and public-snapshot preflight validation. |
| `src/purchase/claims.ts` | Canonical payment-event identity and duplicate-claim checks; no durable payment journal yet. |
| `src/purchase/fee-eligibility.ts` | Expected/actual fee interfaces, exact rational conversions, eligibility, integrity checks and pre-payment revalidation. |
| `test/near/purchase-intent.test.ts` | 18 offline tests for variable amounts, precision, terms, both token legs, validation, duplicate claims and gas-buffer preservation. |
| `test/near/fee-eligibility.test.ts` | 25 offline tests for full system costs, threshold boundaries, invalid/missing data, freshness, tampering, revalidation and actual cost accounting. |
| `test/near/fixtures/sepolia-usdc.json` | Clearly labelled recorded public contract metadata/code; no private material or live purchase evidence. |
| `package.json` | Includes both new test modules in `test:offline` and therefore `npm test`. |
| `README.md` | Current 10-USDC/configurable-amount scope, fee eligibility, funding status and implementation limits. |
| This report | Results, prerequisites and remaining schedule. |

The new modules have no credential, signing or broadcast ports. No purchase command was added to the live CLI. The existing LINK-only CLI retains its previous fixed-transfer restrictions. Allocation terms are an input to the future approved quote, not a substitute for human approval, price verification, quote expiry or the purchase journal.

## Amounts and ERC-20 safeguards

Amounts **1, 5, 10, 20 and 100 USDC** are tested, alongside fractional amounts down to one micro-USDC. JavaScript numbers, exponents, excess precision, zero, negative values and uint256 overflow are rejected. Arithmetic uses bigint throughout.

For each asset, allocation is calculated as one rational expression and floored only at the final ETH wei/LINK base-unit conversion. Fractional USDC allocation budgets are retained until that conversion. The exact remainder is recorded. There is no arbitrary amount minimum; a quantity rounding to zero asset units is a precision failure. Fee eligibility is a separate economic gate.

USDC payment is always Investor → Treasury, six decimals. LINK delivery is always Treasury → Investor, 18 decimals, with the quantity bound to the allocation terms. Wrong token, role, sender, recipient, amount, chain, terms hash or prepared bytes are rejected. The transaction safety references remain 180,000 gas, 30 gwei maximum fee per gas and 0.0036 ETH maximum total fee; these caps do not authorize any transaction or establish its expected cost.

Snapshot validation checks token runtime code/decimals, code-free role addresses, nonce, inventory, native fee funds and fee adequacy. USDC pause and both blacklist results must be explicitly present and false. Both the original and fresh gas estimates must retain at least the approved 20% buffer within the unchanged gas limit. An increase that consumes the buffer stops validation; it never rebuilds a transaction automatically.

Duplicate payment identity is `chainId:transactionHash:TransferLogIndex`, with normalized hashes. Task 03D must verify the authentic payment receipt/event and atomically persist its claim with the paid-state transition. The pure claim helper alone does not accept payments or provide restart-safe replay prevention.

## Fee eligibility interfaces and policy

`MAX_EXPECTED_FEE_BPS = 1000` is configurable. Expected costs must cover **all three EVM legs and all three NEAR signing operations**, with the correct Investor/Treasury payer for each. Missing legs, observations, prices or provenance fail closed.

- EVM expected cost: conservative buffered gas × (explicit assumed base fee + priority fee). Maximum fee reserves are calculated separately and constrained by transaction caps.
- NEAR expected cost: buffered estimated signing execution plus declared transaction overhead, multiplied by the explicit NEAR gas-price assumption, plus the original deposit. The gas attachment is a maximum reserve, not an assumption that 100 Tgas will all burn.
- ETH uses 18 native decimals; NEAR uses 24. Both convert to six-decimal USDC equivalents using documented positive rational rates under the disclosed convention **1 test USDC = 1 nominal quote-dollar**.

The exact rational comparison is `totalExpectedUsdc × 10000 <= investmentUsdc × maximumFeeBps`. Display totals/ratios round upward. Exactly 10% passes; any amount above the exact boundary fails. For the 10-USDC target, the total expected fee budget is 1 nominal USDC, including Treasury-paid costs. These values do not claim production economic viability.

`createFeeEstimate` returns immutable per-leg costs, exact totals, conservative display amounts, expected fee bps, maximum reserves, eligibility and an assessment hash. `assertFeeEligible` recomputes and verifies the record. `revalidateFeeEligibilityBeforePayment` requires live-mode inputs, verified or explicitly approved demonstration rates, unchanged terms/amount/policy, fresh observations and no expiry/freshness extension or backward clock. Default estimate maximum age is 60 seconds. Offline fixtures cannot authorize live payment.

`recordActualExecutionFees` accounts for EVM `gasUsed × effectiveGasPrice`, finalized NEAR transaction/receipt `tokens_burnt`, and unrefunded original deposits, avoiding duplicate receipts and forwarded-deposit double counting. Additional failed execution attempts can be included. It returns total actual costs and realized fee bps; overruns do not cancel the delivery obligation. Fee-estimation operations themselves are WealthPixels operating expenses, outside the six execution-cost groups.

These interfaces validate caller-supplied observations; they do not authenticate an oracle or prove receipt completeness. **Task 03D must collect fresh public inputs, preserve the estimate and policy inside the approved immutable quote, revalidate before payment authorization, and retain an outstanding settlement obligation after payment even if fees rise. Task 03E must verify and export actual receipt-derived costs.**

## USDC readiness and funding

[Circle's official address list](https://developers.circle.com/stablecoins/usdc-contract-addresses) confirms Ethereum Sepolia USDC:

`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

A public read-only RPC snapshot at **2026-11-05T21:12:17Z**, block `0xb8347f`, confirmed chain ID 11155111, six decimals, symbol USDC, deployed runtime code, unpaused state and neither role blacklisted:

| Role | EVM address | USDC balance |
| --- | --- | --- |
| Investor | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` | 0 |
| Treasury | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` | 0 |

Reviewed proxy runtime code hash: `0xcd3f29e2ea9c61dadd48bfeaf8b2884b6de9dfee7bf45329452c4c33d0868ceb`. A proxy-code pin alone does not establish an unchanged implementation; Task 03D must review implementation/upgrade compatibility and refresh metadata and simulation before live preparation.

The [Circle faucet](https://faucet.circle.com/) currently offers 20 test USDC per address/blockchain every two hours, with a recipient field and human CAPTCHA. **One separately approved claim to the existing Investor address would cover the 10-USDC target.** No 100-USDC balance is required, and no faucet request or funding transaction was made. Check actual USDC, role ETH/NEAR balances and Treasury inventory again before future preparation; existing gas balances are not a promise of future sufficiency.

## Pricing configuration and live blockers

Use the approved proposal of frozen ETH/USD and LINK/USD public feed snapshots, with raw integer answers/decimals, positive prices, verified addresses, pinned observation references and explicit heartbeat-based freshness. Testnet USDC is only a nominal quote unit. [Chainlink API](https://docs.chain.link/data-feeds/api-reference), [feed directory](https://docs.chain.link/data-feeds/price-feeds/addresses).

- ETH/USD: official documented Sepolia address `0x694AA1769357215DE4FAC081bf1f309aDC325306`; a live freshness/heartbeat policy still needs verification.
- LINK/USD: responding candidate `0xc59E3633BAAC79493d908e63626716e204A45EdF`; authoritative address and heartbeat verification remain a live gate.
- NEAR/USD: no verified conversion is configured. Supply a documented fresh public reference, or obtain explicit approval of a clearly labelled fixed demonstration rate with a bounded validity period. No new blockchain integration or silent fallback is proposed.

Consequently **live fee eligibility is not yet established**. Synthetic prices in tests demonstrate arithmetic, not current market data or live economic eligibility. Full quote collection is intentionally deferred to Task 03D.

## Commands and results

Before the milestone commit: existing offline suite **122/122 passed**; TypeScript **passed**. Final Task 03B suite: **165/165 passed**, including all existing tests plus 43 new tests; TypeScript **passed**.

Exact final Windows commands executed:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:offline')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

Cross-platform judge equivalents with supported Node 22:

```text
npm test
npm run typecheck
```

Targeted development runs used the project Node 22.23.4 executable with `--import tsx --test test/near/purchase-intent.test.ts` and `--import tsx --test test/near/fee-eligibility.test.ts`. No package installation, legacy mainnet-fork test or live purchase preparation was needed. Git whitespace checks passed. New fixtures contain public metadata only, and ignored `.local` observation records are excluded from source control.

## Remaining increments and schedule

| Increment | Remaining acceptance gate | Indicative window |
| --- | --- | --- |
| 03C — native ETH | Exact value/data intent, sender verification, value-plus-gas inventory, canonical receipt and fee-aware deltas; preserve ERC-20 guards. | Nov 6–7 |
| 03D — quotation and orchestration | Fresh complete six-cost estimate and verified rates; immutable configurable quote and fee policy; pre-payment eligibility, inventory reservation, durable payment claims/finality; serialized delivery, paid/partial obligations and narrowly bound recovery. | Nov 7–10 |
| 03E — purchase evidence | Verify quote plus all three real NEAR/EVM legs; export estimated/actual fees and realized ratio; credential-free verification; retain the original LINK proof separately. | Nov 10–11 |
| 03F — approved live demo and packaging | Separate funding/preparation/signing/broadcast approvals; actual 10-USDC payment followed by quote-sized LINK and native ETH; verify completion or preserve outstanding obligations; publish only after separate authorization. | Nov 11–13 |

The additional fee collector/gating work is approximately half to one focused development day within Task 03D, dependent on price-source verification. Completing 03B on November 5 provides some schedule margin; target a verified live demonstration by November 12 and judge-ready package November 13. These are estimates, subject to review, faucet/RPC availability and operator approvals.

**Stopped at Task 03B.** No private credentials, live transaction preparation, NEAR signing, EVM broadcasting, funding, new contracts, dependency upgrades or changes to legacy Solidity occurred. Native ETH and the full purchase coordinator remain separate implementation milestones.
