import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runExperimentBCli } from "../../scripts/near-mpc-diagnostic.js";
import { encodeState } from "../../src/execution/state.js";
import type { ExperimentBPorts } from "../../src/near/experiment-b.js";
import { experimentBFixture } from "./fixtures/experiment-b.js";

const ID = "experiment-b-investor-offline-cli-001";
const state = `.local/transfers/near-mpc-diagnostics/${ID}.json`;
const base = ["--role", "investor", "--state", state];
// Synthetic input only: these values are not a live budget or approval.
const budget = "123456789000000000000000", digest = "0x" + "11".repeat(32), hash = "1".repeat(32);
const prepare = ["prepare", ...base, "--id", ID, "--fee-budget-yocto", budget];
const script = fileURLToPath(new URL("../../scripts/near-mpc-diagnostic.ts", import.meta.url));
async function sandbox(action: (root: string, ports: ExperimentBPorts, calls: string[], output: string[]) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "wealthpixels-experiment-b-cli-offline-"));
  const calls: string[] = [], output: string[] = [];
  const unexpected = (name: string): never => { calls.push(name); throw new Error("Offline CLI test forbids external services."); };
  const ports: ExperimentBPorts = {
    mode: "live", now: () => Date.parse("2026-11-09T16:00:00.000Z"),
    async rpc() { return unexpected("UNEXPECTED_RPC"); },
    async loadSigner() { return unexpected("UNEXPECTED_CREDENTIAL_ACCESS"); },
    verifySignature() { return unexpected("UNEXPECTED_SIGNATURE_CHECK"); },
    async readAuthority() { return unexpected("UNEXPECTED_AUTHORITY_READ"); },
    verifyMpcOutcome() { return unexpected("UNEXPECTED_MPC_CHECK"); },
  };
  try { await action(root, ports, calls, output); }
  finally {
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-experiment-b-cli-offline-"))));
    await rm(root, { recursive: true, force: true });
  }
}
const invoke = (args: string[], root: string, ports: ExperimentBPorts, output: string[]) =>
  runExperimentBCli(args, { root, ports, write: text => output.push(text) });
const submission = (root: string) => ["submit", ...base, "--approve-digest", digest, "--approve-near-hash", hash,
  "--reference", "OFFLINE synthetic approval", "--credential", join(dirname(root), "external-protected", "investor.json")];

test("Experiment B help is offline, fixes the MPC request and requires a separate explicit fee budget", async () => sandbox(async (root, ports, calls, output) => {
  await invoke(["--help"], root, ports, output);
  const text = output.join("");
  for (const command of ["preflight", "prepare", "inspect", "submit", "reconcile"]) assert.ok(text.includes(command));
  for (const value of ["v1.signer-prod.testnet", "100 Tgas", "1 yoctoNEAR", "wealthpixels/sepolia/v1", "15 minutes",
    "--approve-digest", "--approve-near-hash", "no EVM transaction", "no default MPC fee budget"]) {
    assert.ok(text.includes(value), value);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment B actual CLI help runs with a network trap and creates no files", async () => sandbox(async root => {
  const trap = "data:text/javascript," + encodeURIComponent(`
globalThis.fetch = async () => { process.stderr.write('UNEXPECTED_EXPERIMENT_B_NETWORK'); throw new Error('offline trap'); };
`);
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", trap, script, "--help"], {
    cwd: root, encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Experiment B/);
  assert.doesNotMatch(result.stderr + result.stdout, /UNEXPECTED_EXPERIMENT_B_NETWORK/);
  assert.deepEqual(await readdir(root), []);
}));

