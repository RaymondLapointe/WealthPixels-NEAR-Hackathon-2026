# WealthPixels — Development Reference

This reference preserves implementation context and future product directions moved from
the README during its November 12, 2026 consolidation. It complements the historical task
reports and current operator procedures; it does not authorize live operations.

## Current policies and historical reports

The [Operator Story](WealthPixels_Guided_Purchase_Operator_Story.md) and
[current operator runbook](Task03FA_Live_Operator_Runbook.md) document the November 11
version-2 timing correction. New quotes fix purchase acceptance at the earliest original
approved-price expiry or any shorter requested/nominal deadline. Execution observations
independently retain a maximum 60-second freshness window and are refreshed at the
preparation, signing and broadcast checks. Refreshing costs changes neither the accepted
portfolio terms nor the purchase deadline. Version-1 historical deadlines and hashes remain intact.

After timely payment authorization and first MPC submission, signing reconciliation and
separately approved broadcast of that payment can continue under the unchanged accepted demonstration rates and fresh cost
checks. All three settlements need not complete within 60 seconds. Finalized payment creates
delivery obligations that persist through quote expiry and fee increases.

The original Task 03D-1, Task 03D-2 and Task 03F-A reports describe their historical timing
baseline. Read them as development records alongside the current procedures above.

## External pricing integration and future production readiness

WealthPixels intentionally treats asset pricing as a replaceable external service. The proof
of concept uses explicitly approved demonstration pricing to isolate and prove portfolio
allocation, economic screening and delivery of individually owned assets. Demonstration
assumptions are preserved as such; they are not production market pricing.

The `PriceProvider` interface separates price acquisition from allocation calculation, fee
eligibility and transaction execution. Offline tests use interchangeable providers without
changing that arithmetic or delivery code. Chainlink, CoinGecko, institutional data services
and other future providers can be integrated at this boundary. The future provider choice
is deliberately left open; no paid API or additional blockchain pricing infrastructure is
introduced.

