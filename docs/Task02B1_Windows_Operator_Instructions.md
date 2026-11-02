# Task 02B-1 — One-laptop Operator Guide

Account establishment completed November 2, 2026. The two disposable NEAR testnet accounts and their public EVM derivations are verified. See [the completion report](Task02B1_Account_Setup_and_Derivation.md) and [public evidence](Task02B1_Public_Identities.json) for exact IDs, keys, addresses and finalized blocks.

## Existing credentials

The human operator generated these files locally, outside the repository:

- %LOCALAPPDATA%\WealthPixels\testnet-credentials\treasury.json
- %LOCALAPPDATA%\WealthPixels\testnet-credentials\investor.json

Keep the existing files; do not regenerate keys to retry account registration. The files contain plaintext private keys. The prepared store helper requires owner-and-SYSTEM-only permissions. Same-user processes remain trusted; separate OS users or computers are optional, not required for this demo.

The assistant registered only the supplied public keys through the approved testnet faucet flow and did not open either private file. Public sidecars can be shared; private JSON files, seed material and key objects must stay out of source control, logs and chat.

The provisioning helpers remain available for review:
- scripts/prepare-testnet-credential-store.ps1
- scripts/provision-role-key.ts

They are guarded, role-specific helpers for human-approved provisioning. They are not called by judging commands. Existing role files/accounts are intentionally protected against accidental regeneration.

## Credential-free review

Use Node 22.23.4 and standard npm commands:

~~~text
npm ci
npm test
npm run typecheck
npm run verify:evidence
~~~

Tests are offline fixtures. The public transfer verifier remains pending (exit 2) until actual approved MPC/EVM transfer hashes exist; account registration and public derivation are not live LINK-delivery proof.

Public derivation can be reproduced without credentials:

~~~text
npm run near:derive -- --treasury wealthpixels-treasury.testnet --investor wealthpixels-investor.testnet
~~~

The CLI derives addresses; the separate public account/key verification is in the recorded evidence. Judges do not need private credentials or Windows-specific configuration. The project-local PowerShell Node launcher remains optional.

## Next stage: Task 02B-2

No live signing/transfer command is implemented yet. A future process must explicitly select one role and its exact credential file, verify account/public-key binding, and load only that file. It must not scan the credential directory, load both roles or silently fall back to another identity.

This one-operator arrangement demonstrates separate cryptographic account authorities, not independent production custody.

Before any EVM funding or live signing:
1. Obtain separate approval for Task 02B-2 and exact test-only funding.
2. Refresh MPC domain/root/gas parameters and compare the full trusted derived addresses.
3. Check Sepolia chain ID 11155111, official LINK code/decimals, balances, pending nonce, fee budget and gas estimate.
4. Present the selected role, token, recipient, raw amount and maximum fee before the approved signature request/broadcast.
5. Verify recovered sender, receipt, exact Transfer event and token deltas; reconcile uncertain outcomes before retries.

The planned transfer remains 1 LINK treasury to investor, followed by a separately authorized 0.1 LINK return. No MPC signatures, EVM funding, EVM broadcasts, deployments or publication occurred during Task 02B-1 completion.
