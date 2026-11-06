import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { keccak256 } from "ethers";
import { baseEncode } from "near-api-js";
import { VERIFIED_IDENTITIES } from "../../../src/near/identities.js";
import type { AuthorityRole } from "../../../src/near/config.js";
import type { PreparedMpcSigning } from "../../../src/near/signing.js";
import { preparePurchaseLeg, assertPreparedPurchaseLeg, type PurchaseLeg, type PreparedPurchaseLeg,
  type PurchaseLegSigned, type PurchaseLegReceiptResult, type VerifiedPurchaseLeg, type FailedPurchaseLegProof } from "../../../src/purchase/legs.js";
import type { CompletePurchaseCosts } from "../../../src/purchase/costs.js";
import type { PurchaseExecutionDriver } from "../../../src/purchase/settlement.js";
import { createPurchaseQuote, type PurchaseQuote } from "../../../src/purchase/quote.js";
import { approveDemonstrationPrices, prepareDemonstrationPrices, toAllocationPrices } from "../../../src/purchase/prices.js";
import { createPurchaseTerms } from "../../../src/purchase/terms.js";
import { parseUsdcAmount } from "../../../src/purchase/amounts.js";
import { reservePurchaseQuote, approveReservedPurchase, type FundingInventorySnapshot } from "../../../src/purchase/journal.js";
import { AT, costs, inventory, priceInput, prices } from "./purchase-quote.js";
import { IMPLEMENTATION_PIN, purchaseObservationRpc } from "./purchase-legs.js";

/** Trusted TEST CODE injection only. No CLI flag enables this driver in production.
 * Simulated signatures are labelled byte messages, NOT Ethereum signed transactions.
 * Every transport, cost, price, ledger and receipt is synthetic. No key material,
 * cryptographic signing operation, credential read, live RPC or blockchain execution occurs. */
export interface FixtureLedger {
  treasuryUsdc: bigint; investorUsdc: bigint; treasuryLink: bigint; investorLink: bigint;
  treasuryEth: bigint; investorEth: bigint; treasuryNonce: number; investorNonce: number;
  treasuryNear: bigint; investorNear: bigint;
}
export interface FixtureCall { readonly operation: string; readonly leg?: PurchaseLeg; readonly role?: AuthorityRole; readonly hash?: string; readonly credentialPath?: string }
export interface FixtureControls {
  nearSubmit: Partial<Record<PurchaseLeg, "timeout-before" | "timeout-after">>;
  broadcast: Partial<Record<PurchaseLeg, "timeout-before" | "timeout-after" | "wrong-hash">>;
  receipt: Partial<Record<PurchaseLeg, "pending" | "unfinalized" | "reorg" | "failed" | "wrong-token" | "wrong-amount" | "wrong-recipient" | "wrong-transaction">>;
  prepareFailure?: PurchaseLeg; recheckFailure?: PurchaseLeg; authorityFailure?: AuthorityRole; nearReadFailure?: PurchaseLeg;
  invalidMpc?: PurchaseLeg; lookupFailure?: PurchaseLeg; knownLookup?: PurchaseLeg;
  collectDelayMs?: number; recheckDelayMs?: number; lookupDelayMs?: number; prepareSigningDelayMs?: number;
  costTransform?: (costs: CompletePurchaseCosts) => CompletePurchaseCosts;
  fundingTransform?: (funding: FundingInventorySnapshot) => FundingInventorySnapshot;
  pendingNonce?: Partial<Record<AuthorityRole, number>>;
  claimOverride?: { transactionHash: string; logIndex: bigint };
}
export interface FixtureOptions {
  readonly amount?: string; readonly id?: string; readonly investorUsdc?: bigint; readonly at?: string;
  readonly baseFeePerGas?: bigint; readonly maxFeePerGas?: bigint; readonly maxPriorityFeePerGas?: bigint;
  readonly nearUsd?: { readonly numerator: bigint; readonly denominator: bigint };
  readonly initialCostTransform?: (costs: CompletePurchaseCosts) => CompletePurchaseCosts;
}
const feeLeg = { "usdc-payment": "investor-usdc-payment", "link-delivery": "treasury-link-delivery", "eth-delivery": "treasury-eth-delivery" } as const;
const gasUsed = { "usdc-payment": 50_000n, "link-delivery": 60_000n, "eth-delivery": 21_000n } as const;
const hexHash = (label: string) => `0x${createHash("sha256").update("PUBLIC OFFLINE FIXTURE: " + label).digest("hex")}`;
const nearHash = (label: string) => baseEncode(createHash("sha256").update("PUBLIC OFFLINE HASH: " + label).digest());
const roleFor = (leg: PurchaseLeg): AuthorityRole => leg === "usdc-payment" ? "investor" : "treasury";

