# Phase 3G follow-up: final recovery-audit diagnosis

November 5, 2026. Stopped without broadcasting, signing, credential access, fee changes or transaction-state changes.

## Findings

The original Phase 3G `PREFLIGHT_FAILED` cannot be classified conclusively from preserved evidence. Its catch discarded the exception from the Sepolia recheck or subsequent public lookups. Later targeted observations passed, but cannot prove the earlier cause. RPC interruption and state-validation failure remain possible. The reported error was not the distinct `AUDIT_EXPIRED` rejection.

Diagnostic-only changes now preserve safe method/stage and category information: HTTP status, numeric JSON-RPC error code, timeout, network failure, malformed response, or controlled transaction-validation reason. Remote messages, bodies, URLs and unknown exception details remain suppressed. Signature validation, fees, state transitions, freshness, read allowlists and submission limits are unchanged.

## Single additional invocation

The additional invocation failed locally before reaching RPCs. My positional PowerShell launcher invocation consumed npm's bare `--` separator. The installed npm parser consequently consumed CLI option names, and `scripts/transfer.ts` rejected malformed arguments before constructing the RPC adapter, acquiring the state lock or invoking the audit. Independent local argument/parser checks confirmed this; they made no network requests.

The wrapper's terminating handling of native stderr also stopped the outer command before its intended log-writing block. The returned error is separately preserved in ignored `.local/transfers/evidence/phase3g-followup-invocation-failure.json`. No passed audit was produced. No additional invocation or public RPC investigation followed this failure, respecting the requested stop condition.

Local runtime-path validation and state decoding passed. State remains `signed`, with no broadcast marker or receipt. Its SHA256 is unchanged:

`777f4dc6952bd5c1755569bcad904d01539247bd877fee14e3dc3bddc37e7ffc`

Signed EVM hash remains `0xff3272b7b92f32c9f498bc37994b6502f29f12050a9a9cd63532723f62c8c719`; NEAR signing hash remains `8Lf5NwoqSgoJjmHpM1AbjxUwAKww4HXeSJ6n9N3acoXs`. The original bytes, timestamp, nonce 0, chain 11155111 and exact 1 LINK transfer remain unchanged. No new MPC compatibility investigation was performed.

## Validation and file changes

Using project-local Node v22.23.4:

- `.\scripts\with-node22.ps1 npm run test:offline`: 109 passed, 0 failed (four new diagnostic tests).
- `.\scripts\with-node22.ps1 npm run typecheck`: passed.
- `git diff --check`: passed.

Changed files: `src/evm/erc20-transfer.ts` (typed local preflight failures and public fee values); `src/evm/sepolia-link.ts` (safe transport diagnostics and preservation); `src/execution/recovery-broadcast.ts` (failed stage/lookup diagnostics); `test/near/sepolia-link.test.ts` and `test/near/recovery-broadcast.test.ts` (offline diagnostic, redaction, no-retry and unchanged-state regressions); this report. An ignored local failure record was added. No dependencies, legacy Solidity, signed state or earlier evidence were changed. These diagnostic changes are not yet committed; accepted Phase 3E/3F remains committed as `54a5503`.

## Freshness and fee limits

The unchanged 30-second clock starts before NEAR/MPC public reads, includes all Sepolia reads and canonical-block checks, and is checked at completion and before/after durable audit/state writes before sending. Reads taking too long or slow storage correctly block submission. An individual EVM read can consume 20 seconds; multiple sequential phases can exhaust the budget. A preview audit cannot authorize a later broadcast.

Signed max fee remains 1,028 wei/gas and priority fee 1,000 wei/gas. The existing conservative guard requires base fee at most 28 wei/gas to retain the full tip. Protocol inclusion instead requires base fee at most the signed max fee, with the effective tip limited by remaining headroom ([EIP-1559](https://eips.ethereum.org/EIPS/eip-1559)). Very low tip acceptance and validator inclusion are not established by public read methods. Fee increases, transaction replacement and new signatures remain unauthorized.

The last successful targeted snapshot had base fee 17 wei/gas, nonce 0/0, treasury 25 LINK/0.05 ETH, investor 0 LINK/0.05 ETH, successful simulation, gas estimate 142,020 below signed limit 170,424, and no known signed transaction/receipt. That older snapshot is not fresh approval evidence. Current broadcast suitability is therefore **not cleared** by this follow-up.

## Next checkpoint: approval for a corrected read-only audit

The local-only parameter probe confirms this explicit array retains npm's separator. The following command has NOT been executed; a new authorization for one read-only audit is required after the failed invocation:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','transfer','--','recovery-audit','--role','treasury','--state','.local/transfers/treasury-link-phase3d-20261104T220512383Z.json','--audit','.local/transfers/evidence/phase3g-followup-approved-read-only-audit.json','--near-rpc','https://archival-rpc.testnet.fastnear.com','--evm-rpc','https://ethereum-sepolia-rpc.publicnode.com')
```

The standard cross-platform equivalent is `npm run transfer -- recovery-audit` with the same CLI flags, under the supported Node runtime. After a fully successful fresh audit, present the unchanged hash-bound `broadcast-recovered` command for separate explicit one-broadcast approval. No broadcast approval is requested at this incomplete checkpoint.
