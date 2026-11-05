import { access, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseUnits, formatEther } from "ethers";
import { createEvmBroadcastTransport } from "../src/evm/broadcast.js";
import { createSepoliaReadRpc, prepareSepoliaLinkTransfer, verifySepoliaLinkReceipt, SepoliaLinkError } from "../src/evm/sepolia-link.js";
import { requireRole } from "../src/near/identities.js";
import { verifyRoleMpc, prepareMpcSigning, readMpcSigningOutcome, MpcSigningError } from "../src/near/signing.js";
import { encodeState, publicExecutionSummary, readState, runtimeStatePath, saveState, withStateLock, type ExecutionState } from "../src/execution/state.js";
import { broadcastTransfer, reconcileEvm, reconcileSigning, requestSignature } from "../src/execution/workflow.js";
import { verifyEvidence } from "../src/evidence/verify.js";
import {
  broadcastRecoveredTransfer, encodeRecoveryBroadcastAudit, inspectRecoveryBroadcast,
  RecoveryBroadcastError, type RecoveryBroadcastAudit,
} from "../src/execution/recovery-broadcast.js";

async function preserveRecoveryAudit(file: string, audit: RecoveryBroadcastAudit): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(encodeRecoveryBroadcastAudit(audit), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

const HELP = `Operator-only Sepolia LINK workflow; no command creates keys or funds accounts.
Each operation requires --role treasury|investor and --state .local/transfers/<name>.json.
Public RPC overrides: --near-rpc <HTTPS URL> --evm-rpc <Sepolia HTTPS URL>.
prepare   --gas-limit-cap 120000 --max-fee-gwei 30 --max-total-fee-eth 0.0036 (read-only)
inspect   (local state only; no credentials or network)
sign      --credential <absolute selected-role.json path> --approve-sign <unsignedHash> (NEAR transaction)
reconcile (read-only recovery of pending/near-failed/signed results; saves only validated signatures or receipts)
broadcast --approve-broadcast <signed EVM hash> (Sepolia transaction)
recovery-audit --audit <NEW ignored .json file> (read-only audit for the pinned recorded transaction of the selected role)
broadcast-recovered --audit <NEW ignored .json file> --approve-broadcast <exact signed hash> --acknowledge-expired-preparation <original ISO timestamp> (one Sepolia submission; separate approval required)
export    --treasury-state <file> --investor-state <file> (no credentials; verifies both legs publicly)
Signing and broadcast flags represent separate human approvals. Do not run them until authorized.
Fixed intents: treasury sends exactly 1 LINK to investor; investor returns exactly 0.1 LINK.
Fixture tests never constitute live execution.`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") { console.log(HELP); return; }
  const allowed: Record<string, string[]> = {
    prepare: ["--role", "--state", "--near-rpc", "--evm-rpc", "--gas-limit-cap", "--max-fee-gwei", "--max-total-fee-eth"],
    inspect: ["--role", "--state"],
    sign: ["--role", "--state", "--near-rpc", "--evm-rpc", "--credential", "--approve-sign"],
    reconcile: ["--role", "--state", "--near-rpc", "--evm-rpc"],
    broadcast: ["--role", "--state", "--near-rpc", "--evm-rpc", "--approve-broadcast"],
    "recovery-audit": ["--role", "--state", "--audit", "--near-rpc", "--evm-rpc"],
    "broadcast-recovered": ["--role", "--state", "--audit", "--near-rpc", "--evm-rpc", "--approve-broadcast", "--acknowledge-expired-preparation"],
    export: ["--treasury-state", "--investor-state", "--near-rpc", "--evm-rpc"],
  };
  if (!allowed[command]) throw new Error("Unknown transfer command. Use --help.");
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed[command].includes(key) || !value || value.startsWith("--") || options[key] !== undefined) throw new Error("Invalid or duplicate command option. Use --help.");
    options[key] = value;
  }
  const required = (key: string): string => { if (!options[key]) throw new Error(`Missing ${key}.`); return options[key]; };
  const nearRpcUrl = options["--near-rpc"] ?? "https://archival-rpc.testnet.fastnear.com";
  const evmRpcUrl = options["--evm-rpc"] ?? "https://ethereum-sepolia-rpc.publicnode.com";
  if (command === "export") {
    const treasury = await readState(await runtimeStatePath(required("--treasury-state")), "treasury");
    const investor = await readState(await runtimeStatePath(required("--investor-state")), "investor");
    if ([treasury, investor].some(state => state.status !== "confirmed" || !state.signed || !state.nearTransactionHash)) throw new Error("Both real transfers must be confirmed before publishing complete evidence.");
    const publicRpc = createSepoliaReadRpc(evmRpcUrl);
    const [delivery, returned] = await Promise.all([
      verifySepoliaLinkReceipt(treasury.preflight, treasury.signed!.hash, publicRpc),
      verifySepoliaLinkReceipt(investor.preflight, investor.signed!.hash, publicRpc),
    ]);
    if (returned.blockNumber <= delivery.blockNumber) throw new Error("Investor return must follow the confirmed treasury delivery.");
    const file = resolve("evidence/sepolia-link.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.status = "complete";
    manifest.transfers = [treasury, investor].map(state => ({
      direction: state.role === "treasury" ? "treasury-to-investor" : "investor-to-treasury",
      amountBaseUnits: state.preflight.prepared.amount.toString(), nearTransactionHash: state.nearTransactionHash,
      evmTransactionHash: state.signed!.hash,
    }));
    await verifyEvidence(manifest, { nearRpcUrl, evmRpcUrl });
    await writeFile(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log("Both live transfer proofs verified; public evidence/sepolia-link.json updated.");
    return;
  }
  const role = requireRole(required("--role"));
  const recoveryCommand = command === "recovery-audit" || command === "broadcast-recovered";
  // Recovery accepts only the exact recorded Treasury or Investor transaction; the module pins each role's hashes and intent.
  if (command === "broadcast-recovered") { required("--approve-broadcast"); required("--acknowledge-expired-preparation"); }
  const stateFile = await runtimeStatePath(required("--state"), process.cwd(), command === "prepare");
  if (command === "inspect") {
    console.log(encodeState(publicExecutionSummary(await readState(stateFile, role))));
    return;
  }
  // A missing explicit approval stops before any provider or credential loading.
  if (command === "sign") { required("--credential"); required("--approve-sign"); }
  if (command === "broadcast") required("--approve-broadcast");
  let auditFile: string | undefined;
  if (recoveryCommand) {
    auditFile = await runtimeStatePath(required("--audit"), process.cwd(), true);
    if (auditFile === stateFile) throw new Error("The immutable audit must use a separate new filename.");
    try { await access(auditFile); throw new Error("Audit file already exists; a fresh audit filename is required."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const evm = createSepoliaReadRpc(evmRpcUrl);
  await withStateLock(stateFile, async () => {
    let state: ExecutionState;
    if (command === "prepare") {
      try { await access(stateFile); throw new Error("State already exists. Inspect/reconcile it; use a new name only for a separately reviewed operation."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const policy = {
        gasLimitCap: BigInt(required("--gas-limit-cap")),
        maxFeePerGasCap: parseUnits(required("--max-fee-gwei"), "gwei"),
        maxTotalFeeWei: parseUnits(required("--max-total-fee-eth"), "ether"),
      };
      await verifyRoleMpc(role, nearRpcUrl);
      const preflight = await prepareSepoliaLinkTransfer(role, policy, evm);
      state = { schemaVersion: 1, role, status: "prepared", preflight, createdAt: new Date().toISOString() };
      await saveState(stateFile, state);
      console.log(`Maximum EVM fee: ${formatEther(preflight.prepared.maximumFeeWei)} test ETH. No signature requested.`);
    } else {
      state = await readState(stateFile, role);
      const readPorts = {
        verifyMpc: verifyRoleMpc, readOutcome: readMpcSigningOutcome,
        save: (value: ExecutionState) => saveState(stateFile, value),
      };
      if (command === "recovery-audit") {
        const audit = await inspectRecoveryBroadcast(state, { nearRpcUrl }, {
          evm, verifyMpc: verifyRoleMpc, readOutcome: readMpcSigningOutcome,
        });
        await preserveRecoveryAudit(auditFile!, audit);
        console.log(encodeRecoveryBroadcastAudit(audit));
        return;
      } else if (command === "broadcast-recovered") {
        await broadcastRecoveredTransfer(state, {
          nearRpcUrl, approval: required("--approve-broadcast"),
          expiredPreparationAcknowledgment: required("--acknowledge-expired-preparation"),
        }, {
          ...readPorts, evm, saveAudit: (audit) => preserveRecoveryAudit(auditFile!, audit),
          broadcast: createEvmBroadcastTransport(evmRpcUrl),
        });
      } else if (command === "reconcile") {
        if (state.status.startsWith("near-") || state.status === "signed") await reconcileSigning(state, nearRpcUrl, readPorts);
        else if (state.status.startsWith("evm-") || state.status === "confirmed") await reconcileEvm(state, { ...readPorts, evm });
        else throw new Error("No unresolved submission. Inspect this state before another action.");
      } else {
        const ports = {
          ...readPorts, evm, prepareSigning: prepareMpcSigning,
          broadcast: createEvmBroadcastTransport(evmRpcUrl),
        };
        if (command === "sign") await requestSignature(state, { credentialPath: required("--credential"), nearRpcUrl, approval: required("--approve-sign") }, ports);
        else if (command === "broadcast") await broadcastTransfer(state, { nearRpcUrl, approval: required("--approve-broadcast") }, ports);
      }
    }
    console.log(encodeState(publicExecutionSummary(state)));
    if (["near-uncertain", "near-failed", "evm-uncertain"].includes(state.status) || state.recovery) process.exitCode = 2;
  });
}

main().catch((error: unknown) => {
  // Only our sanitized domain errors may supply details. Never print raw SDK/fs/RPC exceptions.
  if (error instanceof MpcSigningError || error instanceof SepoliaLinkError || error instanceof RecoveryBroadcastError) console.error(`${error.code}: ${error.message}`);
  console.error("Transfer command stopped. Check explicit options and saved state; reconcile any submitted hash before retrying. Use npm run transfer -- --help for syntax.");
  process.exitCode = 1;
});
