# Task 02B-2B Phase 3E — MPC compatibility fix and recovered signature

November 4, 2026. **Completed: corrected validation, 90 offline tests passed, existing successful MPC result recovered to signed. No new NEAR signing submission, credential access or EVM broadcast occurred.**

## Changes and validation

| File | Change |
| --- | --- |
| `src/evm/erc20-transfer.ts` | Removed only the incorrect raw R-point parity/recovery-ID equality rule. Preserved point validation, scalar ranges, supported recovery IDs and low-s canonicalization. |
| `src/near/signing.ts` | Final result now requires recovery to both the complete trusted MPC-derived public key and exact role EVM address, with all original NEAR action/digest checks retained. |
| `src/execution/workflow.ts` | Guarded recovery accepts recorded near-failed and signed states; requires an existing valid NEAR hash and fixed original intent. Invalid/nonfinal/unavailable results leave state unchanged. Success persists a validated clone before changing in-memory status. Signed replay revalidates both proofs/bytes and returns without writing. |
| `scripts/transfer.ts` | Routes near-failed/signed reconciliation through read-only ports. Reconciliation receives no signing or EVM submission capabilities. |
| `test/near/erc20-transfer.test.ts` | Replaced obsolete parity-equality tests with recovery/sender validation coverage. |
| `test/near/signing.test.ts` | Authentic recorded result, exact expected key/address/hash, altered digest/identity/parameters/signature, wrong recovery ID and high-s equivalent coverage. |
| `test/near/execution.test.ts` | Recorded-result recovery, idempotence, missing hash, failed verification/state preservation, failed saves, tampered intent/signed proof, no signing/broadcast ports and unchanged expiry gate. |
| `test/near/fixtures/mpc-8Lf5Nwoq.json` | Clearly labelled recorded public NEAR response, original approved unsigned state and expected verification values. No private credentials. |
| `test/near/fixtures/recorded-mpc.ts` | Typed cloned offline fixture access. |
| This report | Recovery evidence, current suitability and proposed approval path. |

Executed `npm test` and `npm run typecheck` through the existing project-local Node22.23.4 launcher. **90/90 offline tests passed; zero failures/skips. TypeScript passed.** `git diff --check` passed. These fixture tests are offline regressions, not fresh live blockchain execution. No dependency/lockfile, Solidity, original portfolio test or derivation-module change was made.

## Validated recovery of the existing result

Original NEAR signing hash:

```text
8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs
```

The corrected CLI retrieved the existing finalized public outcome, rechecked the original account/key/contract/domain/path/100Tgas/one-yocto action and exact approved digest, validated the authentic signature against the full trusted derived key and address, and reconstructed the existing signed transaction. The raw03 R prefix and recovery_id0 were not rewritten. Wrong recovery_id1 and changed digest/transaction cases are rejected by cryptographic binding.

- Recovered sender: **`0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87`**.
- Original unsigned digest: `0xd092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4`.
- Recovered signed EVM hash:

```text
0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719
```

State **`.local/transfers/treasury-link-phase3d-20261104T220512383Z.json`** is now **signed**, changed only by the validated reconciliation routine. No manual JSON status edit was made. The original `createdAt: 2026-11-04T22:05:28.617Z`, complete preflight/transaction data and signed bytes remain unchanged; signed bytes exactly match the independently verified pre-recovery candidate.

Before recovery the exact near-failed state was archived at `.local/transfers/evidence/phase3e-before-reconciliation-state-cd6a9f90.json`, SHA256 `cd6a9f90e53331ad7f40df9aca0cc143febe07d5fc809f6e8c734320dbc59b92`. Original public outcome, prior signed candidate, investigation archive and pending transfer manifest remain unchanged.

Ran the existing CLI twice:

~~~text
npm run transfer -- reconcile --role treasury --state .local/transfers/treasury-link-phase3d-20261104T220512383Z.json --evm-rpc https://ethereum-sepolia-rpc.publicnode.com
~~~

