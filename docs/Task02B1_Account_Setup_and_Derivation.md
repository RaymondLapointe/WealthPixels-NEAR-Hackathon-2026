# Task 02B-1 — Completed Account Setup and Public Derivation

Completed November 2, 2026 (America/Toronto).

Both named NEAR testnet accounts are registered with the distinct public keys supplied by the human operator. Each account had exactly one FullAccess key and an observed balance of 10 test NEAR at the verification block.

## Verified identities

| Role | NEAR testnet account | Observed balance |
| --- | --- | --- |
| Treasury | wealthpixels-treasury.testnet | 10 test NEAR |
| Investor | wealthpixels-investor.testnet | 10 test NEAR |

Registered public access keys:
- Treasury: ed25519:8y8NfEhTLWFYgMCKhGLQBPVPZaEBjQvdphf29ta6BQJ1
- Investor: ed25519:HYbgeU5vRTw686L5xxp3JtsyzrcBrQcpR3MtBq197DWc

The keys are different. Each matched the operator-provided public metadata and was the account's sole registered FullAccess key.

| Role | Derived Ethereum Sepolia EVM address |
| --- | --- |
| Treasury | 0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87 |
| Investor | 0x07FE574EdB1B2f537F9be452312C15A5b9427820 |

These addresses were derived using the existing adapter, with contract-derived and locally derived public keys matching. An additional independent public-math verification is recorded in the JSON evidence.

## Public verification evidence

[Task02B1_Public_Identities.json](Task02B1_Public_Identities.json) contains full public account state, registered access keys/permissions, balances, public derivation keys, checksummed addresses and authority binding.

Account state was checked at finalized block 275946908:
4KEGkZc516orruRASxdSZUpvh8MPDk3P1fXeiVhYeZp1

MPC reads and both contract derivations were pinned to finalized block 275946939:
2Gy8MBJVUhPTPz4fS5ho6jXDe6EsS94mYLgneLbm43CB

Verified derivation configuration:
- Network: NEAR testnet.
- MPC contract: v1.signer-prod.testnet, version 3.18.0.
- ECDSA domain 0, CaitSith, purpose Sign; key epoch 27.
- Fixed path: wealthpixels/sepolia/v1.
- Public root: secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3
- Target EVM network for future transactions: Ethereum Sepolia, chain ID 11155111.
- Observed minimum MPC signing gas attachment: 15 Tgas. Recheck before any later signing.

Public derivation can be reproduced without credentials:

~~~text
npm run near:derive -- --treasury wealthpixels-treasury.testnet --investor wealthpixels-investor.testnet
~~~

The CLI performs public derivation only. Account/key registration verification is recorded separately in the public evidence file. Public key registration and derivation do not constitute a live MPC signature or EVM spending proof.

## Approved provisioning performed

The human operator generated and retained both credentials locally. The assistant did not run key generation or open either private credential file.

After explicit approval for both registrations and initial faucet funding:
1. Rechecked both names as UNKNOWN_ACCOUNT at finalized block 275945727.
2. Validated both supplied public-key encodings and their distinctness.
3. Verified the CLI's configured testnet network and official helper faucet.
4. Ran official near-cli-rs 0.30.1 sponsor-by-faucet-service with use-manually-provided-public-key, once for each account.
5. Independently checked finalized account state, expected FullAccess keys and positive initial funding.

Both CLI calls returned exit 0. Completion is based on finalized public account/key/balance checks, not the exit codes alone. Quiet CLI output did not retain creation transaction hashes; no hashes have been invented. The faucet service performed the approved NEAR account-creation/funding transactions.

## Validation and boundaries

- npm test — 43/43 offline tests passed.
- npm run typecheck — passed.
- No legacy Solidity, original test, Hardhat configuration, dependency versions or lockfile changes.
- No private credential files were read by the assistant.
- No MPC signing requests, EVM funding, EVM broadcasts or deployments.
- No remote or public repository publication.

The public transfer manifest now includes the verified role addresses/root, but remains pending with no transfer hashes. Offline fixtures are not live execution. Two distinct keys under one demonstrator do not establish independent production custody.

Task 02B-1 is complete. Stop before Task 02B-2. The next separately approved milestone is a small treasury-authorized Sepolia LINK transfer, followed by an investor-authorized return; funding and live signing remain unapproved.
