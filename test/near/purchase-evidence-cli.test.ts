import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readPublicEvidenceJson, writeNewPublicEvidenceJson } from "../../src/evidence/public-files.js";

const verifier = fileURLToPath(new URL("../../scripts/verify-purchase-evidence.ts", import.meta.url));
const exporter = fileURLToPath(new URL("../../scripts/export-purchase-evidence.ts", import.meta.url));
const prefix = "wealthpixels-public-evidence-cli-";
const pending = JSON.stringify({ schemaVersion: 1, kind: "wealthpixels-portfolio-purchase", mode: "live", status: "pending",
  message: "OFFLINE CLI test placeholder, no transaction evidence" });
const trap = "data:text/javascript," + encodeURIComponent(`
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const base = process.cwd().replaceAll('\\\\', '/').toLowerCase();
const guard = file => {
  const value = String(file ?? '').replaceAll('\\\\', '/').toLowerCase();
  if (value.includes('never_open') || value === base + '/.local' || value.startsWith(base + '/.local/')) {
    process.stderr.write('UNEXPECTED_PRIVATE_OR_RUNTIME_FILE_ACCESS'); throw new Error('offline filesystem trap');
  }
};
for (const name of ['readFileSync','lstatSync','statSync','openSync','mkdirSync']) {
  const original = fs[name]; fs[name] = function(file, ...args) { guard(file); return original.call(this, file, ...args); };
}
for (const name of ['readFile','lstat','stat','open','mkdir','realpath']) {
  const original = fs.promises[name]; fs.promises[name] = function(file, ...args) { guard(file); return original.call(this, file, ...args); };
}
syncBuiltinESMExports();
globalThis.fetch = async () => { process.stderr.write('UNEXPECTED_PUBLIC_EVIDENCE_NETWORK'); throw new Error('offline network trap'); };
`);
function run(script: string, cwd: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", trap, script, ...args], {
    cwd, encoding: "utf8", timeout: 20_000,
  });
}
function noAccess(result: ReturnType<typeof run>) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_PRIVATE_OR_RUNTIME_FILE_ACCESS|UNEXPECTED_PUBLIC_EVIDENCE_NETWORK/);
}
async function sandbox(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try { await action(root); }
  finally { assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), prefix))), "Cleanup stays inside the generated public-evidence test root.");
    await rm(root, { recursive: true, force: true }); }
}

test("purchase evidence CLI help requires neither journal nor public RPC access", async () => sandbox(async root => {
  for (const script of [verifier, exporter]) {
    const result = run(script, root, ["--help"]); noAccess(result); assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /credential|credentials/i); assert.deepEqual(await readdir(root), []);
  }
}));

test("pending public purchase placeholder exits2 without touching runtime state or making an RPC request", async () => sandbox(async root => {
  await mkdir(join(root, "evidence")); await writeFile(join(root, "evidence", "pending.json"), pending);
  const result = run(verifier, root, ["--manifest", "evidence/pending.json"]); noAccess(result);
  assert.equal(result.status, 2, result.stderr); const output = JSON.parse(result.stdout);
  assert.equal(output.status, "incomplete"); assert.equal(output.code, "PENDING"); assert.deepEqual(output.completedChecks, []);
  assert.equal(await readFile(join(root, "evidence", "pending.json"), "utf8"), pending);
  assert.deepEqual(await readdir(root), ["evidence"]);
}));

test("verifier rejects credential, state, signing and runtime paths before any protected file access", async () => sandbox(async root => {
  for (const flag of ["--credential", "--credential-path", "--state", "--env", "--sign", "--broadcast", "--force", "--fixture"]) {
    const result = run(verifier, root, [flag, ".local/transfers/NEVER_OPEN.json"]); noAccess(result); assert.equal(result.status, 1);
  }
  for (const path of [".local/transfers/NEVER_OPEN.json", "../NEVER_OPEN.json", "credentials/NEVER_OPEN.json", ".env"]) {
    const result = run(verifier, root, ["--manifest", path]); noAccess(result); assert.equal(result.status, 1);
  }
  assert.deepEqual(await readdir(root), []);
}));

