import { lstat, open, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { baseDecode } from "near-api-js";
import { decodeEncodedState, encodeState, runtimeStatePath, saveEncodedState, withStateLock } from "../src/execution/state.js";
import {
  assertExperimentBState, createExperimentBPorts, ExperimentBError, observeExperimentB, prepareExperimentB,
  publicExperimentBSummary, reconcileExperimentB, submitExperimentB,
  type ExperimentBPorts, type ExperimentBState,
} from "../src/near/experiment-b.js";

const HELP = `Experiment B: NEAR Testnet Investor MPC diagnostic; diagnostic message only, no EVM transaction.
Commands: preflight | prepare | inspect | submit | reconcile
Every command requires --role investor. Fixed receiver v1.signer-prod.testnet, sign, 100 Tgas, 1 yoctoNEAR,
ECDSA domain 0, derivation path wealthpixels/sepolia/v1. No transaction/action override exists.
preflight: --id experiment-b-investor-ID --fee-budget-yocto HUMAN_APPROVED_POSITIVE_INTEGER
           optional --near-rpc HTTPS_URL --verify-rpc HTTPS_URL; no credential or state file.
prepare: --id experiment-b-investor-ID --fee-budget-yocto HUMAN_APPROVED_POSITIVE_INTEGER
         --state .local/transfers/near-mpc-diagnostics/experiment-b-investor-ID.json
         optional --near-rpc HTTPS_URL --verify-rpc HTTPS_URL; exclusive creation only.
inspect/reconcile: --state EXISTING_B_JSON; no credential or endpoint override.
submit: --state EXISTING_B_JSON --approve-digest EXACT_0x_SHA256 --approve-near-hash EXACT_BASE58_NEAR_HASH
        --reference PUBLIC_APPROVAL_REFERENCE --credential ABSOLUTE_EXTERNAL_INVESTOR_JSON
Preparation and signing/submission require separate human authorization. Preparation expires after 15 minutes.
There is no default MPC fee budget. Experiment A's fee budget does not authorize an MPC request.
Endpoints and the unsigned transaction are immutable after preparation. One raw send, no retry or replacement.
Uncertain outcomes require separately authorized credential-free reconciliation, never another submit.
No live operation is authorized merely by these instructions. Help is offline and reads no credential/state.
`;
const specs: Record<string, readonly string[]> = {
  preflight: ["role", "id", "fee-budget-yocto", "near-rpc", "verify-rpc"],
  prepare: ["role", "id", "fee-budget-yocto", "state", "near-rpc", "verify-rpc"],
  inspect: ["role", "state"],
  submit: ["role", "state", "approve-digest", "approve-near-hash", "reference", "credential"],
  reconcile: ["role", "state"],
};
class CliInputError extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CliInputError(message);
}
function publicEndpoint(value: string): string {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      !host.includes("mainnet") && host.includes(".") && host !== "localhost" && !host.endsWith(".localhost") &&
      !host.endsWith(".local") && !host.endsWith(".internal") && !isIP(host.replace(/^\[|\]$/g, "")) &&
      !url.port && url.pathname === "/",
    "Use a public HTTPS Testnet RPC origin without credentials, ports, paths or query strings.");
    return url.origin;
  } catch { throw new CliInputError("Use a public HTTPS Testnet RPC origin without credentials, ports, paths or query strings."); }
}
function diagnosticFile(file: string, root: string): string {
  const base = resolve(root, ".local", "transfers", "near-mpc-diagnostics"), target = resolve(root, file), part = relative(base, target);
  check(part && part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part) && !part.includes(sep) &&
    target.endsWith(".json"), "Experiment B state must be a JSON file directly inside .local/transfers/near-mpc-diagnostics/.");
  return target;
}
async function unused(file: string): Promise<void> {
  try { await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new CliInputError("The diagnostic file already exists. Preserve it; preparation never overwrites an existing attempt.");
}
function nearHash(value: string): string {
  try {
    check(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && baseDecode(value).length === 32,
      "Approval must be the exact base58 NEAR transaction hash.");
    return value;
  } catch { throw new CliInputError("Approval must be the exact base58 NEAR transaction hash."); }
}
function diagnosticDigest(value: string): string {
  check(/^0x[0-9a-f]{64}$/.test(value), "Digest approval must be the exact 0x-prefixed lowercase SHA-256 digest.");
  return value;
}
async function readState(file: string): Promise<ExperimentBState> {
  const state = decodeEncodedState(await readFile(file, "utf8"));
  assertExperimentBState(state);
  check(basename(file) === state.id + ".json", "The diagnostic filename must match the original prepared identifier.");
  check(publicEndpoint(state.primaryRpc) === state.primaryRpc && publicEndpoint(state.secondaryRpc) === state.secondaryRpc,
    "Stored diagnostic endpoints must remain canonical public HTTPS Testnet RPC origins.");
  check(state.mode === "live", "Synthetic offline fixture state cannot be used by the live diagnostic CLI.");
  return state;
}
export interface ExperimentBCliOptions {
  readonly root?: string;
  /** Code-injected unit-test port only; no CLI fixture switch or provider override can install it. */
  readonly ports?: ExperimentBPorts;
  readonly write?: (value: string) => void;
}
export async function runExperimentBCli(argsValue: readonly string[], options: ExperimentBCliOptions = {}): Promise<void> {
  const args = [...argsValue], command = args.shift(), root = resolve(options.root ?? process.cwd());
  const write = options.write ?? (text => process.stdout.write(text));
  const print = (value: unknown) => write(JSON.stringify(value, (_key, field) => typeof field === "bigint" ? field.toString() : field, 2) + "\n");
  if (!command || (["help", "--help"].includes(command) && args.length === 0)) { write(HELP); return; }
  check(Object.hasOwn(specs, command), "Unknown Experiment B command.");
  const allowed = new Set(specs[command]!), flags = new Map<string, string>();
  while (args.length) {
    const token = args.shift()!;
    check(token.startsWith("--") && allowed.has(token.slice(2)) && !flags.has(token.slice(2)),
      "Unknown, duplicate or prohibited diagnostic option.");
    const value = args.shift(); check(value && !value.startsWith("--"), "Diagnostic option value is missing.");
    flags.set(token.slice(2), value);
  }
  const need = (name: string) => { const value = flags.get(name); check(value, `Required --${name} is missing.`); return value; };
  check(need("role") === "investor", "Select --role investor; Treasury signing authority is prohibited in Experiment B.");
  const endpoints = {
    ...(flags.has("near-rpc") ? { primaryRpc: publicEndpoint(need("near-rpc")) } : {}),
    ...(flags.has("verify-rpc") ? { secondaryRpc: publicEndpoint(need("verify-rpc")) } : {}),
  };
  const id = ["preflight", "prepare"].includes(command) ? need("id") : undefined;
  if (id) check(/^experiment-b-investor-[a-z0-9][a-z0-9-]{0,95}$/.test(id), "Use a unique experiment-b-investor-ID identifier.");
  const feeBudgetYocto = ["preflight", "prepare"].includes(command) ? need("fee-budget-yocto") : undefined;
  if (feeBudgetYocto) check(/^[1-9][0-9]{0,77}$/.test(feeBudgetYocto), "Supply an explicit human-approved positive integer --fee-budget-yocto; no MPC budget is supplied by default.");
  const file = command === "preflight" ? undefined : diagnosticFile(need("state"), root);
  if (command === "prepare") check(basename(file!) === id + ".json", "The diagnostic filename must match --id exactly, followed by .json.");
  // Validate both approvals and credential selection before touching any filesystem or RPC.
  const approveDigest = command === "submit" ? diagnosticDigest(need("approve-digest")) : undefined;
  const approveNearHash = command === "submit" ? nearHash(need("approve-near-hash")) : undefined;
  const reference = command === "submit" ? need("reference") : undefined;
  if (reference) check(reference === reference.trim() && /^[\x20-\x7e]{1,200}$/.test(reference), "Use a bounded public approval reference.");
  const credentialPath = command === "submit" ? need("credential") : undefined;
  if (credentialPath) {
    const part = relative(root, resolve(credentialPath));
    check(isAbsolute(credentialPath) && basename(credentialPath) === "investor.json" &&
      (part === ".." || part.startsWith(".." + sep) || isAbsolute(part)),
    "Select the explicit absolute protected external investor.json credential; Treasury credentials are prohibited.");
  }
  const ports = () => options.ports ?? createExperimentBPorts(root);
  if (command === "preflight") { print(await observeExperimentB({ id: id!, feeBudgetYocto: feeBudgetYocto!, ...endpoints }, ports())); return; }
  if (command === "prepare") {
    await unused(file!);
    const path = await runtimeStatePath(file!, root, true);
    await withStateLock(path, async () => {
      await unused(path); const p = ports();
      const state = prepareExperimentB(id!, await observeExperimentB({ id: id!, feeBudgetYocto: feeBudgetYocto!, ...endpoints }, p), p.now());
      assertExperimentBState(state);
      check(state.mode === "live", "The live CLI cannot create synthetic diagnostic state.");
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(encodeState(state)); await handle.sync(); } finally { await handle.close(); }
      print(publicExperimentBSummary(state));
    }); return;
  }
  const path = await runtimeStatePath(file!, root);
  if (command === "inspect") { print(publicExperimentBSummary(await readState(path))); return; }
  await withStateLock(path, async () => {
    const state = await readState(path), p = ports();
    const save = async (next: ExperimentBState) => { assertExperimentBState(next); await saveEncodedState(path, next); };
    if (command === "submit") await submitExperimentB(state,
      { role: "investor", approveDigest: approveDigest!, approveNearHash: approveNearHash!, reference: reference!, credentialPath: credentialPath! }, p, save);
    else await reconcileExperimentB(state, p, save);
    print(publicExperimentBSummary(state));
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runExperimentBCli(process.argv.slice(2)).catch(error => {
    // Unknown transport/filesystem/parser errors may contain untrusted or sensitive text.
    if (error instanceof ExperimentBError && error.publicFeeBalance) {
      process.stderr.write(JSON.stringify({ code: error.code, message: error.message, feeBalance: error.publicFeeBalance }, null, 2) + "\n");
    } else process.stderr.write((error instanceof CliInputError || error instanceof ExperimentBError ? error.message :
      "Experiment B command failed. Preserve its state and inspect/reconcile without retrying submission.") + "\n");
    process.exitCode = 1;
  });
}
