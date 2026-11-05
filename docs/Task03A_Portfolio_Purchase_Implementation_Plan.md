# Task 03A — Portfolio purchase implementation plan

November 5, 2026. **Design and read-only readiness assessment only.** Recommendation: extend the existing TypeScript/Ethers/NEAR CLI into one quoted purchase with **three sequential EVM transfers**. No new deployed contract, frontend, bridge, framework, pooled fund, portfolio token or intents provider is needed.

**Proposed transaction sequence**

1. Approve an immutable quote and reserve Treasury inventory locally.
2. Investor `wealthpixels-investor.testnet` authorizes **100 USDC** from `0x07FE574EdB1B2f537F9be452312C15A5b9427820` to Treasury `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`. A direct ERC-20 transfer needs no spending allowance.
3. Verify the exact payment; observe confirmations, then wait until its canonical block is finalized before releasing inventory.
4. Treasury `wealthpixels-treasury.testnet` delivers the quoted **LINK**, confirms it, then freshly prepares and delivers the quoted **native ETH**. Query the Treasury nonce again between deliveries.
5. Verify all three NEAR authorizations, EVM receipts and asset movements against the quote; publish a separate purchase evidence manifest.

Treasury sells its own inventory and retains the USDC proceeds. Investor directly owns the delivered assets at its existing NEAR-controlled EVM address. This is **non-atomic settlement**: payment or one delivery can succeed before another leg fails. Separate signing credentials demonstrate distinct cryptographic authorization; the demonstrator may operate both roles.

**Verified testnet readiness and funding**

Read-only Sepolia snapshot: **2026-11-05 19:01:30 UTC**, block **12071420**, canonical hash recorded in [Task03A_ReadOnly_Readiness.json](Task03A_ReadOnly_Readiness.json).

| Role | USDC | LINK | Native ETH | Confirmed/pending nonce |
| --- | ---: | ---: | ---: | --- |
| Treasury | 0 | 24.1 | 0.04999999985630444 | 1 / 1 |
| Investor | 0 | 0.9 | 0.04999999995618284 | 1 / 1 |

Circle's official Ethereum Sepolia USDC is **`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`**. Live calls confirmed deployed code, symbol/name USDC, **6 decimals**, `paused=false`, and neither role blacklisted. **100 USDC = 100000000 base units**. The proxy code hash is recorded; execution preflight must recheck restrictions and implementation compatibility because the token is upgradeable. Test USDC has no monetary value or dollar backing. [Circle contract directory](https://developers.circle.com/stablecoins/usdc-contract-addresses), [contract design](https://github.com/circlefin/stablecoin-evm#fiattoken-features).

The funding shortfall is **100 test USDC to the Investor address above**. Circle's public faucet documents a typed recipient address, Ethereum Sepolia support, **20 USDC per two hours per address/blockchain**, no account/API key, and reCAPTCHA. From zero, five successful claims at approximately T+0/2/4/6/8 hours require **at least eight hours plus processing**. This is documented availability, not tested delivery; no faucet request was made. An already-funded disposable Sepolia wallet can alternatively transfer the shortfall after approval; Circle also documents requests for larger allocations, without a guaranteed turnaround. No new wallet or bridge is needed. [Circle faucet and FAQ](https://faucet.circle.com/).

Current ETH/LINK inventory covers the illustration below; no additional funding of those assets is recommended now. Both NEAR accounts have approximately **9.997 NEAR spendable after storage reserve**, verified at 19:06 UTC. At the observed gas price a 100-Tgas attachment represents approximately 0.01 NEAR plus transaction overhead/deposit; current balances comfortably cover one Investor and two Treasury requests.

The public Sepolia RPC supports the `finalized` block tag. Its checkpoint timestamp was about **19 minutes behind the check time** in the observed sample; allow a meaningful finality wait rather than treating two confirmations as finality.

**Reusable components and smallest additions**

