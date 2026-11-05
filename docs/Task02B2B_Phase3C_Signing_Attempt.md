# Task 02B-2B Phase 3C — Signing stopped before submission

November 4, 2026. **No MPC signing request was submitted. The single signing-command invocation stopped at a Sepolia public RPC preflight read. It was not retried.**

Authorized digest: `0xe52b608fe4fae8bddd23b623ef7e9be01105e79f4bcf50626339fcc7ea69f886`.

State: `.local/transfers/treasury-link-phase3b-20261104T184719418Z.json`.

## Checks and attempt

- Freshness checked at **18:52:25.244 UTC**: the exact authorized digest matched, state was prepared, no prior submission hash existed, and the preparation had not expired.
- Expiration remains **19:02:39.679 UTC / 2:02:39.679 p.m. America/Toronto** on November 4.
- Fresh public Treasury NEAR account/key/MPC checks passed: expected sole FullAccess key, finalized access nonce275945855000000, MPC3.18.0/domain0, expected derived Treasury address, minimum15Tgas, and sufficient conservative liquid balance9.99818NEAR for the0.25NEAR operating reserve.
- Existing CLI `transfer sign` was invoked **once**, with the exact approved digest, state path and only the selected protected Treasury credential path.
- It returned exit **1**: `RPC_FAILED: Sepolia read failed (eth_getCode); check the public RPC and retry the read only.`

The workflow awaits `recheckSepoliaLinkTransfer` before calling `prepareMpcSigning`, which is where credential loading and local NEAR signing begin. This failure occurred in that first public EVM recheck. Therefore the credential loader, local NEAR signing, persisted-hash and submission stages were not reached. Passing a file path on the CLI did not open that file.

## Preserved state and read-only diagnosis

At **18:54:49.879 UTC**, state inspection confirmed unchanged status **prepared**, the same approved digest, no NEAR transaction hash, no MPC outcome and no signed EVM hash. The public-only diagnostic then passed the exact stored transaction's complete EVM recheck at block **12064332**, hash `0x3f4aa15d9dfb91695652f34b10ce45b19d370914287e1bc195828601078cb592`. No RPC error recurred in that diagnostic; the exact transient provider cause was not established. No limits, nonce, fee fields, recipient or digest were changed.

| Requested evidence | Result |
| --- | --- |
| NEAR signing transaction hash | **None — not submitted** |
| NEAR transaction status | **No transaction created/submitted** |
| MPC signature validation | **Not performed; no signature received** |
| Recovered EVM sender | **Unavailable; no signature** |
| Expected public Treasury EVM address | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Signed Ethereum transaction hash | **None** |
| Signing-command invocations | **1** |
| Actual MPC signing submissions | **0** |
| Private credential files accessed | **0** |
| EVM broadcasts | **0** |

Stopped under the no-automatic-retry instruction. A further signing-command attempt needs an explicit human decision. If the preparation has expired by that time, prepare and review a new digest and obtain separate approval; do not substitute it under the existing hash authorization. Preserve all current state and do not broadcast anything.
