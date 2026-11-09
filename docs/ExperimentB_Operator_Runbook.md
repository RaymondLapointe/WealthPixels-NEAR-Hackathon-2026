# Experiment B operator runbook

This implementation is authorized for offline development and regression tests only. No Experiment B live preflight, preparation, digest approval, credential read, submission or reconciliation is authorized by this runbook. The commands below are future operator templates. Every angle-bracket placeholder must be replaced only after the corresponding separate authorization. No Experiment B fee budget has been approved; the templates intentionally contain no usable budget value.

Experiment A reached FINAL success as an ordinary Investor self-transfer. Its public transport result does not verify MPC service availability. The original Experiment A, Treasury native-test and purchase records remain separate. See [offline readiness](ExperimentB_Offline_Readiness.md) for the authorization boundary and historical fee context.

## Fixed request and approval boundaries

Only `--role investor` is accepted, for `wealthpixels-investor.testnet` and its pinned FullAccess key. The request is exactly one direct `sign` FunctionCall to `v1.signer-prod.testnet`, with `100000000000000` gas, `1` yoctoNEAR, ECDSA domain `0` and path `wealthpixels/sepolia/v1`. There is no EVM transaction, asset transfer, arbitrary digest, action, gas, derivation path or authority option.

The default primary is `https://test.rpc.fastnear.com`; corroboration is `https://archival-rpc.testnet.near.org`. Only preflight and preparation accept `--near-rpc` and `--verify-rpc` public HTTPS origin options. Stored operations use the saved endpoints. There is no capability probe, endpoint substitution, force, retry, nonce replacement or timestamp-reset option.

For an ID `experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>`, the canonical UTF-8 diagnostic message is exactly the following two lines, with LF after each line, including the final line. The actual ID replaces the placeholder; JSON property order and whitespace are fixed.

```text
WealthPixels/Experiment-B/NEAR-testnet/MPC-diagnostic/v1
{"experimentId":"experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>","nearAccountId":"wealthpixels-investor.testnet","purpose":"diagnostic-only-no-asset-transfer"}
```

The SHA-256 digest must be inside the accepted secp256k1 scalar range. It is never reduced. The exact contract argument is:

```json
{"request":{"payload_v2":{"Ecdsa":"<64 lowercase digest characters without 0x>"},"path":"wealthpixels/sepolia/v1","domain_id":0}}
```

Preparation is credential-free. It fixes the digest, Investor authority, direct request, gas/deposit, nonce, reference block, endpoints, fee policy, unsigned NEAR transaction hash and an original 15-minute deadline. Signing/submission requires separate explicit approval of **both** the `0x`-prefixed diagnostic digest and the base58 NEAR transaction hash. A fee-budget value is an offchain safeguard, not a protocol execution cap; Experiment A's budget supplies no approval for B.

## Offline checks available now

Use the pinned Node 22 runtime. The following commands perform offline checks and create only synthetic temporary test records:

```sh
npm run near:mpc-diagnostic -- --help
npm run test:experiment-b
npm run typecheck
npm test
```

On Windows, the checked-in helper selects the existing pinned project runtime. Passing an explicit argument array preserves npm's `--` separator:

```powershell
$toolArguments = @('run', 'near:mpc-diagnostic', '--', '--help')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments $toolArguments
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run', 'test:experiment-b')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run', 'typecheck')
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test')
```

Help performs no RPC, credential or state read. Fixture providers are available only as code-injected unit-test ports. There is no CLI fixture switch, and the live CLI refuses fixture-marked saved state.

## Future public preflight and preparation

First obtain separate authorization for bounded public preflight and unsigned preparation, the unique public ID, the selected public endpoints and an explicit positive integer fee budget in yoctoNEAR. The templates below are intentionally unusable until those values and authorization exist. Preflight refreshes public Investor key/nonce/balance, synchronized Testnet observations, MPC version/root/domain/minimum gas/derivation and FunctionCall protocol pricing. It loads no credential and writes no state.

```sh
npm run near:mpc-diagnostic -- preflight --role investor --id "experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>" --fee-budget-yocto "<FUTURE_HUMAN_APPROVED_INTEGER_YOCTO>"
```

After successful public review and preparation authorization, create an unused JSON file directly in the dedicated ignored B namespace. Its basename must be the exact approved ID followed by `.json`:

```sh
npm run near:mpc-diagnostic -- prepare --role investor --id "experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>" --fee-budget-yocto "<FUTURE_HUMAN_APPROVED_INTEGER_YOCTO>" --state ".local/transfers/near-mpc-diagnostics/experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>.json"
```

The equivalent explicit PowerShell arrays are:

```powershell
$toolArguments = @(
  'run', 'near:mpc-diagnostic', '--', 'preflight', '--role', 'investor',
  '--id', 'experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>',
  '--fee-budget-yocto', '<FUTURE_HUMAN_APPROVED_INTEGER_YOCTO>'
)
.\scripts\with-node22.ps1 -Tool npm -ToolArguments $toolArguments

$toolArguments = @(
  'run', 'near:mpc-diagnostic', '--', 'prepare', '--role', 'investor',
  '--id', 'experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>',
  '--fee-budget-yocto', '<FUTURE_HUMAN_APPROVED_INTEGER_YOCTO>',
  '--state', '.local/transfers/near-mpc-diagnostics/experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>.json'
)
.\scripts\with-node22.ps1 -Tool npm -ToolArguments $toolArguments
```

