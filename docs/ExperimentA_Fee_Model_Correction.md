# Experiment A — Separate execution cost and upfront funding

Date: November 9, 2026. Starting checkpoint: `45639bd34573e24d310ab2311da330ac68629759`.

This is an offline correction and replay of previously captured public observations at FINAL block `276963528`, hash `9bDsyN3RRx2bXhVbUXrM3iDVGR4QEW9oH1w3nZvWAcXX`. No new RPC requests or live transaction preparation were performed.

## Fixed scope and calculation

The diagnostic remains one Investor-to-self Transfer of 1 yoctoNEAR. The fee budget remains `100000000000000000000` yoctoNEAR (0.0001 NEAR), with the same authority, endpoints, original 15-minute validity, exact-hash approval, durable state and one-attempt submission rules.

The pure fee calculator records separate send and receipt-execution gas, observed block price, receipt purchase floor, pricing policy and derived costs. It makes no network calls and constructs no transaction.

For observed block price `P`, send gas `S`, receipt execution gas `E`, and purchase floor `M`:

```text
A = 2 × P                          disclosed application price-movement allowance
Q = max(A, M)                      conservative receipt gas purchase price
B = min(Q, A)                      assumed receipt execution burn price
estimated execution cost = S × A + E × B + refund penalty
upfront gas funding      = S × A + E × Q
required spendable       = upfront gas funding + 1 yoctoNEAR
```

The 2× allowance is an application estimate for inclusion/execution price movement, not a protocol rule, hard fee cap or guarantee. Fresh observations are still required before signing and after durable persistence. The deprecated protocol pessimistic-price ratio is no longer treated as the current protocol's pricing rule.

The purchase floor applies only to receipt gas. Expected refunds are displayed but never credited toward upfront affordability. The expected execution estimate faces the fee-budget guard; the full prefunded amount faces the separate storage-safe-balance guard.

## Supported protocol and refund assumptions

Only the documented protocol-88 named-account Transfer schedule is supported. Refund penalty is explicitly identified as zero under the tagged nearcore 2.14.0 base configuration and protocol-85/88 changes. Missing RPC penalty fields are not interpreted as observed zero: the record identifies a versioned documented policy. Unknown protocol versions, unavailable mandatory prices/gas inputs and contradictory exposed refund parameters stop the workflow.

Sources: [gas lifecycle](https://github.com/near/nearcore/blob/master/docs/architecture/how/gas.md), [tagged base parameters](https://github.com/near/nearcore/blob/2.14.0/core/parameters/res/runtime_configs/parameters.yaml), [protocol 85](https://github.com/near/nearcore/blob/2.14.0/core/parameters/res/runtime_configs/85.yaml), [protocol 88](https://github.com/near/nearcore/blob/2.14.0/core/parameters/res/runtime_configs/88.yaml).

No account is created; no account-creation charge applies. This narrowly supported zero-penalty model does not attempt to implement future refund-fee schedules.

## Historical replay results

Recorded inputs: `S = E = 223182562500` gas, `P = 100000000` yoctoNEAR/gas, `M = 1000000000` yoctoNEAR/gas. The application allowance sets `A = 200000000`; `Q = 1000000000`; `B = 200000000`.

| Result | Exact yoctoNEAR | NEAR |
|---|---:|---:|
| Expected send burn, with price allowance | 44636512500000000000 | 0.0000446365125 |
| Expected receipt burn, with price allowance | 44636512500000000000 | 0.0000446365125 |
| Refund penalty under supported schedule | 0 | 0 |
| Total estimated execution cost | 89273025000000000000 | 0.000089273025 |
| Conservative upfront gas purchase | 267819075000000000000 | 0.000267819075 |
| Required upfront spendable, including transfer | 267819075000000000001 | 0.000267819075000000000001 |
| Storage-safe spendable balance | 9997375988080103099999999 | 9.997375988080103099999999 |
| Approved estimated-fee budget | 100000000000000000000 | 0.0001 |

Both guards pass in this **offline historical replay**:

- Expected execution cost ≤ budget: `89273025000000000000 <= 100000000000000000000` → TRUE.
- Spendable ≥ full upfront requirement: `9997375988080103099999999 >= 267819075000000000001` → TRUE.

The estimated price-difference refund is `178546050000000000000` yoctoNEAR (0.00017854605 NEAR), without any reliance on receiving it to fund the transaction. At the unbuffered recorded price, the reference execution burn is 0.0000446365125 NEAR; the implementation deliberately uses the higher 2×-price scenario for eligibility.

These estimates do not guarantee actual network fees. Actual burn and refunds depend on inclusion/execution prices and must be reconciled from public outcomes after a separately authorized transaction. Historical eligibility does not authorize a fresh preparation or submission.

## Changed files and validation

- `src/near/experiment-a-fees.ts`: small, pure fixed-Transfer calculator.
- `src/near/experiment-a.ts`: collected pricing inputs, immutable fee-model validation and separate budget/affordability diagnostics.
- `test/near/experiment-a-fees.test.ts`: arithmetic, floor regimes, changing prices, unsupported inputs and exact integers.
- Existing Experiment A tests/fixture: high receipt floor, insufficient upfront balance despite affordable burn, repricing before signing, unavailable/refund inputs and immutable assumptions.
- `package.json`: include the new tests in targeted/full offline commands; dependencies unchanged.
- Operator runbook and this report.

Validation results:

- Experiment A targeted tests: **58 passed, 0 failed** (including 12 pure fee-model tests).
- Complete offline suite: **566 passed, 0 failed, 0 skipped** (85.5 seconds).
- TypeScript: passed, exit code 0.
- Independent protocol/formula review: no blocking issue found.
- Staged file/secret/artifact review and whitespace checks: passed before the local checkpoint.

Exact validation commands:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:experiment-a') | Select-Object -Last 18
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

No production MPC, Treasury, Ethereum, purchase or original uncertain-state behavior is changed. All 50 existing runtime JSON files/evidence are preserved; the proposed live diagnostic state file remains absent. No protected credential or live RPC was accessed. The local milestone identifier and clean Git status are reported in the completion message; the commit contains this report.
