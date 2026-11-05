# Phase 3H: revised Investor fee preparation — signing approval checkpoint

November 5, 2026. **Recommended fees prepared and inspected; no signing, broadcasting or private credential access.**

The proposed **1,000 wei/gas priority fee and 5,000 wei/gas maximum fee** are suitable under the observed Sepolia conditions. Fresh preparation and exact-transaction recheck both observed a **19 wei/gas base fee**. Full priority coverage requires 1,019 wei/gas, within the selected maximum. The unchanged full-tip check permits base fees up to 4,000 wei/gas. The tip matches the prior successful Treasury transfer; inclusion remains subject to future network and RPC conditions.

| Approval field | New unsigned transaction |
| --- | --- |
| Network/type | Ethereum Sepolia 11155111; EIP-1559 type 2 |
| Sender | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| Recipient | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| LINK / amount | `0x779877A7B0D9E8603169DdbD7836e478b4624789`; exactly 0.1 LINK / 100000000000000000 base units |
| Nonce / ETH value / access list | 0 / 0 / [] |
| Fresh gas estimate / 20% buffered limit | 43,334 / 52,001 |
| Priority / maximum fee per gas | 1,000 / 5,000 wei |
| Maximum total EVM fee | **260,005,000 wei = 0.000000000260005 ETH** |
| Protective ceilings | Unchanged: 180,000 gas; 30 gwei/gas; 0.0036 ETH total |
| Created / expires | 2026-11-05T16:17:00.756Z / **2026-11-05T16:32:00.756Z** (11:32:00.756 Toronto) |

**New unsigned digest:**

```text
0x5dc09f64bf1751de61ce3cf3c3bdea6561ce2e38d992393eef57c3dca10641f9
```

**New ignored state:** `.local/transfers/investor-link-phase3h-fees5000-20261105T161641902Z.json`, status `prepared`, SHA256 `0e98e973c9b4093e7eba3947aa314a6380d2c211909aaa2d6131af707bdae27d`.

Fresh public NEAR/MPC checks verified the Investor authority, current registered key and expected derived address; MPC version 3.18.0. Sepolia checks verified chain/token identity, exact code hash/18 decimals, role EOAs, nonce, transfer simulation, canonical blocks, fresh gas, fee caps and sufficient inventory/gas. Balances remain Treasury 24 LINK / 0.04999999985630444 ETH; Investor 1 LINK / 0.05 ETH.

The existing programmatic preparation helpers and Ethers transaction builder constructed a **new** preflight from fresh observations with explicit fees. `assertLinkPreflight(newPreflight, trustedPolicy)` and a fresh `recheckSepoliaLinkTransfer` passed; normal state persistence saved only the new, unused path. Existing CLI inspection and independent offline reconstruction passed. No application source or CLI flags changed. Selected public EVM RPC remains `https://rpc.sepolia.ethpandaops.io`.

The previous state `.local/transfers/investor-link-phase3h-20261105T160006254Z.json` remains byte-for-byte unchanged, SHA256 `b016864c10a08d7ef75c0c4cc8f38ba8b434ff2e69a9596f32b697764877f7fd`. It was not edited, timestamp-reset or signed. Treasury evidence was not modified. Public preflight observations and the preparation recipe are preserved in ignored local evidence files.

Inspect the new state with:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','transfer','--','inspect','--role','investor','--state','.local/transfers/investor-link-phase3h-fees5000-20261105T161641902Z.json')
```

**Separate approval requested:** exactly one Investor NEAR MPC signing submission for the **new digest above**, provided the saved preparation remains fresh and live checks pass. Signing account `wealthpixels-investor.testnet`; contract `v1.signer-prod.testnet`; ECDSA domain 0; path `wealthpixels/sepolia/v1`; 100 Tgas and 1 yoctoNEAR. A separate approval is still required for EVM broadcasting. Normal signing and broadcasting both enforce the original 15-minute window. If expired or checks fail, stop; no hash substitution, automatic retry or fee change.
