# Public testnet evidence

This directory holds the completed two-way LINK evidence, the completed Experiment A ordinary NEAR and Experiment B direct-MPC diagnostic summaries, the completed standalone native ETH smoke summary, and the completed three-leg portfolio purchase.

`guided-purchase-20261111-003.json` is the completed portfolio manifest; [its saved verification report](guided-purchase-20261111-003-verification-001.json) records all seven checks passing at 2026-11-11T21:51:31.505Z (exit 0). The Investor paid 10 test USDC and received exactly 0.478697941598851124 LINK and 0.002400960384153661 native ETH. Total execution cost was 0.009738 nominal USDC, rounded up under approved demonstration prices. The [Judge Story](../docs/WealthPixels_Hackathon_Demo_Story.md) explains the completed journey.

sepolia-link.json is the earlier two-way LINK manifest. As of November 5, 2026 its status is "complete": the real 1 LINK Treasury delivery and separately authorized 0.1 LINK Investor return are confirmed and public verification passed. It records both NEAR signing hashes, both Sepolia transaction hashes and the verified public role addresses/root. Detailed public observations are in [treasury-link-delivery.json](treasury-link-delivery.json) and [investor-link-return.json](investor-link-return.json). Account establishment and derivation are recorded in [Task02B1_Public_Identities.json](../docs/Task02B1_Public_Identities.json). These records contain no credentials or fabricated transactions.

## Commands and outcomes

Experiment A is recorded separately in [experiment-a-near-self-transfer.json](experiment-a-near-self-transfer.json). It summarizes the live 1-yoctoNEAR Investor self-transfer, its FINAL outcomes from both public endpoints, execution-block hash, receipt IDs, nonce and actual fee. It contains no credentials, signed executable bytes or local runtime paths. The original ignored diagnostic record is preserved.

This summary is an export of completed observations, not a fresh RPC verification or a portfolio/MPC result. The LINK and purchase manifest verifiers use different schemas and do not accept this diagnostic summary. Its public transaction can be independently queried through NEAR RPC `tx` with hash `GtjwK1T6j2yfAfcV3VSHjj9uVeD6nEf9odKvYR6G1MwP`, sender `wealthpixels-investor.testnet` and `wait_until: "NONE"`. No new lookup was made during packaging. Timestamps in the summary are operator observation times; the execution block is identified by hash, without inventing an unretained height or timestamp.

Experiment B is recorded separately in [experiment-b-near-mpc-diagnostic.json](experiment-b-near-mpc-diagnostic.json). It summarizes the exact approved canonical diagnostic message and SHA-256 digest, the Investor's direct `sign` call to `v1.signer-prod.testnet` with fixed path `wealthpixels/sepolia/v1`, domain 0, 100 Tgas and a 1-yoctoNEAR deposit, agreeing FINAL success from both public endpoints, execution-block height/hash, all four receipt outcomes and the final access-key nonce. The returned public Secp256k1 signature recovers the full trusted derived public key and Investor address. The actual transaction and receipt fee is `803921567157200000000` yoctoNEAR (`0.0008039215671572` NEAR); the attached deposit is separate.

The Experiment B summary exports saved observations. The existing production state assertion and MPC outcome normalizer passed offline against both saved outcomes; no new RPC lookup was made during packaging. The public transaction can be queried with NEAR RPC `tx`, hash `CvbiuJEoKXyfppXZUs5Qc6gswXHyNmovbewLLCfkYLdE`, sender `wealthpixels-investor.testnet` and `wait_until: "NONE"`. The summary contains public MPC signature components but no credentials, signed NEAR executable bytes, raw function-call arguments, Ethereum serialization or local runtime paths. Original ignored records remain preserved. Its timestamps are operator observation times. Canonical block checks report the completed reconciliation, with RPC trust and retained-data limits stated in the summary. This diagnostic does not establish an EVM asset transfer or portfolio purchase, and one successful run does not guarantee future RPC availability or MPC success. The LINK and purchase manifest verifiers do not accept this separate diagnostic-summary schema.

