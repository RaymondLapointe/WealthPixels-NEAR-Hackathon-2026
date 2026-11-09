# Experiment A — Implementation and offline validation

Date: November 9, 2026.

This increment implements an isolated ordinary NEAR Testnet submission diagnostic. It does not execute Experiment A or resolve the original Treasury MPC attempt.

## Preserved project baseline

- Accepted baseline: `4a5e63d4897e51ae55176c65397b043656993881` (508 passing offline tests).
- Original Treasury test: `native-smoke-20261109-001`, NEAR hash `EhhdBmen29BbsDy7sTHnFsWqNVeS6LiCSowv79AxQhsS`, status `near-uncertain`.
- Original state SHA-256: `FDF668299F096FE4F957029CA5EF73E5B8054F470E83DA718F04E408B5B6B860`.
- Its separately agreed FINAL-height checkpoint remains `277015472`. No checkpoint observation or reconciliation is performed by this development task.
- A before/after SHA-256 comparison covers all 49 existing runtime JSON files under `.local/transfers`, including the original state and four investigation evidence files.

## Diagnostic boundary

The only supported transaction is one ordinary `Transfer` of **1 yoctoNEAR** from `wealthpixels-investor.testnet` to itself, using its existing verified FullAccess public key. No MPC request, Ethereum transaction, Treasury authority, purchase journal, new account or new dependency is involved.

The helper separates public preflight, unsigned preparation/inspection, exact-hash-approved signing and one submission, and credential-free reconciliation. Its ignored diagnostic state is separate from native-test and purchase state. Original preparation timestamps and the 15-minute deadline are immutable; an expired or uncertain attempt cannot be reset or automatically retried.

Public records preserve the account/key, preceding and selected nonce, finalized reference block, exact NEAR transaction hash, transfer action/amount/recipient, selected endpoint, original preparation/deadline, attempt stages and sanitized outcomes. A send-intent marker is not proof of network acceptance. An RPC acknowledgment is not FINAL execution. Missing or contradictory observations remain unresolved.

The approved **0.0001 NEAR** offchain fee budget is checked using exact integer arithmetic and refreshed network/balance observations before signing. It is an application safeguard, not a protocol-enforced maximum gas charge.

Files added or changed:

- `src/near/experiment-a.ts`: fixed self-transfer preparation, public metadata validation, one-attempt submission and two-endpoint reconciliation.
- `scripts/near-rpc-diagnostic.ts`: isolated CLI and exclusive diagnostic-state creation/locking.
- `test/near/experiment-a.test.ts`, `test/near/experiment-a-cli.test.ts` and `test/near/fixtures/experiment-a.ts`: labelled, simulated offline coverage.
- `package.json`: `near:diagnostic`, `test:experiment-a`, and inclusion of the two new test files in the full offline suite. Dependencies are unchanged.
- `tsconfig.near.json`: typecheck the new CLI.
- This report and `docs/ExperimentA_Operator_Runbook.md`.

No existing production signing, purchase, native-test or Solidity module is modified.

## RPC access

Default primary: `https://test.rpc.fastnear.com`.

Default secondary: `https://archival-rpc.testnet.near.org`.

These are configurable public HTTPS endpoints without embedded credentials. Endpoint choices are recorded and cannot be silently changed for an approved prepared transaction. Existing MPC and portfolio defaults remain unchanged.

NEAR's [provider list](https://docs.near.org/api/rpc/providers) identifies the public FastNEAR Testnet endpoint and the rate-limited NEAR archival endpoint. FastNEAR's [RPC documentation](https://docs.fastnear.com/rpc) also names `https://rpc.testnet.fastnear.com`, while its [authentication documentation](https://docs.fastnear.com/auth) describes API keys. The earlier design inspection observed unauthenticated read access; it did not prove unauthenticated `send_tx` acceptance or reliable submission.

No valid or deliberately invalid submission probe is executed during development. Before live use, document provider confirmation of unauthenticated submission support, or obtain an explicit operator decision covering the remaining access uncertainty of the single experiment. Do not claim read-only readiness proves write access; do not obtain API credentials or silently switch providers.

## Commands and operator instructions

See [ExperimentA_Operator_Runbook.md](ExperimentA_Operator_Runbook.md) for the exact command sequence and separate approval checkpoints. All live examples are instructions only and have not been executed under this authorization.

Proposed live preparation command, requiring separate authorization:

```text
npm run near:diagnostic -- prepare --role investor --id experiment-a-investor-20261109-001 --state .local/transfers/near-diagnostics/experiment-a-investor-20261109-001.json --near-rpc https://test.rpc.fastnear.com --verify-rpc https://archival-rpc.testnet.near.org
```

Preparation reads public network state and constructs an unsigned transaction only. After inspection, signing/submission requires another explicit approval of that exact NEAR hash and the protected external Investor credential path. No hash has been prepared for live approval during this task.

Standard offline verification:

```text
npm run test:experiment-a
npm test
npm run typecheck
```

Windows development uses the existing `scripts/with-node22.ps1` launcher and argument-array syntax. No PowerShell dependency is introduced into the Node CLI itself.

## Completion results

- Targeted Experiment A suite: **40 passed, 0 failed**.
- Full offline suite: **548 passed, 0 failed, 0 skipped**, preserving all 508 baseline tests (99.7 seconds).
- TypeScript: passed, exit code 0.
- Staged whitespace, secret and artifact checks: passed; exactly the nine listed helper/configuration/test/documentation files are included.
- Existing production transaction modules, Solidity, dependencies, public LINK evidence and the 49 existing runtime JSON files remain unchanged. No live RPC calls were made during implementation.

Exact Windows validation commands executed:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:experiment-a') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

Regression coverage includes fixed action/authority/hash, immutable preparation, credential isolation, nonce changes, fee-budget failures, advancing-clock timestamps, stale observations before credential access and after persistence, exclusive state paths, one-attempt semantics, pre/post-send failures, minimal RPC acknowledgments, partial secondary evidence, genuine FINAL success/failure, and rejection of forged FINAL labels.

All test transactions, signatures, credentials and network responses are explicitly mocked offline fixtures; none constitutes a live transaction. The reviewed local commit identifier and final Git status are supplied in the completion message; that commit contains this report and the operator runbook.

Live success requires the exact approved transaction, successful FINAL execution and relevant receipt outcomes, nonce reconciliation, actual public fee accounting and corroboration by the secondary endpoint. Unknown hashes, timeouts, incomplete finality or conflicting evidence never authorize an automatic second submission.

No protected credentials are accessed, no live transaction is prepared or signed, no blockchain submission or funding is performed, and no Experiment B or portfolio purchase is started.