Both returned exit0. The second run left the signed-state file byte-identical, SHA256 **`777f4dc6952bd5c1755569bcad904d01539247bd877fee14e3dc3bddc37e7ffc`**. Normal live signing and broadcast age/approval gates are unchanged.

## Current Sepolia suitability

The first assessment hit the known public `eth_getCode` availability error. A subsequent public-read diagnostic passed at **2026-11-04T22:42:33.117Z**, block **12065457**, hash `0x1b364f7a739788b4c96625193b781871b284d1e547f11afc90062c51c5183ce0`:

| Check | Result |
| --- | --- |
| Network / token / role EOAs | Sepolia11155111; official LINK code/18decimals; expected roles passed |
| Confirmed/pending nonce | Both0, matching signed nonce0 |
| Treasury inventory/native funds | 25LINK /0.05ETH; sufficient |
| Exact1LINK transfer simulation | Passed |
| Gas estimate / existing signed limit | 142020 /170424; sufficient |
| Current base fee + signed priority fee | 16+1000=1016wei/gas, within signed maxFee1028wei/gas |
| Existing maximum fee | 175195872wei =0.000000000175195872ETH; within originalcaps |
| Signed transaction known / receipt | Neither found on RPC |
| Cryptographic validity | Exact signed bytes/key/address/hash verified |
| Local preparation age | **Expired**; normal CLI broadcast remains blocked |

The existing transaction remains network-compatible under this snapshot. Recheck immediately before any later approved send; public RPC availability and conditions can change. Assessment evidence is preserved in ignored files `phase3e-recovered-state-assessment.json` and `phase3e-suitability-read-diagnostic.json` under `.local/transfers/evidence/`. No EVM transaction was sent, and the public transfer-evidence manifest remains pending.

## Proposed explicit recovery-specific broadcast approval path

**Proposal only: no new broadcast path was implemented or invoked.** The current normal broadcast operation correctly refuses the expired original15-minute window, which ended22:20:28.617UTC. EVM signed bytes contain no such expiry. The timestamp must not be reset and no new MPC signature is needed to fix this local policy.

A separately approved recovery-only operation should:

1. Require signed status plus immutable original evidence; bind approval to role Treasury, the exact NEARhash above, unsigned digest, signed hash and byte-identical serialized transaction. Keep the original createdAt, nonce, amount, destination, gas and fees.
2. Require an **explicit human acknowledgment of the expired local preparation window** and approval to broadcast this exact signed hash once. No generic force/skip-check flag, hidden clock refresh or inferred approval.
3. Refresh finalized NEAR/MPC identity/root/domain and the original successful outcome; revalidate full recovered public key/address and exact signed bytes. Perform every existing Sepolia network/token/EOA, confirmed+pending nonce, inventory/native funds, simulation, gas and fee-cap check. Require no existing transaction/receipt for thishash; otherwise reconcile instead of sending.
4. Record a fresh audit artifact containing the check time, canonical block, nonces, balances, gas/fee observations, original timestamps and all three bound hashes. Replace only the preparation-age criterion with this specifically approved, fresh recovered-transaction audit; retain all other checks.
5. Immediately before the one send, recheck that nothing changed, persist the approved hash/submitting state, submit the existing bytes once, and reconcile the resulting receipt/events/balance deltas. On failure or uncertainty, stop and investigate the saved hash; never re-sign, raise fees or resend automatically.

**Remaining approval:** review/approve that narrow recovery-broadcast policy/implementation and explicitly approve one EVM broadcast of the exact recovered signed hash. Phase3E itself stops here. If live nonce/fees/gas/balances no longer satisfy the original signed transaction, report the exact failure and obtain a new decision rather than altering or substituting bytes.

No credentials were accessed, no new NEAR transaction was submitted and no EVM transaction was broadcast during Phase3E.
