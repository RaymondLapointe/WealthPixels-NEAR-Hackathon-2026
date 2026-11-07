# Task 03E - Public purchase evidence and independent verification

November 7, 2026. Software, offline tests, public read-only observations and local checkpointing only. No private credentials, live purchase preparation, MPC signing, Ethereum broadcast or funding occurred. Task 03F has not begun.

## Result and important remaining dependency

Implemented a separate strict public purchase manifest/exporter and a credential-free verifier for the three USDC/LINK/native ETH legs, complete signing/receipt/movement evidence and actual fees. The accepted Task 03D-2 baseline is **`337bd5ec687f62e0ee673725de2fa2001aca2082`**, preserved under local tag `checkpoint/task03d2-accepted-before-03e`. The initial working tree was clean; all **364 baseline tests and TypeScript checks passed** before development.

**Historical consensus-state availability is a real remaining infrastructure dependency.** Recent public Ethereum Beacon history passed a live capability diagnostic, including current Sepolia Gloas support. The same default service returned404 for the approximately two-day-old state needed by a separate retention probe. Two documented public alternatives also failed to supply that old state. The verifier correctly leaves missing history incomplete. Do not describe delayed judge verification as assured until a compatible public archive service is demonstrated for the required retention period. No safeguard was weakened, paid account created or cached observation substituted as live evidence.

## Implemented components

| Added or changed | Purpose |
| --- | --- |
| `src/evidence/purchase-manifest.ts` | Whitelist export of completed purchases, strict schema/integrity, historical approvals/economics, bounded exact-integer codec and fixture/live separation. |
| `src/evidence/purchase-leg.ts` | Reconstruct public EIP-1559 bytes, full-key sender/signature verification, direct finalized MPC binding, canonical ERC-20/native receipts and actual costs. |
| `src/evidence/purchase-finality.ts` | Historical finalized payment before LINK release, anchored to the execution header's parent Beacon root; standard pre-Gloas/Gloas APIs. |
| `src/evidence/purchase-rpc.ts` | Configurable public JSON-RPC, method allowlists, sequential pacing, request/time/size bounds, safe errors and no automatic retries. |
| `src/evidence/purchase-reconcile.ts` | Pure three-leg observation reconciliation. Caller-supplied fixtures produce consistency results, never live verification success. |
| `src/evidence/public-files.ts` | Bounded public JSON paths, no traversal/linked inputs, unused-output checks and no overwrite. |
| `scripts/export-purchase-evidence.ts`, `scripts/verify-purchase-evidence.ts` | Separate local public-field export and journal-free public verification CLIs. |
| Six test files and two fixtures under `test/near` | 83 new offline tests; simulated purchase associations are clearly labelled. |
| `evidence/portfolio-purchase.pending.json` | Honest pending status; no real purchase hashes or false success. |
| `package.json`, `tsconfig.near.json`, README/evidence docs and three diagnostic JSON records | Commands, typechecking, scope/infra disclosures and public observations. No dependencies changed. |

Legacy Solidity/tests, existing transaction security limits, dependency lockfile and published Phase 3H JSON evidence are unchanged. Protected files and real ignored transaction journals were not accessed. Export help was exercised; no real journal was exported.

## Manifest and verification rules

The manifest preserves the exact investment, 50/50 allocation, quantities, immutable quote/hash, approved demonstration prices/provenance/original references, all six expected costs and the 10% screen. It also includes public role identities/root/domain/path, separate quote/payment/signing/broadcast approval claims, three NEAR/Ethereum hash pairs, public unsigned parameters, canonical receipt/balance summaries, unique payment identity, actual costs, realized ratio and completed settlement/no outstanding obligations.

Serialized unsigned/signed transaction payloads, credential paths/private keys, raw runtime audits and unnecessary local state are excluded. Public code reconstructs signed bytes from the blockchain's transaction fields. Exact values use bounded `{"$bigint":"..."}` JSON encoding. Only completed reconciled records export; synthetic records remain `offline-fixture` and are rejected by the live verifier. No fixture is published as a live purchase.

Independent verification checks the quote/allocation/economics mathematically at original approval times; each exact direct NEAR request/result, full trusted MPC-derived key and executed Ethereum signature; official USDC (6 decimals) and LINK (18 decimals); exact payment/event/delivery quantities; canonical receipt/parent state; historical balances and gas; per-leg account nonce progression; payment < LINK < ETH order and sequential Treasury nonces; complete NEAR receipt burns; and realized total fees/ratio. The 10% expected-cost ceiling includes both payers and all six operations. Actual overruns are recorded rather than cancelling settled obligations. The one-yocto deposit is conservatively included unless its refund is independently established.

