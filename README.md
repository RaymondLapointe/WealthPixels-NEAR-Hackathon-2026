# WealthPixels — NEAR Chain Signatures prototype

WealthPixels has demonstrated treasury-owned test LINK delivered to an investor EVM address, followed by an investor-authorized return transfer. Each address is derived from a different NEAR testnet account.

**Current status, November 10, 2026:** both live LINK transfers remain confirmed: Treasury delivered exactly 1 LINK, and Investor independently authorized a 0.1 LINK return through its separate NEAR account. The completed [public two-leg evidence](evidence/sepolia-link.json) contains both NEAR and Sepolia transaction hashes. Treasury also delivered exactly **0.000001 native ETH** through its NEAR authority; [public native smoke evidence](evidence/native-eth-smoke.json) records the successful receipt, exact balance movements and costs. The portfolio purchase coordinator and evidence verifier are tested offline; no live portfolio purchase has executed. The [readiness corrections](docs/Portfolio_Purchase_Readiness_Corrections_20261110.md) implement the USDC-only gas ceiling, guarded unpaid expiry and complete NEAR upfront funding reserves. An approved demonstration price set, fresh readiness checks and separate live approvals remain prerequisites. The earlier [readiness snapshot](docs/Native_ETH_Milestone_and_Portfolio_Readiness_20261110.md) remains preserved as historical evidence.

The hackathon demonstrator may control both disposable testnet roles on one computer. Separate accounts and authorizations demonstrate protocol behavior, **not independent production custody**.

## Portfolio purchase development: Task 03B

The next live demonstration targets **10 test USDC**, with an illustrative 50% native ETH / 50% LINK allocation from Treasury principal inventory. The amount is configurable; 10 USDC is a demonstration target, with no production minimum implied. The earlier 100-USDC planning example is superseded. The completed live evidence above proves the two LINK transfers; a portfolio purchase has not yet executed.

Task 03B introduced exact six-decimal USDC parsing, immutable allocation terms, Investor-to-Treasury USDC intents, quote-sized Treasury-to-Investor LINK intents, and fee accounting. Task 03D-2 now connects these to the purchase operator CLI, durable atomic payment claims and sequential settlement. `npm test` includes 1, 5, 10, 20 and 100 USDC cases. The purchase lifecycle has been demonstrated with labelled offline fixtures; no live portfolio purchase has executed.

Before payment authorization, total expected system execution costs must be at most `MAX_EXPECTED_FEE_BPS = 1000` (10%) of the investment. This includes all three EVM transactions and all three NEAR MPC signing operations, regardless of payer. Calculations use exact rational USDC equivalents, at least 20% gas buffers, documented conversion inputs and separate expected-fee assumptions and maximum reserves. Missing, expired or unverified inputs fail closed; offline price fixtures cannot authorize payment. Fee-estimation work is a WealthPixels operating expense. The 10% testnet policy makes no claim about production economic viability.

Task 03D-1 binds approved demonstration prices and all six expected costs into an immutable quote. Task 03D-2 adds public cost/funding collectors, role-specific execution, finalized payment claiming, durable settlement obligations, bounded recovery and actual fee accounting. After accepted payment, fee increases and quote expiration leave delivery obligations outstanding. Task 03E adds separate public purchase evidence export and independent verification; no live portfolio purchase is claimed.

