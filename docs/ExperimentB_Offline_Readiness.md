# Experiment B — Offline MPC diagnostic readiness

Date: November 9, 2026. This is a design assessment only. No live preflight, unsigned transaction, diagnostic digest approval, credential access or MPC request has been executed for Experiment B.

## Experiment A closure

The sanitized public summary is [experiment-a-near-self-transfer.json](../evidence/experiment-a-near-self-transfer.json). Transaction `GtjwK1T6j2yfAfcV3VSHjj9uVeD6nEf9odKvYR6G1MwP` reached FINAL success through both configured endpoints. The actual fee was `44636512500000000000` yoctoNEAR (0.0000446365125 NEAR); finalized Investor key nonce was `275946428000002`.

The original diagnostic record is unchanged. This export preserves completed RPC observations and their local timestamps; it makes no new blockchain claims or queries. The canonical execution block is identified by hash because the block height was checked by the live helper but not retained in its compact proof. This single ordinary transaction does not establish MPC service availability or general RPC reliability.

## Smallest useful MPC diagnostic

Use only `wealthpixels-investor.testnet` and its verified FullAccess key `ed25519:HYbgeU5vRTw686L5xxp3JtsyzrcBrQcpR3MtBq197DWc`. Retain the existing MPC derivation configuration:

- Receiver: `v1.signer-prod.testnet`.
- Action: exactly one direct `FunctionCall`, method `sign`.
- ECDSA domain: `0`; path: `wealthpixels/sepolia/v1`.
- Gas attachment: `100000000000000` gas (100 Tgas), subject to a fresh check of the deployed minimum.
- Deposit: exactly `1` yoctoNEAR.
- Primary: `https://test.rpc.fastnear.com`; corroboration: `https://archival-rpc.testnet.near.org`.
- Existing adapter expects MPC version `3.18.0` and the pinned root below. These are code expectations, not freshly observed live configuration.

Exact argument format:

```json
{"request":{"payload_v2":{"Ecdsa":"<64 lowercase hexadecimal digest characters, without 0x>"},"path":"wealthpixels/sepolia/v1","domain_id":0}}
```

Use SHA-256 of a published, canonical UTF-8 diagnostic message, with LF line endings and a unique public experiment ID. Proposed format:

```text
WealthPixels/Experiment-B/NEAR-testnet/MPC-diagnostic/v1
{"experimentId":"<unique-public-id>","nearAccountId":"wealthpixels-investor.testnet","purpose":"diagnostic-only-no-asset-transfer"}
```

Use exactly these two UTF-8 lines, one LF after each line including the final line, and the shown JSON property order without additional whitespace. Resolve the unique ID during a separately authorized preparation and preserve the exact message bytes. Reject a digest outside the existing secp256k1 scalar range; do not reduce or reinterpret it. Message-domain separation is distinct from MPC domain `0`. Keeping the established derivation path permits verification against the already trusted Investor public key.

No Ethereum transaction fields, ABI calls, EIP-1559 serialization, permit, wallet-authentication request or broadcast capability belongs in this diagnostic. Only a signature over the explicitly identified diagnostic message is requested. No digest or transaction has been prepared by this assessment.

## Reusable implementation and precise gap

Reusable without a new framework:

- `verifyRoleMpc`: expected network, contract version, domain, root, derivation and registered account key checks.
- `ReadOnlyMpcClient` and `deriveEvmPublicKey`: public MPC inspection and independent derivation.
- `createNearSubmissionRecord` and successor validation: append-only public nonce/reference/hash/stage metadata.
- Single raw `send_tx`, immutable deadline and durable persistence patterns already used by the signing utilities.
- `readMpcSigningOutcome` and `normalizeMpcOutcome`: FINAL direct-call validation, signature normalization, full derived-key recovery and expected-address checks.
- Existing Investor-only credential isolation, atomic storage and locking patterns.

There is no existing standalone Experiment B CLI. `prepareMpcSigning` reads the credential and locally signs before returning its NEAR hash, and refreshes the reference block internally. It cannot be presented as credential-free preparation of a pinned NEAR transaction hash. The fixed-transfer Experiment A command must not be repurposed or supplied a fabricated Transfer intent.

Recommend a thin, isolated diagnostic helper with a pure unsigned MPC transaction builder and a separate sign/submit stage. It should reuse the existing public validation, metadata and signature-verification functions. Bind approval to **both the diagnostic digest and the prepared NEAR transaction hash**, including the fixed role, gas, deposit, path, domain, nonce, reference block and original deadline. A small shared pure builder or narrowly scoped adapter can avoid a new generalized transaction framework; any implementation/refactor requires separate authorization.

