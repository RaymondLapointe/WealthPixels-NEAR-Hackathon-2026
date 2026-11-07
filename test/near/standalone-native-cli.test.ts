import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPurchaseCoordinator } from "../../src/purchase/coordinator.js";
import { createPurchaseExecutionFixture } from "./fixtures/purchase-execution.js";

const script = fileURLToPath(new URL("../../scripts/native-test.ts", import.meta.url));
const trap = "data:text/javascript," + encodeURIComponent(`
import fs from 'node:fs'; import promises from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
const forbidden = path => /CLI_(?:STATE|CREDENTIAL)_SENTINEL/.test(String(path));
const originalRead = promises.readFile.bind(promises), originalSync = fs.readFileSync.bind(fs);
promises.readFile = async (path,...args) => { if(forbidden(path)) {process.stderr.write('UNEXPECTED_NATIVE_FILE_READ');throw new Error('offline trap');}return originalRead(path,...args);};
fs.readFileSync = (path,...args) => {if(forbidden(path)){process.stderr.write('UNEXPECTED_NATIVE_FILE_READ');throw new Error('offline trap');}return originalSync(path,...args);};
syncBuiltinESMExports();
globalThis.fetch = async () => {process.stderr.write('UNEXPECTED_NATIVE_NETWORK');throw new Error('offline trap');};
`);
function run(root: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", trap, script, ...args], {
    cwd: root, encoding: "utf8", timeout: 20_000,
  });
}
async function sandbox(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "wealthpixels-standalone-native-cli-offline-"));
  try { await action(root); }
  finally {
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), "wealthpixels-standalone-native-cli-offline-"))));
    await rm(root, { recursive: true, force: true });
  }
}
const hash = `0x${"11".repeat(32)}`;
const base = ["--role", "treasury", "--state", ".local/transfers/native-tests/CLI_STATE_SENTINEL.json", "--intent-hash", hash];
const auditPath = ["--audit", ".local/transfers/native-tests/evidence/new-audit.json"];
function quietFailure(result: ReturnType<typeof run>) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr + result.stdout, /UNEXPECTED_NATIVE_(?:FILE_READ|NETWORK)/);
}

