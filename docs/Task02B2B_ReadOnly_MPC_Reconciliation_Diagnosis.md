# Read-only diagnosis — Finalized MPC result and near-failed state

November 4, 2026. **The onchain transaction succeeded. The saved near-failed status is caused by an incorrect adapter validation assumption. No source correction or state-status change was applied during this investigation.**

## Preserved public evidence

NEAR hash: `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs`.

Fresh public RPC retrieval again reports **FINAL / SuccessValue**. The direct action matches the approved Treasury account/public key, MPC receiver, exact digest, domain0, path,100Tgas and1yoctoNEAR. The transaction outcome points to its successful execution receipt; the complete receipt tree contains **four receipt outcomes, zero failures**:

| Receipt | Executor | Outcome |
| --- | --- | --- |
| `7UBcruaLQtMNgpiSF4zwSfSC5vnQDBHQwN92cvXSZn8G` | MPC contract | SuccessReceiptId; one sign-request log |
| `Ec1YfuLafVjrnAEyVHvSRR7qARtFzFVvXVvZtFDiBWEL` | MPC contract | SuccessValue returning the signature |
| `ErQxo3wmt1tpthQwPAmCCMrwbkeWSBwK2oG2tLhVqjbC` | Treasury | SuccessValue |
| `3addupgXocSw5rq5sRY369CRaELxStvmEQHHSK9Nd5g9` | Treasury | SuccessValue |

The MPC log records predecessor `wealthpixels-treasury.testnet`, path `wealthpixels/sepolia/v1`, Ecdsa payload bytes equal to approved digest `d092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4`, and domain0. The complete unabridged logs, receipt outcomes, decoded request and public MPC response were preserved in a new ignored archive:

`.local/transfers/evidence/phase3d-public-investigation-20261104T221817759Z.json`

The original state and first public outcome archive remain byte-identical:

- State SHA-256: `cd6a9f90e53331ad7f40df9aca0cc143febe07d5fc809f6e8c734320dbc59b92`.
- Original outcome SHA-256: `a96225f43194149e44843d41109cca44d5773490f5aa26555ead94bbe1c62bd7`.

## Exact incompatibility

Expected and actual public response structure match:

~~~json
{
  "scheme": "Secp256k1",
  "big_r": { "affine_point": "03...(66 hex digits total)" },
  "s": { "scalar": "...(64 hex digits, already low-s)" },
  "recovery_id": 0
}
~~~

This example abbreviates public values for readability; the archive preserves them verbatim. The point is valid, r/s are nonzero and below the secp256k1 order, and recovery_id is supported. The failing condition is **src/evm/erc20-transfer.ts:265–268**:

~~~ts
const pointParity = point.startsWith("02") ? 0 : 1;
if (response.recovery_id !== pointParity) {
  throw new Error("MPC recovery_id does not match big_r point parity");
}
~~~

For the real result, raw R prefix03 implies parity1, but the provided recovery identifier is0. That equality assumption is invalid for this valid response. The failure propagates through `normalizeMpcOutcome` at signing.ts:312, whose catch reports generic INVALID_OUTCOME at:319; `reconcileSigning` then classifies it near-failed at workflow.ts:71. The existing offline test also enforced the incorrect assumption, so passing that fixture did not establish live compatibility.

**Do not rewrite the public response or flip recovery_id to match the prefix.** Independent verification computes a valid ECDSA verification point that is the negation of the raw R. Recovery0 gives the correct key; recovery1 gives the wrong address, `0x82AF0812aBf85B2d45890764DC91061094D08EaD`.

## Independent cryptographic verification

Both an Ethers-based reconstruction and a separate pure-Python implementation passed. Python independently checked the ECDSA equation, recovered Q, reproduced the NEAR additive derivation, and reconstructed unsigned/signed RLP and Keccak hashes. No private key or signing API was used.

- Recovered sender: **`0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`**.
- Recovered full public point matches the independently NEAR-derived Treasury point.
- Approved unsigned digest: **`0xd092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4`**.
- Signed EVM hash: **`0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719`**.

All exact1LINK transaction fields, Sepolia11155111, recipient, canonical token, nonce0, gas170424, maxFee1028wei/gas, priority1000wei/gas, zeroETH and empty access list match the approved bytes. The previous verified signed candidate remains in ignored local evidence; this investigation did not change it or broadcast it.

## Smallest proposed correction and regression test

**Proposal only, not implemented:** remove the four-line raw-R-prefix/recovery-ID equality guard. Preserve curve-point validation, r/s range checks, supported recovery-ID checks, low-s normalization, exact NEAR action/digest bindings, and mandatory trusted-sender recovery in both outcome validation and EVM assembly.

Use a clearly labelled recorded-public-response offline fixture from this exact finalized result, plus the approved unsigned metadata. The regression must:

1. Reproduce the current specific parity rejection before the fix; after the fix, validate the real03/recovery0 response, exact Treasury public point/address and expected signed EVM hash.
2. Flip recovery_id to1 and require rejection at expected-sender verification, even though it matches the R prefix. Also reject tampered digest/signer/key/receiver/path/domain/gas/deposit.
3. Retain malformed/off-curve point, zero/out-of-range scalar, unsupported recovery-ID and high-s canonicalization coverage. Replace the old tests that require raw parity equality with trusted-sender tests.
4. Exercise the full finalized-outcome-to-signed-transaction path offline. Fixture use must never be represented as a new live signing request.

## Recommended recovery, without resubmission

1. Retain the original evidence and state snapshot. Apply only the reviewed parser correction and regression tests, then run the offline suite and typecheck.
2. Independently verify the recorded final response and recovered full public key/sender against the exact approved digest before any reconciled-status transition. The two implementations above provide that verification for these preserved bytes.
3. Provide a guarded **read-only recovery** for the existing recorded NEAR hash. The current workflow and CLI exclude near-failed from reconciliation; the smallest additional recovery adjustment is to allow this state through those two gates when its recorded hash exists, while retaining every final-result/request/signature check. Do not reset the status to prepared or invoke sign. Only the validated reconciliation routine may change it to signed; malformed or genuinely failed results must remain blocked. **No manual JSON status edit.** Add an offline workflow test proving failed validation never changes status and that neither signing nor broadcasting is invoked during recovery.
4. Before any later broadcast, separately review nonce/fees/balances and the local freshness policy. The original window ends **November4,22:20:28.617UTC**; do not reset createdAt to bypass it. An EVM signature has no inherent15-minute expiry, but the current CLI does enforce that local gate. Resolve this explicitly rather than requesting another MPC signature just to repair parsing. EVM broadcasting still requires separate approval.

**No additional MPC request is needed to recover this completed result.** This investigation made only public RPC reads and offline verification; no credentials were accessed, no transaction was submitted, no application source was changed, and the saved execution status remains near-failed.
