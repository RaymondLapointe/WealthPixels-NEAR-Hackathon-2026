# Phase 3G: first Treasury-to-Investor LINK delivery

November 5, 2026. **Successful: exactly 1 LINK delivered and independently verified on Ethereum Sepolia.**

The approved `broadcast-recovered` command was invoked once using the corrected PowerShell argument array. Its fresh recovery audit passed in **4.104 seconds**, within the unchanged 30-second window, before the durable audit/submission state and single send. The RPC returned the exact approved Ethereum hash.

- NEAR signing transaction: [8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs](https://testnet.nearblocks.io/txns/8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs)
- Ethereum transaction: [0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719](https://sepolia.etherscan.io/tx/0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719)
- Network/token: Sepolia 11155111; LINK `0x779877A7B0D9E8603169DdbD7836e478b4624789`.
- Treasury: `wealthpixels-treasury.testnet`, `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`.
- Investor: `wealthpixels-investor.testnet`, `0x07FE574EdB1B2f537F9be452312C15A5b9427820`.

## Verification

The existing read-only `reconcile` command verified the signed transaction, successful receipt, exact LINK Transfer event, canonical block/parent, fee calculation and exact Treasury/Investor token deltas; it saved status `confirmed`. A separate read-only collection and the existing independent `verifyTransferProof` verifier bound the original successful NEAR MPC signature to the mined Ethereum transaction. An independent reviewer checked the preserved public proof, event and balance arithmetic.

Mined block **12070134**, hash `0x7573c5332c3e3a4e4a5290fd41c48a48ffb36c7f6075ea1d6eace292136816b5`. Receipt status **1**. Latest evidence records **31 confirmations** at head **12070164**.

| Role | LINK before → after | Verified ETH after |
| --- | --- | --- |
| Treasury | 25 → 24 | 0.04999999985630444 |
| Investor | 0 → 1 | 0.05 |

Gas used **140,878** at **1,020 wei/gas**; actual fee **143,695,560 wei = 0.00000000014369556 ETH**. The Treasury ETH decrease equals that fee exactly; Investor ETH was unchanged. Treasury confirmed/pending nonces are **1/1**.

Original signed bytes, nonce 0, gas limit 170,424, fee parameters, amount, recipient and preparation timestamp `2026-11-04T22:05:28.617Z` are unchanged.

## Preserved evidence and scope

Public single-transfer evidence: [evidence/treasury-link-delivery.json](../evidence/treasury-link-delivery.json). It is explicitly labelled live evidence, contains both public transaction hashes and recorded public observations, and covers this delivery only.

Ignored local audit: `.local/transfers/evidence/phase3g-approved-broadcast-ff3272b7.json`, SHA256 `212d1f416f6586931725d9b196e8bd539e4677ff648e701e0a23aeb0ecae2586`. Raw read observations and command outcomes are preserved beside it. The existing state remains at its original path with validated status `confirmed`.

Only evidence/report files were added in this checkpoint; no application source, Solidity, dependencies or safeguards changed. No private credentials were accessed, new NEAR request submitted, replacement transaction created or additional EVM broadcast attempted.

No unresolved issue remains for the first delivery. The investor return was not prepared, signed or executed. The two-leg evidence manifest remains pending until separately authorized return work is completed.
