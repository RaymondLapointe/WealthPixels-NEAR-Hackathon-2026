# Task 02B-2B, Phase 1 — Live readiness and funding preparation

November 3, 2026. **Read-only verification complete. No software blocker found in the current public configuration; EVM funding is required before transfer preparation can succeed. No funding or live execution is authorized by this report.**

## Preserved implementation

Committed the reviewed Task 02B-2A implementation locally as `c8a3d11de86e5f90634efac962d203a24f4a9879` (`milestone: Task 02B-2A live transfer implementation and offline verification`). The repository-only review covered 53 nonignored files, including document XML: no credentials, runtime/generated artifacts, external links or large artifacts were included. No remote is configured. Staging found two extra EOF blank lines in the newly added signing source/test; those were removed without changing behavior before committing.

`npm test`: **77 passed, 0 failed, 0 skipped**. `npm run typecheck`: **passed**. These ran through the existing project-local Node 22.23.4 Windows launcher. The original Solidity contracts, original portfolio test, Hardhat configuration, lockfile and public derivation modules were preserved. No dependency installation or upgrade was performed. This phase adds only this report and [the public RPC snapshot](Task02B2B_Phase1_Public_Readiness.json) after the implementation checkpoint.

## NEAR accounts and MPC

Public NEAR reads used `https://archival-rpc.testnet.fastnear.com`. The shared finalized snapshot is block **276052258**, hash `Cjnf46RKNDvzzLFD3bA1f3nKHhf3ftwMASSKEruajjwG`, timestamp **2026-11-03 13:00:29 UTC**. Independent adapter checks also passed at finalized block 276052261.

| Role | Existing account and sole FullAccess public key | Independently reproduced EVM address |
| --- | --- | --- |
| Treasury | `wealthpixels-treasury.testnet` — `ed25519:8y8NfEhTLWFYgMCKhGLQBPVPZaEBjQvdphf29ta6BQJ1` | `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` |
| Investor | `wealthpixels-investor.testnet` — `ed25519:HYbgeU5vRTw686L5xxp3JtsyzrcBrQcpR3MtBq197DWc` | `0x07FE574EdB1B2f537F9be452312C15A5b9427820` |

Both accounts exist, have their expected distinct sole FullAccess keys, no deployed code and **10 test NEAR** each, locked balance zero and storage usage 182 bytes. Full points were reproduced with independent Python SHA3/secp256k1/Keccak/EIP55 calculations and matched the existing implementation and live contract derivations.

MPC: `v1.signer-prod.testnet`, version **3.18.0**, ECDSA domain **0**, `CaitSith`, purpose `Sign`, threshold 11, key epoch 27/attempt 1. Fixed path: **`wealthpixels/sepolia/v1`**. Root:

```text
secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3
```

Live minimum attachment is **15 Tgas**; our proposed attachment is **100 Tgas**, with **1 yoctoNEAR deposit**. The existing credential-free `verifyRoleMpc` check passed for each real account with the current root/version/domain/derivation/key. This verifies the adapter's public gates, not a live signature or private-key possession.

Storage amount per byte is `10000000000000000000` yoctoNEAR. Conservatively reserving all 182 bytes leaves **9.99818 NEAR per role**; this is a lower bound, not a claim about the maximum spendable amount under small-account storage exemptions.

