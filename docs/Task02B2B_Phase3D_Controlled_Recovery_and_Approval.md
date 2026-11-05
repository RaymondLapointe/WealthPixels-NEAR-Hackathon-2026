# Task 02B-2B Phase 3D — Controlled recovery and signing approval

November 4, 2026. **Safe state confirmed. Fresh unsigned preparation passed. No signing authorization has been given for this new digest, and no signing command was invoked in this phase.**

All three earlier state files remain byte-for-byte identical (SHA-256 checked), prepared and unsigned; none contains a NEAR submission hash, MPC outcome, signed EVM transaction or receipt. Their freshness windows expired, so this phase used a new ignored state file. Fresh public access-key checks still show the sole expected keys and unchanged Treasury/Investor NEAR nonces275945855000000/275946428000000; each account retains10testNEAR. Public observations and the earlier failed-command control flow support that no MPC submission occurred.

## RPC readiness

The primary `https://ethereum-sepolia-rpc.publicnode.com` passed fresh read-only chain, contract/role code, decimals, balances, confirmed/pending nonce, transfer simulation and pinned-block gas-estimation checks. Official LINK remains deployed with4282bytes and codehash `0xcafbd9135200b24454a9ffcac5a8db40947a17f8a8a542062d0f1fb48bd8b269`. Treasury holds25LINK/0.05ETH; investor0LINK/0.05ETH. Exact1LINKsimulation succeeded.

Documented alternatives were investigated without signing:

- [dRPC Sepolia](https://drpc.org/chainlist/ethereum-sepolia-rpc), `https://sepolia.drpc.org`: live `eth_chainId` returned HTTP400/code35, chain unavailable on free plan. Not proposed for use.
- [Automata public network documentation](https://docs.1rpc.io/using-the-web3-api/networks), `https://public.1rpc.io/sepolia`: live requests returned HTTP429/code-32029 under the required parallel read workload. Not proposed for use.

Retain the primary RPC explicitly. Its historical intermittent failures are not claimed fixed; the current readiness and complete CLI preparation both passed. No paid/API-key service was configured, no source/provider implementation was changed, and no transaction fields were adjusted to overcome an RPC failure. A future signing-command error must stop rather than trigger an automatic retry.

## Exact approval request

| Field | Fresh reviewed value |
| --- | --- |
| Network / nonce | Ethereum Sepolia11155111 /0 |
| Treasury sender | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Investor recipient | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |
| LINK contract | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |
| Amount | Exactly1LINK, `1000000000000000000` baseunits |
| ETH value / type | 0wei / EIP-1559 type2, empty accesslist |
| Raw estimate / buffered gas limit | 142020 /170424,20% buffer |
| Gas ceiling | 180000 |
| Max fee / priority fee per gas | 1028wei /1000wei |
| Maximum total EVM fee | 175195872wei =0.000000000175195872ETH |
| Approved fee ceilings | 30gwei /0.0036ETH total |

Unsigned hash:

```text
0xd092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4
```

New ignored state: `.local/transfers/treasury-link-phase3d-20261104T220512383Z.json`. Statusprepared. Created **2026-11-04T22:05:28.617Z**; expires **2026-11-04T22:20:28.617Z**, November4 at **5:20:28.617p.m. America/Toronto**. EVM snapshotblock12065276, hash `0xdae4520fa2b2f97a2d671b249cd302a78bbf49be00fe40e72fec9bdbfa41e479`.

Fresh public NEAR/MPC checks passed: `v1.signer-prod.testnet` version3.18.0, unchanged root/derivedaddresses and expected sole FullAccesskeys, ECDSAdomain0, minimum15Tgas. Proposed one direct signing request: requesting account `wealthpixels-treasury.testnet`, method `v1.signer-prod.testnet.sign`, payload_v2.Ecdsa equal to this exactdigest without0x, domain0, path `wealthpixels/sepolia/v1`, gas100Tgas, deposit1yoctoNEAR.

The existing prepare and inspect commands passed with the new file, explicit primaryRPC and unchanged `--gas-limit-cap 180000 --max-fee-gwei 30 --max-total-fee-eth 0.0036`. Unsigned bytes/calldata and Keccak were audited. Old states remain ignored/untracked and preserved. No source changes or tests were needed.

**Explicit approval requested:** invoke the existing live signing command exactly once for this digest/state, using only the protected Treasury credential after its public-key match, followed by read-only NEAR reconciliation/signature recovery. Persist the NEARhash before submission; stop on failure/uncertainty. No EVM broadcast is authorized. If expired or live preflight fails, do not substitute another digest.

Credentials accessed0; MPC signing submissions0; signedEVMhashnone; EVMbroadcasts0.
