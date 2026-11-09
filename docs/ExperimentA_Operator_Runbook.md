# Experiment A — Investor NEAR self-transfer

These commands are proposed operator instructions, not authorization to execute a live operation. Implementation and tests used simulated observations only. No Experiment A transaction has been prepared or submitted.

## Fixed scope and prerequisites

- Node 22.23.4, near-api-js 7.4.0; existing dependencies only.
- Sender and recipient: `wealthpixels-investor.testnet`.
- Sole expected FullAccess key: `ed25519:HYbgeU5vRTw686L5xxp3JtsyzrcBrQcpR3MtBq197DWc`.
- Exactly one `Transfer` action of `1` yoctoNEAR. No MPC, EVM, Treasury credential or purchase journal is used.
- Fee budget: `100000000000000000000` yoctoNEAR (`0.0001 NEAR`). This is an offchain estimate safeguard, not a protocol maximum charge. No 100-Tgas function-call attachment applies to a Transfer action.
- The earlier read-only estimate was approximately `0.0000446365125 NEAR`; it is historical context, not a trusted current default. Preparation and submission fetch fresh protocol fees, gas price, storage-safe balance, authority and nonce.
- Stop other Investor NEAR activity during the experiment. Its NEAR access-key nonce changes if the transfer is accepted. Neither Ethereum account's nonce changes.

The primary is `https://test.rpc.fastnear.com`; the secondary is `https://archival-rpc.testnet.near.org`. [NEAR's public provider list](https://docs.near.org/api/rpc/providers) documents these services. FastNEAR also documents `https://rpc.testnet.fastnear.com` with API-key authentication. Unauthenticated reads worked during the accepted design preflight; this does not prove unauthenticated `send_tx` acceptance. Resolve that access question through documented provider confirmation or a separately explicit decision to test it with the single approved transaction. Do not send an invalid payload as an unapproved capability probe, obtain API keys, or silently change providers.

## 1. Read-only preflight — separate authorization required

```text
npm run near:diagnostic -- preflight --role investor --near-rpc https://test.rpc.fastnear.com --verify-rpc https://archival-rpc.testnet.near.org
```

Review synchronized Testnet identity, the sole expected key, FINAL reference block, account balance after storage reserve, current nonce, exact fee estimate and fixed budget. These observations do not reserve a nonce or create a transaction. A missing input, stale observation, wrong key or excessive fee stops preparation.

## 2. Prepare and inspect — separate authorization required

Use the proposed identifier and currently unused path:

```text
npm run near:diagnostic -- prepare --role investor --id experiment-a-investor-20261109-001 --state .local/transfers/near-diagnostics/experiment-a-investor-20261109-001.json --near-rpc https://test.rpc.fastnear.com --verify-rpc https://archival-rpc.testnet.near.org
npm run near:diagnostic -- inspect --role investor --state .local/transfers/near-diagnostics/experiment-a-investor-20261109-001.json
```

Preparation performs fresh public checks and creates an unsigned transaction without opening a credential. Existing files cannot be overwritten; the filename must match the identifier. Review the full NEAR transaction hash, account/key, Transfer amount, nonce, reference block, endpoints, fees, preparation time and original 15-minute deadline.

Request explicit approval for **one signing and submission of that exact NEAR hash**. An expired preparation requires a separate decision and fresh identifier; never reset timestamps. A recorded attempt is never reused, even after a failure before sending.

## 3. Sign and submit once — explicit hash-bound approval required

Only after approval, replace the placeholders with the reviewed hash, a public approval reference and the existing absolute protected Investor credential path:

```text
npm run near:diagnostic -- submit --role investor --state .local/transfers/near-diagnostics/experiment-a-investor-20261109-001.json --approve REVIEWED_NEAR_HASH --reference PUBLIC_APPROVAL_REFERENCE --credential ABSOLUTE_EXTERNAL_INVESTOR_JSON
```

The credential file contains a plaintext private key and must stay in its existing protected external location. Do not print it, paste its contents into chat, copy it into the repository or supply a Treasury credential. This command alone can read it; preflight, preparation, inspection and reconciliation accept no credential option.

Submission preserves the hash-bound attempt marker before credential access, refreshes public checks, validates the locally signed bytes and Investor signature, saves a send-intent marker, rechecks deadlines/freshness, and invokes exactly one raw `send_tx` POST. SDK account helpers with retry/re-sign defaults are not used. Signed executable bytes remain in memory and are not saved in public state.

`rpc-accepted` means an RPC acknowledgment, not completed execution. A minimal `NONE` acknowledgment is recorded without inventing a returned hash or FINAL proof. A mismatched hash, malformed response, timeout or transport error remains uncertain. Do not rerun `submit`, copy state into another identifier, switch submission endpoints or create a replacement.

## 4. Reconcile read-only — no signing credential

```text
npm run near:diagnostic -- reconcile --role investor --state .local/transfers/near-diagnostics/experiment-a-investor-20261109-001.json
```

One invocation uses bounded reads, without polling loops or automatic request retries. It checks both endpoints even if one lookup fails, preserving any valid partial proof. If execution remains incomplete or unavailable, stop and review the saved result; any later read-only invocation is a separate operational decision.

Success requires `final-success`, including:

- FINAL execution for the exact recorded transaction hash, Investor account/key, nonce, self-recipient and one-yocto Transfer.
- A valid public Investor signature against the original transaction hash.
- A complete, consistent receipt-outcome tree and successful final status.
- Matching primary and secondary proof, canonical finalized execution block, and a FINAL access-key nonce at least as large as the submitted nonce.
- Actual fees summed from public transaction/receipt `tokens_burnt` observations.

`final-failure` is a corroborated execution failure. `unresolved` is incomplete or conflicting evidence. Neither permits resubmission. The latest public account balance is recorded but labelled as a current observation, not an isolated historical balance-delta proof; other nonce activity is disclosed.

The ignored state preserves public preparation, attempt events, sanitized classifications and final/partial proof. It is trusted local diagnostic evidence backed by public RPC observations, not a cryptographic light-client proof. No original Treasury state is read or reconciled by this helper.

## Windows launcher

VS Code PowerShell may use the existing project-local Node launcher. Preserve the npm `--` separator with an argument array:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','near:diagnostic','--','prepare','--role','investor','--id','experiment-a-investor-20261109-001','--state','.local/transfers/near-diagnostics/experiment-a-investor-20261109-001.json','--near-rpc','https://test.rpc.fastnear.com','--verify-rpc','https://archival-rpc.testnet.near.org')
```

This is the proposed preparation command, **not yet executed or authorized**. Use the same array convention for later approved commands. Core execution remains platform-independent Node/TypeScript.

Offline verification, requiring no blockchain funding or credentials:

```text
npm run test:experiment-a
npm test
npm run typecheck
```

Stop after Experiment A. Experiment B, the Treasury native ETH test, portfolio execution, funding and any replacement require their own approvals.
