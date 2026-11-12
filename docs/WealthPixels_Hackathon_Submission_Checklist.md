# WealthPixels — Hackathon submission checklist

Prepared November 11, 2026. This is a local release checklist, not a submission or permission to publish. Rules checked against the [official HACKATHON.md](https://nearhackathon.com/HACKATHON.md); recheck before submission.

## Completed package

- [x] [Purchase manifest](../evidence/guided-purchase-20261111-003.json) and [verification report](../evidence/guided-purchase-20261111-003-verification-001.json) agree on purchase `guided-purchase-20261111-003` and quote `0x12f47956df63129eeb2ae6a8f388f2274e777ee5d62f0eb395f0cc21bfeda4a1`.
- [x] Original artifact bytes preserved; production manifest validation and publication-field audit passed. No private keys, protected paths, secrets, executable signed payloads or raw journals were found in either artifact.
- [x] Saved public verification: seven groups passed, exit 0, at `2026-11-11T21:51:31.505Z`. Packaging did not rerun RPC verification. Future history availability remains conditional.
- [x] Packaging validation: 667/667 offline tests, TypeScript and fixture-only three-leg dry-run passed. Fixture success is separate from the live purchase evidence.
- [x] [README evaluation paths and prior-code disclosure](../README.md#reproducibility-and-source-history) and both ten-chapter journey stories updated.

## Before release and submission

- [ ] Confirm the public GitHub destination; no remote is configured locally. Publish only after owner approval, by **November 14, 2026, 23:59 UTC**, and keep the repository public through judging. [Official rules](https://nearhackathon.com/HACKATHON.md)
- [ ] In a fresh clone with no `.local` or credentials, run `npm ci`, `npm test`, `npm run typecheck` and `npm run purchase:dry-run`. Confirm the README's explicit completed-manifest verifier command works when historical public data is available. This packaging reran offline checks in the existing checkout, not a clean dependency installation.
- [ ] Scan all Git history/refs for secrets before publication, with redacted findings and false-positive review. The two-artifact audit is not a repository-history scan; no dedicated scanner was installed or run during packaging. Do not read external credential stores or rewrite history automatically.
- [ ] Obtain owner confirmation of legacy-code reuse rights and add an appropriate root LICENSE. Current package metadata says ISC; legacy Solidity headers say MIT. No license was selected or changed in this package.
- [ ] Mark the imported baseline `8e38b987d7dd3a373a1bb1f003bb575d12b0ec8b` and final submission with the required tags, or use a dedicated submission branch; add the actual public comparison link to README. Preserve the baseline disclosure and dependency attributions. [Rules Q-002–Q-005, Q-014](https://nearhackathon.com/HACKATHON.md)
- [ ] Record a short demo video. Suggested 2–3 minutes: the investor proposition, completed 10-USDC purchase and exact individual assets, NEAR's three authorizations, saved successful verification, then the credential-free commands. Label fixture output and recorded live evidence separately; show no credential selections or private terminal history. Video is required for a local-only demo. [Rule Q-012](https://nearhackathon.com/HACKATHON.md)
- [ ] Human publishes an X demo post saying it was built at NEAR HACKATHON, with the video, `@NEARProtocol` and `#NEARHackathon`; retain its public URL. [Official demo instructions](https://nearhackathon.com/#apply)
- [ ] Confirm tracks: **`defi`** is the strongest fit for the implemented portfolio purchase/Chain Signatures workflow; **`open`** is also defensible for direct asset ownership through chain abstraction. These are recommendations, not organizer acceptance. No NEAR Intents integration, autonomous AI business or delivered tokenized securities is claimed. Testnet projects are allowed. [Track definitions](https://nearhackathon.com/#tracks), [testnet rule Q-010](https://nearhackathon.com/HACKATHON.md)
- [ ] Supply the owner's mainnet NEAR prize-payout account, distinct from `wealthpixels-investor.testnet` and `wealthpixels-treasury.testnet`. Do not invent or create an account on the owner's behalf. [Payout requirement](https://nearhackathon.com/HACKATHON.md)
- [ ] Complete the [final submission form](https://nearhackathon.com/#apply): confirm team/contact details, tracks, payout account, public repository/demo URLs, project description and consent. Review all values; submit once after explicit approval. Do not commit personal submission data. [Official submission requirements](https://nearhackathon.com/HACKATHON.md)

No repository publication, X post, hackathon submission or new blockchain operation was performed during packaging.