**Fee correction from live protocol data:** protocol 88 reports gas price `100000000` and minimum gas-purchase price `1000000000` yoctoNEAR per gas. The latter matters for prepayment. Using the observed receipt/action fees, 154 charged method/argument bytes and current upstream classical-Ed25519 accounting gives an estimated reservation of **0.100919944113047000000001 NEAR** for one proposed call, rather than the 0.01 NEAR obtained by multiplying attachment by burn price alone. Reserve **0.25 NEAR per account** for this operation; both balances comfortably cover it. No more NEAR funding is needed. This is a snapshot estimate with margin, not a future fee cap; unused prepaid gas can be refunded. [Protocol fee calculation](https://github.com/near/nearcore/blob/master/core/primitives/src/fees.rs)

Observed finalized access-key nonces are treasury `275945855000000` and investor `275946428000000`. The adapter reads fresh finalized state for each preparation, uses that nonce plus one, and rechecks before its single submission. It does **not** require Task 02B-1's nonce to remain unchanged. Finality does not reveal competing pending requests: keep one active operation per role and reconcile its saved hash before doing anything else. Both `tx_status` and `EXPERIMENTAL_tx_status` were recognized by live parameter-validation probes. A nonexistent-hash FINAL request timed out; no successful MPC outcome is claimed, and a timeout must remain unresolved rather than trigger another submission.

## Sepolia readiness

Endpoint: `https://ethereum-sepolia-rpc.publicnode.com`. Snapshot block **12055461**, hash `0x66d340b7736865a0633ae857573823d21a9c0021773a86d9b0f4743248fb7bbd`, timestamp **2026-11-03 13:03:36 UTC**. Chain ID **11155111**.

Official LINK: **`0x779877A7B0D9E8603169DdbD7836e478b4624789`**, **18 decimals**, 4,282 bytes of deployed code. Observed code hash: `0xcafbd9135200b24454a9ffcac5a8db40947a17f8a8a542062d0f1fb48bd8b269`. The address/decimals match [Chainlink's documentation](https://docs.chain.link/resources/link-token-contracts). Both derived role addresses have no code.

| Role | Current Sepolia ETH | Current LINK | Confirmed / pending EVM nonce |
| --- | ---: | ---: | --- |
| Treasury | 0 | 0 | 0 / 0 |
| Investor | 0 | 0 | 0 / 0 |

All **12 required read methods** responded: `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`, `eth_call`, `eth_getBalance`, `eth_getTransactionCount`, `eth_estimateGas`, `eth_maxPriorityFeePerGas`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_blockNumber`, `eth_getLogs`. Historical parent-block LINK reads worked. Three existing mined type-2 transactions had the required transaction, receipt and nonempty log fields; these are RPC compatibility probes, not WealthPixels transfer evidence.

The real 1 LINK simulation and gas estimate both reverted with insufficient token balance, as expected. A pinned-block metadata-call estimate succeeded, proving method/block-tag support; its 17,606 gas estimate is **not** a LINK-transfer estimate. Measure the actual transfer only after funding.

Observed base fee was 17 wei/gas and suggested priority fee 2 wei/gas; the implemented selection was 36 wei/gas, well below the **30 gwei** cap. At the **120,000 gas** ceiling this observed selection is 4,320,000 wei; the existing absolute **0.0036 ETH** fee cap remains appropriate and the proposed **0.005 ETH** balance covers it. Recheck immediately before signing/broadcast: low observed fees do not guarantee later inclusion or prices. No gas/fee cap change is recommended now.

## Exact additional funding proposed — separate approval required

Network for every action: **Ethereum Sepolia, chain ID 11155111**. Send LINK using the official token contract above, with the role EOA as token recipient.

| Recipient | Additional test LINK | Additional Sepolia ETH |
| --- | ---: | ---: |
| Treasury `0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87` | **2** (`2000000000000000000` base units) | **0.005** (`5000000000000000` wei) |
| Investor `0x07FE574EdB1B2f537F9be452312C15A5b9427820` | **0** | **0.005** (`5000000000000000` wei) |

**Preferred exact-amount route:** an existing operator-controlled disposable Sepolia wallet with these test assets makes the three approved transfers above. Its source balance must also cover its funding-transaction gas. No such wallet or balance has been assumed, opened or created in this phase. Check network, full recipient and token contract for each transfer, record each funding hash, wait for confirmation, then re-read balances. Do not send LINK to the MPC/NEAR account, and do not send ETH to the LINK token contract.

**Current Chainlink faucet alternative:** [official instructions](https://docs.chain.link/resources/acquire-link) explicitly permit a recipient different from the connected wallet. The [live Sepolia page](https://faucets.chain.link/sepolia) advertises fixed **25 LINK** and **0.5 ETH** drips. Its current frontend provides editable recipient rows and connected-wallet ownership-message authentication. Native-token requests display a **1 LINK on Ethereum mainnet** eligibility condition; testnet LINK is exempt. Backend enforcement, which address is checked, cooldowns and actual availability were not exercised. [Current public frontend](https://faucets.chain.link/_next/static/immutable/chunks/2cvmlys2xvm9o.js)

After separate faucet approval only: connect an **existing disposable EVM wallet**, select the Ethereum Sepolia LINK card, continue to the recipient form, replace the default address with the full treasury EOA above, complete the challenge and submit the request. Any ownership-message signature is from that ordinary connected wallet, not either NEAR authority. Review the recipient again before submission and retain the resulting hash. Do not select another network's faucet card.

The faucet does not currently advertise a 2 LINK or 0.005 ETH amount selector. If exact funding is required, use the existing wallet route. If no wallet has 2 test LINK, the smallest advertised direct LINK drip is **25 LINK to treasury instead of 2**, requiring approval of that adjusted allocation; the demo still sends exactly 1 and later returns 0.1 LINK. Do not then add another 2 LINK. Avoid forwarding through an intermediate wallet unless needed.

For ETH, prefer an already funded disposable Sepolia wallet sending exactly 0.005 to each role. Do not buy/transfer mainnet LINK or connect production credentials to satisfy the faucet gate. If no test ETH source is available, obtaining one remains an external funding prerequisite. The Google Cloud Sepolia faucet exists but its current authenticated eligibility/amounts were not verifiable from the public sign-in page, so it is not represented here as a confirmed workaround. Chainlink ETH drips of 0.5 would require separately approved larger funding and confirmed eligibility; they are not automatically substituted for 0.005.

## Existing CLI sequence and approval checkpoints

All requested interfaces are implemented; no additional development is identified by these public checks. Live MPC execution and EVM submission remain unproven until separately approved. Finish and confirm funding before the demonstration; concurrent LINK funding in the receipt block can trip the strict balance/event isolation check.

1. **Funding approval first:** approve the exact three transfers in the table, or explicitly approve the 25-LINK faucet variation and identify the ETH source. No account/key creation is included.
2. **After funding, read-only treasury preparation and inspection:**

```text
npm run transfer -- prepare --role treasury --state .local/transfers/treasury-link.json --gas-limit-cap 120000 --max-fee-gwei 30 --max-total-fee-eth 0.0036
npm run transfer -- inspect --role treasury --state .local/transfers/treasury-link.json
```

These will not currently pass preflight because treasury is unfunded. Defaults are the verified public endpoints above; `--near-rpc` and `--evm-rpc` allow explicit public HTTPS overrides. Use supported Node 22; the project-local Windows launcher remains optional.

3. **Separate NEAR signing approval:** inspect the exact 1 LINK intent, sender/recipient, nonce, complete EIP-1559 fields, maximum fee and unsigned digest. Approve that digest and the 100 Tgas/one-yocto direct MPC request before running locally:

```text
npm run transfer -- sign --role treasury --state .local/transfers/treasury-link.json --credential "<absolute external treasury.json path>" --approve-sign <inspected unsignedHash>
npm run transfer -- reconcile --role treasury --state .local/transfers/treasury-link.json
```

Only the sign command loads the one selected role file, and only after approval. It saves the NEAR hash before exactly one submission. Reconciliation is read-only and may be repeated while pending. Do not resubmit sign on a timeout.

4. **Separate EVM broadcasting approval:** after FINAL MPC success and expected-sender recovery, inspect/approve the saved signed EVM hash:

```text
npm run transfer -- broadcast --role treasury --state .local/transfers/treasury-link.json --approve-broadcast <inspected signed EVM hash>
npm run transfer -- reconcile --role treasury --state .local/transfers/treasury-link.json
```

Require successful receipt, at least two confirmations, matching Transfer event, exact treasury/investor deltas -1/+1 LINK, and both NEAR and Sepolia hashes. Unknown outcomes require saved-hash/nonce reconciliation; no automatic second request or broadcast is allowed. Prepared operations expire after 15 minutes, so prepare only when ready for review. Stale signed/uncertain operations need manual reconciliation and a new explicit decision.

5. **Later investor return:** after confirmed delivery and separate approval, use a fresh process, `--role investor`, `.local/transfers/investor-link.json`, and only its external `investor.json` file. Repeat prepare/inspect, independent digest approval, one signing submission, read-only reconciliation, independent broadcast-hash approval and receipt verification. Its amount is fixed at **0.1 LINK**, with deltas investor/treasury -0.1/+0.1 in a later block. The operator must enforce this sequence; the CLI does not require the earlier treasury state for investor preparation, while export enforces the later block order.

6. **Public evidence, after both transfers succeed:**

```text
npm run transfer -- export --treasury-state .local/transfers/treasury-link.json --investor-state .local/transfers/investor-link.json
npm run verify:evidence
```

Export freshly checks both receipts/balance deltas and public NEAR/MPC/EVM links, then records real hashes. Verification needs no credentials. The current public evidence manifest remains **pending with zero transfers**; compatibility probes and offline fixtures have not been substituted for WealthPixels execution.

**Stop:** no private credential files were accessed; no accounts/keys were created; no tokens requested/funded; no live MPC signing submissions or EVM broadcasts occurred. Same-laptop dual-role operation remains a disclosed demonstrator, not proof of production custody independence. Await separate funding and execution approvals.