export async function createPurchaseExecutionFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "wealthpixels-purchase-coordinator-offline-"));
  const originalNow = Date.now;
  let clockMs = Date.parse(options.at ?? AT);
  const clock = { now: () => clockMs, iso: () => new Date(clockMs).toISOString(), advance(ms: number) { clockMs += ms; }, set(iso: string) { clockMs = Date.parse(iso); } };
  // Isolated test process, restored in cleanup. The durable journal deliberately
  // uses its trusted clock rather than accepting a backdated request timestamp.
  Date.now = clock.now;
  const calls: FixtureCall[] = [], controls: FixtureControls = { nearSubmit: {}, broadcast: {}, receipt: {} };
  const ledger: FixtureLedger = { treasuryUsdc: 0n, investorUsdc: options.investorUsdc ?? 20_000_000n,
    treasuryLink: 24_100_000_000_000_000_000n, investorLink: 900_000_000_000_000_000n,
    treasuryEth: 50_000_000_000_000_000n, investorEth: 50_000_000_000_000_000n,
    treasuryNonce: 1, investorNonce: 1, treasuryNear: 9n * 10n ** 24n, investorNear: 9n * 10n ** 24n };
  const preparedByDigest = new Map<string, { quote: PurchaseQuote; prepared: PreparedPurchaseLeg }>();
  const signing = new Map<string, { quote: PurchaseQuote; prepared: PreparedPurchaseLeg; role: AuthorityRole; outcome?: unknown; attempted: boolean }>();
  const broadcasted = new Map<string, { quote: PurchaseQuote; prepared: PreparedPurchaseLeg; signed: PurchaseLegSigned;
    before: FixtureLedger; after: FixtureLedger; failed: boolean; blockNumber: bigint; blockHash: string }>();
  const rolePaths = { investor: join(tmpdir(), "wealthpixels-OFFLINE-NOT-A-CREDENTIAL-investor.json"), treasury: join(tmpdir(), "wealthpixels-OFFLINE-NOT-A-CREDENTIAL-treasury.json") };
  let sequence = 100n;
  const baseFee = options.baseFeePerGas ?? 1000n, maximumFee = options.maxFeePerGas ?? 5000n, priorityFee = options.maxPriorityFeePerGas ?? 1000n;
  const effectivePrice = baseFee + priorityFee;
  const count = (operation: string, leg?: PurchaseLeg) => calls.filter(call => call.operation === operation && (!leg || call.leg === leg)).length;
  const record = (operation: string, leg?: PurchaseLeg, role?: AuthorityRole, hash?: string, credentialPath?: string) => calls.push({ operation, ...(leg ? { leg } : {}), ...(role ? { role } : {}), ...(hash ? { hash } : {}), ...(credentialPath ? { credentialPath } : {}) });
  const fundingSnapshot = (): FundingInventorySnapshot => {
    const value: FundingInventorySnapshot = { ...inventory(), observedAt: clock.iso(), blockNumber: sequence, nearBlockHeight: sequence + 900n,
      blockHash: sequence === 100n ? inventory().blockHash : hexHash(`evm-block-${sequence}`),
      nearBlockHash: sequence === 100n ? inventory().nearBlockHash : nearHash(`near-block-${sequence}`),
      reference: "SIMULATED readiness only; never actual public account funding", sourceUrl: "https://example.invalid/offline-purchase-readiness",
      treasuryEthWei: ledger.treasuryEth, treasuryLinkBaseUnits: ledger.treasuryLink,
      investorEthWei: ledger.investorEth, investorUsdcBaseUnits: ledger.investorUsdc,
      treasurySpendableNearYocto: ledger.treasuryNear, investorSpendableNearYocto: ledger.investorNear };
    return controls.fundingTransform ? controls.fundingTransform(value) : value;
  };
  function freshCosts(quote: PurchaseQuote): CompletePurchaseCosts {
    const value: CompletePurchaseCosts = { ...quote.costs, sampledAt: clock.iso(), expiresAt: new Date(clockMs + 60_000).toISOString(),
      evmObservation: { ...quote.costs.evmObservation, blockNumber: sequence, blockHash: fundingSnapshot().blockHash },
      nearObservation: { ...quote.costs.nearObservation, blockHeight: sequence + 900n, blockHash: fundingSnapshot().nearBlockHash },
      reference: "SIMULATED complete six-cost public observations, no live RPC" };
    return controls.costTransform ? controls.costTransform(value) : value;
  }
  function makeQuote(amount = options.amount ?? "10", id = options.id ?? "offline-coordinator-purchase"): PurchaseQuote {
    const originalInput = priceInput(id), at = clock.iso();
    const input = options.nearUsd ? { ...originalInput, prices: { ...originalInput.prices,
      NEAR: { ...originalInput.prices.NEAR, ...options.nearUsd } } } : originalInput;
    const packet = prepareDemonstrationPrices({ ...input, validFrom: at, expiresAt: new Date(clockMs + 300_000).toISOString() });
    const p = approveDemonstrationPrices(packet, { approvedDigest: packet.approvalDigest, reference: "SIMULATED offline price approval only", approvedAt: at });
    const investmentUsdcBaseUnits = parseUsdcAmount(amount);
    const terms = createPurchaseTerms({ investmentUsdcBaseUnits, ...toAllocationPrices(p, { purchaseId: id, asOf: at, purpose: "prepayment" }) });
    const c = costs(prices(true, priceInput(id)), amount, "live");
    let observations: CompletePurchaseCosts = { ...c, termsHash: terms.termsHash, sampledAt: at, expiresAt: new Date(clockMs + 300_000).toISOString(),
      evmObservation: { ...c.evmObservation, blockNumber: sequence, blockHash: fundingSnapshot().blockHash },
      nearObservation: { ...c.nearObservation, blockHeight: sequence + 900n, blockHash: fundingSnapshot().nearBlockHash },
      assetIdentity: { usdcImplementation: IMPLEMENTATION_PIN },
      evm: c.evm.map(item => ({ ...item, observedBaseFeePerGasWei: baseFee, assumedBaseFeePerGasWei: baseFee,
        maxFeePerGasWei: maximumFee, maxPriorityFeePerGasWei: priorityFee })) };
    if (options.initialCostTransform) observations = options.initialCostTransform(observations);
    return createPurchaseQuote({ purchaseId: id, purpose: "prepayment", investmentUsdcBaseUnits,
      prices: p, costs: observations, createdAt: at });
  }
  let quote: PurchaseQuote;
  try { quote = makeQuote(); }
  catch (error) {
    Date.now = originalNow;
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-purchase-coordinator-offline-"))), "Cleanup must remain in the generated offline root.");
    await rm(root, { recursive: true, force: true }); throw error;
  }
  function simulatedSigned(value: PreparedPurchaseLeg): PurchaseLegSigned {
    const message = `OFFLINE FIXTURE ONLY; NOT AN ETHEREUM TRANSACTION; ${value.purchaseId}; ${value.leg}; ${value.prepared.unsignedHash}`;
    const serialized = `0x${Buffer.from(message, "utf8").toString("hex")}`;
    return { serialized, hash: keccak256(serialized), senderAddress: value.prepared.senderAddress };
  }
  function proofFor(value: PreparedPurchaseLeg, signed: PurchaseLegSigned): PurchaseLegReceiptResult {
    const mined = broadcasted.get(signed.hash), behavior = controls.receipt[value.leg];
    if (!mined || behavior === "pending") return { status: "not-mined", publicObservations: [{ method: "eth_getTransactionReceipt", params: [signed.hash], result: null }] };
    if (["reorg", "wrong-token", "wrong-amount", "wrong-recipient", "wrong-transaction"].includes(behavior ?? ""))
      throw new Error(`SIMULATED public receipt verification rejected ${behavior}; no live observation occurred.`);
    const role = value.role, other = role === "treasury" ? "investor" : "treasury", effectiveGasPriceWei = effectivePrice;
    const common = { purchaseId: value.purchaseId, quoteHash: value.quoteHash, leg: value.leg, role,
      unsignedHash: value.prepared.unsignedHash, transactionHash: signed.hash, blockNumber: mined.blockNumber, blockHash: mined.blockHash,
      confirmations: 10n, gasUsed: gasUsed[value.leg], effectiveGasPriceWei, actualFeeWei: gasUsed[value.leg] * effectiveGasPriceWei,
      publicObservations: [{ method: "eth_getTransactionReceipt" as const, params: [signed.hash], result: {
        kind: "OFFLINE-SIMULATED-RECEIPT-NOT-LIVE", transactionHash: signed.hash, status: mined.failed ? "0x0" : "0x1",
        blockHash: mined.blockHash, intendedAsset: value.leg === "usdc-payment" ? "USDC" : value.leg === "link-delivery" ? "LINK" : "ETH",
        intendedAmount: "amount" in value.prepared ? value.prepared.amount.toString() : value.prepared.amountWei.toString() } }],
      feeObservation: { leg: feeLeg[value.leg], payer: role, transactionHash: signed.hash, executionStatus: mined.failed ? "failed" as const : "success" as const,
        gasUsed: gasUsed[value.leg], effectiveGasPriceWei } };
    if (mined.failed) return { status: "failed", proof: { ...common, kind: "failed-purchase-leg", finality: "two-confirmations" } as FailedPurchaseLegProof };
    const before = { senderEth: mined.before[`${role}Eth`], recipientEth: mined.before[`${other}Eth`] };
    const after = { senderEth: mined.after[`${role}Eth`], recipientEth: mined.after[`${other}Eth`] };
    const finality = behavior === "unfinalized" ? "awaiting-finality" : value.leg === "usdc-payment" ? "finalized" : "two-confirmations";
    const asset = value.leg === "usdc-payment" ? "Usdc" : "Link";
    const tokenAmount = "amount" in value.prepared ? value.prepared.amount : 0n;
    const token = value.leg !== "eth-delivery" ? {
      before: { ...before, senderToken: mined.before[`${role}${asset}`], recipientToken: mined.before[`${other}${asset}`] },
      after: { ...after, senderToken: mined.after[`${role}${asset}`], recipientToken: mined.after[`${other}${asset}`] },
      tokenDeltas: { sender: -tokenAmount, recipient: tokenAmount },
    } : { before, after, nativeDeltas: { sender: mined.after.treasuryEth - mined.before.treasuryEth, recipient: mined.after.investorEth - mined.before.investorEth } };
    const proof: VerifiedPurchaseLeg = { ...common, kind: "verified-purchase-leg", finality, ...token,
      ...(value.leg === "usdc-payment" && finality === "finalized" ? { paymentClaim: { chainId: 11155111n,
        transactionHash: controls.claimOverride?.transactionHash ?? signed.hash, logIndex: controls.claimOverride?.logIndex ?? 2n } } : {}) } as VerifiedPurchaseLeg;
    return { status: finality === "awaiting-finality" ? "awaiting-finality" : "confirmed", proof };
  }
  function simulateAcceptedTransaction(q: PurchaseQuote, prepared: PreparedPurchaseLeg, signed: PurchaseLegSigned) {
    assert.equal(broadcasted.has(signed.hash), false, "SIMULATED duplicate external transaction");
    const role = prepared.role, before = structuredClone(ledger), failed = controls.receipt[prepared.leg] === "failed";
    ledger[`${role}Nonce`]++; ledger[`${role}Eth`] -= gasUsed[prepared.leg] * effectivePrice;
    if (!failed) {
      if (prepared.leg === "usdc-payment") { ledger.investorUsdc -= q.terms.investmentUsdcBaseUnits; ledger.treasuryUsdc += q.terms.investmentUsdcBaseUnits; }
      else if (prepared.leg === "link-delivery") { ledger.treasuryLink -= q.terms.quantities.linkBaseUnits; ledger.investorLink += q.terms.quantities.linkBaseUnits; }
      else { ledger.treasuryEth -= q.terms.quantities.ethWei; ledger.investorEth += q.terms.quantities.ethWei; }
    }
    sequence++; broadcasted.set(signed.hash, { quote: q, prepared, signed, before, after: structuredClone(ledger), failed,
      blockNumber: sequence, blockHash: hexHash(`evm-block-${sequence}`) });
  }
  const driver: PurchaseExecutionDriver = {
    mode: "offline-fixtures", now: clock.now,
    async prepare(q, leg) {
      record("prepare", leg, roleFor(leg)); if (controls.prepareFailure === leg) throw new Error("SIMULATED preparation failure");
      const role = roleFor(leg), cost = q.costs.evm.find(item => item.leg === feeLeg[leg])!;
      const observed = purchaseObservationRpc(leg, { confirmedNonce: BigInt(ledger[`${role}Nonce`]), pendingNonce: BigInt(controls.pendingNonce?.[role] ?? ledger[`${role}Nonce`]),
        senderBalance: leg === "usdc-payment" ? ledger.investorUsdc : ledger.treasuryLink, nativeBalance: ledger[`${role}Eth`],
        blockNumber: sequence, blockHash: fundingSnapshot().blockHash, baseFee });
      const value = await preparePurchaseLeg(q, q.quoteHash, leg, { maxFeePerGas: cost.maxFeePerGasWei,
        maxPriorityFeePerGas: cost.maxPriorityFeePerGasWei, usdcImplementationPin: IMPLEMENTATION_PIN }, observed.rpc);
      preparedByDigest.set(value.prepared.unsignedHash, { quote: q, prepared: value }); return value;
    },
    assertPrepared(q, value) { assertPreparedPurchaseLeg(value, q, q.quoteHash); },
    async recheck(q, value) {
      record("recheck", value.leg, value.role); if (controls.recheckDelayMs) clock.advance(controls.recheckDelayMs);
      if (controls.recheckFailure === value.leg) throw new Error("SIMULATED fresh nonce/gas/inventory/network failure");
      assertPreparedPurchaseLeg(value, q, q.quoteHash);
      assert.equal(value.prepared.nonce, ledger[`${value.role}Nonce`], "SIMULATED stale confirmed nonce");
      assert.equal(controls.pendingNonce?.[value.role] ?? ledger[`${value.role}Nonce`], value.prepared.nonce, "SIMULATED stale pending nonce");
      return { kind: "OFFLINE-SIMULATED-FRESH-PREFLIGHT", nonce: ledger[`${value.role}Nonce`], observedAt: clock.iso() };
    },
    async verifyAuthority(role) { record("verifyAuthority", undefined, role);
      if (controls.authorityFailure === role) throw new Error("SIMULATED incorrect role MPC identity");
      return { kind: "OFFLINE-SIMULATED-NEAR-AUTHORITY", role, accountId: VERIFIED_IDENTITIES[role].accountId }; },
    async prepareSigning(role, digest, credentialPath) {
      const found = preparedByDigest.get(digest); assert.ok(found, "SIMULATED signing requires a prepared digest");
      assert.equal(role, found.prepared.role); assert.equal(credentialPath, rolePaths[role], "SIMULATED role-specific credential path mismatch");
      record("prepareSigning", found.prepared.leg, role, digest, credentialPath);
      const transactionHash = nearHash(`${found.quote.purchaseId}:${found.prepared.leg}:${digest}`);
      const entry = { ...found, role, attempted: false, outcome: undefined as unknown }; signing.set(transactionHash, entry);
      if (controls.prepareSigningDelayMs) clock.advance(controls.prepareSigningDelayMs);
      return { transactionHash, signerAccountId: VERIFIED_IDENTITIES[role].accountId, receiverId: "v1.signer-prod.testnet", request:
        { payload_v2: { Ecdsa: digest.slice(2) }, path: "wealthpixels/sepolia/v1", domain_id: 0 }, gasTgas: 100, depositYocto: "1",
        async broadcastOnce() {
          assert.equal(entry.attempted, false, "SIMULATED NEAR capability is single-use"); entry.attempted = true;
          record("nearSubmit", found.prepared.leg, role, transactionHash);
          if (controls.nearSubmit[found.prepared.leg] === "timeout-before") throw new Error("SIMULATED NEAR transport uncertainty before processing");
          entry.outcome = { kind: "OFFLINE-SIMULATED-MPC-RESULT-NOT-LIVE", hash: transactionHash, role, digest,
            leg: found.prepared.leg, final_execution_status: "FINAL", valid: true };
          ledger[`${role}Near`] -= 900_000_000_000_000_000_000n;
          if (controls.nearSubmit[found.prepared.leg] === "timeout-after") throw new Error("SIMULATED NEAR timeout after acceptance");
          return entry.outcome;
        } } as unknown as PreparedMpcSigning;
    },
    async readSigning(role, hash) { const entry = signing.get(hash); assert.ok(entry); record("readSigning", entry.prepared.leg, role, hash);
      if (controls.nearReadFailure === entry.prepared.leg || !entry.outcome) throw new Error("SIMULATED public NEAR outcome unavailable");
      assert.equal(entry.role, role); return structuredClone(entry.outcome); },
    assemble(q, prepared, hash, outcome) {
      const entry = signing.get(hash); assert.ok(entry && isDeepStrictEqual(entry.outcome, outcome), "SIMULATED unrecognized public MPC outcome");
      assert.equal(entry.quote.quoteHash, q.quoteHash); assert.equal(entry.prepared.prepared.unsignedHash, prepared.prepared.unsignedHash);
      if (controls.invalidMpc === prepared.leg) throw new Error("SIMULATED MPC signature/full sender verification failed");
      return simulatedSigned(prepared);
    },
    assertSigned(q, prepared, signed) { assertPreparedPurchaseLeg(prepared, q, q.quoteHash);
      assert.deepEqual(signed, simulatedSigned(prepared), "SIMULATED signature binding mismatch"); },
    async inspectReceipt(q, prepared, signed) { record("inspectReceipt", prepared.leg, prepared.role, signed.hash);
      assert.equal(q.quoteHash, prepared.quoteHash); return proofFor(prepared, signed); },
    async replayReceipt(q, prepared, signed, result) { record("replayReceipt", prepared.leg, prepared.role, signed.hash);
      assert.equal(q.quoteHash, prepared.quoteHash);
      if (controls.receipt[prepared.leg] === "reorg") throw new Error("SIMULATED previously observed receipt was reorged");
      if (result.status === "not-mined") return;
      assert.equal(result.proof.transactionHash, signed.hash); assert.equal(result.proof.unsignedHash, prepared.prepared.unsignedHash);
      assert.equal(result.proof.purchaseId, q.purchaseId); assert.equal(result.proof.quoteHash, q.quoteHash);
      assert.equal(result.proof.role, prepared.role); assert.equal(result.proof.leg, prepared.leg);
      assert.equal(result.proof.actualFeeWei, result.proof.gasUsed * result.proof.effectiveGasPriceWei);
    },
    async lookup(prepared, signed) { record("lookup", prepared.leg, prepared.role, signed.hash);
      if (controls.lookupDelayMs) clock.advance(controls.lookupDelayMs);
      if (controls.lookupFailure === prepared.leg) throw new Error("SIMULATED Sepolia lookup timeout");
      const known = broadcasted.has(signed.hash) || controls.knownLookup === prepared.leg;
      return { known, receipt: broadcasted.has(signed.hash) && controls.receipt[prepared.leg] !== "pending",
        confirmedNonce: ledger[`${prepared.role}Nonce`], pendingNonce: controls.pendingNonce?.[prepared.role] ?? ledger[`${prepared.role}Nonce`] };
    },
    async collectCosts(q) { record("collectCosts"); if (controls.collectDelayMs) clock.advance(controls.collectDelayMs);
      return { costs: freshCosts(q), inventory: fundingSnapshot() }; },
    async funding(q) { record("funding"); return { inventory: fundingSnapshot(), gasPriceYoctoNear: q.costs.nearObservation.gasPriceYoctoNear,
      expiresAt: new Date(clockMs + 60_000).toISOString() }; },
    nearCost(role, hash, outcome, leg) { const entry = signing.get(hash); assert.ok(entry && isDeepStrictEqual(entry.outcome, outcome));
      return { leg: feeLeg[leg], payer: role, transactionHash: hash, transactionTokensBurntYoctoNear: 100_000_000_000_000_000_000n,
        receiptOutcomes: [{ receiptId: nearHash(`simulated-receipt:${hash}`), tokensBurntYoctoNear: 800_000_000_000_000_000_000n }],
        originalAttachedDepositYoctoNear: 1n, refundedDepositYoctoNear: 0n }; },
    broadcast: { async sendRawTransaction(serialized) {
      const preparedEntry = [...preparedByDigest.values()].find(entry => simulatedSigned(entry.prepared).serialized === serialized);
      assert.ok(preparedEntry, "SIMULATED broadcast requires the exact preserved fixture bytes");
      const { prepared, quote: q } = preparedEntry, signed = simulatedSigned(prepared), role = prepared.role, behavior = controls.broadcast[prepared.leg];
      record("evmSubmit", prepared.leg, role, signed.hash); assert.equal(broadcasted.has(signed.hash), false, "SIMULATED duplicate transport submission");
      if (behavior === "timeout-before") throw new Error("SIMULATED Ethereum uncertainty before acceptance");
      simulateAcceptedTransaction(q, prepared, signed);
      if (behavior === "timeout-after") throw new Error("SIMULATED Ethereum timeout after acceptance");
      return behavior === "wrong-hash" ? `0x${"00".repeat(32)}` : signed.hash;
    } },
  };
  async function setup(q = quote) {
    await reservePurchaseQuote({ quote: q, expectedQuoteHash: q.quoteHash, inventory: fundingSnapshot(), asOf: q.createdAt }, root);
    return approveReservedPurchase({ expectedQuoteHash: q.quoteHash, role: "investor", approval: q.quoteHash,
      reference: "SIMULATED offline Investor quote approval; no human/live authorization", approvedAt: clock.iso() }, root);
  }
  async function cleanup() {
    Date.now = originalNow;
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-purchase-coordinator-offline-"))), "Cleanup must remain in the generated offline root.");
    await rm(root, { recursive: true, force: true });
  }
  function observeExternal(leg: PurchaseLeg) {
    const entry = [...preparedByDigest.values()].filter(value => value.prepared.leg === leg).at(-1);
    assert.ok(entry, "SIMULATED external observation requires an existing prepared intent");
    const signed = simulatedSigned(entry.prepared);
    record("externalObservation", leg, entry.prepared.role, signed.hash); simulateAcceptedTransaction(entry.quote, entry.prepared, signed);
    return signed.hash;
  }
  return { root, quote, makeQuote, driver, ledger, controls, calls, count, rolePaths, clock, setup, cleanup, observeExternal,
    journalFile: join(root, ".local", "transfers", "purchase-journal.json") };
}
export type PurchaseExecutionFixture = Awaited<ReturnType<typeof createPurchaseExecutionFixture>>;