| Existing component | Treatment |
| --- | --- |
| `src/near/signing.ts`, MPC derivation/identities | Reuse account/key checks, role isolation, digest signing, persisted NEAR hash, finalized result and full-public-key/sender recovery. |
| `src/evm/erc20-transfer.ts` | Reuse ERC-20 encoding, bigint arithmetic and EIP-1559 serialization. Add approved USDC metadata and quote-sized LINK intent validation. |
| `src/evm/broadcast.ts` | Reuse separate exact-hash approval and one-use transport. |
| `src/evm/sepolia-link.ts` | Extract asset-specific preflight/receipt patterns. The current module fixes Treasury 1 LINK / Investor 0.1 LINK; it is not already a USDC or portfolio executor. |
| Execution state/workflow | Reuse locking, durable writes, uncertainty and approval patterns through a small typed leg interface. The existing codec embeds LINK-only preflight. |
| Existing evidence verifier | Preserve the completed two-leg proof. Add a purchase schema/verifier; the current verifier requires exactly the old LINK amounts and directions. |
| New modules | Proposed `src/evm/native-transfer.ts`, `src/purchase/{quote,state,workflow}.ts`, a fixed asset registry/validation interface, purchase evidence verifier and `scripts/purchase.ts`. |
| Legacy Solidity, PriceProvider, mainnet-fork swap test | Leave unchanged and exclude from the purchase path. They target ERC-20 contract inventory/WETH-WBTC. PriceProvider configuration setters lack owner checks; its pricing/decimal logic should not become the new authority. |

Native ETH needs a type-2 transaction with **to=Investor, value=quoted wei, data=0x**. Reuse MPC signature normalization only after exact native transaction validation; the ERC-20 assembler hardcodes value zero and token calldata. Check code-free role addresses, fresh nonce, simulation/estimate, 20% gas buffer and **value + maximum fee + remaining delivery reserves**. Do not assume a fixed 21,000-gas limit.

Native receipt verification checks exact signed hash, sender, recipient, value, nonce, chain, gas/fees and canonical success. ETH has no ERC-20 Transfer event. Under quiet demo accounts, verify Investor ETH increase equals delivery value and Treasury decrease equals value plus actual fee. Unrelated activity makes exact balance attribution ambiguous and requires reconciliation, never another send.

**Quotation and inventory policy proposed for approval**