To choose separately approved endpoints during these two commands, append exactly `--near-rpc "https://<APPROVED_PUBLIC_TESTNET_RPC_HOST>" --verify-rpc "https://<APPROVED_DISTINCT_PUBLIC_TESTNET_RPC_HOST>"`. In PowerShell append four corresponding array entries before invocation. No stored operation accepts either endpoint flag.

Review the complete public preparation before requesting signing approval: exact canonical message and digest, unsigned NEAR hash, account/key, nonce/reference, 100 Tgas and 1-yocto deposit, FunctionCall base/per-byte/send/execution pricing assumptions, disclosed price scenarios, approved burn budget, upfront funding reserve, storage-safe affordability and original expiry. Expected burn, attached gas, conservative upfront funding and actual finalized cost are distinct. No refund may be assumed to fund the upfront requirement. A stale nonce, unaffordable reserve, changed MPC authority/configuration or insufficient gas fails before credential access.

Preparation uses exclusive creation and rejects existing attempts. Directory traversal, linked runtime paths, A/native/purchase directories and unrelated schemas are rejected. Copying a state file to a different basename also fails. Never delete or overwrite a record to manufacture an unused attempt. Expired preparation supplies no authority for replacement; any new ID/preparation needs a new separate authorization.

## Future inspection, signing and one submission

Inspect the separately authorized prepared record without a credential or endpoint override:

```sh
npm run near:mpc-diagnostic -- inspect --role investor --state ".local/transfers/near-mpc-diagnostics/experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>.json"
```

Only after a separate human approval explicitly binds both printed hashes and the unchanged original deadline may an operator run one credential-backed signing and raw submission. Select the absolute protected **external** `investor.json`; never copy the credential into the repository or a state file. The reference is a short public approval reference, containing no secrets.

```sh
npm run near:mpc-diagnostic -- submit --role investor --state ".local/transfers/near-mpc-diagnostics/experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>.json" --approve-digest "<EXACT_0x_LOWERCASE_SHA256_DIGEST>" --approve-near-hash "<EXACT_BASE58_NEAR_TRANSACTION_HASH>" --reference "<PUBLIC_HUMAN_APPROVAL_REFERENCE>" --credential "<ABSOLUTE_EXTERNAL_PATH_TO_investor.json>"
```

The PowerShell invocation preserves both hash arguments and npm's separator:

```powershell
$toolArguments = @(
  'run', 'near:mpc-diagnostic', '--', 'submit', '--role', 'investor',
  '--state', '.local/transfers/near-mpc-diagnostics/experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>.json',
  '--approve-digest', '<EXACT_0x_LOWERCASE_SHA256_DIGEST>',
  '--approve-near-hash', '<EXACT_BASE58_NEAR_TRANSACTION_HASH>',
  '--reference', '<PUBLIC_HUMAN_APPROVAL_REFERENCE>',
  '--credential', '<ABSOLUTE_EXTERNAL_PATH_TO_investor.json>'
)
.\scripts\with-node22.ps1 -Tool npm -ToolArguments $toolArguments
```

The CLI validates approval syntax before filesystem or network access. The helper checks the exact saved hashes, original freshness and public fee/authority/nonce/reference state before credential access. It records an attempt durably before signing, verifies the Investor's Ed25519 signature against the rebuilt original unsigned bytes, then durably records send intent before the single raw `send_tx`. The signed payload stays out of public summaries. Persistence failure stops work; it is never permission to submit without a durable marker.

Any failure, process interruption, timeout, uncertain response or RPC rejection ends the submit attempt. Preserve the state, hash, original timestamps and public diagnostics. Do not rerun submit, rebuild the nonce, sign a replacement, change endpoints or reset the deadline. An existing durable marker or lock requires inspection and separately authorized reconciliation; do not automatically remove locks or retry a write/send.

## Future credential-free reconciliation

After separate authorization for bounded public reconciliation, use the original state only:

```sh
npm run near:mpc-diagnostic -- reconcile --role investor --state ".local/transfers/near-mpc-diagnostics/experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>.json"
```

```powershell
$toolArguments = @(
  'run', 'near:mpc-diagnostic', '--', 'reconcile', '--role', 'investor',
  '--state', '.local/transfers/near-mpc-diagnostics/experiment-b-investor-<UNIQUE_PUBLIC_SUFFIX>.json'
)
.\scripts\with-node22.ps1 -Tool npm -ToolArguments $toolArguments
```

Reconciliation loads no credential and cannot submit. It retains incomplete/failed observations and public hashes. Only successful FINAL direct-call execution of the approved immutable request, a valid Investor envelope signature over the rebuilt hash, and verified MPC signature recovery can establish success. Curve-point/scalar/recovery/low-S checks must recover the complete trusted Investor public key and expected address `0x07FE574EdB1B2f537F9be452312C15A5b9427820` for the diagnostic digest. A merely accepted NEAR request or a returned signature string is insufficient.

Public evidence must identify the message, digest, NEAR transaction hash, request/envelope, finality and recovered identity, while explaining that this diagnostic requested no Ethereum asset movement. Treasury attempt `native-smoke-20261109-001`, its checkpoint and all original journals remain outside this workflow.
