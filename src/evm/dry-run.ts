import { authorityForRole, type AuthorityManifest } from "../near/authority.js";
import type { AuthorityRole } from "../near/config.js";
import {
  buildUnsignedErc20Transfer, validateTransferPreflight,
  type Erc20TransferInput, type TransferPreflightSnapshot,
} from "./erc20-transfer.js";

/** Offline only. A supplied manifest is public identity data, never authorization. */
export function prepareRoleTransferDryRun(
  manifest: AuthorityManifest,
  role: AuthorityRole,
  input: Omit<Erc20TransferInput, "senderAddress" | "recipientAddress">,
  observations?: TransferPreflightSnapshot,
) {
  const sender = authorityForRole(manifest, role);
  const recipient = authorityForRole(manifest, role === "treasury" ? "investor" : "treasury");
  const prepared = buildUnsignedErc20Transfer({
    ...input, senderAddress: sender.evmAddress, recipientAddress: recipient.evmAddress,
  });
  const preflight = observations ? validateTransferPreflight(prepared, observations) : undefined;
  return Object.freeze({
    mode: "dry-run" as const, role, authorityBinding: manifest.bindingHash,
    prepared, preflight, signingRequested: false as const, broadcast: false as const,
    liveObservationsVerified: false as const,
  });
}