test("Experiment B rejects other roles, mutable requests, duplicate flags and retry/fixture switches before effects", async () => sandbox(async (root, ports, calls, output) => {
  for (const args of [
    ["preflight", "--role", "treasury"], ["preflight"], ["preflight", "--role", "investor", "--role", "investor"],
    [...prepare, "--amount", "2"], [...prepare, "--recipient", "other.testnet"], [...prepare, "--path", "other/path"],
    [...prepare, "--domain", "1"], [...prepare, "--gas", "1"], [...prepare, "--digest", digest],
    ["submit", ...base, "--retry", "true"], ["submit", ...base, "--force", "true"],
    [...prepare, "--fixture", "true"], [...prepare, "--allow-fixtures", "true"], ["constructor", ...base],
  ]) await assert.rejects(invoke(args, root, ports, output));
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("preflight and prepare require a public B identifier and explicit positive fee budget without a default", async () => sandbox(async (root, ports, calls, output) => {
  for (const command of ["preflight", "prepare"]) {
    const valid = [command, "--role", "investor", "--id", ID, "--fee-budget-yocto", budget,
      ...(command === "prepare" ? ["--state", state] : [])];
    for (const omitted of ["id", "fee-budget-yocto"]) {
      const args = [...valid], index = args.indexOf("--" + omitted); args.splice(index, 2);
      await assert.rejects(invoke(args, root, ports, output), /Required/);
    }
    for (const value of ["0", "-1", "01", "0.0001", "1e24", " 1", "1".repeat(79)]) {
      const args = [...valid]; args[args.indexOf("--fee-budget-yocto") + 1] = value;
      await assert.rejects(invoke(args, root, ports, output), /positive integer/);
    }
    for (const value of ["experiment-a-investor-synthetic", "experiment-b-treasury-synthetic", "../synthetic", "experiment-b-investor-UPPER"] ) {
      const args = [...valid]; args[args.indexOf("--id") + 1] = value;
      await assert.rejects(invoke(args, root, ports, output), /identifier/);
    }
  }
  await assert.rejects(invoke([...prepare.slice(0, -4), "--id", "experiment-b-investor-other", "--fee-budget-yocto", budget], root, ports, output), /filename/);
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment B rejects unsafe endpoint URLs before filesystem or network access", async () => sandbox(async (root, ports, calls, output) => {
  for (const flag of ["--near-rpc", "--verify-rpc"]) for (const url of ["http://test.rpc.fastnear.com", "https://user:password@test.rpc.fastnear.com",
    "https://test.rpc.fastnear.com?apiKey=PRIVATE", "https://test.rpc.fastnear.com/secret-path", "https://rpc.mainnet.near.org",
    "https://test.rpc.fastnear.com#fragment", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://host.internal", "https://test.rpc.fastnear.com:1234"]) {
    await assert.rejects(invoke([...prepare, flag, url], root, ports, output), /public HTTPS Testnet RPC/);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment B cannot target Experiment A, Treasury, purchase or escaped diagnostic state", async () => sandbox(async (root, ports, calls, output) => {
  for (const path of [".local/transfers/near-diagnostics/experiment-a-investor-synthetic.json", ".local/transfers/native-tests/native-smoke-20261109-001.json",
    ".local/transfers/purchase-journal.json", ".local/transfers/near-mpc-diagnostics/../native-tests/synthetic.json", "docs/experiment.json",
    ".local/transfers/near-mpc-diagnostics/nested/state.json", ".local/transfers/near-mpc-diagnostics/state.txt"]) {
    await assert.rejects(invoke(["inspect", "--role", "investor", "--state", path], root, ports, output), /near-mpc-diagnostics/);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment B read-only operations reject credentials and stored operations reject endpoint/budget substitution", async () => sandbox(async (root, ports, calls, output) => {
  for (const command of ["preflight", "prepare", "inspect", "reconcile"]) {
    const args = command === "preflight" ? ["--role", "investor", "--id", ID, "--fee-budget-yocto", budget] : command === "prepare" ? prepare.slice(1) : base;
    await assert.rejects(invoke([command, ...args, "--credential", join(root, "investor.json")], root, ports, output), /prohibited/);
  }
  for (const command of ["inspect", "submit", "reconcile"]) for (const flag of ["--near-rpc", "--verify-rpc", "--fee-budget-yocto"]) {
    await assert.rejects(invoke([command, ...base, flag, "https://other.invalid"], root, ports, output), /prohibited/);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("both digest and NEAR hash approvals must be syntactically valid before state access", async () => sandbox(async (root, ports, calls, output) => {
  const valid = submission(root);
  for (const omitted of ["approve-digest", "approve-near-hash", "reference", "credential"]) {
    const args = [...valid], index = args.indexOf("--" + omitted); args.splice(index, 2);
    await assert.rejects(invoke(args, root, ports, output), /Required/);
  }
  for (const value of ["11".repeat(32), "0x" + "AA".repeat(32), "0x1234", "invalid digest"]) {
    const args = [...valid]; args[args.indexOf("--approve-digest") + 1] = value;
    await assert.rejects(invoke(args, root, ports, output), /Digest approval/);
  }
  for (const value of [digest, "invalid hash", "111", "0".repeat(32)]) {
    const args = [...valid]; args[args.indexOf("--approve-near-hash") + 1] = value;
    await assert.rejects(invoke(args, root, ports, output), /NEAR transaction hash/);
  }
  for (const value of ["investor.json", join(root, "investor.json"), join(dirname(root), "treasury.json")]) {
    const args = [...valid]; args[args.indexOf("--credential") + 1] = value;
    await assert.rejects(invoke(args, root, ports, output), /external investor\.json/);
  }
  for (const value of [" private-reference", "private-reference\n", "x".repeat(201)]) {
    const args = [...valid]; args[args.indexOf("--reference") + 1] = value;
    await assert.rejects(invoke(args, root, ports, output), /bounded public approval/);
  }
  assert.deepEqual(calls, []); assert.deepEqual(await readdir(root), []);
}));

test("Experiment B preparation refuses overwrite and preserves unrelated synthetic records", async () => sandbox(async (root, ports, calls, output) => {
  const file = join(root, state), a = join(root, ".local", "transfers", "near-diagnostics", "experiment-a-investor-synthetic.json");
  const treasury = join(root, ".local", "transfers", "native-tests", "native-smoke-20261109-001.json"), purchase = join(root, ".local", "transfers", "purchase-journal.json");
  for (const path of [file, a, treasury, purchase]) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, "OFFLINE SYNTHETIC SENTINEL\n"); }
  await assert.rejects(invoke(prepare, root, ports, output), /already exists/);
  for (const path of [file, a, treasury, purchase]) assert.equal(await readFile(path, "utf8"), "OFFLINE SYNTHETIC SENTINEL\n");
  assert.deepEqual(await readdir(dirname(file)), [ID + ".json"]); assert.deepEqual(calls, []);
}));

test("Experiment B rejects linked runtime directories before public reads", async () => sandbox(async (root, ports, calls, output) => {
  const target = join(root, "synthetic-link-target"), link = join(root, ".local", "transfers", "near-mpc-diagnostics");
  await mkdir(target); await mkdir(dirname(link), { recursive: true });
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  try {
    await assert.rejects(invoke(prepare, root, ports, output), /linked|resolved outside/);
    assert.deepEqual(await readdir(target), []); assert.deepEqual(calls, []);
  } finally { await unlink(link); }
}));

test("Experiment B rejects copied A/native/purchase schemas without RPC or signing access", async () => sandbox(async (root, ports, calls, output) => {
  const file = join(root, state); await mkdir(dirname(file), { recursive: true });
  for (const kind of ["experiment-a-near-self-transfer", "standalone-native-eth-test", "portfolio-purchase"]) {
    const text = JSON.stringify({ schemaVersion: 1, kind, status: "prepared", private_key: "OFFLINE-MALFORMED-SENTINEL" });
    await writeFile(file, text);
    await assert.rejects(invoke(["inspect", ...base], root, ports, output));
    await assert.rejects(invoke(["reconcile", ...base], root, ports, output));
    assert.equal(await readFile(file, "utf8"), text);
  }
  assert.deepEqual(calls, []); assert.deepEqual(output, []); assert.deepEqual(await readdir(dirname(file)), [ID + ".json"]);
}));

test("a copied B diagnostic cannot be inspected under a different filename", async () => sandbox(async (root, ports, calls, output) => {
  const synthetic = await experimentBFixture().prepare(), file = join(root, state), text = encodeState(synthetic);
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, text);
  await assert.rejects(invoke(["inspect", ...base], root, ports, output), /filename.*identifier/);
  assert.deepEqual(calls, []); assert.deepEqual(output, []); assert.equal(await readFile(file, "utf8"), text);
}));

test("the live B CLI refuses correctly named synthetic offline fixture state", async () => sandbox(async (root, ports, calls, output) => {
  const synthetic = await experimentBFixture().prepare(ID), file = join(root, state), text = encodeState(synthetic);
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, text);
  await assert.rejects(invoke(["inspect", ...base], root, ports, output), /offline fixture state/);
  await assert.rejects(invoke(["reconcile", ...base], root, ports, output), /offline fixture state/);
  await assert.rejects(invoke(submission(root), root, ports, output), /offline fixture state/);
  assert.deepEqual(calls, []); assert.deepEqual(output, []); assert.equal(await readFile(file, "utf8"), text);
  assert.deepEqual(await readdir(dirname(file)), [ID + ".json"]);
}));

test("stored B state rejects unsafe RPC origins before public services", async () => sandbox(async (root, ports, calls, output) => {
  const original = await experimentBFixture().prepare(ID), file = join(root, state);
  await mkdir(dirname(file), { recursive: true });
  for (const primaryRpc of ["https://localhost", "https://127.0.0.1", "https://host.internal"]) {
    const changed = { ...original, primaryRpc, preflight: { ...original.preflight, primaryRpc } };
    const text = encodeState(changed); await writeFile(file, text);
    await assert.rejects(invoke(["reconcile", ...base], root, ports, output), /public.*HTTPS.*Testnet|public.*Testnet.*RPC/);
    assert.equal(await readFile(file, "utf8"), text);
  }
  assert.deepEqual(calls, []); assert.deepEqual(output, []);
  assert.deepEqual(await readdir(dirname(file)), [ID + ".json"]);
}));
