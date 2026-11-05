# Task 02B-2B Phase 2A — Treasury transaction prepared

November 4, 2026. **Preparation and inspection passed. The transaction is unsigned; no live MPC request or EVM broadcast was made.**

Your latest message shortened the token address. The preparation retains the full official Sepolia LINK address previously verified and pinned in the adapter, shown below. No contract/address constant or application code was changed.

| Approval-critical parameter | Prepared value |
| --- | --- |
| Network / chain ID | Ethereum Sepolia / **11155111** |
| Type | **2**, EIP-1559; empty access list |
| Treasury sender | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Investor recipient | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| LINK token contract | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |
| Token amount | **1 LINK**, `1000000000000000000` base units; 18 decimals |
| ETH value transferred | **0 wei** |
| EVM nonce | **0**, matching confirmed and pending observations |
| Raw gas estimate | **142,020** |
| Buffered gas limit | **170,424**, retaining the 20% buffer |
| Approved gas ceiling | **180,000** |
| Observed base fee | **15 wei/gas** |
| Prepared max fee per gas | **32 wei/gas** = **0.000000032 gwei** |
| Prepared priority fee | **2 wei/gas** |
| Prepared maximum EVM fee | **5,453,568 wei** = **0.000000000005453568 ETH** |
| Approved per-gas / total fee ceilings | **30 gwei / 0.0036 ETH** |

Unsigned transaction hash:

```text
0xf2d4f2b13a1e3197698114fda0a7005efd9a2997a16b6afb48aaae82b95c8a8e
```

Created **2026-11-04 18:18:46.165 UTC**. The existing 15-minute freshness window ends **18:33:46.165 UTC / 13:33:46.165 America/Toronto**. If approval occurs after expiry, a fresh transaction must be prepared and its hash reviewed before signing; this saved transaction will not be silently refreshed.

Saved in **`.local/transfers/treasury-link.json`**, state **`prepared`**. `git check-ignore` confirms it is ignored; it is not tracked. It contains no NEAR transaction hash, MPC outcome, EVM signature or submitted receipt.

## Checks and observations

The existing workflow verified Sepolia chain ID, deployed LINK code/18 decimals, both role EOAs, exact fixed transfer intent, successful transfer simulation, balances, matching confirmed/pending nonce, gas estimate/buffer, fee affordability and all three limits. Preflight used EVM block **12064153**, hash `0xe3045d3cb3c6dc82f91fad150d705fb76fb85563d9822cee0b5376f178653aaf`.

Balances: treasury **25 LINK / 0.05 Sepolia ETH**; investor **0 LINK / 0.05 Sepolia ETH**. Investor's return inventory arrives through the first transfer. Both have sufficient ETH for the approved maximum-fee budget.

Both NEAR accounts passed fresh public checks at finalized block **276230914**, hash `9Bwj4b7tPsXcvh1U8DEJ4HfBvvVn6nGa6rpzHKdqcK42`: expected distinct sole FullAccess keys, **10 test NEAR** each, unchanged root and derived addresses. MPC remains **v1.signer-prod.testnet, version 3.18.0, ECDSA domain 0**, fixed path **`wealthpixels/sepolia/v1`** and minimum gas attachment **15 Tgas**. The proposed later signing call uses 100 Tgas and one yoctoNEAR, subject to fresh checks and separate approval.

Independent inspection decoded the transfer calldata, rebuilt the EIP-1559 unsigned bytes and recalculated Keccak. All fields and the hash matched; no signature was present. All required checks for this preparation passed. Signature recovery and execution verification remain later steps.

## Commands executed

Using the project-local Node 22.23.4 runtime:

```text
npm run transfer -- prepare --role treasury --state .local/transfers/treasury-link.json --gas-limit-cap 180000 --max-fee-gwei 30 --max-total-fee-eth 0.0036
npm run transfer -- inspect --role treasury --state .local/transfers/treasury-link.json
```

Both returned exit **0**. Only fresh public RPC checks, unsigned preparation and local inspection were performed. No failed/uncertain transaction was retried. Application sources, contracts, signing architecture, amounts and destinations remain unchanged. No private credentials were accessed, funding requested, accounts created, MPC signing requests submitted or EVM transactions broadcast.

**Stopped before signing. Separate approval of the reviewed unsigned hash is required for the first live MPC signing submission. EVM broadcasting requires another approval.**
