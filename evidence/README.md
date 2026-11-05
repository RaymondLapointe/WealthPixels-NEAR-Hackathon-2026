# Public testnet evidence

sepolia-link.json is the judge-facing manifest. As of November 5, 2026 its status is "complete": the real 1 LINK Treasury delivery and separately authorized 0.1 LINK Investor return are confirmed and public verification passed. It records both NEAR signing hashes, both Sepolia transaction hashes and the verified public role addresses/root. Detailed public observations are in [treasury-link-delivery.json](treasury-link-delivery.json) and [investor-link-return.json](investor-link-return.json). Account establishment and derivation are recorded in [Task02B1_Public_Identities.json](../docs/Task02B1_Public_Identities.json). These records contain no credentials or fabricated transactions.

## Commands and outcomes

- npm test: offline fixtures only; no RPC.
- npm run verify:evidence: default public manifest.
- npm run verify:evidence -- --manifest path/to/public-manifest.json: another public manifest.
- Optional --near-rpc / --evm-rpc flags select public HTTPS RPC endpoints.
- Exit 0: complete evidence passed every implemented check.
- Exit 1: malformed/inconsistent evidence, failed check, fixture submitted as live evidence, or RPC failure.
- Exit 2: evidence pending; no RPC requests are made.

A pending result is honest prototype status, not a failed blockchain transaction. Do not change status to complete until actual approved transactions and their public hashes exist.

## Completed manifest

The schema has schemaVersion 1, kind "live", status "complete" and operatorModel "single-operator-demo".

- near: testnet, v1.signer-prod.testnet, domainId 0, fixed derivationPath wealthpixels/sepolia/v1 and the recorded public secp256k1 root.
- evm: Sepolia chainId 11155111, official LINK token 0x779877A7B0D9E8603169DdbD7836e478b4624789, decimals 18 and minimum confirmations.
- roles.treasury / roles.investor: verified public NEAR account ID and complete derived EVM address. Never include access credentials.
- transfers: exactly the approved treasury-to-investor and investor-to-treasury legs, each with a positive decimal-string amountBaseUnits, NEAR transaction hash and EVM transaction hash.

The completed 1 LINK delivery and 0.1 LINK return have raw quantities 1000000000000000000 and 100000000000000000 respectively. Both are real testnet executions; the verified post-return balances are Treasury 24.1 LINK and Investor 0.9 LINK.

## Verification and limits

The verifier reads public historical records, validates role derivation from the recorded root and compares each successful NEAR direct-MPC request/response with the actual EVM transaction digest/signature. It also checks chain, sender, token, recipient, amount, receipt status, confirmations and matching Transfer logs. The investor return must be mined in a later block than delivery, matching the wait-for-confirmations operator flow.

It does not load signing identities, request MPC signatures, broadcast EVM transactions, or require today’s access keys/root to match an older record after rotation. It does not prove that separate people control the roles or assert exact historical balance deltas from event logs alone. Public RPC responses are trust inputs.

The synthetic fixtures used by tests are separate from this directory. They are labelled offline fixtures and cannot be submitted to the live CLI as public evidence. The tests do not constitute a completed two-leg live demonstration.

Sources: [NEAR transaction status](https://docs.near.org/api/rpc/transactions), [public RPC providers](https://docs.near.org/api/rpc/providers), [MPC signature types](https://github.com/near/mpc/blob/main/crates/near-mpc-crypto-types/src/primitives.rs).