Official Sepolia USDC is [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://developers.circle.com/stablecoins/usdc-contract-addresses), with six decimals. The November 10 read-only snapshot found **20 test USDC at Investor**, sufficient for the 10-USDC payment without another faucet request. The implementation uses a direct Investor transfer, requiring no spender allowance. Fresh token, funding, pricing and fee-eligibility checks remain mandatory before live preparation.

See the [Task 03B implementation report](docs/Task03B_ERC20_Intents_and_Fee_Eligibility.md) for its accepted baseline, and the Task 03D-2 section below for the implemented purchase workflow and remaining live approvals.

## Native ETH support: Task 03C

Native ETH modules now construct exact EIP-1559 value transfers with empty calldata, bind the quantity to allocation terms, check confirmed/pending nonce and Treasury value-plus-maximum-fee funds, and retain a positive operating reserve (default 0.001 ETH). Fresh estimates must retain at least the 20% gas buffer within protective limits. Signature verification recovers the full trusted MPC-derived Treasury public key. Separate unsigned-digest signing approval and signed-hash broadcast approval, durable attempt markers, exclusive state locks, the unchanged 15-minute preparation window and public reconciliation preserve the execution boundaries.

Offline receipt tests reconstruct exact signed bytes, check canonical receipt/parent blocks and at least two confirmations, account for actual gas and verify delivered ETH as an increase over the Investor's existing balance. Unexpected balance activity requires reconciliation. Synthetic fixture tests remain distinct from the separately completed [live native smoke test](evidence/native-eth-smoke.json). The Task 03D-2 purchase CLI exposes native delivery within the paid-purchase sequence; a live portfolio purchase remains pending.

Task 03C verified ETH/USD and LINK/USD Sepolia feed addresses, eight decimals and one-hour heartbeats against Chainlink's official directory. A timestamped CoinGecko NEAR/USD HTTPS source remains a candidate with access/rate-limit caveats. This research is preserved in [Task 03C results](docs/Task03C_Native_ETH_and_Pricing_Readiness.md). The Task 03D-1 amendment makes approved demonstration prices the hackathon baseline; live price collectors remain future integrations.

## Purchase quotation and prepayment: Task 03D-1

The provider-independent quote engine accepts exact ETH/USD, LINK/USD and NEAR/USD rational observations. Demonstration prices require an explicit approval bound to their proposal digest, one purchase ID, public source/original-observation references and at most five minutes of validity. Historical observations are labelled as demonstration assumptions. There are no trusted current-market defaults or automatic fallbacks.

Each quote freezes the configurable USDC amount, 50/50 allocation, individual asset quantities, prices/provenance/approval, all three EVM plus three NEAR costs, fee ratios, reserves, protective policies and planned role/asset destinations. Total expected system fees must be at most 1,000 bps (10%). Missing/stale costs fail closed. Effective quote expiry is bounded by every required price and cost expiry, including the 60-second fee-observation limit; a nominal 30-minute request cannot extend it.

One locked ignored journal at `.local/transfers/purchase-journal.json` retains the active quote, inventory reservation, separate Investor quote approval and fresh payment-eligibility record. Treasury ETH reserves include delivery value, both delivery fee ceilings and the operating reserve; LINK is separately reserved. Payment eligibility checks Investor USDC/ETH and both NEAR authorities' spendable fee balances. A `payment-authorized` record is an eligibility checkpoint with `executionAuthorized: false`; it cannot sign or send. Its reservation remains held after expiry until Task 03D-2 reconciles any later payment activity. Clearly unpaid, unauthorized quotes can be explicitly expired without repricing or changing the original quote.

The USDC payment alone allows a maximum buffered gas limit of 200,000; LINK/native delivery ceilings remain 180,000. Actual gas limits use fresh estimates plus at least 20%, and the 30-gwei/0.0036-ETH fee ceilings still apply independently. Complete NEAR protocol-88 receipt purchase funding is reserved for one Investor and two Treasury MPC calls, separately from expected execution burn and anticipated refunds. Unsupported or missing pricing inputs fail closed.

To release an expired quoted/approved reservation with no payment authorization or execution, use the local-only guarded command after operator review:

~~~text
npm run purchase -- expire-unpaid --quote-hash REVIEWED_EXPIRED_QUOTE_HASH --approve REVIEWED_EXPIRED_QUOTE_HASH
npm run test:purchase-corrections
~~~

The expiry command rejects payment-authorized or any execution-bearing state, including uncertain, paid and partially delivered purchases. It never signs, calls RPC or edits the original quote. Offline tests use temporary synthetic journals, not real purchases.

Run the fixed, credential-free example:

~~~text
npm run quote:example
~~~

It prints a synthetic 10-USDC quote and all six fee components. It performs no RPC calls or journal writes, contains no real price/Investor approval, and proves no live purchase. Tests also exercise prepayment branches with labelled injected observations and simulated approval references. The journal and calculations are implemented; live purchase preparation, signing, broadcasting, payment finality and settlement remain outside this increment. See the [Task 03D-1 report](docs/Task03D1_Quotation_and_Prepayment.md).

## Purchase execution and recovery: Task 03D-2

The implemented sequence is Investor USDC payment, canonical **finalized** payment verification and atomic claim, Treasury LINK delivery, then Treasury native ETH delivery with a fresh nonce. Each leg requires separate exact-digest MPC signing approval and exact-signed-hash broadcast approval. The production driver reuses the existing signers, trusted full derived public keys, EIP-1559 builders and one-attempt transports. No completed live purchase is claimed.

One ignored journal holds one active purchase, its immutable quote and inventory reservation, per-leg attempts, original bytes/timestamps, public NEAR outcomes, receipt observations, actual fees and outstanding obligations. Payment identity is `chainId:transactionHash:TransferLogIndex`; its unique claim and finalized paid state commit together under the workspace lock. This local quote/payment association is not trustless onchain enforcement.

New payment preparation and the first MPC authorization require an unexpired quote and fresh complete economic eligibility. At that authorization, the exact payment digest and original approved price assumptions are durably bound. The three transactions do **not** have to finish within 60 seconds: an already-authorized payment is screened again against fresh six-cost observations before broadcasting, using the unchanged accepted demonstration rates. These become historical order assumptions, not refreshed market observations. Unresolved signed/submitted payments keep reservations held. After finalized payment, expiry or higher fees cannot cancel delivery obligations.

Normal transaction preparations retain the 15-minute limit. Only an existing signed purchase leg can use recovery, with its exact signed hash, original payment-authorization hash and explicit original-expired-timestamp acknowledgment. Broadcasting creates its own preserved audit within **30 seconds**, additionally bounded by any earlier observation expiry, and persists the attempt before its sole send. Timeout or expiry after the marker leaves an uncertain attempt requiring read-only reconciliation; it does not permit another send. No force flag, automatic resend, replacement or refund exists. Confirmed LINK is freshly checked before ETH delivery/completion; partial settlement resumes only the missing obligation.

Credential-free evaluation:

~~~text
npm run purchase:dry-run
npm run purchase -- --help
~~~

The dry-run creates an isolated temporary journal and uses labelled mock network/signing/broadcast ports. It prints the three intended legs and `settling`, `partially-delivered`, `completed` ledger states. Its mock payloads are not executable Ethereum transactions; it provides no live purchase evidence.

Public account/contract inspection, with no transfer simulation or transaction preparation:

~~~text
npm run purchase -- inspect-networks --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
~~~

The November 6 public snapshot found Investor **20 USDC**, Treasury **24.1 LINK**, Investor **0.9 LINK**, about **0.05 ETH** at each role, and confirmed/pending nonce **1** for both. These are timestamped observations, not continuing readiness approval. The live collector additionally supports all three gas simulations, fee assumptions and storage-reserved NEAR funding; those are required afresh for a separately approved live quote. USDC proxy implementation approval is explicit rather than silently inferred from the RPC that observes it.

Read the [Task 03D-2 report and operator sequence](docs/Task03D2_Purchase_Execution_and_Recovery.md). Task 03E public evidence is described below. All live purchase operations remain separately approved checkpoints. Existing published LINK evidence is unchanged.

## Public portfolio purchase evidence: Task 03E

WealthPixels' purchase proposition is a small USDC payment followed by delivery of individual native ETH and LINK assets from Treasury principal inventory directly to the Investor's NEAR-controlled Ethereum address. The Investor receives no pooled portfolio token. Pricing comes through the replaceable `PriceProvider` interface; the hackathon uses explicitly approved demonstration assumptions, not production real-time market data. The demonstrator may operate both accounts, and the three transactions settle sequentially rather than atomically.

The new public manifest contains the immutable approved quote/prices, six expected costs, separate public authorities and signing hashes, three Ethereum hashes/parameters/receipt references, asset movements, actual execution costs and final settlement. It excludes credentials, executable transaction bytes, local file paths, raw runtime state and the operator's journal. The complete live purchase manifest does not exist yet; [the pending placeholder](evidence/portfolio-purchase.pending.json) makes that explicit.

Current credential-free commands:

~~~text
npm test
npm run typecheck
npm run purchase:dry-run
npm run test:purchase-evidence
npm run verify:purchase -- --manifest evidence/portfolio-purchase.pending.json
~~~

The final command currently reports **incomplete / PENDING**, makes no network requests and exits **2**; it is not a passing purchase proof. Tests and the dry-run use explicitly labelled fixtures and do not execute a live purchase. Once a real completed manifest has been exported and published after approval, reviewers can place it in `evidence/portfolio-purchase.json` and run:

~~~text
npm run verify:purchase -- --manifest evidence/portfolio-purchase.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io --beacon-rpc https://ethereum-sepolia-beacon-api.publicnode.com
~~~

Use `--expected-quote-hash` to pin a separately preserved approved quote hash. Optional `--report evidence/NEW_REPORT.json` preserves success, failure or partial checks without overwriting prior evidence. Exit **0** means every implemented public check passed, **2** means incomplete/unavailable history, and **1** means contradictory/invalid evidence. No signing identity, funding or operator journal is required. `npm run purchase:export-evidence -- --help` describes the separate operator-only extraction of public fields after completion.

Verification reconstructs exact signed bytes from public transactions, matches all three direct NEAR MPC signatures against the full trusted derived keys, and checks official token contracts, USDC six-decimal payment, LINK events, native value/gas, canonical historical balances, finality, order, nonces and actual fees. Historical finalized payment **before** LINK release is checked through Ethereum consensus state anchored by the LINK execution block's parent Beacon root. Beacon REST access is another interface to Ethereum, not another blockchain integration. Missing archive data produces incomplete verification; cached fixtures and today's finalized tag cannot replace it.

Historical `eth_call`, `eth_getBalance`, code/nonces, logs, receipts and exact-state Beacon checkpoint/block/envelope history require archive-capable public services. A November 7 probe passed for recent consensus history but failed for an approximately two-day-old state on the default provider; two documented alternatives also failed. Durable judge reproducibility remains conditional on resolving that retention dependency. Requests are paced and bounded; endpoints are configurable and no paid account is required by the software. Public RPC access queries public state; it grants no asset authority. NEAR account signing authority authorizes an MPC request. An RPC provider can relay already-signed bytes but cannot independently authorize the transfer.

Verification trusts configured RPC responses; it is not a light client or a BLS/SSZ state-proof verifier. Operator approvals, quote association and original gas estimates remain disclosed local assertions. It does not prove independent production custody, global uniqueness across other journals or trustless/atomic settlement. See [purchase evidence format and limits](evidence/README.md) and the [Task 03E completion report](docs/Task03E_Public_Purchase_Evidence_and_Verification.md).

WealthPixels follows a Buy and Build approach: integrate established blockchain infrastructure rather than operate its own RPC nodes without a compelling need. Public services serve the hackathon; production may add commercial providers, redundancy and service-level protections. Provider changes do not change the portfolio protocol or verification rules. The existing two-way LINK evidence remains a separate completed live demonstration.

## Standalone ETH test readiness: Task 03F-A

An operator entry point now supports a separately approved small Treasury-to-Investor native ETH test, without a USDC quote or fabricated portfolio payment. Its own exact-wei intent and ignored state bind the public authorities, policy, amount and transaction hashes. It reuses the existing native builders, full MPC-key verification, canonical receipt/balance accounting and one-attempt signing/broadcast transports.

~~~text
npm run native:test -- --help
npm run native:test:dry-run
npm run test:native-standalone
~~~

The native example is **offline preparation only**, using synthetic observations with no state writes, credentials, signing or broadcast. The separately authorized live native smoke test is now [confirmed](evidence/native-eth-smoke.json). Further live actions require their own approvals. Standalone prepare/sign/broadcast commands refuse active purchase reservations or obligations; they never change the purchase journal. Inspection/reconciliation remain available. State and new audit files belong in ignored `.local/transfers/native-tests/`.

The normal 15-minute preparation rule remains. Expired signed recovery requires the exact intent, original timestamp acknowledgment and signed-hash approval, plus a new preserved audit within 30 seconds and fresh public checks. It cannot re-sign, replace, alter fees or resend an uncertain attempt. An immutable submission deadline now reaches the MPC adapter's final check immediately before `send_tx`, so slow authority reads cannot extend either native preparation or purchase fee eligibility.

The bounded archive review examined two new providers' official documentation and found no qualified public Sepolia Beacon archive route; **zero new probes** were made and the earlier failed requests were not repeated. The historical dependency remains unresolved. A live purchase can be verified promptly while required recent history remains available, with no guarantee of later independent retrieval. Missing history always remains incomplete; an earlier report or cached response does not replace a new verification.

The [Task 03F-A report](docs/Task03FA_Native_Test_and_Live_Readiness.md) and [future operator runbook](docs/Task03FA_Live_Operator_Runbook.md) give the exact command/approval sequence, including the unchanged 60-second first-payment window. No live native test or portfolio purchase was prepared or executed in this increment.

## External Pricing Integration and Future Production Readiness

WealthPixels intentionally treats asset pricing as a replaceable external service. The proof of concept uses explicitly approved demonstration pricing to isolate and prove portfolio allocation, economic screening and delivery of individually owned assets. Demonstration assumptions are preserved as such; they are not production market pricing.

The `PriceProvider` interface separates price acquisition from allocation calculation, fee eligibility and transaction execution. Offline tests use interchangeable providers without changing that arithmetic or delivery code. Chainlink, CoinGecko, institutional data services and other future providers can be integrated at this boundary. The future provider choice is deliberately left open; no paid API or additional blockchain pricing infrastructure is introduced.

Before production deployment, WealthPixels intends to select a suitable third-party provider and implement the required freshness, availability, integrity, failure-handling and market-risk controls. The hackathon's demonstration pricing and Sepolia fee ratios do not establish production economic viability.

## Quick start for judges

Use Node **22.23.4** (pinned in .node-version), or another supported Node 22 patch >=22.22.2, and npm. These commands work on Windows, macOS and Linux:

~~~text
npm ci
npm test
npm run typecheck
~~~

Dependency installation needs internet or a populated npm cache. The tests themselves need no RPC, credentials, account creation, blockchain funding or Windows-specific setup. PowerShell and the development-only Windows Node launcher are optional.

The isolated [Experiment B MPC diagnostic](docs/ExperimentB_Implementation_Report.md) has credential-free tests (`npm run test:experiment-b`) and offline help (`npm run near:mpc-diagnostic -- --help`). Its [operator runbook](docs/ExperimentB_Operator_Runbook.md) requires separate approvals for public preparation and one digest-and-NEAR-hash-bound submission, plus an explicit MPC fee budget. This helper constructs no Ethereum transaction; its synthetic tests do not establish live MPC success.

## Three evaluation modes

| Mode | Command / status | Credentials or funding |
| --- | --- | --- |
| Offline automated tests | npm test or npm run test:offline | None |
| Public transaction verification | npm run verify:evidence | None; public RPC access |
| Optional live reproduction | Separately approved operator workflow | Two disposable NEAR testnet identities and test funds |

### 1. Offline tests

~~~text
npm test
npm run typecheck
~~~

Tests use fixed, explicitly labelled public fixtures and injected RPC responses. They check public derivation, role/configuration binding, unsigned EIP-1559 preparation, preflight guards, signature normalization/recovery, and public-evidence validation. Fixture tests are not live blockchain execution or proof of asset delivery.

The original derivation/transfer tests remain available as npm run test:near. Public evidence tests do not make RPC requests.

### 2. Read-only verification of published transactions

~~~text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
~~~

The command reads evidence/sepolia-link.json. It never loads a credential file or .env, requests a signature, creates an account or broadcasts a transaction.

The published manifest is complete and contains real transaction hashes. Exit 0 means both live proofs passed verification; exit 1 means invalid evidence, failed verification or unavailable RPC data. A manifest marked PENDING makes no RPC requests and exits 2.

Verification checks both the treasury-to-investor transfer and investor return using public NEAR/Sepolia RPCs. It binds the NEAR signer, direct MPC request digest and returned signature to the recorded EVM transaction, then checks the successful receipt, exact LINK transfer calldata/event and published amounts. It verifies the recorded role derivations; it does not assert that different humans control the two accounts.

Public endpoints can be overridden without private credentials:

~~~text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
~~~

Public archival services can be rate limited or unavailable. A network failure is reported as an inability to verify, not silently treated as success. Verification trusts the queried RPC providers; it is not a light-client proof or an exact historical balance audit.

See [evidence format and verification limits](evidence/README.md). Public MPC inspection remains available with npm run near:inspect; npm run near:derive additionally needs the two public account IDs, but no private credentials.

### 3. Optional live reproduction

Judges do not need to run this mode. The operator CLI completed both live transfers, and its offline execution tests use mocks. Any further funding, live MPC signing or EVM broadcasting requires separate approval.

The recommended setup is **one laptop, one Windows user, two disposable NEAR accounts, two separate credential files, and a fresh explicitly selected process for each role**. Each signing invocation must select one `--role` and one explicit `--credential` path. It cannot load a directory or both role files. The current live adapter pins the reviewed WealthPixels public identities; using different identities requires a separately reviewed public configuration change.

~~~text
npm run transfer -- --help
~~~

Read the [Task 02B-2A implementation report and execution runbook](docs/Task02B2A_Live_Transfer_Implementation.md) for preparation, exact fee caps, funding destinations, separate signing/broadcast approvals and recovery. Help and offline tests never load credentials.

The [Treasury recovery report](docs/Task02B2B_Phase3F_Controlled_Broadcast_Recovery.md) and [Investor recovery report](docs/Task02B2B_Phase3H_Investor_Recovery_Readiness.md) describe `recovery-audit` and `broadcast-recovered`. Recovery is restricted to those two exact recorded transactions and requires the signed hash, acknowledgment of the original expired timestamp and a new durable audit. Both transactions are now confirmed; their saved state and attempt markers block another broadcast. Inspection audits cannot authorize a later send, and the normal preparation-age rule remains enforced.

Existing operator credential locations (plaintext private keys; keep the protected store outside the repository):

~~~text
%LOCALAPPDATA%\WealthPixels\testnet-credentials\treasury.json
%LOCALAPPDATA%\WealthPixels\testnet-credentials\investor.json
~~~

A same-user process could technically read both files. This is operator-controlled demo separation, not an operating-system or production custody boundary. Separate OS users/devices remain an optional enhancement.

Treasury transactions must originate from the treasury NEAR authority; investor returns must originate from the investor NEAR authority. One shared signer must never impersonate the other role. Actual key creation, account registration, funding and every live signing/broadcast step require explicit approval.

See the [revised Task 02B runbook](docs/Task02B1_Account_Setup_and_Derivation.md) and [one-laptop operator guide](docs/Task02B1_Windows_Operator_Instructions.md).

## Existing Solidity application

The pre-existing contracts implement a contract-custodied USDC-to-WETH/WBTC purchase. They are reference code, not the NEAR-controlled LINK transfer milestone. No Solidity source or original test has been rewritten.

Optional compilation:

~~~text
npm run compile
~~~

The legacy mainnet-fork test is separate from judging defaults:

~~~text
npm run test:legacy -- --network hardhat
~~~

It requires a privately configured MAINNET_RPC_URL and simulates deployments/transactions locally using impersonation. It is not a live-mainnet operation, a NEAR test or a credential-free offline test.

## Reproducibility and source history

- SDK: exact-pinned near-api-js 7.4.0; Ethers 6.16.0; Hardhat 3.1.0.
- Pre-NEAR baseline: 8e38b987d7dd3a373a1bb1f003bb575d12b0ec8b.
- Task 02A checkpoint: e332575412e167fa47090f62d3428fcc1a1b6e06.
- Runtime/dependencies/generated files and local secrets are excluded from Git.
- Account availability in prior reports is a timestamped observation, not a reservation or proof of ownership.
- Public reuse/submission of the pre-existing code still needs the owner's authorization and accurate disclosure.

Windows developers may retain scripts/with-node22.ps1 as a convenience. An open editor can lock native Hardhat libraries and block npm ci; close the relevant project/editor before a clean reinstall rather than requiring judges to use that launcher.
