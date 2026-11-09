import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runExperimentACli } from "../../scripts/near-rpc-diagnostic.js";
import type { ExperimentAPorts } from "../../src/near/experiment-a.js";
import { experimentAFixture } from "./fixtures/experiment-a.js";

const ID = "experiment-a-investor-offline-cli-001";
const state = `.local/transfers/near-diagnostics/${ID}.json`;
const base = ["--role", "investor", "--state", state];
const hash = "1".repeat(32);
const script = fileURLToPath(new URL("../../scripts/near-rpc-diagnostic.ts", import.meta.url));
async function sandbox(action: (root: string, ports: ExperimentAPorts, calls: string[], output: string[]) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "wealthpixels-experiment-a-cli-offline-"));
  const calls: string[] = [], output: string[] = [];
  const ports: ExperimentAPorts = {
    mode: "live", now: () => Date.parse("2026-11-09T16:00:00.000Z"),
    async rpc() { calls.push("UNEXPECTED_RPC"); throw new Error("Offline CLI test forbids network."); },
    async loadSigner() { calls.push("UNEXPECTED_CREDENTIAL_ACCESS"); throw new Error("Offline CLI test forbids credentials."); },
    verifySignature() { calls.push("UNEXPECTED_SIGNATURE_CHECK"); return false; },
  };
  try { await action(root, ports, calls, output); }
  finally {
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-experiment-a-cli-offline-"))));
    await rm(root, { recursive: true, force: true });
  }
}
const invoke = (args: string[], root: string, ports: ExperimentAPorts, output: string[]) =>
  runExperimentACli(args, { root, ports, write: text => output.push(text) });

test("Experiment A help is offline and advertises fixed self-transfer and separate authorization stages", async () => sandbox(async (root, ports, calls, output) => {
  await invoke(["--help"], root, ports, output);
  const text = output.join("");
  for (const command of ["preflight", "prepare", "inspect", "submit", "reconcile"]) assert.ok(text.includes(command));
  assert.match(text, /Transfer 1 yoctoNEAR/); assert.match(text, /15 minutes/); assert.match(text, /0\.0001 NEAR/);
  assert.match(text, /not MPC or Ethereum/); assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment A actual CLI help does not contact RPC or read signing credentials", async () => sandbox(async root => {
  const trap = "data:text/javascript," + encodeURIComponent(`
globalThis.fetch = async () => { process.stderr.write('UNEXPECTED_EXPERIMENT_A_NETWORK'); throw new Error('offline trap'); };
`);
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", trap, script, "--help"], {
    cwd: root, encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Experiment A/);
  assert.doesNotMatch(result.stderr + result.stdout, /UNEXPECTED_EXPERIMENT_A_NETWORK/);
  assert.deepEqual(await readdir(root), []);
}));

