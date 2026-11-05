# Task 02B-2B Phase 3G — First EVM broadcast readiness

November 5, 2026. **Stopped at approval. No broadcast, new MPC signing, credential access, transaction modification or fee increase occurred.**

## Local checkpoint

The accepted Phase3E/3F source, tests, public fixtures and reports are committed locally as **`54a5503b2b937b0ab9a8386593f455ab2a226aa0`**, `milestone: Phase 3E-3F MPC compatibility and controlled broadcast recovery`.

The17-file checkpoint excludes credentials, all `.local/` transaction state/audits and private/runtime files. The public fixture contains the published NEAR transaction signature, not a private key. No Git remote is configured and nothing was published. Older untracked historical reports were preserved. Implementation/investigation and the accepted105-test validation were not repeated.

## Expired audit after persisted submitting marker

The workflow saves the audit and `evm-submitting` before its final30-second freshness check; the network send is later. If that check raises AUDIT_EXPIRED, it sends nothing on that path and deliberately preserves the marker/audit rather than rolling back.

Safe procedure: preserve state, timestamp, bytes and audit; run the existing read-only `reconcile` command on the same state/hash. It checks receipt, transaction lookup and confirmed/pending nonces. A pending transaction is monitored; a valid confirmed receipt is verified. An unknown hash with nonce0 does **not** automatically reset the state or authorize another send. The current code offers no automatic re-arm. Any further attempt needs a separately reviewed and explicitly authorized recovery decision; never manually clear the marker or reset status/createdAt. This avoids duplicate/uncertain resubmission. Our actual state is still signed with **no attempt marker and no receipt**, so that edge case has not occurred.

## Fresh public verification

The standard read-only recovery audit was invoked once and stopped with `PREFLIGHT_FAILED: Fresh Sepolia preflight or public transaction lookups failed; nothing was submitted.` Its generic error does not establish the precise failing read/condition. The command was **not rerun** and no failed audit was relabelled as passed.

Separate targeted public reads completed with **zero RPC errors** at **2026-11-05T12:54:20.003Z**, Sepolia block **12069606**, hash `0x6e588aa950c9db1a9838c74b8f06b1a02a34396ae3bac72b6a6b1d2529abf450`. That block was independently confirmed canonical at12:57:09.243Z.

| Readiness condition | Result |
| --- | --- |
| MPC signature / full trusted key and sender | Verified; Treasury `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Network / LINK | Sepolia11155111; official codehash unchanged;18decimals; both role EOAs correct |
| Treasury / investor balances |25LINK/0.05ETH and0LINK/0.05ETH |
| Confirmed / pending nonce |0/0, matching signed nonce |
| Transfer simulation | Exact1LINK transfer succeeds |
| Gas estimate / signed limit |142020/170424 |
| Current base + signed priority fee |17+1000=1017wei/gas, within signed max1028 |
| Known signed hash / receipt | Neither found |
| Saved transaction/evidence integrity | Signed state SHA256 unchanged: `777f4dc6952bd5c1755569bcad904d01539247bd877fee14e3dc3bddc37e7ffc` |

These latest observations support eligibility of the **unchanged existing bytes**. They do not substitute for the complete fresh audit required inside any later approved broadcast command. Public RPC/fee conditions may change; the unchanged conservative guard stops if base fee exceeds28wei/gas. The failed initial audit remains disclosed; no safeguard is bypassed.

Diagnostic records are preserved in ignored `.local/transfers/evidence/phase3g-readiness-diagnosis.json` and `phase3g-canonical-check.json`.

## Exact proposed command — NOT EXECUTED

Signed hash:

```text
0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719
```

After separate explicit approval only:

~~~text
npm run transfer -- broadcast-recovered --role treasury --state .local/transfers/treasury-link-phase3d-20261104T220512383Z.json --audit .local/transfers/evidence/phase3g-approved-broadcast-ff3272b7.json --near-rpc https://archival-rpc.testnet.fastnear.com --evm-rpc https://ethereum-sepolia-rpc.publicnode.com --approve-broadcast 0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719 --acknowledge-expired-preparation 2026-11-04T22:05:28.617Z
~~~

The output audit filename is currently unused. The command must generate and preserve its own complete fresh audit before saving a submitting marker and sending once; it cannot reuse the inspection snapshot. If any read/check fails or the audit expires, stop. No automatic retry, replacement, fee increase or new MPC signing is authorized.

**Approval requested:** one controlled recovery broadcast of exactly the signed hash above, explicitly acknowledging the original preparation timestamp **2026-11-04T22:05:28.617Z** and its expired local window, conditional on the command's complete fresh validation passing. Stop after submission and read-only receipt reconciliation for review; the investor return remains separately authorized work.
