# Task 02B-2B Phase 3 — Fresh treasury signing approval

November 4, 2026. Status: **fresh unsigned preparation complete; awaiting explicit approval of this digest for one live MPC signing submission.** No signing approval has been received or exercised.

| Parameter | Reviewed value |
| --- | --- |
| Network / nonce | Ethereum Sepolia, chain ID 11155111 / nonce 0 |
| Treasury sender | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Investor recipient | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| LINK contract | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |
| Amount | Exactly 1 LINK, `1000000000000000000` base units |
| ETH value / type | 0 wei / type 2 EIP-1559, empty access list |
| Raw estimate / buffered gas limit | 142,020 / 170,424, retaining 20% buffer |
| Gas ceiling | 180,000 |
| Max fee / priority fee | 38 wei/gas / 2 wei/gas |
| Maximum total EVM fee | 6,476,112 wei = 0.000000000006476112 ETH |
| Approved fee ceilings | 30 gwei/gas and 0.0036 ETH total |

Unsigned hash:

```text
0x0bbeaab0616c1faf398ce53dd21234ddc1f272e528101e6106b4507440177d89
```

Created **2026-11-04T18:38:16.719Z**. Expires **2026-11-04T18:53:16.719Z**, November 4 at **1:53:16.719 p.m. America/Toronto**. After expiry, obtain a freshly prepared and reviewed digest before signing. Fees/nonces are rechecked before any separately authorized submission; the saved transaction will not be silently changed.

Saved as `.local/transfers/treasury-link-phase3-20261104T183616124Z.json`, ignored and untracked. The earlier `.local/transfers/treasury-link.json` remains untouched with its original unsigned digest and prepared status. No uncertain state was overwritten or deleted.

All public preparation checks passed: correct network/token/deployed code/decimals/role EOAs; treasury 25 LINK and 0.05 ETH, investor 0 LINK and 0.05 ETH; matching EVM nonce 0; successful exact transfer simulation; gas buffer and fee caps; pinned canonical block consistency. EVM snapshot: block **12064251**, hash `0xb36d0882a96977a1a4ad74a0ee652fff446c945fc4ff39740f049cef7961cfff`. Independent RLP/calldata reconstruction and Keccak matched the digest and unsigned bytes.

Both public NEAR authorities passed fresh checks at finalized block **276232753**, hash `GmQC8yuSJtFMmdUfeqoYkA1GKyYpspSX54EJCK4bohP4`: expected distinct sole FullAccess keys, unchanged root/addresses, 10 test NEAR each and conservative storage-adjusted liquid balance 9.99818 NEAR. MPC is version **3.18.0**, domain 0, minimum attachment 15 Tgas. Observed gas/minimum-purchase prices remain 100000000/1000000000 yoctoNEAR per gas; balances cover the 0.25 NEAR operating reserve.

The proposed separately authorized NEAR request is one direct `sign` call:

- Requesting account: **wealthpixels-treasury.testnet**.
- MPC contract: **v1.signer-prod.testnet**.
- Domain: **0**; path: **wealthpixels/sepolia/v1**.
- Attached gas: **100 Tgas**; deposit: **1 yoctoNEAR**.
- Argument `request.payload_v2.Ecdsa`: the exact unsigned hash above without its `0x` prefix.
- Only the existing protected external Treasury credential file may be loaded after approval; its derived public key must match the registered Treasury FullAccess key.
- Persist the NEAR transaction hash before one submission; never automatically retry an uncertain submission. Reconcile read-only, validate the final direct request/response and recover the Treasury EVM sender.
- Stop with the NEAR outcome and any verified signed EVM hash. EVM broadcasting requires separate approval.

The first public preparation attempt stopped on an eth_getCode RPC read error before writing state. Subsequent public code reads recovered, and the same approved unsigned workflow completed successfully; no failed signing or broadcast was retried. Prepare and inspect both returned exit 0 on the successful attempt. No source/configuration files changed.

**Approval requested:** one direct MPC signing submission for exactly `0x0bbeaab0616c1faf398ce53dd21234ddc1f272e528101e6106b4507440177d89`, using the Treasury NEAR authority and parameters above, followed by read-only reconciliation and a stop before EVM broadcasting.

Private credentials accessed: **none**. MPC signing submissions: **0**. NEAR signing transaction hash: **none**. Signed EVM transaction hash: **none**. EVM broadcasts: **0**.
