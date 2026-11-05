# Task 02B-2B Phase 3H: Investor return prepared

November 5, 2026. **Preparation and inspection passed. Stopped before credential access, NEAR signing or EVM broadcasting.**

## Completed Treasury delivery verified

Fresh read-only verification confirmed Treasury **24 LINK**, Investor **1 LINK**, Treasury confirmed/pending nonce **1/1**, Investor confirmed/pending nonce **0/0**, and respective ETH balances **0.04999999985630444 / 0.05**. The existing receipt, exact 1 LINK Transfer event and original finalized NEAR signature were reverified: **335 confirmations** at the readiness snapshot.

NEAR signing hash: `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs`. Ethereum delivery hash: `0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719`.

The Treasury state remains confirmed and unchanged (SHA256 `e33539f4e626b3d200cdd89843751599a01f34f5a1355fa628d310a771eda83d`). Public `evidence/treasury-link-delivery.json` remains unchanged (SHA256 `e99d120a99da474392387f3203400734ec4fd8ff47a2d273827a40e147b7ca39`).

## Prepared Investor transaction

| Parameter | Value |
| --- | --- |
| Network | Ethereum Sepolia, chain ID 11155111; type 2 / EIP-1559 |
| Sender | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| Recipient | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| EVM to / LINK contract | `0x779877A7B0D9E8603169DdbD7836e478b4624789`; 18 decimals |
| Amount | Exactly 0.1 LINK / 100000000000000000 base units |
| ETH value / access list | 0 / [] |
| Nonce | 0 |
| Raw estimate / buffered gas limit | 43,334 / 52,001; rounded-up 20% buffer |
| Observed base fee | 22 wei/gas |
| Actual selected max fee / priority | 47 / 3 wei/gas |
| Actual maximum EVM fee | 2,444,047 wei = 0.000000000002444047 ETH |
| Protective ceilings | 180,000 gas; 30 gwei/gas; 0.0036 ETH total |
| Preparation block | 12070536, `0xdc08b1570c064a37bafd5e64aab8bb3d70f524a3c06291c85bdd3ef014247128` |
| Created / expires | 2026-11-05T16:02:20.233Z / **2026-11-05T16:17:20.233Z** |

Unsigned digest:

```text
0x041c3f82557936f45f38750675f8e5fc6a4f39ecdad547e2532ce1e299b62499
```

Calldata:

```text
0xa9059cbb0000000000000000000000007548b35f4cb051beec61550fc93cb7d1e9028c87000000000000000000000000000000000000000000000000016345785d8a0000
```

Saved ignored state: `.local/transfers/investor-link-phase3h-20261105T160006254Z.json`, status `prepared`, SHA256 `b016864c10a08d7ef75c0c4cc8f38ba8b434ff2e69a9596f32b697764877f7fd`. No NEAR submission hash or signed EVM transaction exists.

All configured checks passed: Investor account/access-key/MPC public verification, independently derived address, Sepolia chain, role EOAs, exact LINK identity (codehash `0xcafbd9135200b24454a9ffcac5a8db40947a17f8a8a542062d0f1fb48bd8b269`), decimals, nonce, inventory/gas funds, transfer simulation, gas buffer and ceilings, fee coverage and canonical block consistency. A separate offline inspection reconstructed the same digest and decoded the exact recipient/amount.

## RPC issue and unchanged workflow

Two read-only preparations using PublicNode stopped with `RPC_FAILED: Sepolia read failed (eth_getCode): JSON-RPC -32001`; neither produced state or a transaction. Targeted public reads at canonical block 12070485 returned LINK/Treasury code successfully but Investor code failed with `-32000: header not found`, consistent with provider inconsistency. No EOA check was bypassed.

The documented public Alchemy demo returned HTTP 429; dRPC reported that Sepolia requires a paid plan. The [Ethereum chain registry](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-11155111.json) lists `https://rpc.sepolia.ethpandaops.io`; it responded without credentials with chain ID 11155111 and passed the full existing preparation. This endpoint was supplied explicitly through `--evm-rpc`, with no application/configuration change.

Successful commands:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @(
 'run','transfer','--','prepare',
 '--role','investor',
 '--state','.local/transfers/investor-link-phase3h-20261105T160006254Z.json',
 '--gas-limit-cap','180000',
 '--max-fee-gwei','30',
 '--max-total-fee-eth','0.0036',
 '--near-rpc','https://archival-rpc.testnet.fastnear.com',
 '--evm-rpc','https://rpc.sepolia.ethpandaops.io'
)

.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','transfer','--','inspect','--role','investor','--state','.local/transfers/investor-link-phase3h-20261105T160006254Z.json')
```

The existing Investor prepare/inspect/sign/reconcile/ordinary-broadcast workflow needs no source correction. It uses the corrected MPC parser, full public-key/expected-sender validation, distinct Investor credentials selected explicitly, one credential per process, and separate hash-bound approvals. The Treasury-specific expired recovery route does not apply to Investor.

## Approval-critical limits

**The selected 3-wei priority fee is unusually low.** The provider-derived fees currently pass the unchanged full-tip coverage check (22 + 3 <= 47 wei), but future RPC acceptance and validator inclusion are not guaranteed. The current guard would stop if base fee exceeds 44 wei. No minimum-tip override or fee increase was introduced.

Signing authority is **wealthpixels-investor.testnet**, registered public key `ed25519:HYbgeU5vRTw686L5xxp3JtsyzrcBrQcpR3MtBq197DWc`; MPC contract `v1.signer-prod.testnet`, domain **0**, path **wealthpixels/sepolia/v1**, configured **100 Tgas + 1 yoctoNEAR**. No Treasury credential/hash/transaction is reused.

Separate approval is required to request one Investor MPC signature for the displayed digest while its state remains fresh. Signing and ordinary EVM broadcast both enforce the original 15-minute window; do not reset timestamps or silently substitute another preparation/hash. If expired or parameters change, preserve this state and review a newly prepared digest. Signature verification/reconciliation precedes a separate EVM broadcast approval.

No source, dependency or legacy Solidity changes occurred. Only this report and ignored public readiness/diagnostic/unsigned-state records were added; no new tests were necessary for running the existing workflow. The two-leg evidence manifest remains pending. Treasury 24.1 LINK / Investor 0.9 LINK are future expected balances only after the separately approved return executes.