The completed standalone native smoke test is recorded in [native-eth-smoke.json](native-eth-smoke.json), test ID `native-smoke-20261110-002`. Treasury delivered exactly `1000000000000` wei (`0.000001` Sepolia ETH) to Investor. Ethereum transaction `0xa3bcc196bfdc3a47c51c720631521048ce3e5c35425a1a8fb4d0c91bf12bdc74` succeeded in block `12105109`, with 10 recorded confirmations, gas used `21000`, effective gas price `1000017` wei and actual fee `21000357000` wei. Historical parent/receipt-block balances show Investor gained exactly the value and Treasury lost the value plus fee. NEAR transaction `EHMUuAN8z1ZpoN8SrUq9P98wRfKQDzoNFZTwRpkgAvqb` reached FINAL success, and its MPC signature recovers the full trusted Treasury key for the approved digest, path and domain. Its transaction and receipt burn was `0.0008040465990482` NEAR, excluding the separate 1-yoctoNEAR deposit.

This allowlisted summary exports saved live observations. Packaging reran the production execution-state assertion, MPC normalizer against both saved NEAR outcomes, and native receipt verifier offline; all 13 recorded Ethereum verification reads were consumed and reproduced the saved receipt. No new RPC lookup was made. Original timestamps, public parameters and trust limits are preserved; credentials, executable serializations and local runtime paths are excluded. Ten confirmations are the recorded confirmation result, without a consensus-finality claim. This standalone transfer is separate from the completed portfolio purchase. The LINK and purchase manifest verifiers do not accept its summary schema.

- npm test: offline fixtures only; no RPC.
- npm run verify:evidence: default public manifest.
- npm run verify:evidence -- --manifest path/to/public-manifest.json: another public manifest.
- Optional --near-rpc / --evm-rpc flags select public HTTPS RPC endpoints.
- Exit 0: complete evidence passed every implemented check.
- Exit 1: malformed/inconsistent evidence, failed check, fixture submitted as live evidence, or RPC failure.
- Exit 2: evidence pending; no RPC requests are made.

A pending result is honest prototype status, not a failed blockchain transaction. Do not change status to complete until actual approved transactions and their public hashes exist.

## Completed manifest

The schema has schemaVersion 1, kind "live", status "complete" and operatorModel "single-operator-demo".

- near: testnet, v1.signer-prod.testnet, domainId 0, fixed derivationPath wealthpixels/sepolia/v1 and the recorded public secp256k1 root.
- evm: Sepolia chainId 11155111, official LINK token 0x779877A7B0D9E8603169DdbD7836e478b4624789, decimals 18 and minimum confirmations.
- roles.treasury / roles.investor: verified public NEAR account ID and complete derived EVM address. Never include access credentials.
- transfers: exactly the approved treasury-to-investor and investor-to-treasury legs, each with a positive decimal-string amountBaseUnits, NEAR transaction hash and EVM transaction hash.

The completed 1 LINK delivery and 0.1 LINK return have raw quantities 1000000000000000000 and 100000000000000000 respectively. Both are real testnet executions; the verified post-return balances are Treasury 24.1 LINK and Investor 0.9 LINK.

## Verification and limits

The verifier reads public historical records, validates role derivation from the recorded root and compares each successful NEAR direct-MPC request/response with the actual EVM transaction digest/signature. It also checks chain, sender, token, recipient, amount, receipt status, confirmations and matching Transfer logs. The investor return must be mined in a later block than delivery, matching the wait-for-confirmations operator flow.

It does not load signing identities, request MPC signatures, broadcast EVM transactions, or require today’s access keys/root to match an older record after rotation. It does not prove that separate people control the roles or assert exact historical balance deltas from event logs alone. Public RPC responses are trust inputs.

The synthetic fixtures used by tests are separate from this directory. They are labelled offline fixtures and cannot be submitted to the live CLI as public evidence. The tests do not constitute a completed two-leg live demonstration.

