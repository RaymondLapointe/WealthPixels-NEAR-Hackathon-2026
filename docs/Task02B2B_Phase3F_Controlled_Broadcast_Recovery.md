# Task 02B-2B Phase 3F — Controlled broadcast recovery

November 4, 2026. **Implementation, offline testing and public-read verification completed. No EVM broadcast was performed or authorized.**

## Files changed in this phase

| File | Purpose |
| --- | --- |
| `src/execution/recovery-broadcast.ts` | Narrow recovery audit and single-use submission workflow, pinned to the exact existing Treasury signature and transaction. |
| `src/execution/state.ts` | Optional preserved recovery-audit hash/acknowledgment metadata in future submitting state and inspection summaries. |
| `scripts/transfer.ts` | Separate read-only `recovery-audit` and explicitly approved `broadcast-recovered` commands; fresh exclusive audit file, durable sync and operation lock. |
| `test/near/recovery-broadcast.test.ts` | Recorded-result recovery tests with injected read/save/broadcast mocks. |
| `test/near/recovery-cli.test.ts` | CLI approval/credential/force-flag denial tests with network trapped; no real submission. |
| `package.json` | Register both new offline suites; no dependency changes. |
| `README.md` | Accurate live-signature status and recovery workflow reference. |
| This report | Readiness evidence, exact future command and approval requirements. |

The earlier Phase3E compatibility changes remain intact. Legacy Solidity, original portfolio test, Hardhat configuration, dependency versions/lockfile and derivation modules are unchanged. No Git publication occurred.

## Safety and validation results

Executed `npm test` and `npm run typecheck` using project-local Node22.23.4. **105/105 offline tests passed; zero failures/skips. TypeScript passed.** All recovery submission tests used injected mocks; subprocess CLI denial tests trapped network access. `git diff --check` passed.

Coverage includes the authentic recorded MPC result; exact immutable hashes/bytes/time/fee caps; wrong signature, signer, digest and transaction fields; original normal15-minute guard; explicit original-timestamp acknowledgment plus signed-hash approval; current nonce/fee/gas/inventory checks; known transaction/receipt rejection; read/RPC uncertainty; audit and state write failures; slow reads/writes; stale-audit rejection; conservative persisted submitting markers; one-shot timeout/wrong-hash handling; no automatic retries; and absence of a NEAR signing capability in recovery ports.

The module pins this one Treasury transaction:

- NEAR signing hash: `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs`.
- Approved unsigned digest: `0xd092c39664ff6dd3d4c44e319fdef02438534c0c054bd540662b0f3b624ea6e4`.
- Signed EVM hash: **`0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719`**.
- Original creation time: **2026-11-04T22:05:28.617Z**.
- Sepolia11155111, nonce0, exactly1LINK to the verified Investor, gas170424, maxFee1028wei/gas, priority1000wei/gas, original180000/30gwei/0.0036ETH caps.

It verifies saved and freshly retrieved FINAL successful NEAR proof, complete MPC-derived public key, recovered Treasury address, exact approved digest and serialized EVM bytes. It checks current canonical EVM state, exact original LINK codehash/18decimals/role EOAs, confirmed and pending nonces, both roles' balances, transfer simulation, gas estimate and original fee limits, plus signed-hash transaction/receipt lookups. A prior attempt marker or known transaction cannot authorize another send.

Recovery requires the exact signed-hash approval AND acknowledgment equal to the exact original timestamp. There is no generic force flag and no credential option on either recovery command. The normal broadcast command and preparation/signing age checks remain unchanged.

## Preserved successful result

The existing state remains **signed** and byte-identical:

`.local/transfers/treasury-link-phase3d-20261104T220512383Z.json`

SHA256: `777f4dc6952bd5c1755569bcad904d01539247bd877fee14e3dc3bddc37e7ffc`.

Original timestamp, nonce, amount, recipient, gas, fees and signed bytes are unchanged. A byte-exact copy is preserved at `.local/transfers/evidence/phase3f-original-signed-state-777f4dc6.json`. The prior near-failed snapshot, original public result, verified candidate and public investigation evidence are unchanged; the public transfer manifest remains pending with zero delivered transfers.

## Latest read-only suitability

The final audit completed **2026-11-04T23:11:36.959Z**, at Sepolia block **12065602**, hash `0xa128ea171f12e26a87c993cb11dd6c3455cb680546e671831760ad4740d57c1f`, using `https://ethereum-sepolia-rpc.publicnode.com`. The NEAR authority/MPC proof was also freshly verified.

| Check | Result |
| --- | --- |
| Chain / token | Sepolia11155111; official LINK codehash unchanged,18decimals |
| Treasury | 25LINK /0.05SepoliaETH |
| Investor | 0LINK /0.05SepoliaETH |
| Confirmed / pending nonce | 0 /0, matching signed nonce |
| Simulation | Exact1LINK transfer succeeds |
| Gas estimate / signed limit | 142020 /170424 |
| Current base fee | **15wei/gas** |
| Signed priority / max fee | **1000 /1028wei/gas** |
| Fee adequacy | 15+1000=1015 <=1028; original max fee175195872wei |
| Signed transaction / receipt | Neither known to the selected RPC |
| Local original preparation window | Expired and explicitly retained |

**The existing bytes are currently eligible under the unchanged preflight rules.** The unusually low fee cap is a material condition: our conservative full-priority guard rejects a base fee above **28wei/gas**. No fee field will be raised or replaced. Future inclusion is not guaranteed; the command must recheck immediately before sending and stop if conditions/RPC availability change.

Final inspection audit:

`.local/transfers/evidence/phase3f-final-readiness-audit-20261104T231123149Z.json`

The audit's30-second window starts before the first public read and covers all reads, durable audit/state persistence and submission. This inspection audit is for review only; it cannot be supplied as authority for a later broadcast. The actual future broadcast generates a new audit itself after approval, so human review is not subject to this snapshot's30-second timer.

## Exact future command — NOT EXECUTED

After separate explicit approval only:

~~~text
npm run transfer -- broadcast-recovered --role treasury --state .local/transfers/treasury-link-phase3d-20261104T220512383Z.json --audit .local/transfers/evidence/phase3f-approved-broadcast-ff3272b7.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://ethereum-sepolia-rpc.publicnode.com --approve-broadcast 0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719 --acknowledge-expired-preparation 2026-11-04T22:05:28.617Z
~~~

The audit output filename must still be new; existing files are rejected and never overwritten. The command does not accept a preexisting audit as authorization. It generates and durably syncs a new immutable audit containing approvals and public observations, records its SHA256 in the submitting state, saves `evm-submitting` before one raw EVM send, and never invokes NEAR signing. The original transaction remains byte-for-byte unchanged.

If reads or pre-save checks fail, no send occurs. If the audit expires after the durable submitting marker, no send occurs and that marker is preserved for read-only reconciliation. If a send times out or returns an unexpected hash, state remains uncertain with the exact signed hash; no automatic repeat is allowed. Subsequent receipt/event/exact-balance verification uses the existing read-only reconcile command.

## Approval still required

Approve **one** EVM broadcast of the exact signed hash above through `broadcast-recovered`, explicitly acknowledging the original preparation timestamp **2026-11-04T22:05:28.617Z** and its expired local window. Fresh audit and all checks must pass; otherwise stop. This approval does not authorize another NEAR request, fee replacement or retry.

No private credentials were accessed, no NEAR signing request was made, no funds were requested and no EVM transaction was broadcast during Phase3F. Stopped at the human approval checkpoint.
