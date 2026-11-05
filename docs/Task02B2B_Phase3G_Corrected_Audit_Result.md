# Phase 3G: corrected read-only audit passed

November 5, 2026. Exactly one corrected audit invocation executed; exit code 0. No credentials, NEAR signing or EVM broadcasting occurred. No source changes, signed bytes, fees, timestamps or safeguards were modified in this checkpoint.

## Result

Every required recovery-audit check passed: original signed-state integrity and fixed transfer parameters; fresh finalized NEAR account/MPC configuration and original successful signing outcome; complete derived public key, cryptographic signature and Treasury sender recovery; Sepolia chain 11155111; original LINK code hash and 18 decimals; role EOAs; sufficient balances; nonce equality; successful 1 LINK transfer simulation; adequate gas and original fee caps; no known signed hash/receipt; and canonical-block consistency.

The transfer remains exactly 1 LINK from Treasury `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` to Investor `0x07FE574EdB1B2f537F9be452312C15A5b9427820` via LINK `0x779877A7B0D9E8603169DdbD7836e478b4624789`.

| Observation | Result |
| --- | --- |
| Treasury balance | 25 LINK; 0.05 Sepolia ETH |
| Investor balance | 0 LINK; 0.05 Sepolia ETH |
| Treasury confirmed / pending nonce | 0 / 0 |
| Gas estimate / unchanged signed limit | 142,020 / 170,424 |
| Base fee / signed priority / signed maximum | 16 / 1,000 / 1,028 wei per gas |
| Full priority coverage | 1,016 <= 1,028 wei; passed |
| Maximum transaction fee | 175,195,872 wei = 0.000000000175195872 ETH |
| Signed transaction / receipt known to queried RPC | Neither found |
| MPC | Version 3.18.0; original root, domain 0 and path wealthpixels/sepolia/v1 verified |

Audit observations began **2026-11-05T13:37:05.955Z** and completed **13:37:09.347Z**: **3,392 ms**, within the unchanged **30,000 ms** window. Expiration was **13:37:35.955Z**. Outer command wall time was approximately 4.877 seconds.

The immutable public audit is saved in ignored `.local/transfers/evidence/phase3g-followup-approved-read-only-audit.json`, SHA256 `3bcf765ae0ba03e70b46c76637dbcec2d4e9abf33f84d1d877299a48bfb25612`.

The original signed state remains `signed`, without a broadcast-attempt marker, receipt or remaining lock. SHA256 is unchanged: `777f4dc6952bd5c1755569bcad904d01539247bd877fee14e3dc3bddc37e7ffc`. Signed EVM hash remains `0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719`; original NEAR hash remains `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs`.

## Remaining concerns and approval checkpoint

The transaction qualified at this snapshot. Passing public reads cannot prove RPC transaction-pool acceptance or guarantee validator inclusion with the unusually low 1,000-wei tip. The unchanged full-priority guard rejects base fees above 28 wei. No fee adjustment or new signature is authorized. Transient public RPC failures or slow reads/storage must stop execution; no automatic retry is permitted.

This preview expires while approval is reviewed. The approved broadcast command must generate its own complete new audit, preserve it, and enforce freshness again before any send. It cannot reuse this preview as authority.

The following existing command is proposed, **NOT EXECUTED**. Its audit filename was confirmed unused:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @(
  'run','transfer','--','broadcast-recovered',
  '--role','treasury',
  '--state','.local/transfers/treasury-link-phase3d-20261104T220512383Z.json',
  '--audit','.local/transfers/evidence/phase3g-approved-broadcast-ff3272b7.json',
  '--near-rpc','https://archival-rpc.testnet.fastnear.com',
  '--evm-rpc','https://ethereum-sepolia-rpc.publicnode.com',
  '--approve-broadcast','0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719',
  '--acknowledge-expired-preparation','2026-11-04T22:05:28.617Z'
)
```

Separate explicit approval is requested for **one** controlled broadcast of the exact signed EVM hash above, acknowledging the original preparation timestamp **2026-11-04T22:05:28.617Z**, conditional on the command's complete fresh checks passing. No investor return transfer is authorized.