Preserve an isolated ignored state namespace such as `.local/transfers/near-mpc-diagnostics/`; never reset or reuse Experiment A, Treasury native-test or purchase state. Rebuild the exact approved unsigned bytes during validation, compare their SHA-256 with the approved/public NEAR hash, and verify the Investor's Ed25519 signature. This binds the original reference block even when a public transaction view does not repeat that field. `normalizeMpcOutcome` alone does not compare the original NEAR nonce/reference envelope, so the diagnostic must retain that additional binding.

## Public keys and signature acceptance

Expected root (refresh before live preparation):

```text
secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3
```

Offline derivation using the existing implementation and configuration gives the full Investor SEC1 key:

```text
0x04a45b30f6c2681b41d588870a439068f39414ae8188d1c750291a3cac876f73d34be888379790fa941b66d136dea3ab7309a5843b0ed465c5ab115853c6f23f47
```

Expected address: `0x07FE574EdB1B2f537F9be452312C15A5b9427820`. This address is used as a cryptographic identity check; no Ethereum transaction is constructed.

Require a successful FINAL NEAR outcome for the exact approved direct request. Apply the existing curve-point, scalar-range, recovery-ID and low-S safeguards, including the corrected R-point/recovery handling. Recover and compare the complete trusted public key and derived address against the diagnostic digest. Any altered digest, authority, path, domain or envelope must fail. Preserve incomplete/failed results and public hashes without another signature request or broadcast.

## Nonces, fees and funding

Experiment A's finalized nonce `275946428000002` is historical. A future B nonce must be selected from fresh FINAL Investor access-key state plus one. `275946428000003` would only be the next candidate if no other activity occurred; do not hardcode it.

Experiment A's 0.0001-NEAR budget is specific to its ordinary Transfer. It is not an approved MPC budget, and its fixed-Transfer fee calculator must not price a FunctionCall. A future B preflight needs function-call base/per-byte/send/execution inputs, serialized request size, attachment, protocol refund assumptions and a separately approved budget.

Offline context only:

- Existing public evidence for the successful Investor LINK-return MPC request records `804011919896900000000` yoctoNEAR (0.0008040119198969 NEAR) burned. This is a historical observation, not a prediction for B.
- At the previously captured block price of `100000000` yoctoNEAR/gas, fully burning 100 Tgas corresponds to 0.01 NEAR before base/per-byte overhead. The disclosed 2× price scenario would be 0.02 NEAR before that overhead. Actual burn depends on execution.
- Funding 100 Tgas at the previously captured receipt floor of `1000000000` requires 0.1 NEAR before base/per-byte/send overhead and the 1-yocto deposit. A 101-Tgas planning reserve at that floor is approximately 0.101 NEAR, not an exact protocol quote.
- Experiment A's final balance was 9.999151351567603099999999 NEAR, apparently ample at those historical assumptions. Fresh storage-safe affordability must still be checked before any credential access; no funding is authorized or presumed necessary.

Do not confuse attached gas, expected burn, a conservative funding reserve and actual finalized costs. Refresh all estimates before live approval; never fund the upfront requirement by assuming a future refund.

## Recommended authorization sequence

1. Separately authorize only the minimal B helper and offline regression tests: domain separation, exact immutable envelope, two hash approvals, role isolation, expiry, fee/affordability separation, persistence failures, uncertain outcomes and full-key recovery.
2. Separately authorize bounded public preflight and unsigned preparation. Refresh Investor key/nonce/balance, MPC version/root/domain/minimum gas/derivation and FunctionCall pricing on the approved endpoints. Read-only SDK paths may retry internally; the diagnostic should explicitly bound public read requests/timeouts, without changing production submission policy.
3. Present the exact canonical message, digest, unsigned NEAR hash, nonce/reference, 100 Tgas, 1 yoctoNEAR, fee assumptions/budget/upfront reserve and original 15-minute deadline.
4. Obtain explicit approval for one Investor credential-backed signing and one raw submission of that exact prepared request. Load only the protected Investor credential after all public checks, durably record the attempt/hash before POST, and stop on failure or uncertainty. No retry, nonce rebuilding, endpoint substitution, timestamp reset or replacement.
5. Use separately authorized bounded credential-free reconciliation through the public endpoints. Retain the original outcome and require full request/envelope/signature verification before declaring success. Evidence should identify the diagnostic message and disclose that no Ethereum asset movement occurred.

Current remaining work is that small isolated adapter, its offline tests and a fresh live-readiness/fee approval. Experiment A's successful ordinary submission is useful transport evidence; MPC service behavior remains untested by this diagnostic.

The unresolved Treasury attempt `native-smoke-20261109-001` and expiry checkpoint `277015472` remain separate and unchanged. This assessment does not query, retry or reconcile it. No production transaction logic, dependency, credential, purchase journal or signed executable payload has been changed or published.
