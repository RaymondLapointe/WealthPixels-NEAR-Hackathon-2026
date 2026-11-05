import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/transfer.ts", import.meta.url));
const networkTrap = "data:text/javascript," + encodeURIComponent(
  "globalThis.fetch = async () => { process.stderr.write('UNEXPECTED_RECOVERY_NETWORK'); throw new Error('offline network trap'); };",
);
function run(cwd: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", networkTrap, script, ...args], {
    cwd, encoding: "utf8", timeout: 20_000,
  });
}

test("recovery CLI requires both explicit approvals before state/audit or network operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wealthpixels-recovery-cli-"));
  try {
    const base = ["broadcast-recovered", "--role", "treasury", "--state", ".local/transfers/original.json", "--audit", ".local/transfers/evidence/new.json"];
    for (const approvals of [[], ["--approve-broadcast", "0x" + "ff".repeat(32)], ["--acknowledge-expired-preparation", "2026-11-04T22:05:28.617Z"]]) {
      const result = run(directory, [...base, ...approvals]);
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stderr, /UNEXPECTED_RECOVERY_NETWORK/);
      assert.deepEqual(await readdir(directory), []);
    }
  } finally { await rm(directory, { recursive: true }); }
});

test("read-only recovery audit rejects credential and generic force flags before any network request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wealthpixels-recovery-cli-"));
  try {
    const help = run(directory, ["--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /recovery-audit/);
    for (const flag of ["--credential", "--force"]) {
      const result = run(directory, ["recovery-audit", flag, "never-opened"]);
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stderr, /UNEXPECTED_RECOVERY_NETWORK/);
      assert.deepEqual(await readdir(directory), []);
    }
  } finally { await rm(directory, { recursive: true }); }
});

test("Investor recovery CLI retains separate approval and credential/force rejection boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wealthpixels-investor-recovery-cli-"));
  try {
    const base = ["broadcast-recovered", "--role", "investor", "--state", ".local/transfers/investor.json", "--audit", ".local/transfers/evidence/new-investor.json"];
    const signedHash = "0x3be24eeae394ac79ac65df6a2ea2e58aa086cd7500ac78d7d1af99a848b59c86";
    for (const approvals of [[], ["--approve-broadcast", signedHash], ["--acknowledge-expired-preparation", "2026-11-05T16:17:00.756Z"]]) {
      const result = run(directory, [...base, ...approvals]);
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stderr, /UNEXPECTED_RECOVERY_NETWORK/);
      assert.deepEqual(await readdir(directory), []);
    }
    for (const command of ["recovery-audit", "broadcast-recovered"]) {
      for (const flag of ["--credential", "--force"]) {
        const result = run(directory, [command, "--role", "investor", flag, "never-opened"]);
        assert.equal(result.status, 1, result.stderr);
        assert.doesNotMatch(result.stderr, /UNEXPECTED_RECOVERY_NETWORK/);
        assert.deepEqual(await readdir(directory), []);
      }
    }
  } finally { await rm(directory, { recursive: true }); }
});
