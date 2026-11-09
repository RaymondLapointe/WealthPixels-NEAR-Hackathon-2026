# Experiment A — Fee and balance diagnosis

Observation: November 9, 2026, 19:33:28 UTC. Primary RPC: `https://test.rpc.fastnear.com`. Six read-only requests, no retries, using the existing helper. Secondary configuration was unchanged; no secondary query was needed.

FINAL block: `276963528`, hash `9bDsyN3RRx2bXhVbUXrM3iDVGR4QEW9oH1w3nZvWAcXX`. Account, key, protocol and gas-price inputs were pinned to this block. Testnet protocol version: 88. Investor key nonce: `275946428000001`, with the expected sole FullAccess key. No transaction was prepared.

## Exact observations and existing calculation

All arithmetic is integer arithmetic. NEAR decimals below are display values only; 1 NEAR = 10^24 yoctoNEAR.

| Value | Exact yoctoNEAR | NEAR |
|---|---:|---:|
| Investor account balance | 9999195988080103099999999 | 9.999195988080103099999999 |
| Storage cost per byte | 10000000000000000000 | 0.00001 |
| Storage reserve: 182 bytes × cost per byte | 1820000000000000000000 | 0.00182 |
| Storage-safe spendable balance | 9997375988080103099999999 | 9.997375988080103099999999 |
| Helper's estimated fee | 446365125000000000000 | 0.000446365125 |
| Approved fee budget | 100000000000000000000 | 0.0001 |
| Required spendable balance: helper fee + 1 yocto transfer | 446365125000000000001 | 0.000446365125000000000001 |
| Required gross balance: storage reserve + helper fee + transfer | 2266365125000000000001 | 0.002266365125000000000001 |

The account's `locked` balance is zero. The helper's liquid-balance-minus-storage calculation is appropriate for this observation.

Fee inputs:

- Receipt creation: send gas `108059500000`, execution gas `108059500000`.
- Transfer: send gas `115123062500`, execution gas `115123062500`.
- Total gas: `446365125000`.
- Block gas price: `100000000` yoctoNEAR/gas.
- `min_gas_purchase_price`: `1000000000` yoctoNEAR/gas.
- Pessimistic price ratio: `[1,1]`.
- Existing selected price: `ceil(max(block price, purchase floor) × ratio) = 1000000000`.
- Existing estimated fee: `446365125000 × 1000000000 = 446365125000000000000` yoctoNEAR.

## Every comparison in the rejected guard

| Comparison | Result |
|---|---|
| Balance ≥ storage reserve | TRUE |
| Spendable = balance − storage reserve | TRUE |
| Selected gas price > 0 | TRUE |
| Estimated gas > 0 | TRUE |
| Estimated fee = gas × selected price | TRUE |
| Supplied budget equals approved 100000000000000000000 | TRUE |
| Estimated fee ≤ approved budget | **FALSE** |
| Spendable ≥ estimated fee + 1 | TRUE |

Only `446365125000000000000 <= 100000000000000000000` fails. The new explicit error is `FEE_BUDGET_EXCEEDED`. The Investor has ample storage-safe balance; funding is not the cause.

## Cause and recommended correction

The integer arithmetic and unit conversion are correct for the implemented formula. The formula conflates the upfront receipt-gas purchase price with the eventual execution burn price and applies that higher price to send gas as well.

Current [nearcore gas documentation](https://github.com/near/nearcore/blob/master/docs/architecture/how/gas.md) distinguishes conversion gas at block price, receipt gas bought at the purchase floor, and execution burn at the lower applicable price. A difference can be refunded. The installed near-api-js type documentation describes the same receipt purchase distinction. This makes the helper's value an overestimate of expected execution cost and also an overestimate of the direct purchase reserve.

For illustration only, if the observed block price remains unchanged through execution, the two gas subtotals would imply approximately `0.0000446365125 NEAR` burned and `0.00024550081875 NEAR` purchased upfront before refunds. These are analytical estimates, not measured transaction costs or a fee guarantee.

The smallest justified follow-up is to represent expected burn and upfront balance reserve separately: apply the unchanged 0.0001-NEAR budget to the expected execution estimate, and require sufficient storage-safe balance for the full conservative upfront amount plus the transfer. Include protocol/refund assumptions and a high-purchase-floor regression. That eligibility-changing correction is **recommended, not implemented in this diagnostic increment**.

## Changes and validation

- `src/near/experiment-a.ts`: expose only typed public numeric guard details and distinguish budget, balance and calculation failures. All original eight comparisons, existing fee formula, budget and transaction safeguards remain unchanged.
- `scripts/near-rpc-diagnostic.ts`: print those safe public details for the operator.
- `test/near/experiment-a.test.ts`: add high-purchase-floor and insufficient-spendable-balance regressions.
- Targeted Experiment A tests: **42 passed, 0 failed**.
- TypeScript: passed, exit code 0.

Executed offline commands:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','test:experiment-a') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

Public inputs and exact guard results are saved in the new ignored file `.local/transfers/near-diagnostics/evidence/experiment-a-fee-balance-diagnosis-20261109T193328675Z.json`. It is a read-only diagnosis, not prepared transaction state.

The original Treasury record and all earlier runtime evidence remain unchanged. The proposed Experiment A transaction-state file remains absent. No credentials, funding, transaction preparation, signing, submission, endpoint changes or Experiment B actions occurred. The local checkpoint identifier is reported in the completion message.