test("Experiment A rejects other roles, actions, duplicate flags and retry/fixture switches before side effects", async () => sandbox(async (root, ports, calls, output) => {
  for (const args of [
    ["preflight", "--role", "treasury"], ["preflight"], ["preflight", "--role", "investor", "--role", "investor"],
    ["preflight", "--role", "investor", "--amount", "2"], ["preflight", "--role", "investor", "--recipient", "another.testnet"],
    ["submit", ...base, "--retry", "true"], ["submit", ...base, "--force", "true"],
    ["prepare", ...base, "--fixture", "true"], ["prepare", ...base, "--allow-fixtures", "true"],
    ["constructor", ...base],
  ]) await assert.rejects(invoke(args, root, ports, output));
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment A cannot target Treasury, portfolio journals or escaped diagnostic files", async () => sandbox(async (root, ports, calls, output) => {
  for (const path of [".local/transfers/native-tests/native-smoke-20261109-001.json", ".local/transfers/purchase-journal.json",
    ".local/transfers/near-diagnostics/../native-tests/native-smoke-20261109-001.json", "docs/experiment.json",
    ".local/transfers/near-diagnostics/nested/state.json", ".local/transfers/near-diagnostics/state.txt"]) {
    await assert.rejects(invoke(["inspect", "--role", "investor", "--state", path], root, ports, output), /near-diagnostics/);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment A read-only commands reject credentials and stored operations reject endpoint substitution", async () => sandbox(async (root, ports, calls, output) => {
  for (const command of ["preflight", "inspect", "reconcile"]) {
    const args = command === "preflight" ? ["--role", "investor"] : base;
    await assert.rejects(invoke([command, ...args, "--credential", join(root, "investor.json")], root, ports, output), /prohibited/);
  }
  for (const command of ["inspect", "submit", "reconcile"]) {
    await assert.rejects(invoke([command, ...base, "--near-rpc", "https://other.invalid"], root, ports, output), /prohibited/);
    await assert.rejects(invoke([command, ...base, "--verify-rpc", "https://other.invalid"], root, ports, output), /prohibited/);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment A validates preparation identity and public RPC URLs before writes or network", async () => sandbox(async (root, ports, calls, output) => {
  const valid = ["prepare", ...base, "--id", ID];
  for (const url of ["http://test.rpc.fastnear.com", "https://user:password@test.rpc.fastnear.com", "https://test.rpc.fastnear.com?apiKey=PRIVATE",
    "https://test.rpc.fastnear.com/secret-path", "https://rpc.mainnet.near.org", "https://test.rpc.fastnear.com#fragment"]) {
    await assert.rejects(invoke([...valid, "--near-rpc", url], root, ports, output), /public HTTPS Testnet RPC/);
  }
  await assert.rejects(invoke(["prepare", ...base, "--id", "unrelated-id"], root, ports, output), /identifier/);
  await assert.rejects(invoke(["prepare", ...base, "--id", "experiment-a-investor-different"], root, ports, output), /filename/);
  await assert.rejects(invoke(["prepare", ...base], root, ports, output), /Required --id/);
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment A submission requires exact NEAR hash approval and explicit Investor credential selection before state access", async () => sandbox(async (root, ports, calls, output) => {
  const valid = ["submit", ...base, "--approve", hash, "--reference", "OFFLINE public approval", "--credential", join(root, "investor.json")];
  for (const omitted of ["approve", "reference", "credential"]) {
    const args = [...valid], index = args.indexOf("--" + omitted); args.splice(index, 2);
    await assert.rejects(invoke(args, root, ports, output), /Required/);
  }
  for (const value of ["0x" + "11".repeat(32), "invalid hash", "111"]) {
    const args = [...valid]; args[args.indexOf("--approve") + 1] = value;
    await assert.rejects(invoke(args, root, ports, output), /NEAR transaction hash/);
  }
  for (const value of ["investor.json", join(root, "treasury.json")]) {
    const args = [...valid]; args[args.indexOf("--credential") + 1] = value;
    await assert.rejects(invoke(args, root, ports, output), /investor\.json/);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment A preparation refuses overwrite before RPC and leaves unrelated records unchanged", async () => sandbox(async (root, ports, calls, output) => {
  const file = join(root, state), treasury = join(root, ".local", "transfers", "native-tests", "native-smoke-20261109-001.json");
  const purchase = join(root, ".local", "transfers", "purchase-journal.json");
  await mkdir(join(root, ".local", "transfers", "near-diagnostics"), { recursive: true });
  await mkdir(join(root, ".local", "transfers", "native-tests"), { recursive: true });
  // Synthetic sentinels in a fresh temporary directory; never the project's real records.
  await writeFile(file, "OFFLINE EXISTING DIAGNOSTIC MUST BE PRESERVED\n");
  await writeFile(treasury, "OFFLINE TREASURY SENTINEL\n"); await writeFile(purchase, "OFFLINE PURCHASE SENTINEL\n");
  await assert.rejects(invoke(["prepare", ...base, "--id", ID], root, ports, output), /already exists/);
  assert.equal(await readFile(file, "utf8"), "OFFLINE EXISTING DIAGNOSTIC MUST BE PRESERVED\n");
  assert.equal(await readFile(treasury, "utf8"), "OFFLINE TREASURY SENTINEL\n");
  assert.equal(await readFile(purchase, "utf8"), "OFFLINE PURCHASE SENTINEL\n");
  assert.deepEqual(await readdir(join(root, ".local", "transfers", "near-diagnostics")), [ID + ".json"]);
  assert.deepEqual(calls, []);
}));

test("Experiment A rejects unrelated state schemas without RPC or signing access", async () => sandbox(async (root, ports, calls, output) => {
  const file = join(root, state); await mkdir(join(root, ".local", "transfers", "near-diagnostics"), { recursive: true });
  const text = JSON.stringify({ schemaVersion: 1, kind: "standalone-native-eth-test", status: "near-uncertain", private_key: "OFFLINE-MALFORMED-SENTINEL" });
  await writeFile(file, text);
  await assert.rejects(invoke(["inspect", ...base], root, ports, output));
  await assert.rejects(invoke(["reconcile", ...base], root, ports, output));
  assert.equal(await readFile(file, "utf8"), text); assert.deepEqual(calls, []); assert.deepEqual(output, []);
  assert.deepEqual(await readdir(join(root, ".local", "transfers", "near-diagnostics")), [ID + ".json"]);
}));

test("a copied diagnostic cannot be used under a different filename or identifier", async () => sandbox(async (root, ports, calls, output) => {
  const synthetic = await experimentAFixture().prepare(), file = join(root, state);
  await mkdir(join(root, ".local", "transfers", "near-diagnostics"), { recursive: true });
  await writeFile(file, JSON.stringify(synthetic));
  await assert.rejects(invoke(["inspect", ...base], root, ports, output), /filename.*identifier/);
  assert.deepEqual(calls, []); assert.deepEqual(output, []);
  assert.equal(await readFile(file, "utf8"), JSON.stringify(synthetic));
}));