/** Credential-free judging demonstration. Every transaction boundary is a mock. */
export async function runFixturePurchase() {
  const fixture = await createPurchaseExecutionFixture();
  try {
    const { createPurchaseCoordinator } = await import("../../../src/purchase/coordinator.js");
    const c = createPurchaseCoordinator(fixture.driver, { root: fixture.root }), opening = structuredClone(fixture.ledger);
    const transitions: { leg: PurchaseLeg | null; action: string; status: string }[] = [];
    await fixture.setup(); transitions.push({ leg: null, action: "quote-approved", status: "approved" });
    for (const leg of ["usdc-payment", "link-delivery", "eth-delivery"] as const) {
      const role = roleFor(leg), input = { quoteHash: fixture.quote.quoteHash, leg, role };
      let journal = await c.prepare({ ...input, reference: "SIMULATED offline preparation" });
      transitions.push({ leg, action: "prepare", status: journal.active!.execution!.legs[leg]!.status });
      const digest = journal.active!.execution!.legs[leg]!.prepared.prepared.unsignedHash;
      journal = await c.sign({ ...input, approval: digest, reference: "SIMULATED digest approval; no live permission", credentialPath: fixture.rolePaths[role] });
      transitions.push({ leg, action: "mock-near-submit", status: journal.active!.execution!.legs[leg]!.status });
      journal = await c.reconcileSigning(input);
      transitions.push({ leg, action: "mock-signature-reconcile", status: journal.active!.execution!.legs[leg]!.status });
      const e = journal.active!.execution!, signed = e.legs[leg]!.signed!;
      journal = await c.broadcast({ ...input, approval: signed.hash, paymentAuthorizationHash: e.paymentAuthorization!.authorizationHash });
      transitions.push({ leg, action: "mock-evm-submit", status: journal.active!.execution!.legs[leg]!.status });
      journal = await c.reconcile(input);
      transitions.push({ leg, action: "mock-receipt-reconcile", status: (journal.active ?? journal.archive.at(-1)!).status });
      if (leg === "usdc-payment") fixture.clock.advance(120_000);
    }
    const journal = await c.inspect(), completed = journal.archive.at(-1)!;
    return { kind: "offline-purchase-dry-run", executionProof: "FIXTURES ONLY: no real signing, broadcast, funding or onchain purchase",
      pricingMode: "approved-demonstration (SIMULATED offline approval)", investmentUsdcBaseUnits: fixture.quote.terms.investmentUsdcBaseUnits,
      allocationBps: fixture.quote.terms.allocationBps, quantities: fixture.quote.terms.quantities,
      expectedExecutionFeesUsdcBaseUnitsCeil: fixture.quote.feeAssessment.totalExpectedUsdcBaseUnitsCeil,
      expectedFeeBpsCeil: fixture.quote.feeAssessment.expectedFeeBpsCeil, transitions,
      finalStatus: completed.status, mockLedger: { opening, closing: structuredClone(fixture.ledger) },
      mockSubmissionCounts: { near: fixture.count("nearSubmit"), evm: fixture.count("evmSubmit") },
      actualCostObservations: completed.execution!.actualCosts, realizedCosts: completed.execution!.realizedCosts,
      durablePaymentClaims: journal.paymentClaims.length, outstandingObligations: completed.status === "completed" ? [] : ["Review fixture state"] };
  } finally { await fixture.cleanup(); }
}
