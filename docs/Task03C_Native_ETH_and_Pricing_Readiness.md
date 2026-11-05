# Task 03C — Native ETH support and purchase pricing readiness

November 5, 2026. Implementation, offline tests and public pricing research only.

## Result and preserved baseline

Native ETH transaction components are implemented for the future Treasury-to-Investor purchase leg. They reuse the existing NEAR signer, MPC signature normalization, full-public-key derivation, EIP-1559 tools, single-use broadcast transport and durable execution patterns. The purchase coordinator and live CLI integration remain Task 03D work. No native ETH transaction was prepared from live account data, signed or broadcast.

Before development, the accepted **165-test Task 03B suite and TypeScript checks passed**. Commit `2998896f4eef4d0858db63b04d7bb7f5c968e7c1` already contained the clearly labelled Task 03B milestone. After reviewing its 12 files for credentials, generated/runtime files and artifacts, a local acceptance checkpoint tag was created at that commit: `checkpoint/task03b-accepted-before-03c`. No remote was configured.

Phase 3H public evidence remains unchanged. Treasury record SHA-256: `e99d120a99da474392387f3203400734ec4fd8ff47a2d273827a40e147b7ca39`; Investor record SHA-256: `8813bce5d1591b95b454c3e19b9d5ca06bc16b62aee17f197825ebf866cf9f8b`.

## Components and safeguards

| File | Change |
| --- | --- |
| `src/evm/native-transfer.ts` | Pure native EIP-1559 construction, strict field/digest integrity, public signature normalization, full-key sender recovery, exact signed-byte validation and pinned Treasury authority wrappers. |
| `src/evm/sepolia-native.ts` | Quote-sized native delivery, public snapshot observation/rechecks, reserve/cap validation, canonical receipt and balance-delta verification; expected and actual fee adapters. |
| `src/execution/native-workflow.ts` | Separate signing/broadcast approvals, native state codec, durable attempt markers, exclusive locks and public-only reconciliation. |
| `src/execution/state.ts` | Extracted the existing bounded bigint decoder and durable writer for reuse; existing LINK entry points delegate to them without changing behavior. |
| `src/purchase/config.ts` | Verified ETH/LINK pricing metadata and a disabled NEAR/USD HTTPS discovery candidate; no current price defaults or collector. |
| `test/near/native-transfer.test.ts` | 11 cryptography/serialization tests. |
| `test/near/native-delivery.test.ts` | 18 allocation, preflight, receipt, fee and recovery-boundary tests. |
| `test/near/native-workflow.test.ts` | 17 state, approval, freshness, persistence and mocked submission tests. |
| `test/near/fixtures/native-algebraic.ts`, `native-delivery.ts` | Labelled public algebraic and synthetic RPC fixtures; no private keys or live native execution proof. |
| `package.json`, `README.md` | Added the three suites to credential-free judging commands and documented implemented behavior/limits. |
| `docs/Task03C_Pricing_Public_Observations.json`, this report | Timestamped public source observations and completion record. |

The production delivery binds chain ID **11155111**, Treasury `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`, Investor `0x07FE574EdB1B2f537F9be452312C15A5b9427820`, and `value = approved allocation ethWei`, with empty calldata and an empty access list. It rejects altered chain, value, destination, nonce, transaction fields, serialization or digest.

Preflight requires code-free role addresses, successful empty-result simulation, matching confirmed/pending Treasury nonce and sufficient ETH for **delivery value + maximum transaction fee + remaining operating reserve**. The default reserve is **0.001 ETH**, explicitly part of the trusted delivery policy and configurable for reviewed execution. Both original and fresh gas estimates must fit with at least a rounded-up 20% buffer. Gas is estimated; the transaction gas limit is not hardcoded to 21,000. Estimates/limits below intrinsic transaction gas are rejected.

Protective references remain **180,000 gas, 30 gwei maximum fee per gas and 0.0036 ETH maximum total fee**. They are ceilings, not selected fees or spending authorization. Native amounts and costs use bigint only.

