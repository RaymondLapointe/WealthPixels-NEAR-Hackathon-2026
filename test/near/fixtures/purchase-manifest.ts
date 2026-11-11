import { createPurchaseCoordinator } from "../../../src/purchase/coordinator.js";
import { createPurchaseExecutionFixture } from "./purchase-execution.js";

/** Entirely simulated purchase, including signature/transport/receipt ports.
 * No private key generation, credential access, public RPC, real MPC request or EVM execution occurs. */
export async function completedPurchaseManifestFixture(amount = "10", recoverSigned = false, quoteSchemaVersion: 1 | 2 = 1) {
  const f = await createPurchaseExecutionFixture({ amount, investorUsdc: 200_000_000n, quoteSchemaVersion,
    ...(quoteSchemaVersion === 2 ? { approvalDelayMs: 90_000 } : {}) });
  try {
    await f.setup(); const c = createPurchaseCoordinator(f.driver, { root: f.root });
    for (const leg of ["usdc-payment", "link-delivery", "eth-delivery"] as const) {
      const role = leg === "usdc-payment" ? "investor" as const : "treasury" as const;
      const input = { quoteHash: f.quote.quoteHash, role, leg };
      let journal = await c.prepare({ ...input, reference: "SIMULATED offline evidence fixture preparation" });
      journal = await c.sign({ ...input, approval: journal.active!.execution!.legs[leg]!.prepared.prepared.unsignedHash,
        credentialPath: f.rolePaths[role], reference: "SIMULATED offline exact-digest approval" });
      journal = await c.reconcileSigning(input);
      const e = journal.active!.execution!;
      if (recoverSigned) f.clock.advance(900_001);
      await c.broadcast({ ...input, approval: e.legs[leg]!.signed!.hash, paymentAuthorizationHash: e.paymentAuthorization!.authorizationHash,
        ...(recoverSigned ? { recovery: true, expiredPreparationAcknowledgment: e.legs[leg]!.preparedAt } : {}) });
      await c.reconcile(input);
      if (leg === "usdc-payment") f.clock.advance(quoteSchemaVersion === 2 ? 300_000 : 120_000);
    }
    const journal = await c.inspect();
    return { record: structuredClone(journal.archive.at(-1)!), recordedAt: new Date(f.clock.now() + 1000).toISOString() };
  } finally { await f.cleanup(); }
}
