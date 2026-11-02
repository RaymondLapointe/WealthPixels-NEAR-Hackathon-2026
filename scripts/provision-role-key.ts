import { execFileSync } from "node:child_process";
import { readFile, realpath, stat, writeFile, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";

const ACCOUNTS = {
  treasury: "wealthpixels-treasury.testnet",
  investor: "wealthpixels-investor.testnet",
} as const;
const RPC = "https://rpc.testnet.near.org";

/** Human-approved provisioning only. Not imported by the application or judge commands. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Human-only key provisioning: --role treasury|investor --approve-key-generation. Requires the protected external Windows store. Creates one new role key and public sidecar; never creates accounts or requests funding.");
    return;
  }
  if (args.length !== 3 || args[0] !== "--role" ||
      (args[1] !== "treasury" && args[1] !== "investor") ||
      args[2] !== "--approve-key-generation") {
    throw new Error("Explicit role and --approve-key-generation are required. No key generation was attempted.");
  }
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) {
    throw new Error("This human provisioning helper requires the reviewed Windows credential store.");
  }
  const role = args[1];
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(process.env.LOCALAPPDATA, "WealthPixels", "testnet-credentials");
  if (root.toLowerCase() === repo.toLowerCase() || root.toLowerCase().startsWith(repo.toLowerCase() + "\\")) {
    throw new Error("Credential storage must be outside the repository.");
  }
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-File", join(repo, "scripts", "prepare-testnet-credential-store.ps1"), "-Check",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  if ((await realpath(root)).toLowerCase() !== root.toLowerCase() || !(await stat(root)).isDirectory()) {
    throw new Error("Credential directory must be the verified real directory.");
  }
  const credentialFile = join(root, role + ".json");
  const publicFile = join(root, role + ".public.json");
  if (existsSync(credentialFile) || existsSync(publicFile)) {
    throw new Error("Role files already exist. Preserve them; never regenerate a key to retry faucet registration.");
  }
  const otherRole = role === "treasury" ? "investor" : "treasury";
  const otherPublicFile = join(root, otherRole + ".public.json");
  let otherPublicKey: string | undefined;
  if (existsSync(otherPublicFile)) {
    if (!(await lstat(otherPublicFile)).isFile()) throw new Error("Other public metadata is not a regular file.");
    const other = JSON.parse(await readFile(otherPublicFile, "utf8"));
    if (other.role !== otherRole || other.account_id !== ACCOUNTS[otherRole] ||
        typeof other.public_key !== "string" || "private_key" in other) {
      throw new Error("Other role public metadata is invalid.");
    }
    otherPublicKey = other.public_key;
  }
  async function rpc(method: "status" | "query", params: unknown): Promise<Record<string, any>> {
    const response = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "role-provisioning", method, params }),
      redirect: "error", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Public testnet RPC is unavailable.");
    const body = await response.json();
    if (body.jsonrpc !== "2.0" || body.id !== "role-provisioning") throw new Error("Invalid RPC response.");
    return body;
  }
  const status = await rpc("status", []);
  if (status.error || status.result?.chain_id !== "testnet") throw new Error("RPC must report NEAR testnet.");
  const account = await rpc("query", {
    request_type: "view_account", finality: "final", account_id: ACCOUNTS[role],
  });
  if (account.error?.cause?.name !== "UNKNOWN_ACCOUNT") {
    throw new Error("The account is not confirmed absent. Stop without generating a key.");
  }

  // This is the only key-generation call. It is reached only after explicit approval,
  // protected-store checks, no-overwrite checks and public testnet availability.
  const pair = KeyPair.fromRandom("ed25519");
  const publicKey = pair.getPublicKey().toString();
  if (publicKey === otherPublicKey) throw new Error("Role public keys must be different.");
  const credential = {
    account_id: ACCOUNTS[role], public_key: publicKey, private_key: pair.toString(),
  };
  await writeFile(credentialFile, JSON.stringify(credential, null, 2) + "\n", {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  // Only this public sidecar is read by registration commands or shared with Codex.
  const metadata = {
    role, account_id: ACCOUNTS[role], public_key: publicKey, credential_file: credentialFile,
  };
  await writeFile(publicFile, JSON.stringify(metadata, null, 2) + "\n", {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  console.log(JSON.stringify({ ...metadata, public_metadata_file: publicFile }, null, 2));
}
main().catch(() => {
  // Do not print arbitrary exceptions, key objects, secret JSON or RPC/config details.
  console.error("Provisioning stopped. No account or faucet request was made. Check approval, the protected store, existing role files and public account availability. Preserve any existing files; do not overwrite or blindly regenerate.");
  process.exitCode = 1;
});