Signing uses the existing Treasury-only credential selection, `prepareMpcSigning`, current role/MPC checks and exact unsigned-digest approval. Final public MPC outcome normalization binds the direct request, role, root/domain/path, digest, full trusted derived key and sender. Broadcasting independently requires the signed hash, signature/byte revalidation, fresh Sepolia checks and absence of an existing transaction/receipt. The NEAR hash or EVM attempt marker is durably saved before its one-use submission capability runs. Timeout, unexpected response or save failure stops automatic progress and preserves reconciliation state.

The original **15-minute preparation window** remains enforced before signing/broadcasting, including after awaited work. Expiry does not reset timestamps or authorize another request. Public reconciliation can inspect an expired operation without submitting. There is no native force flag or expired-signature broadcast exception; purchase/leg-bound exceptional recovery must be designed and tested in Task 03D before accepting payment.

Receipt verification reconstructs the exact signed transaction, verifies success, canonical receipt/parent blocks, at least two confirmations, actual EIP-1559 gas price and gas bounds. Investor delivery is measured as **after ETH minus previously held ETH**, equal to the quoted value; Treasury decrease must equal value plus actual gas. Unexplained concurrent balance activity stops verification. This uses public RPC observations and quiet-account attribution, not a light-client proof or transaction trace.

## Offline evidence and results

**211/211 tests passed**, comprising all 165 existing tests plus 46 native tests. TypeScript checks passed. Development initially found two test-fixture assumptions about an absent saved ERC-20 signature; the tests now reconstruct it from the preserved authentic public MPC result and correctly reject its use for native authorization.

Exact final commands:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:offline')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

Focused native validation also ran:

```powershell
.\scripts\with-node22.ps1 -Tool node -ToolArguments @('--import','tsx','--test','test/near/native-transfer.test.ts','test/near/native-delivery.test.ts','test/near/native-workflow.test.ts')
```

Judges use ordinary cross-platform `npm test` and `npm run typecheck` on supported Node 22. Runtime remains Node **22.23.4**, near-api-js **7.4.0** and the existing Ethers/Hardhat versions. No dependencies were installed or upgraded; legacy Solidity/tests and completed LINK evidence were preserved.

The positive crypto fixture is **synthetic**, with public algebraic R=generator, s=1 and a recovered synthetic public key. No private key or wallet was generated. It constructs value `2000000000000000` wei, nonce 1, gas limit 25,200, maximum fee 5,000 wei/gas and priority fee 1,000 wei/gas:

- Unsigned fixture digest: `0x2dbaee8bea5463425f9dadd643ee2cb3353a5be1897ed2871ec6c7dbcb7af200`.
- Signed fixture hash: `0xb394afaa81c415352680df9304e5b557d64f76c7b1a9f79e0d8ff3c9a90c59de`.
- Mock receipt: 21,000 gas at 2,000 wei/gas, actual fee 42,000,000 wei; existing Investor ETH is preserved and increases by precisely the delivery value.

These hashes are not proposed live transactions or real Treasury authorizations. Positive signature/receipt reconstruction is exercised at the generic native layer; the pinned Treasury workflow rejects synthetic and unrelated ERC-20 proofs. Signing submission order and uncertainty handling use injected mocks. A genuine native Treasury MPC signature, successful native broadcast branch and onchain delivery remain unproven until separately approved live execution; no validation bypass was introduced to fabricate them.

## Pricing readiness