test("exporter rejects credentials and invalid output destinations before reading or creating a journal", async () => sandbox(async root => {
  for (const args of [["--credential", "NEVER_OPEN.json"], ["--purchase-id", "offline-id", "--out", ".local/transfers/NEVER_OPEN.json"],
    ["--purchase-id", "offline-id", "--out", "../NEVER_OPEN.json"], ["--purchase-id", "offline-id", "--out", ".env"]]) {
    const result = run(exporter, root, args); noAccess(result); assert.equal(result.status, 1);
  }
  assert.deepEqual(await readdir(root), []);
}));

test("pending verification can create one public report and cannot overwrite existing evidence", async () => sandbox(async root => {
  await mkdir(join(root, "evidence")); await writeFile(join(root, "evidence", "pending.json"), pending);
  const args = ["--manifest", "evidence/pending.json", "--report", "evidence/report.json"];
  const first = run(verifier, root, args); noAccess(first); assert.equal(first.status, 2, first.stderr);
  const report = await readFile(join(root, "evidence", "report.json"), "utf8"); assert.equal(JSON.parse(report).status, "incomplete");
  const second = run(verifier, root, args); noAccess(second); assert.equal(second.status, 1);
  assert.equal(await readFile(join(root, "evidence", "report.json"), "utf8"), report);
  assert.equal(await readFile(join(root, "evidence", "pending.json"), "utf8"), pending);
}));

test("public evidence files enforce new-file writes and the exact two-megabyte size ceiling", async () => sandbox(async root => {
  await mkdir(join(root, "evidence"));
  await writeNewPublicEvidenceJson("evidence/new.json", "{}\n", root);
  await assert.rejects(writeNewPublicEvidenceJson("evidence/new.json", "overwritten", root));
  assert.equal(await readPublicEvidenceJson("evidence/new.json", root), "{}\n");
  const exact = " ".repeat(2_000_000); await writeNewPublicEvidenceJson("evidence/exact.json", exact, root);
  assert.equal((await readPublicEvidenceJson("evidence/exact.json", root)).length, 2_000_000);
  await assert.rejects(writeNewPublicEvidenceJson("evidence/too-large.json", exact + " ", root), /two megabytes/);
  await writeFile(join(root, "evidence", "oversized.json"), exact + " ");
  await assert.rejects(readPublicEvidenceJson("evidence/oversized.json", root), /bounded/);
  assert.equal((await readdir(join(root, "evidence"))).includes("too-large.json"), false);
}));

test("public evidence path constraints reject traversal, runtime files and non-JSON extensions", async () => sandbox(async root => {
  await mkdir(join(root, "evidence"));
  for (const path of [".local/transfers/state.json", "../outside.json", "evidence/../../outside.json", "evidence/file.txt", "evidence"]) {
    await assert.rejects(readPublicEvidenceJson(path, root)); await assert.rejects(writeNewPublicEvidenceJson(path, "{}", root));
  }
  assert.deepEqual(await readdir(join(root, "evidence")), []);
}));

test("public evidence rejects linked input files and directory junctions without following them", async () => sandbox(async root => {
  await mkdir(join(root, "evidence")); await mkdir(join(root, "outside"));
  await writeFile(join(root, "outside", "public-fixture.json"), "{}");
  await link(join(root, "outside", "public-fixture.json"), join(root, "evidence", "hardlink.json"));
  await assert.rejects(readPublicEvidenceJson("evidence/hardlink.json", root), /link|regular/i);
  await symlink(join(root, "outside"), join(root, "evidence", "junction"), "junction");
  await assert.rejects(readPublicEvidenceJson("evidence/junction/public-fixture.json", root), /link|regular/i);
  await assert.rejects(writeNewPublicEvidenceJson("evidence/junction/new.json", "{}", root), /link|regular/i);
  assert.deepEqual(await readdir(join(root, "outside")), ["public-fixture.json"]);
}));
