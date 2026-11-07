import { decodePurchaseEvidenceManifest } from "../src/evidence/purchase-manifest.js";
import { verifyPurchaseEvidence } from "../src/evidence/purchase-verify.js";
import { assertUnusedPublicEvidenceOutput, readPublicEvidenceJson, writeNewPublicEvidenceJson } from "../src/evidence/public-files.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("Credential-free public purchase verification: --manifest evidence/FILE.json [--expected-quote-hash HASH] [--near-rpc HTTPS_URL] [--evm-rpc HTTPS_URL] [--beacon-rpc HTTPS_URL] [--pacing-ms 0..2000] [--report evidence/NEW_REPORT.json]. Defaults to evidence/portfolio-purchase.pending.json. Exit0 verified, exit2 pending/incomplete, exit1 failed. No fixture, signing or broadcast option exists.\n"); return;
  }
  const flags = new Map<string, string>(), allowed = ["--manifest", "--expected-quote-hash", "--near-rpc", "--evm-rpc", "--beacon-rpc", "--pacing-ms", "--report"];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!allowed.includes(key) || flags.has(key) || !value || value.startsWith("--")) throw new Error("Invalid, duplicate or prohibited public purchase verification option.");
    flags.set(key, value);
  }
  if (flags.has("--report")) await assertUnusedPublicEvidenceOutput(flags.get("--report")!);
  const text = await readPublicEvidenceJson(flags.get("--manifest") ?? "evidence/portfolio-purchase.pending.json");
  const pending = JSON.parse(text);
  const manifest = pending.schemaVersion === 1 && pending.kind === "wealthpixels-portfolio-purchase" && pending.mode === "live" && pending.status === "pending" ? pending : decodePurchaseEvidenceManifest(text);
  const pacing = flags.get("--pacing-ms");
  if (pacing !== undefined && (!/^(0|[1-9][0-9]{0,3})$/.test(pacing) || Number(pacing) > 2000)) throw new Error("Read pacing must be an integer between0 and2000 milliseconds.");
  const result = await verifyPurchaseEvidence(manifest, { nearRpcUrl: flags.get("--near-rpc"), evmRpcUrl: flags.get("--evm-rpc"),
    beaconUrl: flags.get("--beacon-rpc"), expectedQuoteHash: flags.get("--expected-quote-hash"), ...(pacing === undefined ? {} : { pacingMs: Number(pacing) }) });
  const output = JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n";
  if (flags.has("--report")) await writeNewPublicEvidenceJson(flags.get("--report")!, output);
  process.stdout.write(output);
  process.exitCode = result.status === "verified" ? 0 : result.status === "incomplete" ? 2 : 1;
}
main().catch(() => { process.stderr.write("Public purchase verification failed: check public manifest, options and output paths. No credentials were loaded and nothing was submitted.\n"); process.exitCode = 1; });
