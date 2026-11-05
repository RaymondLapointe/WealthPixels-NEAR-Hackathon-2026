# Phase 3H: Investor return completed and two-leg evidence verified

November 5, 2026. **Success: the existing signed Investor transaction delivered exactly 0.1 LINK back to Treasury. Both legs are confirmed and public verification passed.**

## Execution and authorization

The authorized `broadcast-recovered --role investor` command ran **once**. Its fresh audit passed in **5.653 seconds / 30 seconds**, then the durable audit and submitting marker were saved before the single EVM send. The RPC returned the exact approved signed hash. Existing read-only reconciliation verified the successful receipt, original signature/bytes, exact LINK Transfer event, canonical block and exact balance deltas; state is now **confirmed**.

- Investor NEAR signing: [4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z](https://testnet.nearblocks.io/txns/4uD2MLZVKW8qNKcRQPzweVVwvb3yDTNw5DzHm2MPky9z).
- Investor Sepolia return: [0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86](https://sepolia.etherscan.io/tx/0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86).
- Original approved unsigned digest: `0x5dc09f64bf1751de61ce3cf3c3bdea6561ce2e38d992393eef57c3dca10641f9`.
- Original creation timestamp remains **2026-11-05T16:17:00.756Z**; no timestamp, signed byte, amount, recipient, nonce or fee parameter changed.
- Return block **12070957**, hash `0xa17c8b827b395c7b2d924aed4ff0687d5b63e9f5baf551351338e63d93b1c673`; receipt status **1**.

The completed two-leg public verification subsequently returned **verified**, with Treasury **914 confirmations** and Investor **91 confirmations**. These counts are observations, not a promise of a fixed count.

## Verified balances and actual gas

Post-return balances were read at Sepolia block **12070971** and independently checked against the receipt's parent/mined-block changes.

| Role | LINK before → after | ETH after |
| --- | --- | --- |
| Treasury | 24 → **24.1** | **0.04999999985630444** |
| Investor | 1 → **0.9** | **0.04999999995618284** |

Both addresses' confirmed/pending EVM nonces are **1/1**.

| Gas/fee parameter | Value |
| --- | --- |
| Signed nonce / gas limit | 0 / **52,001** |
| Preparation estimate / buffer | **43,334 / 20%**, rounded up |
| Signed maximum fee per gas | **5,000 wei** |
| Signed maximum priority fee | **1,000 wei** |
| Signed maximum total EVM fee | **260,005,000 wei = 0.000000000260005 ETH** |
| Actual gas consumed | **42,958** |
| Actual effective gas price | **1,020 wei/gas** |
| Actual EVM fee paid | **43,817,160 wei = 0.00000000004381716 ETH** |

The Investor's ETH decrease equals the actual gas fee exactly; Treasury ETH did not change during the return. The event and historical token balances prove exactly **100000000000000000** LINK base units moved Investor → Treasury.

## Public evidence and judging

- [Completed two-leg live manifest](../evidence/sepolia-link.json).
- [Detailed Investor return proof](../evidence/investor-link-return.json).
- [Preserved original Treasury delivery proof](../evidence/treasury-link-delivery.json), unchanged SHA256 `e99d120a99da474392387f3203400734ec4fd8ff47a2d273827a40e147b7ca39`.
- Investor return proof SHA256: `8813bce5d1591b95b454c3e19b9d5ca06bc16b62aee17f197825ebf866cf9f8b`.

The first standard export hit an HTTP 429 receipt-read rate limit; the second provider failed a historical balance query. A subsequent single historical-state query confirmed availability on ethPandaOps. Export then ran the **same existing receipt/historical-balance verifiers for both legs and the same public evidence verifier**, using 35 real public RPC reads paced at one-second intervals. Every check passed before writing the completed manifest. No fixtures, cached balance substitution, weakened guard or source-code bypass was used. The pacing applied only to post-confirmation read-only export; the recovery audit's 30-second limit stayed unchanged.

The independent CLI also passed without credentials:

```text
npm run verify:evidence -- --manifest evidence/sepolia-link.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://rpc.sepolia.ethpandaops.io
```

The Windows development launcher preserved npm's `--` separator through its explicit argument array. README.md and evidence/README.md now describe the completed real transfers and distinguish offline fixtures from live public evidence. Public RPC rate limits remain an availability consideration; verification fails rather than treating missing data as success.

## Preservation and scope

Original signed state remains at `.local/transfers/investor-link-phase3h-fees5000-20261105T161641902Z.json` with validated status **confirmed**, the retained attempt/audit marker and receipt. Fresh audit: `.local/transfers/evidence/phase3h-investor-approved-recovery-broadcast-3be24eea.json`, SHA256 `dde45a4014811fdfa6295448eeaf46a3f20f1aa4d2c8bfabe78cb2b183ef39ce`. Raw public observations and paced export/verification records are preserved in ignored local evidence files.

No credentials were accessed, new NEAR signing requested, replacement transaction created, duplicate broadcast attempted, source/dependency/Solidity changes made or repository published during execution. Only public evidence/documentation and ignored execution records were updated. The prior recovery implementation's 122 passing offline tests and passing typecheck remain unchanged; no additional code changes required new tests.

**No unresolved blocker remains for the two-leg LINK demonstration.** Separate NEAR signing authorities have now authorized the delivery and return. The disclosed single-operator testnet demonstration does not establish production custody independence. Task 03 has not begun.
