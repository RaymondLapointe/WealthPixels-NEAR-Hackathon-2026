import { readFile } from "node:fs/promises";
import { EvidenceVerificationError, verifyEvidence } from "../src/evidence/verify.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Read-only evidence verification: --manifest <file> [--near-rpc <public HTTPS URL>] [--evm-rpc <public HTTPS URL>]. Default: evidence/sepolia-link.json. Pending exits 2; no signing or broadcasting is available.");
    return;
  }
  const options: { manifest: string; nearRpcUrl?: string; evmRpcUrl?: string } = { manifest: "evidence/sepolia-link.json" };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!["--manifest", "--near-rpc", "--evm-rpc"].includes(flag) || !value || value.startsWith("--") || seen.has(flag)) {
      throw new Error("Use --manifest <file>, --near-rpc <public URL>, or --evm-rpc <public URL>; fixture mode is unavailable.");
    }
    seen.add(flag);
    if (flag === "--manifest") options.manifest = value;
    else if (flag === "--near-rpc") options.nearRpcUrl = value;
    else options.evmRpcUrl = value;
  }
  let manifest: unknown;
  try { manifest = JSON.parse(await readFile(options.manifest, "utf8")); }
  catch { throw new Error("Cannot read the evidence JSON. Start with evidence/sepolia-link.json and record public evidence after approved execution."); }
  console.log(JSON.stringify(await verifyEvidence(manifest, options), null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof EvidenceVerificationError || error instanceof Error ? error.message : "Evidence verification failed.");
  process.exitCode = error instanceof EvidenceVerificationError && error.code === "PENDING" ? 2 : 1;
});
