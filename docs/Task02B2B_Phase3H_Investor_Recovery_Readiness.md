# Phase 3H: existing Investor signed transaction recovery readiness

November 5, 2026. **Implementation, offline verification and live read-only recovery audit passed. Stopped before EVM broadcast. No credentials or additional NEAR signing request were used.**

## Preserved transaction

State remains `signed` at `.local/transfers/investor-link-phase3h-fees5000-20261105T161641902Z.json`, with no recorded EVM attempt, receipt, recovery uncertainty or lock. The signed bytes and original timestamp remain unchanged. State SHA256 before and after this task is `7f45deeae4eb17bc131f7aa04ff016cb7b6d4ba1fe2637870ef56661bdbcef3a`.

- Signed EVM hash: `0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86`.
- Approved unsigned digest: `0x5dc09f64bf1751de61ce3cf3c3bdea6561ce2e38d992393eef57c3dca10641f9`.
- Successful finalized NEAR signing hash: `4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z`.
- Original creation: **2026-11-05T16:17:00.756Z**; original preparation expired **16:32:00.756Z**.
- Exact transfer: **0.1 LINK** from Investor `0x07FE574EdB1B2f537F9be452312C15A5b9427820` to Treasury `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`.
- Network/token: Sepolia **11155111**, LINK `0x779877A7B0D9E8603169DdbD7836e478b4624789`, 18 decimals.
- Signed parameters: nonce **0**, gas limit **52,001**, maximum fee **5,000 wei/gas**, priority **1,000 wei/gas**, ETH value **0**, empty access list.
- Maximum total EVM fee: **260,005,000 wei = 0.000000000260005 ETH**. Protective caps unchanged: 180,000 gas / 30 gwei per gas / 0.0036 ETH total.

## Narrow implementation and validation

The recovery engine now has an immutable, closed allowlist for exactly the recorded Treasury transaction and this recorded Investor transaction. It pins each role's three hashes, original creation timestamp, amount, nonce, gas and fee parameters. Caller-defined recovery intents are not accepted.

Existing safeguards remain: saved and freshly finalized MPC proof, complete trusted public-key and expected-sender recovery, exact signed-byte/digest agreement, current role-specific nonce and balance reads, token/code/decimals/EOAs, simulation/gas/fees, unknown transaction/receipt, canonical block, explicit hash approval and expired-preparation acknowledgment. Both role balances are recorded.

The unchanged **30-second** audit starts before public reads. Future submission must preserve its immutable audit, persist the submitting marker, recheck freshness after durable writes and use the single-use EVM transport. An expired audit, uncertain submission or persisted attempt cannot automatically retry. There is no signing/credential capability or force option in recovery. Normal 15-minute signing/broadcast safeguards remain unchanged; the normal broadcast command was not invoked.

Changed: `src/execution/recovery-broadcast.ts`, `scripts/transfer.ts`, `package.json` (test command only), `test/near/recovery-cli.test.ts`; added `test/near/investor-recovery-broadcast.test.ts`, `test/near/fixtures/mpc-4uD2MLZV.json`, `test/near/fixtures/recorded-investor-mpc.ts` and this report. The new fixture is curated actual public NEAR evidence with unsigned preparation inputs, without credentials or executable signed EVM bytes. No legacy Solidity, dependency versions, lockfile, normal workflow or Treasury regression tests changed in this task. Earlier uncommitted diagnostic changes were preserved.

Final checks:
- `.\scripts\with-node22.ps1 npm run test:offline`: **122 passed, zero failures**, including all Treasury regressions and 13 additional Investor/CLI tests.
- `.\scripts\with-node22.ps1 npm run typecheck`: **passed**.
- `git diff --check`: **passed**.
- Independent read-only security review: passed.
- Public fixture secret-field scan: no credential/private-key/seed fields found.

## Live read-only recovery audit

The existing CLI `recovery-audit --role investor` passed at **2026-11-05T17:21:52.428Z–17:21:58.815Z**, **6.387 seconds / 30 seconds**, Sepolia block **12070930**. Live MPC version **3.18.0**, trusted root/domain 0/path `wealthpixels/sepolia/v1`, registered Investor key and complete recovered public key/address all verified. No RPC error or validation bypass occurred.

| Observation | Result |
| --- | --- |
| Investor LINK / ETH | 1 LINK / 0.05 ETH |
| Treasury LINK / ETH | 24 LINK / 0.04999999985630444 ETH |
| Investor confirmed / pending nonce | 0 / 0 |
| Simulation / gas estimate | Passed / 43,334, below signed 52,001 |
| Base fee + signed priority | 25 + 1,000 = 1,025 wei, below 5,000 |
| Signed hash / receipt lookup | Neither known to queried RPC |

Audit: `.local/transfers/evidence/phase3h-investor-recovery-readiness-20261105T172140037Z.json`. Test logs and original/fresh public proof are preserved under ignored `.local/transfers/evidence/`. Treasury public delivery evidence remains byte-for-byte unchanged.

Eligibility is a snapshot. The preview audit expires while approval is reviewed and cannot authorize a later send. The controlled broadcast must create its own complete fresh audit and stop on failed/uncertain reads or validation. Public reads do not guarantee inclusion.

## Exact proposed recovery command — NOT EXECUTED

The new audit filename below was confirmed unused. The acknowledgment is the **original creation timestamp**, not the expiration time.

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @(
 'run','transfer','--','broadcast-recovered',
 '--role','investor',
 '--state','.local/transfers/investor-link-phase3h-fees5000-20261105T161641902Z.json',
 '--audit','.local/transfers/evidence/phase3h-investor-approved-recovery-broadcast-3be24eea.json',
 '--approve-broadcast','0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86',
 '--acknowledge-expired-preparation','2026-11-05T16:17:00.756Z',
 '--near-rpc','https://archival-rpc.testnet.fastnear.com',
 '--evm-rpc','https://rpc.sepolia.ethpandaops.io'
)
```

**Separate explicit authorization requested:** exactly one EVM broadcast of the signed hash above, acknowledging the expired preparation originally created at **2026-11-05T16:17:00.756Z**, conditional on all fresh checks passing. No new signature, fee change or timestamp reset is authorized. Reconcile a known/confirmed hash instead of rebroadcasting; preserve uncertain outcomes without retries.