Current payment finality alone cannot prove it preceded delivery. The historical check reads the LINK block's [EIP-4788](https://eips.ethereum.org/EIPS/eip-4788) parent Beacon header, verifies its SSZ header root, obtains the exact anchored state's finalized checkpoint and matches the checkpoint's execution boundary to canonical Sepolia. Gloas separates payload envelopes; the verifier conservatively uses the checkpoint execution parent. Unsupported or unavailable historical data cannot pass. This is Ethereum execution/consensus data, not an added blockchain integration. Exact official API/specification sources are preserved in the diagnostic record.

RPC responses are trusted. There is no BLS light client or BeaconState/body Merkle-proof verification. Local approval references, original gas estimates and quote/payment association are operator assertions; internal hashes do not independently prove a human approved a quote. `--expected-quote-hash` can compare a separately preserved approval record. A manifest cannot prove absence of duplicate claims in other journals. The demonstration may use one operator for both accounts and settles non-atomically from principal inventory; it issues no pooled portfolio token. Pricing is provider-independent approved demonstration assumptions, not current production market data.

## Commands and results

Cross-platform Node22.23.4/npm commands:

```text
npm test
npm run typecheck
npm run purchase:dry-run
npm run test:purchase-evidence
npm run verify:purchase -- --manifest evidence/portfolio-purchase.pending.json
npm run purchase:export-evidence -- --help
```

Final results: **447/447 full offline tests**, **83/83 evidence tests**, TypeScript and the fixture dry-run passed. All 364 prior tests remain. Coverage includes altered quote/prices/amounts/allocations/identities/signatures, events/native values, finality/order/nonces, costs/settlement, fixture relabeling, unavailable public history, safe files/CLI access, pacing and no retries. Native receipts awaiting their second confirmation remain incomplete; malformed or contradictory receipts fail.

The complete three-leg positive fixture proves mathematical/control-flow consistency with mock observations, not real MPC signatures for a USDC/native purchase. Separate cryptographic tests replay the authentic recorded Treasury signature and verify generic public algebraic fixtures; these are never accepted as live purchase proof. A real end-to-end portfolio evidence verification remains dependent on separately approved live execution.

The pending command returns `incomplete/PENDING`, makes zero RPC calls and exits 2 with standard Node/npm; it is not a passing purchase result. The development PowerShell launcher collapses a nonzero child exit into its own error status, so use the structured result or standard commands for the precise classification. Help tests require no journal, credentials or network. No real completed purchase manifest exists yet.

Future completed evidence, after separate execution/publication approval:

```text
npm run purchase:export-evidence -- --purchase-id PURCHASE_ID --out evidence/portfolio-purchase.json
npm run verify:purchase -- --manifest evidence/portfolio-purchase.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io --beacon-rpc https://ethereum-sepolia-beacon-api.publicnode.com --report evidence/purchase-verification.json
```

Those are future templates, not commands executed here. Place downloaded public JSON in `evidence/`. Add `--expected-quote-hash` with the separately preserved approved hash when available. Verification needs no journal or credentials. `--report` preserves verified, failed or incomplete results and partial checks in a new file; it never overwrites old evidence. Exit 0 means all required public checks passed; exit 2 means incomplete/pending/history unavailable; exit 1 means invalid or contradictory evidence. The existing `npm run verify:evidence` continues to verify the separate completed two-way LINK demonstration.

## Public observations and infrastructure

The basic inspection at **08:30:14 Toronto / 13:30:14.387 UTC November 7** passed: Investor 20 USDC, 0.9 LINK, 0.04999999995618284 ETH; Treasury 0 USDC, 24.1 LINK, 0.04999999985630444 ETH. Both confirmed/pending EVM nonces were 1. MPC 3.18.0, public identities/root/domain/path and derived addresses matched; both NEAR accounts had about 9.9974 spendable test NEAR after storage reserve. Base fee was 17 wei. USDC implementation remained `0xDa317C1d3E835dD5F1BE459006471aCAA1289068`, code hash `0xf4898b096a273d86cda13cce6503404da4005565fae6026a94919b231229d85b`. This historical snapshot is expired and authorizes nothing; no additional USDC funding was indicated for the 10-USDC target. Fresh transaction-specific quantities/funds/fees still require later approval.

Public records: [basic readiness](Task03E_Public_Readiness_Observation.json), [recent finality capability diagnostic](Task03E_Public_Finality_Diagnostic.json), [archive availability investigation](Task03E_Archive_RPC_Availability.json). The recent diagnostic uses unrelated canonical blocks and is explicitly not a purchase/payment proof. The retention probe's old state returned404 on PublicNode; Lodestar returned500, and the documented unstable Nimbus alternative failed TLS verification. No retry, TLS bypass, HTTP downgrade or paid-provider setup occurred.

