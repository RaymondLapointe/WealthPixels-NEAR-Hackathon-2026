import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../../scripts/purchase.ts", import.meta.url));
// This preload rejects network activity, transaction-state I/O and the synthetic
// credential sentinel. It never reads a real key or transaction-state file.
const trap = "data:text/javascript," + encodeURIComponent(`
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  globalThis.fetch = async () => { process.stderr.write('UNEXPECTED_PURCHASE_NETWORK'); throw new Error('offline network trap'); };
  for (const method of ['readFile', 'writeFile', 'open', 'mkdir', 'stat', 'lstat', 'realpath']) {
    const original = fs.promises[method];
    fs.promises[method] = async (...args) => {
      const path = String(args[0]).replaceAll('\\\\', '/');
      if (path.includes('/.local/transfers') || path.includes('NEVER_OPEN_PROTECTED_ROLE')) {
        process.stderr.write('UNEXPECTED_PURCHASE_PRIVATE_OR_STATE_ACCESS');
        throw new Error('offline protected-state trap');
      }
      return original.apply(fs.promises, args);
    };
  }
  syncBuiltinESMExports();
`);
function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", trap, script, ...args], {
    encoding: "utf8", timeout: 20_000,
  });
}
function noSideEffects(result: ReturnType<typeof run>): void {
  assert.doesNotMatch(result.stderr, /UNEXPECTED_PURCHASE_NETWORK|UNEXPECTED_PURCHASE_PRIVATE_OR_STATE_ACCESS/);
  assert.equal(result.signal, null, result.stderr);
}
test("purchase CLI help is credential-free and performs no network, journal or transaction operation", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Read-only:/);
  assert.match(result.stdout, /no automatic transaction loops or retries/); noSideEffects(result);
});
test("read-only purchase inspection rejects a credential flag before touching protected files or RPCs", () => {
  const result = run(["inspect-networks", "--credential", "C:/NEVER_OPEN_PROTECTED_ROLE.json"]);
  assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /Unknown, duplicate or prohibited/); noSideEffects(result);
});
test("purchase audit rejects a generic force option without reading state or creating a submission capability", () => {
  const result = run(["audit-broadcast", "--force", "--role", "treasury"]);
  assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /Unknown, duplicate or prohibited/); noSideEffects(result);
});
test("purchase CLI rejects duplicate options before readonly network or state access", () => {
  const result = run(["inspect-networks", "--near-rpc", "https://example.invalid/first", "--near-rpc", "https://example.invalid/second"]);
  assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /Unknown, duplicate or prohibited/); noSideEffects(result);
});
