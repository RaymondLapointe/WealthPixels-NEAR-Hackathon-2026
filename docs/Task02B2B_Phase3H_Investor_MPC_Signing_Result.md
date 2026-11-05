# Phase 3H: Investor MPC signing succeeded — EVM broadcast approval checkpoint

November 5, 2026. **Exactly one authorized Investor NEAR MPC signing request succeeded. No EVM broadcast occurred.**

Approved unsigned digest: `0x5dc09f64bf1751de61ce3cf3c3bdea6561ce2e38d992393eef57c3dca10641f9`.

- NEAR transaction: [4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z](https://testnet.nearblocks.io/txns/4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z).
- Outcome: **FINAL / SuccessValue**, four successful receipt outcomes.
- Signing authority: `wealthpixels-investor.testnet`, registered Investor FullAccess key verified.
- Direct call: `v1.signer-prod.testnet`, domain 0, path `wealthpixels/sepolia/v1`, 100 Tgas and 1 yoctoNEAR.
- MPC signature and complete derived public key: **verified** by existing reconciliation and independent offline review.
- Recovered EVM sender: `0x07FE574EdB1B2f537F9be452312C15A5b9427820`.

**Signed Ethereum hash:**

```text
0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86
```

The original exact 0.1 LINK Investor-to-Treasury transaction is unchanged: Sepolia 11155111, LINK `0x779877A7B0D9E8603169DdbD7836e478b4624789`, recipient `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`, nonce 0, gas limit 52,001, max fee 5,000 wei/gas, priority fee 1,000 wei/gas, maximum EVM fee 0.000000000260005 ETH.

Saved state: `.local/transfers/investor-link-phase3h-fees5000-20261105T161641902Z.json`, status **signed**, with the NEAR transaction hash persisted before submission and verified outcome/signature afterward. Only the protected external Investor credential was loaded; the Treasury credential was not accessed. No signing retry occurred.

Read-only suitability checks at **2026-11-05T16:26:11.785Z** passed: Investor 1 LINK / 0.05 ETH, confirmed and pending nonce 0/0, base fee 17 wei, successful simulation and estimate 43,334 within signed limit 52,001. Neither the signed EVM hash nor receipt was known to the queried RPC. This snapshot does not replace live validation during an approved broadcast.

**Original preparation expiration remains 2026-11-05T16:32:00.756Z (11:32:00.756 Toronto).** Ordinary broadcast requires this preparation to remain fresh; do not reset timestamps, alter signed bytes, substitute a hash, use the Treasury-only recovery command or request another signature if expired.

The following existing command is proposed only, **NOT EXECUTED**:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @(
 'run','transfer','--','broadcast',
 '--role','investor',
 '--state','.local/transfers/investor-link-phase3h-fees5000-20261105T161641902Z.json',
 '--approve-broadcast','0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86',
 '--near-rpc','https://archival-rpc.testnet.fastnear.com',
 '--evm-rpc','https://rpc.sepolia.ethpandaops.io'
)
```

Separate explicit authorization is requested for exactly one EVM broadcast of this signed hash, conditional on freshness and all live checks passing. If approved and accepted, reconcile receipt/event/exact balance deltas through read-only calls. If submission is uncertain, preserve state and stop without retry or replacement.

Local public signing/reconciliation outcomes and read-only suitability evidence are preserved under `.local/transfers/evidence/`. No application source, dependency, Solidity or prior transaction/evidence file was modified. Two-leg public evidence remains pending until the return actually executes.
