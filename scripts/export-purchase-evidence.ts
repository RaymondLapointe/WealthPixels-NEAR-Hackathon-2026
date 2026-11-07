import { readPurchaseJournal } from "../src/purchase/journal.js";
import { exportCompletedPurchaseEvidence, encodePurchaseEvidenceManifest } from "../src/evidence/purchase-manifest.js";
import { assertUnusedPublicEvidenceOutput, writeNewPublicEvidenceJson } from "../src/evidence/public-files.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("Local public-field export only: --purchase-id ID --out evidence/NEW_FILE.json. Reads this checkout's completed ignored purchase journal; never credentials. No signing, preparation, broadcast or funding. Local export alone is not independent blockchain verification. Existing files cannot be overwritten.\n"); return;
  }
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!["--purchase-id", "--out"].includes(key) || flags.has(key) || !value || value.startsWith("--")) throw new Error();
    flags.set(key, value);
  }
  const id = flags.get("--purchase-id"), out = flags.get("--out");
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) || !out) throw new Error();
  await assertUnusedPublicEvidenceOutput(out);
  const journal = await readPurchaseJournal(), records = journal.archive.filter(record => record.quote.purchaseId === id);
  if (records.length !== 1) throw new Error();
  const manifest = exportCompletedPurchaseEvidence(records[0]!, new Date().toISOString());
  await writeNewPublicEvidenceJson(out, encodePurchaseEvidenceManifest(manifest));
  process.stdout.write(JSON.stringify({ status: "exported-local-claims", mode: manifest.mode, manifestHash: manifest.manifestHash,
    independentPublicVerificationRequired: true }) + "\n");
}
main().catch(() => { process.stderr.write("Purchase evidence export failed: require one completed reconciled purchase, valid public fields and an unused evidence JSON output. No credentials were loaded and nothing was submitted.\n"); process.exitCode = 1; });
