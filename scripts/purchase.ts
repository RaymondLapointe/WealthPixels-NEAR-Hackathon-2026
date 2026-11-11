import { open, readFile } from "node:fs/promises";
import { getAddress } from "ethers";
import { decodeEncodedState, encodeState, runtimeStatePath } from "../src/execution/state.js";
import { parseUsdcAmount, requireUint256 } from "../src/purchase/amounts.js";
import { createPurchaseCoordinator } from "../src/purchase/coordinator.js";
import { inspectReadiness, collectPurchaseCosts, RECORDED_MPC_SIGNING_ASSUMPTIONS } from "../src/purchase/readiness.js";
import { createPurchaseExecutionServices } from "../src/purchase/services.js";
import { prepareDemonstrationPrices, approveDemonstrationPrices, assertPriceSet, parseExactPriceDecimal, toAllocationPrices,
  type PriceAsset, type PriceInput, type PricePacket, type PriceSet } from "../src/purchase/prices.js";
import { createPurchaseTerms } from "../src/purchase/terms.js";
import { createPurchaseQuote } from "../src/purchase/quote.js";
import { approveReservedPurchase, expireUnpaidPurchase, reservePurchaseQuote, readPurchaseJournal, type PurchaseJournal } from "../src/purchase/journal.js";
import { check, hexHash } from "../src/purchase/integrity.js";
import { requireRole } from "../src/near/identities.js";
import { PURCHASE_LEGS } from "../src/purchase/settlement.js";
import type { PurchaseLeg } from "../src/purchase/legs.js";
import { compactPurchaseOutput, priceCommandOutput, commandTiming, commandFailure } from "../src/purchase/operator-output.js";

