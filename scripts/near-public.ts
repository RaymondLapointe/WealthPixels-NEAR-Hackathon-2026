import {
  NEAR_TESTNET_RPC, configurationFromPublicEnvironment, validateRpcUrl,
} from "../src/near/config.js";
import { createAuthorityManifest } from "../src/near/authority.js";
import { ReadOnlyMpcClient, MPC_READ_METHODS, type MpcInspection } from "../src/near/mpc.js";

function summary(value: MpcInspection) {
  return {
    networkId: value.networkId, contractId: value.contractId, domainId: value.domainId,
    blockHash: value.blockHash, blockHeight: value.blockHeight, version: value.version,
    rootPublicKey: value.rootPublicKey, domain: value.domain, minimumGasTgas: value.minimumGasTgas,
    allowedViewMethods: MPC_READ_METHODS,
    signingRequestsMade: false, transactionsBroadcast: false,
  };
}

async function main(): Promise<void> {
  const [operation, ...options] = process.argv.slice(2);
  if (operation !== "inspect" && operation !== "derive") {
    throw new Error("Usage: near-public.ts inspect|derive [--rpc URL] [--treasury ACCOUNT.testnet --investor ACCOUNT.testnet]");
  }
  const flags: Record<string, string> = {};
  const allowed = new Set(["--rpc", "--treasury", "--investor"]);
  for (let i = 0; i < options.length; i += 2) {
    const name = options[i];
    const value = options[i + 1];
    if (!allowed.has(name) || !value || value.startsWith("--") || flags[name]) {
      throw new Error("Invalid or duplicate public CLI option.");
    }
    flags[name] = value;
  }
  const rpcUrl = validateRpcUrl(flags["--rpc"] ?? process.env.NEAR_TESTNET_RPC_URL ?? NEAR_TESTNET_RPC);
  if (operation === "inspect") {
    if (flags["--treasury"] || flags["--investor"]) {
      throw new Error("Use derive when supplying treasury/investor account IDs.");
    }
    const inspection = await new ReadOnlyMpcClient({ rpcUrl }).inspect();
    console.log(JSON.stringify(summary(inspection), null, 2));
    return;
  }
  // Validate both explicit IDs before constructing a network client.
  const configuration = configurationFromPublicEnvironment({
    NEAR_TESTNET_RPC_URL: rpcUrl,
    TREASURY_NEAR_ACCOUNT_ID: flags["--treasury"] ?? process.env.TREASURY_NEAR_ACCOUNT_ID,
    INVESTOR_NEAR_ACCOUNT_ID: flags["--investor"] ?? process.env.INVESTOR_NEAR_ACCOUNT_ID,
  });
  const client = new ReadOnlyMpcClient(configuration);
  const inspection = await client.inspect();
  const [treasury, investor] = await Promise.all([
    client.derive(configuration.roles.treasury, configuration.derivationPath),
    client.derive(configuration.roles.investor, configuration.derivationPath),
  ]);
  const authorities = createAuthorityManifest(configuration, inspection, { treasury, investor });
  console.log(JSON.stringify({
    inspection: summary(inspection), authorities,
    accountExistenceChecked: false, accountControlProven: false,
    warning: "Public derivation does not establish account existence, ownership or spending authority.",
  }, null, 2));
}

main().catch(() => {
  // Never include arbitrary RPC errors or command-line values in output.
  console.error("Public NEAR operation failed. Verify explicit distinct .testnet IDs, HTTPS testnet RPC and supported finalized MPC configuration. No signing or broadcast was attempted.");
  process.exitCode = 1;
});