Independent verification requires archive-capable Ethereum receipts/logs/headers plus historical `eth_call`, balances/code/nonces at receipt and parent; complete FINAL NEAR transaction/receipt outcomes; and historical Ethereum Beacon headers, exact-state checkpoints and checkpoint blocks/envelopes. Public endpoints are configurable. Default JSON-RPC pacing is 125 ms, Beacon 200 ms, with bounded timeouts and request budgets; these readers cannot sign, estimate a live purchase or broadcast. The documented NEAR method-name alternative is not a submission retry. No provider-specific response may determine verification rules.

Public RPC data access is distinct from NEAR signing authority: a provider can query public data or relay approved signed bytes but cannot independently authorize spending. WealthPixels' Buy and Build approach favors established specialized infrastructure over running its own nodes. Production may add commercial services, redundancy and service-level protections without redesigning the protocol/verifier. Public archival retention must be demonstrated for judging; missing history remains unresolved, with no fixture/cache fallback.

## Task03F prerequisites and approval sequence

The optional small native ETH test would reduce live value-transfer/gas/receipt risk. Tested native library functions already provide state, signing, reconciliation and broadcast safeguards, but neither current CLI exposes a standalone unpaid native test: `transfer` is LINK-only and `purchase` correctly requires finalized USDC. A thin explicit native-test entry point/amount binding and operator tests are needed; this is small additional development, not a new signing architecture. Standalone expired-signed recovery also needs a reviewed path if the existing15-minute window cannot be met. No dummy paid purchase or timestamp reset is appropriate. This entry point was not built in Task03E.

Before any live purchase, review archive retention, public implementation identity, selected fees, approved demonstration rates and exact quantities; confirm20USDC/current gas/NEAR funding freshly. A native test consumes a fresh Treasury nonce and delivery/gas funds; subsequent purchase code must query both nonces and balances again. No nonce should be preassigned from this report.

For the first Investor authorization within60seconds:

1. Have the operator present at the local terminal; review configurable investment/allocation, prices/provenance, caps, credential location and command forms **before** creating the short-lived quote. Approve one price packet for at most5minutes. Do not wait for a long chat review after quotation begins.
2. Once separately authorized, `quote` collects all six fresh costs/funding and prints the exact quote hash/deadline. The operator explicitly runs `approve-quote` for that hash immediately, then `prepare --leg usdc-payment --role investor` with a recorded reference.
3. Inspect the exact prepared unsigned digest/parameters and separately approve `sign` for that digest using only the Investor credential. Its own fresh fee/funding/authority checks and durable marker must finish before the original quote **and any shorter observation deadline**. There is no measured guarantee that public RPC plus operator latency will fit60seconds; all stages fail closed. If it expires before a signing attempt, preserve/retire the unsigned preparation as required and obtain a new quote/approvals. Never extend timestamps or reuse an old authorization for a different digest.
4. Reconcile the existing NEAR hash, review/approve the signed EVM hash separately, then broadcast through its fresh audit. An already-consumed exact payment authorization can complete later under Task03D-2's unchanged accepted-order assumptions and fresh six-cost screen; unresolved attempts retain reservations. All three transactions need not complete within60seconds.
5. Wait for canonical finalized payment, separately prepare/sign/broadcast/reconcile LINK, then freshly prepare/sign/broadcast/reconcile ETH. Each digest and broadcast hash needs explicit approval. Stop and reconcile uncertainty; never resend automatically. Paid/partial obligations survive expiry or failure.
6. Export completed public evidence and run independent verification. Preserve incomplete reports rather than marking unavailable history successful. No public publication, live native test or purchase execution is approved by this report.

November14 remains a plausible live-demonstration target, but delayed public judging is **not assured until historical Beacon availability is resolved**. Prioritize that dependency, the optional thin native-test path and a coordinated short-window operator session; avoid unrelated features. Task03E software is complete, with these explicit operational dependencies remaining for separately authorized Task03F.

## Source preservation and local checkpoint

Exact final Windows checks used the existing launcher: `-Tool npm -ToolArguments @('test')`, `@('run','test:purchase-evidence')`, `@('run','typecheck')` and `@('run','purchase:dry-run')`; test output was bounded with `Select-Object`. `git diff --check` passed. Source/artifact/secret review precedes local commit subject `milestone: Task 03E public purchase evidence and independent verification`; its exact ID and final status are reported at handoff. No remote is configured or repository published.

Original Phase 3H SHA-256 values remain Treasury `e99d120a99da474392387f3203400734ec4fd8ff47a2d273827a40e147b7ca39` and Investor `8813bce5d1591b95b454c3e19b9d5ca06bc16b62aee17f197825ebf866cf9f8b`. No original Solidity or existing live evidence was rewritten.