The official [Chainlink feed directory](https://docs.chain.link/data-feeds/price-feeds/addresses) references this [Sepolia metadata source](https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia.json). Both verify:

| Feed | Sepolia proxy | Decimals | Documented heartbeat / deviation |
| --- | --- | --- | --- |
| ETH/USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | 8 | 3,600 seconds / 1% |
| LINK/USD | `0xc59E3633BAAC79493d908e63626716e204A45EdF` | 8 | 3,600 seconds / 1% |

This resolves the previous LINK provenance/heartbeat blocker. Public reads at **22:03:03Z**, block `0xb83576`, confirmed matching descriptions, decimals and documented aggregators. Raw ETH answer was `224173646055`, updated 21:03:48Z; LINK answer `1067229000`, updated 22:02:48Z. These are historical observations, not current quote prices. Full public parameters are preserved in [the pricing record](Task03C_Pricing_Public_Observations.json).

Proposed policy: positive bounded answers, approved proxies/metadata, valid nonfuture timestamps/rounds and a canonical observation block; strict maximum age **3,600 seconds**, with rate expiry bounded by `updatedAt + 3600`. A heartbeat is not an uptime guarantee. The ETH sample was close to expiry; stop when stale instead of granting silent grace. [Chainlink monitoring guidance](https://docs.chain.link/data-feeds/overview#check-the-timestamp-of-the-latest-answer).

For NEAR signing-cost conversion, [CoinGecko Simple Price](https://docs.coingecko.com/demo/reference/simple-price) supplies `near`/USD and `last_updated_at` over HTTPS. Coin identity was checked against NEAR Protocol metadata. A keyless request returned raw price lexeme `3.69` with timestamp 22:01:54Z, observed 22:02:36Z. Preserve it as exact rational **369/100**, rather than calculating with a parsed floating-point number. No new blockchain integration is needed.

CoinGecko's [access documentation](https://docs.coingecko.com/docs/errors-and-rate-limits) describes keyless IP-based access, while the endpoint's Demo reference marks an API-key header required. One successful public response does not guarantee availability. Keep this source **disabled until Task 03D policy/collector review**; propose a 120-second maximum source age and rejection on missing/stale timestamps, malformed data, unavailable service, HTTP 401/429 or other errors. No API key was requested or accessed.

If that source proves unreliable, the minimal alternative is an **explicitly approved demonstration rate** with exact rational value, public source/original observation, approval reference and absolute expiry of at most five minutes. No automatic fallback or stale-price reuse. Proposed freshness/source policies require review before live integration.

## Economic controls and Task 03D gates

`MAX_EXPECTED_FEE_BPS = 1000` is unchanged. `nativeDeliveryFeeEstimate` supplies the existing `treasury-eth-delivery` / Treasury-payer estimate interface using raw estimated gas and the buffer exactly once, explicit base/priority assumptions and separate maximum reserves. Verified receipt output supplies `ActualEvmCost` with gas used and effective price. Delivery value is not counted as an execution fee.

Live 10% eligibility is **not established** by pricing research or fixture tests. Before accepting Investor USDC, Task 03D must:

1. Integrate and approve the price/freshness collector; obtain all three EVM and three NEAR signing estimates and documented ETH/NEAR conversions. Reject missing inputs and preserve the fee assessment in the approved immutable quote; revalidate before payment.
2. Connect ERC-20/native adapters to purchase-specific CLI/state dispatch, inventory reservation, payment finality, atomic duplicate-payment claims, serialized Treasury nonces and partial-delivery obligations.
3. Implement and test tightly quote/leg/hash-bound recovery for expired signed purchase legs, keeping original bytes/timestamps and one-attempt safeguards. Complete this before payment acceptance.
4. Collect actual costs, including failed attempts, and retain paid delivery obligations even if fees rise. Add three-leg credential-free evidence in Task 03E.
5. Refresh funding/inventory readiness under separate approval. The last Task 03B USDC observation was zero at Investor; one approved 20-USDC Circle allocation would cover the configurable 10-USDC target. No funding is authorized or performed here.

The **November 12 live-demo target remains feasible**, with Task 03D integration/recovery as the critical path: approximately 2–3 focused development days, followed by purchase evidence and separately approved execution/operator waits. Target Task 03D by November 9–10, evidence November 10–11, live proof November 11–12 and packaging November 13. Pricing availability, funding, operator approvals and RPC/finality delays can affect that estimate.

**Stopped after Task 03C.** No private credentials, live transaction preparation, MPC signing, Ethereum broadcast, funding, new accounts, new contracts, dependency upgrade or Task 03D coordinator implementation occurred.
