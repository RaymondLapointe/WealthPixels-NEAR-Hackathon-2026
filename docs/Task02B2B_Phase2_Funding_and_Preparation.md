# Task 02B-2B Phase 2 — Funding verified; preparation stopped at gas cap

November 4, 2026. **Funding and public identity checks passed. The existing preparation workflow stopped at the approved gas limit. No prepared transaction or unsigned hash exists. The cap has not been changed.**

## Verified funding

Read-only Sepolia snapshot: chain ID **11155111**, block **12064055**, hash `0x2f96b2fdef561b475daa71bf577679150d45a05288163f998c06c15a79e20d56`, timestamp **2026-11-04 17:58:36 UTC**. RPC: `https://ethereum-sepolia-rpc.publicnode.com`.

| Role | Verified address | Sepolia ETH | LINK | Confirmed / pending nonce |
| --- | --- | ---: | ---: | --- |
| Treasury | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` | **0.05** | **25** | **0 / 0** |
| Investor | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` | **0.05** | **0** | **0 / 0** |

Treasury has enough LINK to send exactly **1 LINK**. Both ETH balances cover the existing **0.0036 ETH maximum-fee budget**. Investor's return inventory will come from the treasury delivery; no initial LINK funding is required. Token `0x779877A7B0D9E8603169DdbD7836e478b4624789` has deployed code (4,282 bytes) and reports 18 decimals. An initial public RPC code-read error was followed by successful read-only checks; no transaction parameters were changed.

## Refreshed NEAR authority checks

Both existing accounts still have their sole expected, distinct FullAccess keys and **10 test NEAR**, locked balance zero, storage usage 182 bytes. `verifyRoleMpc` passed for both. Treasury was checked at finalized block **276228734** (`6L8atN2Tb1BsdqTJ9xZWtTZZSxRJmG4FmRb7UGLe1x9P`); investor at **276228733** (`ADxhn1P6XoowTh5zTja9SWeM9fow1Vm8vuoVjsPRXkZ3`).

MPC remains **v1.signer-prod.testnet**, version **3.18.0**, ECDSA domain **0**, `CaitSith`, purpose `Sign`, threshold 11, epoch 27/attempt 1; minimum attachment **15 Tgas**. The reviewed root is unchanged:

```text
secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3
```

Fixed path `wealthpixels/sepolia/v1` still derives both complete verified EVM addresses. Local-versus-contract points match; independent public math reproduced the addresses again. The account/public-key and nonce values are recorded in [the public check results](Task02B2B_Phase2_Public_Checks.json). No credential files were opened and no key-possession proof or live signature is claimed.

## Preparation outcome and precise blocker

Executed once:

```text
npm run transfer -- prepare --role treasury --state .local/transfers/treasury-link.json --gas-limit-cap 120000 --max-fee-gwei 30 --max-total-fee-eth 0.0036
```

It returned exit **1**, `PREFLIGHT_FAILED: Buffered gas limit exceeds the approved gasLimitCap.` The subsequent inspect command was not run because preparation failed. No `.local/transfers/treasury-link.json` state file or lock remained. There is **no unsigned hash to approve for signing**.

Read-only diagnosis of the same exact transfer at block **12064064**, hash `0xa1ff3734fd3c22f1f228a914f1ba88f08f682fd0e3a81f0dc6b6374f23e20187`, timestamp **2026-11-04 18:00:24 UTC**:

| Parameter | Observed value |
| --- | --- |
| Sender | Treasury address above |
| Recipient | Investor address above |
| Token | Official Sepolia LINK contract above |
| Amount | **1 LINK**, `1000000000000000000` base units |
| ETH value | **0** |
| EVM nonce | **0**, matching pending nonce |
| Transfer simulation | **Succeeded**, returned true |
| Raw gas estimate | **142,020** |
| Required gas limit with existing 20% buffer | **170,424** |
| Approved gas-limit ceiling | **120,000 — failed** |
| Base fee / priority fee | **16 / 2 wei per gas** |
| Provisional EIP-1559 max fee per gas | **34 wei** |
| Provisional maximum EVM fee at buffered gas | **5,794,416 wei = 0.000000000005794416 ETH** |
| Unsigned transaction hash | **Not created** |

These are diagnostic observations, not an approved or saved transaction. The provisional fee is below both existing fee caps, but that does not override the separate gas-limit ceiling. Successful signing/execution cannot be claimed, and not all preparation checks passed.

## Next approval needed

Recommend separately approving a **180,000 gas-limit ceiling** for a fresh preparation only, retaining the **30 gwei per-gas cap**, **0.0036 ETH total-fee cap**, exact **1 LINK** amount and verified recipient. The freshly measured buffered gas limit must fit all three limits; it will not automatically become 180,000. No such change has been applied. If the next estimate exceeds the revised ceiling, stop again rather than adjusting it automatically.

Only after that approval should the existing prepare/inspect workflow be run again with `--gas-limit-cap 180000`. Present its actual fields and unsigned hash for a **separate live MPC signing approval**. Keep EVM broadcast approval independent. Do not sign against the diagnostic fee values above, which are a time-sensitive snapshot.

Source/configuration files are unchanged. This checkpoint added only this report and its public JSON record; no tests were rerun because no application code changed. No credentials, faucet requests, account/key creation, MPC signing requests or EVM broadcasts occurred. Stopped at the failed safety check as instructed.
