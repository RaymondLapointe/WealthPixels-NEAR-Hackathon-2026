# Task 02B-2B Phase 3D — First live MPC signing result

November 4, 2026. **Exactly one live NEAR MPC signing submission completed successfully. Independent cryptographic verification recovered the expected Treasury public key/address and assembled the signed Sepolia transaction offline. Nothing was broadcast to Sepolia.**

| Evidence | Result |
| --- | --- |
| NEAR signing hash | `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs` |
| NEAR execution | **FINAL / SuccessValue**, no failed receipts |
| Requesting account | `wealthpixels-treasury.testnet` |
| Registered signing public key | `ed25519:8y8NfEhTLWFYgMCKhGLQBPVPZaEBjQvdphf29ta6BQJ1` |
| NEAR access-key nonce | **275945855000001** |
| Receiver / method | `v1.signer-prod.testnet.sign`, one direct function-call action |
| Domain / path | **0** / `wealthpixels/sepolia/v1` |
| Attachment / deposit | **100 Tgas / 1 yoctoNEAR** |
| Approved unsigned digest | `0xd092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4` |
| MPC scheme | **Secp256k1** |
| Independent signature validation | **Passed**, recovered complete expected MPC-derived public point |
| Recovered EVM sender | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Signed EVM transaction hash | `0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719` |
| Live MPC submissions | **1**, no retries |
| EVM broadcasts | **0** |

## Execution and authorization

The saved state matched the explicitly approved digest and was unexpired at **22:08:21.457UTC**, before its22:20:28.617UTC expiry. The existing signing command was then invoked once using only the existing protected external Treasury credential. The SDK-derived credential public key matched the registered key; no Investor credential was loaded. All live signing preflights passed. The NEAR hash was persisted before submission as designed, and the command returned near-submitted.

The onchain action contains exactly the approved payload_v2.Ecdsa digest, domain0/path above,100Tgas and1yocto. The RPC final result is successful; this is the first demonstrated live MPC authorization for this Treasury identity. EVM transfer fields remain exactly1LINK from Treasury to Investor on Sepolia11155111, officialLINK `0x779877A7B0D9E8603169DdbD7836e478b4624789`, nonce0, gas170424, maxFee1028wei/gas, priority1000wei/gas, zeroETHvalue and emptyaccesslist.

## Local reconciliation compatibility issue

The existing reconciler marked the state **near-failed** because its signature normalizer requires the raw R-point prefix parity to equal recovery_id. The real successful response has prefix **03** (parity1), recovery_id **0**, and an already low-s scalar. This valid response violates that parser assumption.

Read-only/offline diagnosis used the actual returned r/s/recovery_id, retained point/scalar-range validation, and verified recovery against the full trusted MPC-derived Treasury public key. A second independent audit decoded the approved request and rebuilt the EVM transaction. Both obtained the same Treasury sender and signed transaction hash above, with keccak(serialized) matching the hash and unsignedHash matching the approved digest.

Thus **near-failed is a local validation classification, not an onchain failure or invalid signature**. No application code or transaction state was changed to bypass it. A narrow compatibility fix and offline regression test using this public result are needed before the existing CLI can reconcile/broadcast normally. Keep mandatory expected-sender recovery; remove only the unsupported raw-point-parity equality assumption. **Do not repeat MPC signing: the required signature already exists.**

## Evidence and suitability

Preserved ignored files:

- Operation state: `.local/transfers/treasury-link-phase3d-20261104T220512383Z.json` (retains near-failed and the real NEARhash).
- Complete public NEAR final result: `.local/transfers/treasury-link-phase3d-near-outcome-8Lf5Nwoq.json`.
- Independently verified signed candidate, including executable bytes kept out of terminal logs: `.local/transfers/evidence/phase3d-verified-signed-candidate-ff3272b7.json`.

At **22:13:56.330UTC**, fresh read-only checks passed at Sepolia block **12065318**, hash `0xf724f2c7c7275b34651b4e92170bd890fd907dd344f8672105c568e951308643`: approved nonce0 was still current, gas/fees/balances/simulation passed, and the signed hash was not known to the RPC. The preparation was still within its local freshness window. It is cryptographically valid and passed those network checks, but **the current CLI cannot broadcast it while its parser/state remain unresolved**. The local15-minute gate ends **22:20:28.617UTC /5:20:28.617p.m. Toronto**. Review freshness handling and recheck nonce/fees before any separately approved broadcast; never silently alter the signed transaction or request another signature just to repair reconciliation.

No source changes, additional wallets/accounts, funding, repeated NEAR submissions or EVM broadcasts occurred. The exact authorized Treasury credential was used only by the signing command; subsequent diagnosis used public outcome/state only. Stopped for review of the compatibility issue and a separate EVM broadcast decision.
