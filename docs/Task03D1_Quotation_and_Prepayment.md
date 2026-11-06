# Task 03D-1 — Quotation, economic eligibility and durable prepayment state

Completed November 6, 2026 UTC. Implementation and offline verification only. The pricing amendment takes precedence: approved demonstration prices are the baseline; live Chainlink/CoinGecko collectors are deferred.

## Result and checkpoint

Implemented a replaceable `PriceProvider`, explicit demonstration-price approval, immutable variable-amount 50/50 quotations, integration of all six expected execution costs, and a locked restart-safe prepayment journal. No transaction execution/coordinator from Task 03D-2 was started.

Before development, **211/211 existing offline tests and TypeScript checks passed**. The accepted Task 03C commit `be32498d32ae829f9d9c5d99b6da044ba05e22ac` was reviewed for credentials, generated/runtime artifacts and source/evidence integrity, then preserved under local tag **`checkpoint/task03c-accepted-before-03d1`**. No remote is configured.

Phase 3H records remain unchanged. SHA-256:

- Treasury delivery: `e99d120a99da474392387f3203400734ec4fd8ff47a2d273827a40e147b7ca39`.
- Investor return: `8813bce5d1591b95b454c3e19b9d5ca06bc16b62aee17f197825ebf866cf9f8b`.

## Files and interfaces

| File | Purpose |
| --- | --- |
| `src/purchase/prices.ts` | `PriceProvider`, normalized exact observations, proposal/approval hashes, purchase-scoped demonstration provider, separate offline provider, allocation/fee-rate adapters. |
| `src/purchase/costs.ts` | Complete three-EVM/three-NEAR observation validation and fee assessment, bound to purchase/terms, roles, assets, quantities, public references and protective policy. |
| `src/purchase/quote.ts` | Immutable quote/hash, source-independent quote creation, separate Investor approval and fresh prepayment-eligibility assessment. |
| `src/purchase/journal.ts` | One active purchase, durable reservations, approvals, eligibility, explicit unpaid expiry, history and future payment-claim foundation. |
| `src/purchase/integrity.ts` | Typed bigint hashing, immutable copies, bounded identifiers and strict UTC/public-source validation. |
| `src/evm/sepolia-native.ts` | Extracted pure `estimateNativeDeliveryFees`; the existing native fee adapter delegates to it. This permits quotation without constructing a transaction or choosing a nonce. |
| `test/near/prices.test.ts` | Nine pricing/approval/provenance/freshness tests. |
| `test/near/quote.test.ts` | Nineteen quotation/economic/provider/interchangeability tests, including five variable purchase amounts. |
| `test/near/prepayment-journal.test.ts` | Fourteen persistence, reservation, funding, expiry, corruption and failure tests. |
| `test/near/fixtures/purchase-quote.ts` | Clearly labelled synthetic prices, cost/funding observations and simulated approvals. |
| `scripts/quote-example.ts` | Credential-free fixed offline example; no RPCs or journal writes. |
| `package.json`, `tsconfig.near.json` | Include the new tests and typechecked example command. No dependency changes. |
| `README.md`, this report | Implementation limits, example instructions and the required **External Pricing Integration and Future Production Readiness** section. |

The new journal shares the existing ignored-runtime path validation, exclusive lock, bounded bigint codec and fsynced temporary-file/rename writer. Existing signers, LINK execution, Solidity contracts, legacy tests and dependency lockfile were preserved.

## Pricing policy

The engine receives ETH/USD, LINK/USD and NEAR/USD as positive bounded rational integers with provider/source identity, original observation, pricing mode and validity. It imports no Chainlink or CoinGecko acquisition logic. Tests exercise interchangeable provider implementations with identical allocation/fee results and different provenance hashes.