Before production deployment, WealthPixels intends to select a suitable third-party provider
and implement the required freshness, availability, integrity, failure-handling and market-risk
controls. The hackathon's demonstration pricing and Sepolia fee ratios do not establish
production economic viability. See [Task 03C pricing research](Task03C_Native_ETH_and_Pricing_Readiness.md)
and [Task 03D-1's provider interface](Task03D1_Quotation_and_Prepayment.md#pricing-policy).

### Post-hackathon product direction — not implemented

**Firm Investor Portfolio Quotes:** WealthPixels intends to explore a firm review period,
potentially five to ten minutes beginning when the completed quote is presented, as
portfolios expand to 10, 20, 30, 50 or more assets. Principal inventory can support that
commercial approach subject to inventory commitment and market-risk policies.

**WealthPixels Portfolio Purchase Fee:** a future percentage-based purchase fee could let
WealthPixels absorb ordinary blockchain execution-cost fluctuations within its operating
economics. Fee levels, minimum economic purchase sizes, network costs, inventory economics
and exceptional congestion require separate decisions.

These directions introduce no hackathon platform fee, commission or spread, no new pricing
provider or market-risk model, and no ten-minute price window. Approved demonstration prices
remain valid for at most five minutes; the unchanged 10% execution-cost eligibility safeguard
is not an Investor fee. The investment amount is configurable; the demonstrated 10 USDC
does not imply a production minimum.

## Public infrastructure and verification

WealthPixels follows a Buy and Build approach: integrate established blockchain infrastructure
rather than operate its own RPC nodes without a compelling need. Public services serve the
hackathon; production may add commercial providers, redundancy and service-level protections.
Provider changes do not change the portfolio protocol or verification rules.

Public RPC access queries public state and grants no asset authority. NEAR signing authority
authorizes an MPC request; an RPC provider can relay already-signed bytes but cannot
independently authorize the transfer. Public verification does not require a paid account.

Historical Ethereum calls, balances, code/nonces, logs, receipts and exact-state Beacon
checkpoint/block/envelope history require compatible archival services. The completed purchase
passed historical finality verification on November 11, but later independent reproduction
depends on providers retaining the required history. The earlier failed archive investigations
remain historical findings; they do not contradict the later successful purchase check.

The [public evidence guide](../evidence/README.md) preserves verifier schemas, endpoint/pacing
options, return codes and RPC trust limitations, including the absence of BLS consensus and
BeaconState/body Merkle-proof verification. A current finalized head, cached report or fixture
cannot substitute for missing historical evidence.

## Legacy Solidity tooling and Windows setup

The original contract-custodied USDC-to-WETH/WBTC application remains reference code, separate
from the demonstrated NEAR-authorized ETH/LINK purchase. Optional compilation:

```bash
npm run compile
```

Its original mainnet-fork test is separate from the credential-free judging defaults:

```bash
npm run test:legacy -- --network hardhat
```

That test requires a privately configured `MAINNET_RPC_URL` and simulates deployments and
transactions locally using impersonation. It is neither a live-mainnet operation nor a NEAR
test. The [original-code assessment](WealthPixels_NEAR_Codebase_Assessment_and_Codex_Kickoff.md)
and [Task 01 baseline](Task01_Development_Baseline_2026-11-01.md) preserve the legacy behavior,
review findings and historical test limitations.

Windows developers may use [the Node launcher](../scripts/with-node22.ps1) as a convenience.
An open editor can lock native Hardhat libraries and block `npm ci`; close the relevant
project/editor before a clean reinstall. Judges do not need that launcher.
[Task 02A verification](Task02A_Verification_and_Task02B_Plan.md) records the setup context.

## Technical detail preserved in supporting documentation

| Material consolidated from the README | Supporting documentation |
| --- | --- |
| Exact six-decimal USDC parsing, immutable allocation, complete six-cost assessment and gas buffers | [Task 03B](Task03B_ERC20_Intents_and_Fee_Eligibility.md), [Task 03D-1](Task03D1_Quotation_and_Prepayment.md) |
| Native empty-calldata transfers, full MPC-key checks, reserves, confirmations and balance accounting | [Task 03C](Task03C_Native_ETH_and_Pricing_Readiness.md), [Task 03F-A](Task03FA_Native_Test_and_Live_Readiness.md) |
| USDC 200,000-gas ceiling versus 180,000 for deliveries, complete NEAR funding and guarded unpaid expiry | [November 10 readiness corrections](Portfolio_Purchase_Readiness_Corrections_20261110.md) |
| Atomic local payment claim, persistent obligations, 15-minute preparation, 30-second broadcast audits and bounded recovery | [Task 03D-2](Task03D2_Purchase_Execution_and_Recovery.md), [current Operator Story](WealthPixels_Guided_Purchase_Operator_Story.md) |
| Standalone native workflow, purchase-reservation exclusion and final submission deadline | [Task 03F-A](Task03FA_Native_Test_and_Live_Readiness.md), [current runbook](Task03FA_Live_Operator_Runbook.md) |
| Separate Treasury/Investor authorities, per-role invocation and earlier LINK recovery restrictions | [Task 02B-1](Task02B1_Account_Setup_and_Derivation.md), [Task 02B-2A](Task02B2A_Live_Transfer_Implementation.md), [Treasury recovery](Task02B2B_Phase3F_Controlled_Broadcast_Recovery.md), [Investor recovery](Task02B2B_Phase3H_Investor_Recovery_Readiness.md) |
| Public derivation, original transfer tests and credential-free inspection | [Task 02A](Task02A_NEAR_Integration_Preparation.md), [Task 02A verification](Task02A_Verification_and_Task02B_Plan.md) |
| Full public transaction checks, historical balances/finality, export boundaries and retained-data limitations | [Public evidence guide](../evidence/README.md), [Task 03E](Task03E_Public_Purchase_Evidence_and_Verification.md) |
| Timestamped balances, nonces and the standalone native milestone | [November 10 milestone](Native_ETH_Milestone_and_Portfolio_Readiness_20261110.md), [public readiness snapshot](Task03D2_Public_Readiness_Observation.json) |
| Earlier LINK/native transfers and isolated ordinary-NEAR/MPC diagnostics | [Public evidence guide](../evidence/README.md), [Experiment A runbook](ExperimentA_Operator_Runbook.md), [Experiment B runbook](ExperimentB_Operator_Runbook.md) |

Additional [signing observability](Task03FB1_Signing_Observability.md) and
[Experiment B closure](ExperimentB_Closure_and_Treasury_Restart_Readiness.md) retain the
diagnostic and restart history. They are distinct from the completed purchase and confer
no permission to repeat any transaction.
