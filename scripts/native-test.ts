import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createStandaloneNativeIntent, observeStandaloneNative, prepareStandaloneNative } from "../src/evm/standalone-native.js";
import { createSepoliaReadRpc } from "../src/evm/sepolia-link.js";
import { createEvmBroadcastTransport } from "../src/evm/broadcast.js";
import { verifyRoleMpc, prepareMpcSigning, readMpcSigningOutcome } from "../src/near/signing.js";
import { encodeState, runtimeStatePath, withStateLock } from "../src/execution/state.js";
import { createStandaloneNativeState, readStandaloneNativeState, withStandaloneNativeStateLock,
  publicStandaloneNativeExecutionSummary, requestStandaloneNativeSignature, reconcileStandaloneNativeSigning,
  auditStandaloneNativeBroadcast, broadcastStandaloneNative, reconcileStandaloneNativeEvm } from "../src/execution/standalone-native.js";
import { withPurchaseExecutionJournal } from "../src/purchase/journal.js";
import { DEFAULT_PURCHASE_QUOTE_POLICY } from "../src/purchase/quote.js";
import { check, hexHash, label, utc } from "../src/purchase/integrity.js";
import { requireUint256 } from "../src/purchase/amounts.js";

const help = `Standalone Treasury-to-Investor Sepolia native ETH test; not a portfolio purchase.
Commands: prepare | inspect | sign | reconcile-signing | audit | broadcast | reconcile
Every command selects --role treasury --state .local/transfers/native-tests/FILE.json
prepare: --id ID --amount-wei INTEGER --max-fee-wei INTEGER --priority-fee-wei INTEGER
All other actions except inspect: --intent-hash HASH
sign: --approve UNSIGNED_HASH --reference APPROVAL_REFERENCE --credential EXTERNAL_TREASURY_FILE
audit/broadcast: --approve SIGNED_HASH --reference APPROVAL_REFERENCE --audit UNUSED_LOCAL_AUDIT_JSON
Expired signed recovery adds --recovery --ack-prepared-at ORIGINAL_TIMESTAMP
Optional endpoints: --near-rpc HTTPS_URL --evm-rpc HTTPS_URL
Audits also belong inside .local/transfers/native-tests/. No earlier audit authorizes a later send.
Preparation, signing and broadcast require separate authorization. No force or automatic retry exists.
Standalone spending is blocked while any portfolio purchase is active/reserved/unsettled.
Credential-free example: npm run native:test:dry-run. Help reads no state, credentials or network.
`;
const specs: Record<string, readonly string[]> = {
  prepare: ["role", "state", "id", "amount-wei", "max-fee-wei", "priority-fee-wei"],
  inspect: ["role", "state"], sign: ["role", "state", "intent-hash", "approve", "reference", "credential"],
  "reconcile-signing": ["role", "state", "intent-hash"], reconcile: ["role", "state", "intent-hash"],
  audit: ["role", "state", "intent-hash", "approve", "reference", "audit", "recovery", "ack-prepared-at"],
  broadcast: ["role", "state", "intent-hash", "approve", "reference", "audit", "recovery", "ack-prepared-at"],
};
const print = (value: unknown) => process.stdout.write(JSON.stringify(value, (_key, field) => typeof field === "bigint" ? field.toString() : field, 2) + "\n");
function lexicalNativeFile(file: string): string {
  const base = resolve(process.cwd(), ".local", "transfers", "native-tests"), target = resolve(file), part = relative(base, target);
  check(part && part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part) && target.endsWith(".json"),
    "Native test state and audits must be new JSON files within .local/transfers/native-tests/."); return target;
}
async function unused(file: string): Promise<void> {
  try { await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error("The selected native state/audit file already exists; preserve it and choose a new filename.");
}
async function writeNew(file: string, value: unknown): Promise<void> {
  const handle = await open(await runtimeStatePath(file, process.cwd(), true), "wx", 0o600);
  try { await handle.writeFile(encodeState(value)); await handle.sync(); } finally { await handle.close(); }
}
/** Shares the purchase reservation lock without modifying its journal or settlement state. */
async function noActivePurchase<T>(action: () => Promise<T>): Promise<T> {
  return withPurchaseExecutionJournal(process.cwd(), DEFAULT_PURCHASE_QUOTE_POLICY, async store => {
    check(!store.current().active, "An active portfolio purchase reserves Treasury inventory or has an outstanding obligation. Finish/reconcile it before a standalone ETH test.");
    return action();
  });
}
async function main() {
  const args = process.argv.slice(2), command = args.shift();
  if (!command || (["help", "--help"].includes(command) && args.length === 0)) { process.stdout.write(help); return; }
  check(command in specs, "Unknown standalone native test command.");
  const allowed = new Set([...specs[command]!, "near-rpc", "evm-rpc"]), flags = new Map<string, string>();
  while (args.length) {
    const token = args.shift()!;
    check(token.startsWith("--") && allowed.has(token.slice(2)) && !flags.has(token.slice(2)), "Unknown, duplicate or prohibited native-test option.");
    const key = token.slice(2);
    if (key === "recovery") flags.set(key, "true");
    else { const value = args.shift(); check(value && !value.startsWith("--"), "Native-test option value is missing."); flags.set(key, value); }
  }
  const need = (name: string) => { const value = flags.get(name); check(value, `Required --${name} is missing.`); return value; };
  check(need("role") === "treasury", "Select the Treasury role explicitly; Investor credentials are not accepted.");
  const file = lexicalNativeFile(need("state"));
  // Validate action syntax before any journal, state, credential or network operation.
  const actionHash = !["prepare", "inspect"].includes(command) ? hexHash(need("intent-hash")) : undefined;
  const approvalHash = ["sign", "audit", "broadcast"].includes(command) ? hexHash(need("approve")) : undefined;
  const reference = approvalHash ? label(need("reference"), "Approval reference") : undefined;
  const credentialPath = command === "sign" ? need("credential") : undefined;
  if (credentialPath) check(isAbsolute(credentialPath), "Select an explicit absolute external Treasury credential path.");
  const auditFile = ["audit", "broadcast"].includes(command) ? lexicalNativeFile(need("audit")) : undefined;
  if (auditFile) {
    check(auditFile !== file, "Audit output must differ from the original native state file.");
    check(flags.has("recovery") === flags.has("ack-prepared-at"), "Recovery and the original expired timestamp acknowledgment are required together.");
    if (flags.has("ack-prepared-at")) utc(need("ack-prepared-at"));
  }
  const nearRpcUrl = flags.get("near-rpc") ?? "https://archival-rpc.testnet.fastnear.com";
  const evmRpcUrl = flags.get("evm-rpc") ?? "https://rpc.sepolia.ethpandaops.io";
  if (command === "inspect") {
    // Decode establishes the immutable intent hash; this command never constructs a signer or reads a purchase journal.
    const { readFile } = await import("node:fs/promises");
    const { decodeEncodedState } = await import("../src/execution/state.js");
    const path = await runtimeStatePath(file), candidate = decodeEncodedState(await readFile(path, "utf8")) as { preflight?: { intent?: { intentHash?: string } } };
    const intentHash = candidate.preflight?.intent?.intentHash; check(intentHash, "No standalone intent exists in this state file.");
    print(publicStandaloneNativeExecutionSummary(await readStandaloneNativeState(file, intentHash))); return;
  }
  const evm = createSepoliaReadRpc(evmRpcUrl);
  if (command === "prepare") {
    const exact = (name: string, positive: boolean) => { const text = need(name); check(/^(0|[1-9][0-9]*)$/.test(text), "Use exact integer wei amounts and fee selections."); return requireUint256(BigInt(text), name, positive); };
    const intent = createStandaloneNativeIntent({ testId: need("id"), role: "treasury", amountWei: exact("amount-wei", true) });
    const fees = { maxFeePerGas: exact("max-fee-wei", true), maxPriorityFeePerGas: exact("priority-fee-wei", false) };
    await noActivePurchase(async () => {
      const path = await runtimeStatePath(file, process.cwd(), true);
      await withStateLock(path, async () => {
        await unused(path); await verifyRoleMpc("treasury", nearRpcUrl);
        const preflight = prepareStandaloneNative(intent, fees, await observeStandaloneNative(intent, evm));
        const state = createStandaloneNativeState(preflight, intent.intentHash);
        await writeNew(path, state); print(publicStandaloneNativeExecutionSummary(state));
      });
    }); return;
  }
  const expectedIntentHash = actionHash!, binding = { role: "treasury" as const, expectedIntentHash };
  const act = async () => withStandaloneNativeStateLock(file, expectedIntentHash, async (state, save) => {
    if (command === "sign") await requestStandaloneNativeSignature(state, { ...binding, nearRpcUrl, approval: approvalHash!,
      reference: reference!, credentialPath: credentialPath! }, { evm, verifyMpc: verifyRoleMpc, prepareSigning: prepareMpcSigning, save });
    else if (command === "reconcile-signing") await reconcileStandaloneNativeSigning(state, { ...binding, nearRpcUrl },
      { verifyMpc: verifyRoleMpc, readOutcome: readMpcSigningOutcome, save });
    else if (command === "reconcile") await reconcileStandaloneNativeEvm(state, binding, { evm, save });
    else {
      await unused(auditFile!);
      const input = { ...binding, nearRpcUrl, approval: approvalHash!, reference: reference!,
        ...(flags.has("recovery") ? { recovery: true } : {}), ...(flags.has("ack-prepared-at") ? { expiredPreparationAcknowledgment: need("ack-prepared-at") } : {}) };
      const reads = { evm, verifyMpc: verifyRoleMpc, readOutcome: readMpcSigningOutcome };
      if (command === "audit") { const audit = await auditStandaloneNativeBroadcast(state, input, reads); await writeNew(auditFile!, audit);
        print({ state: publicStandaloneNativeExecutionSummary(state), audit: { auditHash: audit.auditHash, checkedAt: audit.checkedAt,
          completedAt: audit.completedAt, expiresAt: audit.expiresAt, originalCreatedAt: audit.originalCreatedAt,
          signedHash: audit.signedHash, recovery: audit.recovery, evm: audit.evm } }); return; }
      await broadcastStandaloneNative(state, input, { ...reads, save, saveAudit: audit => writeNew(auditFile!, audit), broadcast: createEvmBroadcastTransport(evmRpcUrl) });
    }
    print(publicStandaloneNativeExecutionSummary(state));
  });
  if (command === "sign" || command === "broadcast") await noActivePurchase(act); else await act();
}
main().catch(error => { process.stderr.write((error instanceof Error ? error.message : "Native test failed; preserve state and reconcile without retry.") + "\n"); process.exitCode = 1; });
