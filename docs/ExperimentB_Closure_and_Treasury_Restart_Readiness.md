# Experiment B closure and Treasury restart readiness

Date: November 10, 2026 (America/Toronto). Baseline: `54b13f52befb2eb121a59389518d88bac89ca714`; working tree was clean before this documentation increment.

## Experiment B closed

[Public Experiment B evidence](../evidence/experiment-b-near-mpc-diagnostic.json) preserves the approved diagnostic message/digest, transaction `CvbiuJEoKXyfppXZUs5Qc6gswXHyNmovbewLLCfkYLdE`, Investor authority, direct MPC request, four successful receipts, both FINAL endpoint observations, authentic public signature, full recovered Investor identity and exact execution fee **0.0008039215671572 NEAR**. The 1-yocto deposit is recorded separately.

The public summary was exported from completed observations and revalidated offline with the existing production state assertion and MPC normalizer. It is not a fresh network verification. It contains no credential material, sensitive local paths or executable signed NEAR payload. No Ethereum transaction or portfolio purchase is claimed. The original B state and final-access-key evidence are unchanged.

## One bounded Treasury checkpoint

New observations are preserved in [the public checkpoint record](Task03FB1_Treasury_Expiry_Checkpoint_20261110.json). Exactly **four** new NEAR RPC requests were made: one FINAL block, two original-hash lookups and one FINAL access-key query. There were no retries, fresh indexed-history probes or Sepolia requests.

| Observation | Result |
|---|---|
| FINAL block observed November 10 at 07:20:52.803 Toronto / 12:20:52.803 UTC | Height **277066663**, protocol 88 |
| Required checkpoint | **277015472**; exceeded by **51191** blocks |
| Original Treasury hash on `https://test.rpc.fastnear.com` | `UNKNOWN_TRANSACTION`, RPC code `-32000` |
| Original hash on `https://archival-rpc.testnet.near.org` | `UNKNOWN_TRANSACTION`, RPC code `-32000` |
| FINAL registered Treasury key | Expected public key, `FullAccess` |
| Current key nonce at FINAL height **277066784** | **275945855000001** |
| Preserved nonce before / after the original attempt | **275945855000001 / 275945855000001** |
| Authentic original execution outcome or MPC signature recovered | None |

The original hash is `EhhdBmen29BbsDy7sTHnFsWqNVeS6LiCSowv79AxQhsS`. The exact selected NEAR nonce and serialized reference block were not retained by that older implementation; neither has been reconstructed or invented.

The preserved protocol response specifies a validity period of **86400 blocks**, rather than an assumed number of wall-clock hours. NEAR checks the age of a transaction's reference block against this limit. See the [nearcore maintainers' description](https://github.com/near/nearcore/issues/12142).

The reviewed implementation selected a FINAL reference before signing. A later preserved FINAL observation, height **276929071**, supplies the conservative upper bound used in the accepted assessment. It is **not** the exact original reference. The strict-margin checkpoint was:

```text
276929071 + 86400 + 1 = 277015472
```

The new FINAL observation is beyond that bound. **Under the recorded implementation and conservative reference bound, the original transaction is no longer eligible for new inclusion on the canonical chain.** This conclusion does not prove that it never executed earlier, and it is not an observed node rejection of a resubmission; nothing was resubmitted.

Both historical access-key observations (heights **276923016** and **276927644**) match the current nonce. Together with the repeated unknown-hash results, this strongly supports non-inclusion. It is not presented as a complete historical proof. The only preserved indexed-history attempt returned HTTP 403 from NearBlocks; it supplied no usable inclusion record and was not retried. No confirmed historical success or onchain rejection was established. The original state remains **`near-uncertain`**, without manual transition or retirement.

## Smallest safe restart

Recommend separately authorizing a new Treasury native-ETH readiness inspection and, if its checks pass, a fresh unsigned smoke-test preparation. This recommendation accepts the residual historical uncertainty for a disposable Testnet diagnostic; it does not declare the old attempt resolved or authorize a retry.

- Use a new identifier and unused file, for example `native-smoke-20261110-002`; retain the old record and evidence permanently.
- Recommend explicitly selecting **`--near-rpc https://test.rpc.fastnear.com`** for the future operation and the official archival endpoint for corroboration. Experiments A and B demonstrate one successful ordinary submission and one successful MPC submission through the candidate primary. They do not guarantee future reliability. No endpoint default or configuration was changed here.
- Refresh Treasury authority/key, fresh NEAR nonce, MPC root/domain/derivation and spendable funding. Do not pin the new request to the old nonce or reference.
- Refresh Sepolia chain identity, confirmed/pending Treasury nonce, balances/reserve, current fees and simulation before preparing the intended **0.000001 ETH** test. No current Sepolia readiness or fee selection is asserted by this NEAR-only checkpoint.
- Preserve a new immutable intent/digest and 15-minute preparation deadline. Obtain separate hash-bound signing and broadcast approvals. If an old outcome is found later, reconcile it; do not broadcast both old and new transactions or bypass nonce checks.

Local inspection found no purchase journal/reservation. The existing native CLI checks the selected filename and active purchase journal but does not scan sibling native states. Thus the old unresolved record is not an automatic software barrier to a new filename; an explicit operational decision and new authorization remain necessary. Re-signing the original non-`prepared` state remains blocked. No production guard was changed.

There is no need to extend the historical investigation or introduce infrastructure before the next separately authorized smoke test. Native ETH delivery and the complete portfolio purchase still require their live milestones and approvals. With four calendar days until November 14, prompt bounded execution is more useful than further diagnostic development; completion is not guaranteed, and the separate historical Beacon archive limitation remains unchanged.

## Preservation and checkpoint

Only the new B public summary, evidence index, public Treasury checkpoint and this report are included in the local documentation commit. No source, dependency, Solidity, existing public transaction evidence or runtime state is changed. Original Treasury state SHA-256 remains `fdf668299f096fe4f957029ca5ef73e5b8054f470e83da718f04e408b5b6b860`.

Validation consists of production offline B proof checks, source-to-summary and exact fee checks, JSON/allowlist review, whitespace checks, a SHA-256 comparison of all **53 existing runtime JSON files**, and Git staging review. No source changed, so the accepted **613-test** milestone is retained rather than rerunning unrelated suites. The exact documentation checkpoint hash and final Git status are supplied with the completion response.

No protected credential was accessed, no live transaction was prepared, no signing or blockchain submission occurred, and the 10-USDC purchase was not initiated. Stop at this checkpoint.
