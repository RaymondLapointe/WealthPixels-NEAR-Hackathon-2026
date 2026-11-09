# Task 03F-B1 — Offline NEAR signing observability

Date: November 9, 2026.

This increment records public metadata for future NEAR signing submissions. It does not resolve the existing `native-smoke-20261109-001` attempt or authorize another signing request.

## Preserved baseline and original attempt

- Starting milestone: `5e8fcfa7c6fd23acaa83ddf0fed9da97dcc01b1c` (Task 03F-A).
- Baseline verification: 492 offline tests passed; TypeScript passed.
- Original uncertain state SHA-256: `FDF668299F096FE4F957029CA5EF73E5B8054F470E83DA718F04E408B5B6B860`.
- The original state, timestamps, hashes, attempt markers and three public investigation evidence files remain unchanged. No metadata is retrospectively invented for that attempt.
- Its separately agreed expiry checkpoint remains FINAL NEAR Testnet height `277015472`. This development increment makes no live RPC requests and does not evaluate that checkpoint.

## Recording and safety

Future signing attempts persist their selected transaction nonce, preceding observed access-key nonce, reference block hash and height, transaction hash, public authority and approved EVM digest. The record also retains the original submission deadline and bounded stage diagnostics.

The initial metadata is saved with the existing durable signing-attempt marker. Subsequent stage records use the existing atomic transfer-state or purchase-journal writer. Persistence must complete before the next submission action proceeds. Transaction metadata cannot be changed and stage history cannot be truncated.

A durable intent to send is not proof that the HTTP request reached a node. An RPC response is not proof of FINAL execution or a valid MPC signature. These records are trusted local observations, not independent onchain evidence. Failed pre-submission checks and uncertain submission outcomes remain distinguishable; neither enables retries. Read-only outcome reconciliation and full signature verification remain required.

Diagnostic records use explicit safe categories and allowlisted public response fields. They do not copy arbitrary RPC response bodies, exception messages, credentials, secret-bearing URLs or executable signed transaction bytes. Existing states without the new optional field remain readable.

The change applies to the ERC-20 transfer, native delivery, standalone native test and purchase-leg signing workflows. It preserves role selection, digest-bound approval, original validity deadlines, one-attempt restrictions, expired-signed recovery and separate EVM broadcast approval.

Recorded stages are `prepared`, `public-checks`, `checks-failed-before-send`, `send-intent`, `rpc-response` and `rpc-uncertain`. The record is exposed as `nearSubmission` by the existing transfer/native inspection summaries and retained in each purchase leg. Finalized execution remains established through the existing `nearOutcome` and signature-reconciliation checks.

Files changed:

- `src/near/submission.ts` and `src/near/signing.ts`: bounded public record, append-only validation, safe diagnostics and persistence hooks.
- `src/execution/state.ts`, `workflow.ts`, `native-workflow.ts` and `standalone-native.ts`: durable records and inspection for existing transfer paths, with legacy-state compatibility.
- `src/purchase/settlement.ts`, `coordinator.ts` and `journal.ts`: per-leg records and journal history protection.
- Existing signing/execution/workflow/coordinator tests and the labelled offline fixtures: recording, save failure, restart, deadline, sanitization and tampering regressions.
- This completion report. No dependencies, legacy Solidity contracts or public LINK evidence changed.

## Offline validation

Commands (standard Node/npm):

```text
npm test
npm run typecheck
```

Windows development commands:

```powershell
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('test') | Select-Object -Last 12
.\scripts\with-node22.ps1 -Tool npm -ToolArguments @('run','typecheck')
```

Results:

- Full offline suite: **508 passed, 0 failed, 0 skipped** (16 additional tests; 114.9 seconds).
- Signing-specific suite: **29 passed**, including 11 new observability regressions.
- TypeScript: passed, exit code 0.
- Staged whitespace validation: passed.
- Review covered 18 intended source, test and documentation files. No credentials, ignored runtime state, generated artifacts, dependency changes or executable signed transaction payloads entered the checkpoint. The existing synthetic fixtures remain labelled offline-only.
- Independent safety review found no blocking defect. Original state/evidence SHA-256 values match their pre-development values. The accepted Phase 3H evidence is unchanged.

All new signing and transport observations in tests are explicitly mocked; they are not live blockchain evidence. The local commit identifier and final Git status are supplied in the completion message; the commit includes this report.

## Next native ETH attempt

First complete the separately authorized public expiry/outcome observation. Preserve the original uncertain attempt regardless of the result. A future test requires its own authorization, fresh preparation, fresh checks, a new approved digest and exactly one approved signing attempt. This increment creates no replacement transaction and grants no additional signing or broadcast capability.
