# Experiment B — Isolated MPC diagnostic implementation

Starting checkpoint: `984b602cb65b1ab783b0ad4dbd2d5c8220777c64`.

This increment implements an offline-tested operator helper. It does **not** demonstrate a live Experiment B signing request. No live preflight, transaction preparation, credential access, NEAR submission or Ethereum operation was performed.

## Fixed diagnostic and approval boundaries

The helper permits only Investor `wealthpixels-investor.testnet`, its previously verified FullAccess public key, and one direct `sign` call to `v1.signer-prod.testnet`. The request retains domain `0`, path `wealthpixels/sepolia/v1`, 100 Tgas and a 1-yoctoNEAR deposit. It signs the SHA-256 digest of the canonical, domain-separated diagnostic message documented in [the readiness assessment](ExperimentB_Offline_Readiness.md). It constructs no Ethereum transaction, permit or asset-transfer intent.

Credential-free preparation freezes the diagnostic message/digest, complete unsigned NEAR envelope/hash, preceding and selected nonces, FINAL reference block, public authority observations, explicit fee budget and original 15-minute deadline. Submission requires separate approval of **both** the diagnostic digest and NEAR transaction hash. The immutable original envelope is reconstructed before signing; only the external Investor credential can be selected. Attempt and send-intent metadata are durably saved before the single raw `send_tx` request. There is no automatic retry, re-signing, endpoint substitution or replacement.

Reconciliation is credential-free and bounded to the two recorded public endpoints. An acknowledgment is distinct from FINAL success. Final verification binds the public transaction to the original envelope/hash and Ed25519 signature, validates the direct MPC request and authentic returned signature using the existing full-key/expected-sender verifier, and checks canonical execution blocks, receipt outcomes and public execution fees. Missing, invalid or contradictory evidence remains unresolved; a genuine finalized execution failure is reported separately.

## Implementation and reuse

- `src/near/experiment-b.ts`: isolated public observations, immutable preparation, durable one-attempt submission and public reconciliation.
- `src/near/experiment-b-fees.ts`: exact-integer, protocol-versioned FunctionCall cost planning.
- `scripts/near-mpc-diagnostic.ts`: strict Investor-only `preflight`, `prepare`, `inspect`, `submit` and `reconcile` commands in a separate ignored state namespace.
- `test/near/experiment-b.test.ts`, `test/near/experiment-b-cli.test.ts` and `test/near/fixtures/experiment-b.ts`: explicitly synthetic offline tests.
- `package.json` and `tsconfig.near.json`: command/test/typecheck inclusion only; no dependency changes.
- `README.md`: link the diagnostic, offline tests and approval boundaries.
- [Experiment B operator runbook](ExperimentB_Operator_Runbook.md): exact future command templates and approval stops.

The helper reuses the existing public MPC inspection/derivation, production signature normalization, submission-observability records, Investor-only credential loader, raw RPC transport and atomic storage/locking utilities. The read-only MPC transport is explicitly injected to keep each public request bounded without SDK retry behavior. No production purchase, native-ETH, Treasury or Experiment A execution implementation is changed.

## Fees and RPC limitations

There is **no default or approved Experiment B fee budget**. The ordinary Experiment A budget of 0.0001 NEAR is not carried forward. A future live-preflight authorization must explicitly supply an MPC planning budget in yoctoNEAR.

The calculator separates send gas from receipt execution gas, includes function-call base/per-byte overhead and the complete 100-Tgas attachment, and applies the receipt purchase-price floor only to receipt gas. It records a disclosed 2× observed-price planning allowance, a full-attachment burn estimate and a separate conservative upfront reserve plus deposit. The upfront guard never relies on future refunds. Full-attachment planning is deliberately conservative; it is neither measured MPC consumption nor a protocol-enforced fee ceiling.

Protocol 88 and the documented zero-refund-penalty schedule are the supported pricing assumptions, following [the preserved protocol research](ExperimentA_Fee_Model_Correction.md). Mandatory missing inputs, unknown versions, contradictory exposed refund settings, stale observations, insufficient upfront funds or an exceeded explicit budget stop the operation. Estimates do not guarantee actual network fees.

Default public endpoints are `https://test.rpc.fastnear.com` and `https://archival-rpc.testnet.near.org`; they remain configurable at preparation and frozen afterward. Experiment A established one ordinary transaction submission through the primary endpoint. MPC service availability, current contract configuration and acceptance of this diagnostic remain unverified live dependencies. No API key or provider account was introduced.

## Validation and preservation

Pinned runtime/SDK remain Node **22.23.4** and near-api-js **7.4.0**. Final validation:

| Check | Result |
|---|---|
| Experiment B core tests | 33 passed |
| Experiment B CLI tests | 14 passed |
| Combined Experiment B suite | **47 passed, 0 failed, 0 skipped** |
| Complete offline regression suite | **613 passed, 0 failed, 0 skipped**; 87.2 seconds |
| TypeScript verification | Passed; exit code 0 |
| Actual CLI offline help | Passed; separate test traps network access and confirms no files created |
| Existing runtime JSON preservation | **51 of 51 byte-for-byte unchanged**, verified by SHA-256 |
| Existing public evidence, Solidity, legacy test and lockfile | Unchanged |

Exact final validation commands executed:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:experiment-b') | Select-Object -Last 16
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test') | Select-Object -Last 16
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','near:mpc-diagnostic','--','--help')
```

Development runs exposed and corrected a shared-metadata reference-block projection error, an overly broad saved-endpoint allowance and a diagnostic-test classification mismatch. The final acknowledgment check also rejects a response containing conflicting transaction-hash fields. No safeguards were relaxed.

Positive coordinator fixtures inject a clearly labelled mock signature-verification port; they are not authentic signatures over an unexecuted diagnostic. The live CLI has no fixture-selection flag and uses the existing production cryptographic verifier. Existing authentic recorded-MPC regression tests remain in the full suite. Both endpoints retain separate allowlisted failure stage/code diagnostics; provider error text, credential paths and executable signed payloads are not persisted.

Staging is restricted to the 11 reviewed source, test, configuration and documentation files in this increment. Credentials, ignored runtime state and generated artifacts are excluded. No remote is configured. The exact local milestone hash and final clean Git status are provided in the completion response; `git log -1 --format="%H %s"` identifies the checkpoint containing this report.

## Next separately authorized action

Review the runbook, choose an explicit MPC fee-planning budget, and authorize only bounded public preflight plus unsigned preparation using a new identifier and unused B-only state path. Review the exact diagnostic digest, NEAR hash, nonce/reference, budget/upfront reserve and deadline before separately authorizing one Investor credential-backed signing/submission. Reconciliation requires its own bounded read-only authorization. Experiment B cannot broadcast an Ethereum transaction.

The original Treasury `native-smoke-20261109-001` attempt and its expiry checkpoint remain separate. This increment does not reconcile, retire or replace that attempt, and does not initiate a native ETH test or portfolio purchase.
