import { lstat, open, readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { baseDecode } from "near-api-js";
import { decodeEncodedState, encodeState, runtimeStatePath, saveEncodedState, withStateLock } from "../src/execution/state.js";
import {
  assertExperimentAState, createExperimentAPorts, ExperimentAError, observeExperimentA, prepareExperimentA,
  publicExperimentASummary, reconcileExperimentA, submitExperimentA,
  type ExperimentAPorts, type ExperimentAState,
} from "../src/near/experiment-a.js";

const HELP = `Experiment A: ordinary NEAR Testnet Investor self-transfer; not MPC or Ethereum.
Commands: preflight | prepare | inspect | submit | reconcile
Every command requires --role investor. The only transaction is Investor -> Investor, Transfer 1 yoctoNEAR.
preflight: optional --near-rpc HTTPS_URL --verify-rpc HTTPS_URL; no credential or state file.
prepare: --id experiment-a-investor-ID --state .local/transfers/near-diagnostics/UNUSED.json
         optional --near-rpc HTTPS_URL --verify-rpc HTTPS_URL
inspect/reconcile: --state EXISTING_DIAGNOSTIC_JSON; no credential or endpoint override.
submit: --state EXISTING_DIAGNOSTIC_JSON --approve EXACT_NEAR_TRANSACTION_HASH
        --reference PUBLIC_APPROVAL_REFERENCE --credential ABSOLUTE_EXTERNAL_INVESTOR_JSON
Preparation and signing/submission require separate human authorization.
Preparation expires after 15 minutes. Fee budget: 0.0001 NEAR (offchain safeguard, not a protocol cap).
The selected endpoints and transaction are immutable after preparation. No force, retry or replacement option exists.
Submission is attempted once. Uncertain outcomes require credential-free reconciliation, never another submit.
No live operation is authorized merely by these instructions. Help is offline and reads no credential/state.
`;
const specs: Record<string, readonly string[]> = {
  preflight: ["role", "near-rpc", "verify-rpc"],
  prepare: ["role", "id", "state", "near-rpc", "verify-rpc"],
  inspect: ["role", "state"],
  submit: ["role", "state", "approve", "reference", "credential"],
  reconcile: ["role", "state"],
};
class CliInputError extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CliInputError(message);
}
function publicEndpoint(value: string): string {
  try {
    const url = new URL(value);
    check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      !url.hostname.toLowerCase().includes("mainnet") && url.pathname === "/",
    "Use a public HTTPS Testnet RPC origin without credentials, paths or query strings.");
    return url.origin;
  } catch { throw new CliInputError("Use a public HTTPS Testnet RPC origin without credentials, paths or query strings."); }
}
function diagnosticFile(file: string, root: string): string {
  const base = resolve(root, ".local", "transfers", "near-diagnostics"), target = resolve(root, file), part = relative(base, target);
  check(part && part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part) && !part.includes(sep) &&
    target.endsWith(".json"), "Experiment A state must be a JSON file directly inside .local/transfers/near-diagnostics/.");
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
async function readState(file: string): Promise<ExperimentAState> {
  const state = decodeEncodedState(await readFile(file, "utf8"));
  assertExperimentAState(state);
  check(basename(file) === state.id + ".json", "The diagnostic filename must match the original prepared identifier.");
  check(state.mode === "live", "Synthetic offline fixture state cannot be used by the live diagnostic CLI.");
  return state;
}
export interface ExperimentACliOptions {
  readonly root?: string;
  /** Code-injected test port only; no CLI fixture or provider override can install it. */
  readonly ports?: ExperimentAPorts;
  readonly write?: (value: string) => void;
}
export async function runExperimentACli(argsValue: readonly string[], options: ExperimentACliOptions = {}): Promise<void> {
  const args = [...argsValue], command = args.shift(), root = resolve(options.root ?? process.cwd());
  const write = options.write ?? (text => process.stdout.write(text));
  const print = (value: unknown) => write(JSON.stringify(value, (_key, field) => typeof field === "bigint" ? field.toString() : field, 2) + "\n");
  if (!command || (["help", "--help"].includes(command) && args.length === 0)) { write(HELP); return; }
  check(Object.hasOwn(specs, command), "Unknown Experiment A command.");
  const allowed = new Set(specs[command]!), flags = new Map<string, string>();
  while (args.length) {
    const token = args.shift()!;
    check(token.startsWith("--") && allowed.has(token.slice(2)) && !flags.has(token.slice(2)),
      "Unknown, duplicate or prohibited diagnostic option.");
    const value = args.shift(); check(value && !value.startsWith("--"), "Diagnostic option value is missing.");
    flags.set(token.slice(2), value);
  }
  const need = (name: string) => { const value = flags.get(name); check(value, `Required --${name} is missing.`); return value; };
  check(need("role") === "investor", "Select --role investor; Treasury signing authority is prohibited in Experiment A.");
  const endpoints = {
    ...(flags.has("near-rpc") ? { primaryRpc: publicEndpoint(need("near-rpc")) } : {}),
    ...(flags.has("verify-rpc") ? { secondaryRpc: publicEndpoint(need("verify-rpc")) } : {}),
  };
  const file = command === "preflight" ? undefined : diagnosticFile(need("state"), root);
  const id = command === "prepare" ? need("id") : undefined;
  if (id) {
    check(/^experiment-a-investor-[a-z0-9][a-z0-9-]{0,95}$/.test(id), "Use a unique experiment-a-investor-ID identifier.");
    check(basename(file!) === id + ".json", "The diagnostic filename must match --id exactly, followed by .json.");
  }
  const approval = command === "submit" ? nearHash(need("approve")) : undefined;
  const reference = command === "submit" ? need("reference") : undefined;
  if (reference) check(reference === reference.trim() && /^[\x20-\x7e]{1,200}$/.test(reference), "Use a bounded public approval reference.");
  const credentialPath = command === "submit" ? need("credential") : undefined;
  if (credentialPath) check(isAbsolute(credentialPath) && basename(credentialPath) === "investor.json",
    "Select the explicit absolute protected external investor.json credential; Treasury credentials are prohibited.");
  const ports = () => options.ports ?? createExperimentAPorts(root);
  if (command === "preflight") { print(await observeExperimentA(endpoints, ports())); return; }
  if (command === "prepare") {
    await unused(file!); // Existing records are rejected before any RPC or new directory/lock creation.
    const path = await runtimeStatePath(file!, root, true);
    await withStateLock(path, async () => {
      await unused(path); const p = ports();
      const state = prepareExperimentA(id!, await observeExperimentA(endpoints, p), p.now());
      assertExperimentAState(state);
      check(state.mode === "live", "The live CLI cannot create synthetic diagnostic state.");
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(encodeState(state)); await handle.sync(); } finally { await handle.close(); }
      print(publicExperimentASummary(state));
    }); return;
  }
  const path = await runtimeStatePath(file!, root);
  if (command === "inspect") { print(publicExperimentASummary(await readState(path))); return; }
  await withStateLock(path, async () => {
    const state = await readState(path), p = ports();
    const save = async (next: ExperimentAState) => { assertExperimentAState(next); await saveEncodedState(path, next); };
    if (command === "submit") await submitExperimentA(state,
      { role: "investor", approval: approval!, reference: reference!, credentialPath: credentialPath! }, p, save);
    else await reconcileExperimentA(state, p, save);
    print(publicExperimentASummary(state));
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runExperimentACli(process.argv.slice(2)).catch(error => {
    // Unknown transport/filesystem/parser errors may contain untrusted or sensitive text.
    process.stderr.write((error instanceof CliInputError || error instanceof ExperimentAError ? error.message :
      "Experiment A command failed. Preserve its state and inspect/reconcile without retrying submission.") + "\n");
    process.exitCode = 1;
  });
}
