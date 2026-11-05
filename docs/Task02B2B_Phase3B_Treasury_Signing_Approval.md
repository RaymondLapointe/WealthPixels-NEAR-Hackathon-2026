# Task 02B-2B Phase 3B — Fresh signing approval checkpoint

November 4, 2026. **Preparation/inspection passed; awaiting separate explicit approval for one live MPC signing submission. No signing or EVM submission has occurred.**

| Field | Fresh reviewed value |
| --- | --- |
| Network / nonce | Ethereum Sepolia, 11155111 / 0 |
| Sender | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Recipient | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| Token | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |
| Amount | 1 LINK, `1000000000000000000` base units |
| ETH value / type | 0 wei / EIP-1559 type 2, empty access list |
| Gas estimate / buffered limit | 142,020 / 170,424; 20% buffer |
| Gas ceiling | 180,000 |
| Max fee per gas / priority fee | 34 wei / 2 wei |
| Maximum EVM fee | 5,794,416 wei = 0.000000000005794416 ETH |
| Approved per-gas / total ceilings | 30 gwei / 0.0036 ETH |

Fresh unsigned hash:

```text
0xe52b608fe4fae8bddd23b623ef7e9be01105e79f4bcf50626339fcc7ea69f886
```

Created **2026-11-04T18:47:39.679Z**; expires **2026-11-04T19:02:39.679Z**, November 4 at **2:02:39.679 p.m. America/Toronto**. Signing must use this fresh state and fail closed if expired or if fresh nonce/balance/fee checks no longer pass. Do not silently rebuild or substitute a digest after approval.

Ignored new state: `.local/transfers/treasury-link-phase3b-20261104T184719418Z.json`. Earlier unsigned states remain preserved. EVM snapshot: block 12064297, `0x15095572526cf3d3eaac9e96983852ee6628429e13ae5ce93919972862d3224c`. Treasury balance: 25 LINK and 0.05 ETH; investor: 0 LINK and 0.05 ETH. Exact transfer simulation, network/token code/decimals/EOAs, nonce, gas/buffer, all fee limits and unsigned hash integrity checks passed.

Fresh NEAR public checks passed for both expected sole FullAccess authorities and derived EOAs; each account still has 10 test NEAR. Treasury check: block 276233902, hash `6xqFALLSLWUXucCyZbLbEexYFXWqY35gGReE3Y5xt3Cy`. MPC remains version3.18.0 with unchanged verified root, ECDSA domain0 and minimum gas15Tgas.

Proposed request after separate approval:

- Requesting account: `wealthpixels-treasury.testnet`.
- Receiver/method: `v1.signer-prod.testnet.sign`.
- `request.payload_v2.Ecdsa`: the exact hash above without `0x`.
- Domain0; path `wealthpixels/sepolia/v1`; attachment **100Tgas**; deposit **1yoctoNEAR**.
- Load only the protected external Treasury credential; derive its public key and match the registered FullAccess key.
- Persist the NEAR hash before exactly one direct submission. Reconcile read-only and verify signature recovery to the Treasury EOA. Do not automatically retry uncertain/failed signing.
- Report the NEAR hash/status, signature result/recovered sender and signed EVM hash, then stop before broadcasting. EVM submission needs another approval.

Commands executed successfully: existing `npm run transfer -- prepare` with the new state path and `--gas-limit-cap 180000 --max-fee-gwei 30 --max-total-fee-eth 0.0036`, then `npm run transfer -- inspect`. No application source or architecture changes were made. No credentials were accessed; MPC signing submissions0; NEAR signing hashnone; EVM broadcasts0.

**Approval requested:** exactly one live direct MPC signing submission for `0xe52b608fe4fae8bddd23b623ef7e9be01105e79f4bcf50626339fcc7ea69f886` under the parameters above, followed by read-only reconciliation and a stop before EVM broadcasting.