Sources: [NEAR transaction status](https://docs.near.org/api/rpc/transactions), [public RPC providers](https://docs.near.org/api/rpc/providers), [MPC signature types](https://github.com/near/mpc/blob/main/crates/near-mpc-crypto-types/src/primitives.rs).

## Portfolio purchase manifest and public verifier

`portfolio-purchase.pending.json` remains an unchanged historical placeholder. The CLI default still selects that placeholder and returns `incomplete/PENDING`, exit 2, without RPC reads. To verify the completed purchase, explicitly select its actual manifest and quote:

~~~text
npm run verify:purchase -- --manifest evidence/guided-purchase-20261111-003.json --expected-quote-hash 0x12f47956df63129eeb2ae6a8f388f2274e777ee5d62f0eb395f0cc21bfeda4a1 --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io --beacon-rpc https://ethereum-sepolia-beacon-api.publicnode.com
~~~

The saved run passed all seven groups, including historical payment finality before LINK delivery. A later run must retrieve its own public data; the saved report is not a replacement for missing history. The LINK manifest/command above remain unchanged.

After separately approved execution, the operator can use `npm run purchase:export-evidence -- --purchase-id ID --out evidence/NEW_FILE.json`. This extracts public fields from a completed reconciled local journal; it never requests signatures or broadcasts. Existing output files cannot be overwritten. Export alone establishes local consistency, not independent blockchain authenticity.

The separate schema is `schemaVersion:1`, `kind:wealthpixels-portfolio-purchase`, `mode:live|offline-fixture`, `status:complete`. It preserves:

- Immutable `quote`, exact USDC investment, 50/50 quantities, approved demonstration rates/provenance, six expected costs and the10% assessment.
- Public `authorities`, `quoteApproval`, original `paymentAuthorization`, and exactly three ordered `legs` with role, approved unsigned hash, public transaction parameters, NEAR/Ethereum hashes, approval references and canonical receipt/movement/cost summaries.
- `settlement` with finalized payment identity, completion and no outstanding obligations; authenticated actual EVM/NEAR costs and `realizedCosts` under original approved conversion assumptions.
- Fixed custody, pricing and local-association disclosures plus `manifestHash` for integrity. Exact integers use `{"$bigint":"..."}` encoding; no floating-point amount/fee conversion is used.

The whitelist excludes credential/private material, serialized unsigned/signed payloads, local paths, raw broadcast audits and unnecessary runtime records. `offline-fixture` exports stay explicitly labelled and cannot pass the public verifier. A forged live label does not supply real MPC signatures or transactions.

Judges use the completed manifest and full command above. Other completed manifests must also reside in this checkout's `evidence` directory. Configurable `--near-rpc`, `--evm-rpc`, `--beacon-rpc` and bounded `--pacing-ms` select compatible services without changing verification rules. `--expected-quote-hash` compares a separately preserved approval hash; it does not turn local approvals into onchain enforcement. `--report evidence/NEW_REPORT.json` retains partial checks and never overwrites evidence. Exit0=verified, exit2=incomplete, exit1=invalid/contradictory. There is no fixture/live bypass or transaction mutation option.

Ethereum archive access must supply historical balances, code, nonces and USDC calls at each receipt/parent block, exact logs, transactions, canonical headers and finality. NEAR must supply FINAL transaction results with all receipt costs. Ethereum consensus REST history must supply the LINK block's anchored parent header/state finality checkpoint and checkpoint payload/envelope. Current Sepolia Gloas uses the checkpoint execution parent as a conservative finalized boundary. Missing, pruned, unsupported, timed-out or rate-limited history remains incomplete; a compatible alternative endpoint may be selected for a new read-only verification run. No automatic read retry or fixture substitution occurs.

RPC responses are trust inputs. Beacon header roots are hashed and linked to the canonical execution header, but BeaconState/body Merkle proofs and BLS consensus signatures are not checked. A current finalized tag alone does not prove past finality. Finality-at-release is checked from the exact historical state. Quote/price approval references, original estimates and the local quote/payment association are operator claims. The public record proves matching transfers under RPC trust, not global payment uniqueness, independent human custody or atomic/trustless portfolio settlement. Actual NEAR costs conservatively include the one-yocto deposit unless a refund is independently proved; that assumption is labelled.

No credentials or paid account are required for public verification. Public RPC access and NEAR signing authorization are different: data access cannot authorize asset movement. Future commercial infrastructure can replace public endpoints without changing the verification protocol. See [Task03E completion](../docs/Task03E_Public_Purchase_Evidence_and_Verification.md) for historical implementation details. New version-2 quotes retain their original approved-price acceptance deadline while execution observations independently retain a maximum 60-second freshness window; see the [current Operator Story](../docs/WealthPixels_Guided_Purchase_Operator_Story.md).