Use an operator-approved frozen quote, populated from **verified Sepolia ETH/USD and LINK/USD feed snapshots**. Read proxy `decimals()`, `description()` and `latestRoundData()`; record addresses, rounds, raw answers, update times and pinned block/hash. Require positive bounded prices, valid timestamps and per-feed maximum age derived from an approved heartbeat policy. A description alone does not establish provenance. [Chainlink API](https://docs.chain.link/data-feeds/api-reference), [official feed directory](https://docs.chain.link/data-feeds/price-feeds/addresses).

ETH/USD `0x694AA1769357215DE4FAC081bf1f309aDC325306` is confirmed by the official API documentation. Candidate LINK/USD `0xc59E3633BAAC79493d908e63626716e204A45EdF` responded onchain, but its authoritative directory entry and heartbeat were not independently confirmed. **That verification is a gate before automatic live quoting.** Both observed rounds were approximately 59 minutes old; freshness cannot be declared without the policy. If feed verification remains blocked, only a separately approved, clearly labelled fixed demonstration-price mode is acceptable; no silent fallback.

For this testnet illustration define **1 test USDC = 1 quote-dollar**, with no claim of real-dollar backing. Allocate 5000/10000 basis points to each asset. USDC uses 6 decimals; ETH/LINK use 18. Compute all amounts with bigint:

```text
assetUnits = floor(usdcBudgetBaseUnits × 10^assetDecimals × 10^feedDecimals
                   / (10^6 × rawAssetPrice))
```

Floor asset quantities; record the rational rounding remainder and its treatment in the approved quote. Do not use floating point. No spread is proposed for this first demo; Investor pays payment gas, Treasury pays delivery gas.

**Sizing illustration only:** observed reference values ETH 2248.53026749 and candidate LINK 10.64538160 yield **0.022236747587042373 ETH + 4.696872491635245842 LINK** for 50 quote-dollars each. These are not an approved quote or prepared transaction. Reserving both proposed 0.0036-ETH delivery-fee ceilings plus a proposed 0.001-ETH operating reserve requires **0.030436747587042373 ETH**, within current Treasury inventory; LINK also fits.

The 50/50 ratio applies to the **purchased allocation at quote prices**, not the entire Investor wallet, which already contains gas ETH and 0.9 LINK. Show purchased deltas separately.

Propose a **30-minute payment-inclusion quote deadline**, distinct from the unchanged **15-minute per-transaction preparation window**. A timely included payment keeps its frozen quantities and reservation while finality is pending, even after quote expiry. A paid order is never silently repriced or expired. Expired unpaid quotes can release inventory only when no signed/submitted payment remains unresolved. Late payments require explicit resolution.

**Minimal coordinator, replay and recovery**

Use one authoritative locked local purchase journal, one active purchase initially, and the existing per-leg transaction lifecycle beneath:

`quoted/reserved → payment-observed → paid → delivering → completed`

Additional states: `expired-unpaid`, `partially-delivered`, `attention-required`. Persist quote hash, immutable identities/root/domain/path, quantities, reservation, approved intents and each leg's NEAR/EVM hashes. Atomically claim **chain ID + payment transaction hash + Transfer log index** with the paid-state transition so one payment cannot fund two orders after a restart.

Payment acceptance requires the exact canonical USDC contract, Investor→Treasury **100000000** units, approved calldata/digest, successful receipt, one exact Transfer event, attributable balance changes and finality. A direct ERC-20 transfer carries no purchase ID: bind its approved digest to the quote in the journal before signing, and publish that association. This does not provide trustless onchain enforcement of the quotation.

Each live operation selects one explicit role and credential file in a fresh process; the coordinator never loads both credentials. Each MPC request and EVM broadcast retains its own hash-bound approval. Query fresh access-key and EVM nonces; serialize Treasury deliveries. Pause on root/domain/path/address mismatch rather than rederiving a new accepted destination.

Current expired-signature recovery allows only the **two completed nonce-zero LINK transactions**. It cannot recover new purchase legs. Before taking payment, implement and test a narrowly purchase/leg-bound recovery path preserving exact original hashes/bytes, full signer verification, expired-time acknowledgment, fresh 30-second audit, durable attempt marker and single-use send. Keep normal freshness intact; no generic force flag or automatic re-signing/rebroadcasting.

A partial delivery remains an obligation. Resume only missing legs after reconciliation. A whole-payment refund after one asset was delivered is not automatic; any replacement, refund or compensation needs an explicit settlement decision. Local reservation cannot stop unrelated Treasury spending, so keep accounts quiet and recheck sufficiency before payment acceptance and each delivery.

**Incremental implementation and acceptance**

Engineering estimate: **4–6 focused development days**, plus faucet/operator/finality waits. Target the live proof by November 12 and judge-ready package November 13, before November 14.

| Increment | Indicative window | Verifiable acceptance |
| --- | --- | --- |
| 03B — checkpoint, asset intents, USDC | Nov 6–7 | Preserve 122-test baseline; six-decimal USDC transfer intent; approved fees/caps; reject wrong token, amount, role and nonce. Verify price configuration. Obtain separate funding approval and start USDC collection in parallel. |
| 03C — native ETH | Nov 7–8 | Exact value/data/sender recovery; value-plus-gas funds; canonical receipt and fee-aware deltas. Preserve ERC-20 tests. |
| 03D — quote/journal/coordinator/recovery | Nov 8–10 | Deterministic 50/50 bigint math; safe reservation/expiry; duplicate payment rejected; pending finality and paid quantities survive restart; partial and uncertain legs cannot duplicate. Test purchase-bound expired recovery before accepting funds. |
| 03E — purchase evidence | Nov 10–11 | Credential-free verifier binds quote and all three real NEAR/EVM legs; correct USDC/ETH/LINK quantities and order; reject fixtures as live evidence. |
| 03F — approved live purchase and packaging | Nov 11–13 | Separately approve funding/signing/broadcasts; verify 100-USDC receipt before delivery, both asset deltas and actual gas; export proof, README commands and final local checkpoint. |

Key dependencies: 100-USDC funding; verified pricing/freshness configuration; archive-capable RPCs with rate pacing; USDC pause/blacklist/upgrade compatibility; native value-plus-gas accounting; and paid-order recovery. Do not assume the old 180,000 gas ceiling fits USDC: estimate later under explicit preparation approval and request review if any limit is exceeded. The existing 180,000/30-gwei/0.0036-ETH limits are protective references, not new transaction authorization.

**Repository and submission readiness**

This remains the separate `C:/projects/WealthPixels-NEAR-Hackathon-2026` workspace with **no Git remote**. HEAD is still **54a5503**; accepted later fixes, fixtures, evidence and documentation are uncommitted. Before Task 03 implementation, rerun offline/type checks, inspect staged content for real secrets/artifacts, and create a clearly labelled local Phase 3H checkpoint. Keep `.env`, protected credentials, `.local` runtime/signed state, node_modules and generated artifacts excluded.

Preserve the two-leg proof and its public records; add a separate purchase manifest. Keep README claims limited to implemented behavior, retain credential-free offline and public-verification modes, label fixtures, and disclose non-atomic/single-operator behavior. Resolve original-code reuse rights and third-party notices before any public hackathon publication; package metadata alone is not evidence of permission. No publication or commit was performed here.

Only this plan, its public read-only summary and ignored observation records were saved. **No application implementation, credential access, faucet funding, live transaction preparation, signing or broadcasting occurred.**