test("standalone native help exposes the separate workflow without file, credential or network operations", async () => sandbox(async root => {
  const result = run(root, ["--help"]);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /native|standalone/i);
  for (const command of ["prepare", "inspect", "sign", "reconcile-signing", "audit", "broadcast", "reconcile"]) assert.ok(result.stdout.includes(command));
  assert.doesNotMatch(result.stderr + result.stdout, /UNEXPECTED_NATIVE_/); assert.deepEqual(await readdir(root), []);
}));
test("read-only native commands reject credential flags before state or network access", async () => sandbox(async root => {
  for (const command of ["inspect", "reconcile-signing", "audit", "reconcile"]) {
    quietFailure(run(root, [command, ...(command === "inspect" ? base.slice(0, 4) : base), "--credential", join(root, "CLI_CREDENTIAL_SENTINEL.json")]));
    assert.deepEqual(await readdir(root), []);
  }
}));
test("native CLI rejects investor authority, unknown, duplicate, force and fixture flags before any side effect", async () => sandbox(async root => {
  const cases = [
    ["inspect", ...base.slice(0, 4), "--role", "treasury"],
    ["inspect", "--role", "investor", "--state", ".local/transfers/native-tests/CLI_STATE_SENTINEL.json"],
    ["audit", ...base, "--force"], ["audit", ...base, "--fixture"], ["audit", ...base, "--allow-fixtures"],
    ["inspect", ...base.slice(0, 4), "--unknown", "value"],
  ];
  for (const args of cases) { quietFailure(run(root, args)); assert.deepEqual(await readdir(root), []); }
}));
test("native CLI rejects portfolio and escaped runtime state paths before reading them", async () => sandbox(async root => {
  for (const path of [".local/transfers/purchase-journal.json", ".local/transfers/CLI_STATE_SENTINEL.json",
    ".local/transfers/native-tests/../CLI_STATE_SENTINEL.json", "docs/CLI_STATE_SENTINEL.json"]) {
    const result = run(root, ["inspect", "--role", "treasury", "--state", path]);
    quietFailure(result); assert.match(result.stderr, /native-tests/i);
    assert.deepEqual(await readdir(root), []);
  }
}));
test("native signing and broadcasting require separate explicit approval inputs before credential access", async () => sandbox(async root => {
  for (const args of [
    ["sign", ...base, "--credential", join(root, "CLI_CREDENTIAL_SENTINEL.json"), "--reference", "offline missing digest"],
    ["sign", ...base, "--approve", hash, "--reference", "offline missing credential"],
    ["broadcast", ...base, ...auditPath, "--reference", "offline missing signed hash"],
    ["broadcast", ...base, ...auditPath, "--approve", hash, "--reference", "offline", "--recovery"],
    ["broadcast", ...base, ...auditPath, "--approve", hash, "--reference", "offline", "--ack-prepared-at", "2026-11-07T00:00:00.000Z"],
  ]) { quietFailure(run(root, args)); assert.deepEqual(await readdir(root), []); }
}));
test("native prepare validates exact integers and required identity before any live observation or file creation", async () => sandbox(async root => {
  const valid = ["prepare", "--role", "treasury", "--state", ".local/transfers/native-tests/new.json", "--id", "offline-never-prepared",
    "--amount-wei", "1000000000000", "--max-fee-wei", "5000", "--priority-fee-wei", "1000"];
  for (const replacement of ["1.5", "1e12", "0", "-1"]) {
    const args = [...valid]; args[args.indexOf("--amount-wei") + 1] = replacement;
    quietFailure(run(root, args)); assert.deepEqual(await readdir(root), []);
  }
  quietFailure(run(root, ["prepare", "--role", "treasury", "--state", ".local/transfers/native-tests/new.json"]));
  assert.deepEqual(await readdir(root), []);
}));

test("active unpaid reservation and finalized paid obligation block standalone prepare without RPC or journal changes", async () => {
  // This purchase uses only the existing explicitly simulated signing/broadcast
  // driver. The child CLI is trapped before any possible real network read.
  const f = await createPurchaseExecutionFixture();
  try {
    await f.setup(); const c = createPurchaseCoordinator(f.driver, { root: f.root });
    for (const phase of ["unpaid", "paid"] as const) {
      if (phase === "paid") {
        const input = { quoteHash: f.quote.quoteHash, leg: "usdc-payment" as const, role: "investor" as const };
        let journal = await c.prepare({ ...input, reference: "SIMULATED guard-test preparation" });
        await c.sign({ ...input, approval: journal.active!.execution!.legs["usdc-payment"]!.prepared.prepared.unsignedHash,
          credentialPath: f.rolePaths.investor, reference: "SIMULATED guard-test signing approval" });
        journal = await c.reconcileSigning(input); const e = journal.active!.execution!;
        await c.broadcast({ ...input, approval: e.legs["usdc-payment"]!.signed!.hash, paymentAuthorizationHash: e.paymentAuthorization!.authorizationHash });
        journal = await c.reconcile(input); assert.ok(journal.active!.execution!.paidAt && journal.active!.execution!.paymentClaim);
      }
      const before = await readFile(f.journalFile, "utf8");
      const result = run(f.root, ["prepare", "--role", "treasury", "--state", ".local/transfers/native-tests/never-created.json",
        "--id", `offline-native-${phase}-guard`, "--amount-wei", "1000000000000", "--max-fee-wei", "5000", "--priority-fee-wei", "1000"]);
      quietFailure(result); assert.match(result.stderr, /purchase|reservation|obligation/i);
      assert.equal(await readFile(f.journalFile, "utf8"), before);
      await assert.rejects(access(join(f.root, ".local", "transfers", "native-tests")), { code: "ENOENT" });
    }
  } finally { await f.cleanup(); }
});