const help = `WealthPixels purchase operator CLI (no automatic transaction loops or retries)
Read-only: inspect | inspect-networks | reconcile-signing | reconcile | audit-broadcast
Local quotation: propose-prices | approve-prices | quote | approve-quote
Local recovery: expire-unpaid (expired quoted/approved reservation only; no RPC or credentials)
Separately approved future live steps: prepare | sign | broadcast | retire-unsigned
Common: --near-rpc URL --evm-rpc URL --quote-hash HASH --leg usdc-payment|link-delivery|eth-delivery --role investor|treasury
sign: --approve UNSIGNED_HASH --reference TEXT --credential EXTERNAL_ROLE_FILE
broadcast/audit-broadcast: --approve SIGNED_HASH --ack-authorization AUTHORIZATION_HASH
Recovery adds: --recovery --ack-prepared-at ORIGINAL_ISO_TIMESTAMP
quote: --prices IGNORED_JSON --amount DECIMAL_USDC --selected-max-fee-wei INTEGER --selected-priority-wei INTEGER
       --usdc-implementation ADDRESS --usdc-code-hash HASH
propose-prices: --input IGNORED_PUBLIC_JSON --out NEW_IGNORED_JSON
approve-prices: --input PROPOSAL_JSON --out NEW_APPROVED_JSON --approve PROPOSAL_DIGEST --reference TEXT
approve-quote: --quote-hash HASH --approve HASH --reference TEXT
expire-unpaid: --quote-hash HASH --approve HASH (both must match; authorization/execution retains inventory)
retire-unsigned: --approve UNSIGNED_HASH --ack-prepared-at ORIGINAL_TIMESTAMP --reference TEXT
All JSON input/output files must be inside .local/transfers. No .env is read.
For credential-free evaluation run npm test and npm run purchase:dry-run.
Commands that prepare, sign, broadcast or fund require separate operator authorization; help performs none.
Action output is compact JSON with application start/output timestamps and remaining validity at output.
Use inspect for sanitized details. Output time is not operator presentation/response time.
`;
const specifications: Record<string, readonly string[]> = {
  inspect: [], "inspect-networks": [], "propose-prices": ["input", "out"], "approve-prices": ["input", "out", "approve", "reference"],
  quote: ["prices", "amount", "selected-max-fee-wei", "selected-priority-wei", "usdc-implementation", "usdc-code-hash"],
  "approve-quote": ["quote-hash", "approve", "reference"], "expire-unpaid": ["quote-hash", "approve"],
  prepare: ["quote-hash", "leg", "role", "reference"],
  sign: ["quote-hash", "leg", "role", "approve", "reference", "credential"],
  "reconcile-signing": ["quote-hash", "leg", "role"], reconcile: ["quote-hash", "leg", "role"],
  "audit-broadcast": ["quote-hash", "leg", "role", "approve", "ack-authorization", "recovery", "ack-prepared-at"],
  broadcast: ["quote-hash", "leg", "role", "approve", "ack-authorization", "recovery", "ack-prepared-at"],
  "retire-unsigned": ["quote-hash", "leg", "role", "approve", "ack-prepared-at", "reference"],
};
const print = (value: unknown) => process.stdout.write(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
function publicSummary(j: PurchaseJournal) {
  return { revision: j.revision, paymentClaims: j.paymentClaims, active: j.active ? summarize(j.active) : null,
    history: j.archive.map(summarize) };
}
function summarize(r: NonNullable<PurchaseJournal["active"]>) {
  return { purchaseId: r.quote.purchaseId, quoteHash: r.quote.quoteHash, status: r.status, quoteExpiresAt: r.quote.expiresAt,
    investmentUsdcBaseUnits: r.quote.terms.investmentUsdcBaseUnits, quantities: r.quote.terms.quantities, prices: r.quote.prices,
    expectedFees: r.quote.feeAssessment, paymentAuthorizationHash: r.execution?.paymentAuthorization?.authorizationHash,
    paidAt: r.execution?.paidAt, attention: r.execution?.attention,
    legs: r.execution ? Object.fromEntries(PURCHASE_LEGS.map(leg => {
      const e = r.execution!.legs[leg]; if (!e) return [leg, { status: "pending" }];
      const { unsignedSerialized: _unsigned, ...parameters } = e.prepared.prepared;
      return [leg, { status: e.status, preparedAt: e.preparedAt, parameters, nearTransactionHash: e.nearTransactionHash,
        signedHash: e.signed?.hash, submissionAttempt: e.evmAttempt, externalObservation: e.externalObservation,
        receipt: e.proof ? { transactionHash: e.proof.transactionHash, blockNumber: e.proof.blockNumber, blockHash: e.proof.blockHash,
          actualFeeWei: e.proof.actualFeeWei, kind: e.proof.kind } : null }];
    })) : null, realizedCosts: r.execution?.realizedCosts };
}
async function load(file: string): Promise<any> {
  try { return decodeEncodedState(await readFile(await runtimeStatePath(file), "utf8")); }
  catch { throw new Error("Public workflow JSON is invalid or outside the ignored runtime directory; no credential file was selected."); }
}
async function writeNew(file: string, value: unknown): Promise<void> {
  const path = await runtimeStatePath(file, process.cwd(), true), handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(encodeState(value)); await handle.sync(); } finally { await handle.close(); }
}
const commandStartedAt = new Date().toISOString();
const commandName = process.argv[2] ?? "help";
async function main() {
  const args = process.argv.slice(2), command = args.shift();
  if (!command || command === "--help" || command === "help") { process.stdout.write(help); return; }
  check(command in specifications, "Unknown purchase command. Use --help.");
  const allowed = new Set([...specifications[command]!, ...(command === "expire-unpaid" ? [] : ["near-rpc", "evm-rpc"])]), flags = new Map<string, string>();
  while (args.length) {
    const token = args.shift()!;
    check(token.startsWith("--") && allowed.has(token.slice(2)) && !flags.has(token.slice(2)), "Unknown, duplicate or prohibited purchase option.");
    const key = token.slice(2);
    if (key === "recovery") flags.set(key, "true");
    else { const value = args.shift(); check(value !== undefined && !value.startsWith("--"), "Missing purchase option value."); flags.set(key, value); }
  }
  const need = (key: string) => { const value = flags.get(key); check(value !== undefined && value.length > 0, `Required option --${key} is missing.`); return value; };
  const context = () => ({ command, startedAt: commandStartedAt, outputAt: new Date().toISOString(),
    ...(flags.has("leg") ? { leg: flags.get("leg") as PurchaseLeg } : {}), ...(flags.has("quote-hash") ? { quoteHash: flags.get("quote-hash")! } : {}) });
  const printPurchase = (journal: PurchaseJournal) => print(compactPurchaseOutput(journal, context()));
  if (command === "expire-unpaid") {
    const expectedQuoteHash = hexHash(need("quote-hash")), approval = hexHash(need("approve"));
    check(approval === expectedQuoteHash, "Unpaid expiry approval must exactly match --quote-hash.");
    printPurchase(await expireUnpaidPurchase({ expectedQuoteHash, asOf: new Date().toISOString() })); return;
  }
  const networks = { nearRpcUrl: flags.get("near-rpc") ?? "https://archival-rpc.testnet.fastnear.com", evmRpcUrl: flags.get("evm-rpc") ?? "https://rpc.sepolia.ethpandaops.io" };
  if (command === "inspect-networks") { const r = await inspectReadiness(networks); print({ kind: "public-readiness-no-transaction-preparation", ...r }); return; }
  if (command === "inspect") { print(publicSummary(await readPurchaseJournal())); return; }
  if (command === "propose-prices") {
    const input = await load(need("input"));
    const prices = Object.fromEntries((["ETH", "LINK", "NEAR"] as const).map(asset => {
      const p = input.prices?.[asset]; check(p && (!p.quoteCurrency || p.quoteCurrency === "USD"), "A documented USD price for each asset is required.");
      return [asset, { asset, quoteCurrency: "USD", ...parseExactPriceDecimal(p.priceUsd), sourceUrl: p.sourceUrl, sourceReference: p.sourceReference, originalObservedAt: p.originalObservedAt }];
    })) as Record<PriceAsset, PriceInput>;
    const packet = prepareDemonstrationPrices({ purchaseId: input.purchaseId, providerId: input.providerId, validFrom: input.validFrom, expiresAt: input.expiresAt, prices });
    await writeNew(need("out"), packet); print(priceCommandOutput(packet, context())); return;
  }
  if (command === "approve-prices") {
    const packet = await load(need("input")) as PricePacket;
    const set = approveDemonstrationPrices(packet, { approvedDigest: need("approve"), reference: need("reference"), approvedAt: new Date().toISOString() });
    await writeNew(need("out"), set); print(priceCommandOutput(set, context())); return;
  }
  if (command === "quote") {
    const prices = await load(need("prices")) as PriceSet, initialTime = new Date().toISOString();
    assertPriceSet(prices, { purchaseId: prices.purchaseId, asOf: initialTime, purpose: "prepayment" });
    const amount = parseUsdcAmount(need("amount")), terms = createPurchaseTerms({ investmentUsdcBaseUnits: amount,
      ...toAllocationPrices(prices, { purchaseId: prices.purchaseId, asOf: initialTime, purpose: "prepayment" }) });
    const pin = { address: getAddress(need("usdc-implementation")), codeHash: hexHash(need("usdc-code-hash")) };
    const integer = (key: string, positive: boolean) => { const text = need(key); check(/^(0|[1-9][0-9]*)$/.test(text), "Fee selections must be exact integers in wei."); return requireUint256(BigInt(text), key, positive); };
    const collected = await collectPurchaseCosts(terms, { ...networks, purchaseId: prices.purchaseId, usdcImplementationPin: pin,
      fees: { maxFeePerGasWei: integer("selected-max-fee-wei", true), maxPriorityFeePerGasWei: integer("selected-priority-wei", false) },
      nearSigningAssumptions: RECORDED_MPC_SIGNING_ASSUMPTIONS });
    const time = new Date().toISOString(), quote = createPurchaseQuote({ purchaseId: prices.purchaseId, purpose: "prepayment", investmentUsdcBaseUnits: amount,
      prices, costs: collected.costs, createdAt: time });
    printPurchase(await reservePurchaseQuote({ quote, expectedQuoteHash: quote.quoteHash, inventory: collected.readiness.inventory, asOf: time })); return;
  }
  if (command === "approve-quote") { printPurchase(await approveReservedPurchase({ expectedQuoteHash: need("quote-hash"), role: "investor",
    approval: need("approve"), reference: need("reference"), approvedAt: new Date().toISOString() })); return; }
  const leg = need("leg") as PurchaseLeg; check(PURCHASE_LEGS.includes(leg), "Invalid purchase leg.");
  const role = requireRole(need("role")), input = { quoteHash: need("quote-hash"), leg, role };
  const coordinator = createPurchaseCoordinator(createPurchaseExecutionServices(networks));
  if (command === "prepare") printPurchase(await coordinator.prepare({ ...input, reference: need("reference") }));
  else if (command === "sign") printPurchase(await coordinator.sign({ ...input, approval: need("approve"), reference: need("reference"), credentialPath: need("credential") }));
  else if (command === "reconcile-signing") printPurchase(await coordinator.reconcileSigning(input));
  else if (command === "reconcile") printPurchase(await coordinator.reconcile(input));
  else if (command === "retire-unsigned") printPurchase(await coordinator.retireUnsigned({ ...input, approval: need("approve"), originalPreparedAt: need("ack-prepared-at"), reference: need("reference") }));
  else {
    const approval = { ...input, approval: need("approve"), paymentAuthorizationHash: need("ack-authorization"),
      ...(flags.has("recovery") ? { recovery: true } : {}), ...(flags.has("ack-prepared-at") ? { expiredPreparationAcknowledgment: need("ack-prepared-at") } : {}) };
    if (command === "audit-broadcast") { const audit = await coordinator.auditBroadcast(approval);
      // This optional inspection audit is not journaled; retain all its public evidence in output.
      print({ ...audit, ...commandTiming(context()) }); }
    else printPurchase(await coordinator.broadcast(approval));
  }
}
main().catch(error => { process.stderr.write(JSON.stringify(commandFailure(error, commandName, commandStartedAt, new Date().toISOString()), null, 2) + "\n"); process.exitCode = 1; });