`prepareDemonstrationPrices` creates an inspectable proposal digest. `approveDemonstrationPrices` requires that exact digest, an explicit approval reference and a valid approval time. Prices apply to **one purchase ID** for **at most five minutes**. Historical source timestamps remain unchanged; the effective assumption epoch is separately labelled. Approval is a local human-audit record, not a NEAR signature. This task did not obtain approval for any real price set.

Offline prices have no approval and cannot authorize prepayment eligibility. There are no current-price defaults, silent refreshes or automatic fallbacks. Missing assets/rates/provenance, invalid currencies, invalid/future timestamps, zero/negative prices and expired sets fail closed.

The Task 03C Chainlink address/heartbeat research and CoinGecko candidate remain intact for future integrations. Their production freshness/availability engineering is deliberately outside this increment. A future reviewed provider adapter can normalize observations at the interface without changing allocation, fee or transaction-delivery calculations. No paid API or additional blockchain was added.

## Complete economic screening

All six intended costs are mandatory: Investor USDC gas, Treasury LINK gas, Treasury native ETH gas, and the corresponding three role-specific NEAR signing operations. Cost data must identify the correct authorities, MPC contract/domain/path, exact asset quantities, gas/fee assumptions, deposits and public observation references.

Expected EVM fees use buffered estimated gas times the explicit base/priority assumptions; maximum fee reserves remain separate. NEAR estimates include explicit execution and transaction overhead, at least the 20% buffer, gas price and original one-yocto deposit. The 100-Tgas attachment is a reserve ceiling rather than expected consumption. Native ETH portfolio value is excluded from fees.

The configured maximum remains **1,000 bps (10%)**. For 10 USDC, expected total system execution costs must be **at most 1 nominal USDC**, including both payers. Exact rational cross-products decide eligibility; rounding is only for conservative display. Tests accept exactly 10% and reject any amount above it.

Conversion uses the disclosed demonstration convention **1 test USDC = 1 nominal USD quote unit**, without a claim of dollar backing or production viability. Price acquisition and fee-estimation work remain WealthPixels operating expenses, outside these six execution-cost components.

The quote binds investment amount, 50/50 weights, quantities/rounding, all prices and approvals, all six costs, ratios/reserves, policies, planned role/asset destinations and expiry. It contains no executable transaction bytes, nonce or signing request. Purchase amounts **1, 5, 10, 20 and 100 USDC** are supported; an amount may fail the economic screen under costly conditions without becoming a protocol minimum.

Effective expiry is the earliest required deadline: requested/nominal quote window, price expiration, observation expiration and **sampled fee time + at most 60 seconds**. A nominal 30-minute window cannot extend stale inputs. Separate Investor quote approval and fresh payment-eligibility checks preserve the original quote; neither reprices nor extends it. Updated maximum reserves cannot exceed the original reservation without a new quote.

The cost module consumes explicitly supplied observations. It validates structure, identities, references, consistency, assumptions and age; it does not authenticate arbitrary caller-supplied data as an RPC proof. **No fresh real-network cost/funding observations were collected here. Task 03D-2 must supply verified public reads, simulation/estimates and role funding before live payment preparation.** Fixture records marked `live` exercise these validation branches with injected data; they are not real network observations.

## Prepayment journal and boundaries

The fixed ignored file is `.local/transfers/purchase-journal.json`, with one cooperating workspace-wide lock. It supports:

`quoted → approved → payment-authorized`

Clearly unpaid `quoted`/`approved` records can explicitly transition to archived `expired-unpaid`. A quote is never overwritten or silently refreshed; historical purchase IDs cannot be reused. The journal validates against the system clock as well as recorded timestamps and checks again before persistence, preventing backdated approval of expired quotes.

Treasury reserves equal the quoted native value, both Treasury EVM maximum fee reserves and the operating reserve (default 0.001 ETH), plus the exact LINK quantity. Fresh eligibility additionally checks Investor USDC and ETH gas funds and both distinct NEAR accounts' spendable signing-fee balances. Missing, stale, conflicting or insufficient observations reject the action without modifying the saved journal.

`payment-authorized` is an eligibility record with **`executionAuthorized: false`**. It grants no signing/broadcast capability. Its reservation **does not automatically expire or release**: Task 03D-2 must first reconcile any subsequent signed/submitted payment. The current schema intentionally rejects forged `paid`/settlement states or nonempty payment claims. Atomic payment claiming, finality and settlement transitions remain future work.

Reservations protect cooperating local processes; they do not prevent unrelated Treasury spending. Fresh onchain checks remain necessary. Journal persistence uses the existing fsynced-file/rename pattern; an interrupted temporary write fails closed and requires review rather than automatic deletion/reset.

## Fixed offline 10-USDC example

Run `npm run quote:example`. It uses synthetic assumptions: ETH/USD **2500/1**, LINK/USD **10/1**, NEAR/USD **1/1**. These are neither current market observations nor approved live prices. The example has `priceApproval: null`, `pricingMode: offline-fixture` and no execution permission.

| Item | Offline example |
| --- | --- |
| Investment / allocation | 10 USDC; 50% ETH, 50% LINK |
| Asset quantities | 0.002 ETH (`2000000000000000` wei); 0.5 LINK (`500000000000000000` base units) |
| Expected USDC-payment EVM fee | 0.165 nominal USDC |
| Expected LINK-delivery EVM fee | 0.198 nominal USDC |
| Expected ETH-delivery EVM fee | 0.0693 nominal USDC |
| Expected NEAR costs | Three × (0.00108 NEAR + 1 yoctoNEAR), at the fixture's nominal rate |
| Expected total, rounded up to USDC precision | **0.435541 USDC** |
| Expected ratio, rounded up | **436 bps (4.36%)**; passes fixture economics |
| Separate maximum fee reserves, rounded up | 1.995301 nominal USDC; these are not expected fees |
| Requested / effective expiry | 03:30 / **03:01 UTC**, from creation at 2026-11-06 03:00 UTC |
| Actual costs | Unavailable; no transactions executed |

Deterministic example quote hash: `0x25ab6e34437caf3c706999310286cb6ff5e51c80bc4a6de4ba74a82222245c09`. It is not an approved live quote or a signing digest. Original fixture references and all six exact fee components are printed by the command.

## Validation and next checkpoint

Final result: **253/253 offline tests passed**, including all 211 existing tests and 42 new tests. TypeScript checks and the example command passed. Git whitespace checks passed. Journal tests use isolated temporary project roots, injected observations/simulated approvals and a fixed clock; no real project purchase journal was created.

Exact final Windows commands:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:offline')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','quote:example')
```

Cross-platform equivalents are `npm test`, `npm run typecheck` and `npm run quote:example`. Focused pricing/quote and journal suites were also run with the existing Node/tsx test runner. Runtime remains Node 22.23.4 and near-api-js 7.4.0; dependencies were unchanged. No legacy mainnet-fork test or secret RPC configuration was needed.

**Task 03D-2 still requires separate approval:** verified fresh cost/funding collectors; live CLI/state dispatch; payment preparation, finality and atomic claiming; serialized Treasury deliveries; durable paid/partial obligations; hash-bound signing/broadcast approvals; exact-byte expiry/uncertainty recovery; late/unmatched payment handling; and eventual actual-cost/evidence export. Existing transaction safeguards remain mandatory.

The **November 12 live-demo target remains feasible**, with Task 03D-2 integration and recovery as the critical path, followed by evidence and approved live execution. The 60-second fee/quote window creates a real operational timing constraint for separate human approvals; Task 03D-2 must address sequencing and uncertain outcomes without extending timestamps or repricing accepted payment. Network availability, funding and operator timing can affect the target. No market-data collector build or paid API setup is needed for the agreed demonstration baseline.

**Stopped at Task 03D-1.** No private credentials, faucet/funding actions, live purchase preparation, NEAR MPC requests, Ethereum broadcasts, new accounts, deployments or Task 03D-2 execution occurred.
