import { createPurchaseCoordinator } from "../src/purchase/coordinator.js";
import { PURCHASE_LEGS, roleForLeg } from "../src/purchase/settlement.js";
import { createPurchaseExecutionFixture } from "../test/near/fixtures/purchase-execution.js";

if (process.argv.length !== 2) throw new Error("The fixed offline dry-run accepts no credentials, RPC or transaction options.");
const fixture = await createPurchaseExecutionFixture({ quoteSchemaVersion: 2, approvalDelayMs: 75_000 });
try {
  await fixture.setup();
  const coordinator = createPurchaseCoordinator(fixture.driver, { root: fixture.root }), states: unknown[] = [];
  for (const leg of PURCHASE_LEGS) {
    const input = { quoteHash: fixture.quote.quoteHash, leg, role: roleForLeg(leg) };
    let j = await coordinator.prepare({ ...input, reference: "Fixed offline dry-run preparation" });
    const unsignedHash = j.active!.execution!.legs[leg]!.prepared.prepared.unsignedHash;
    await coordinator.sign({ ...input, approval: unsignedHash, reference: "SIMULATED offline approval", credentialPath: fixture.rolePaths[input.role] });
    j = await coordinator.reconcileSigning(input);
    if (leg === "usdc-payment") fixture.clock.set(new Date(Date.parse(fixture.quote.expiresAt) + 1000).toISOString()); // Accepted settlement outlives original prices.
    const execution = j.active!.execution!, signedHash = execution.legs[leg]!.signed!.hash;
    await coordinator.broadcast({ ...input, approval: signedHash, paymentAuthorizationHash: execution.paymentAuthorization!.authorizationHash });
    j = await coordinator.reconcile(input);
    states.push({ leg, status: j.active?.status ?? j.archive.at(-1)!.status, paymentClaims: j.paymentClaims });
  }
  const journal = await coordinator.inspect(), completed = journal.archive.at(-1)!;
  process.stdout.write(JSON.stringify({ kind: "offline-three-leg-purchase-dry-run", executionProof: "none; all signing, broadcasts, observations, prices and balances are simulated",
    quoteSchemaVersion: fixture.quote.schemaVersion, quoteExpiresAt: fixture.quote.expiresAt, initialFeeExpiresAt: fixture.quote.feeAssessment.expiresAt,
    intendedLegs: fixture.quote.transactions, investmentUsdcBaseUnits: fixture.quote.terms.investmentUsdcBaseUnits,
    quantities: fixture.quote.terms.quantities, states, finalLedger: fixture.ledger, finalStatus: completed.status,
    outstandingObligations: [], realizedFixtureCosts: completed.execution!.realizedCosts,
    simulatedNearSubmissions: fixture.calls.filter(c => c.operation === "nearSubmit").length,
    simulatedEvmSubmissions: fixture.calls.filter(c => c.operation === "evmSubmit").length,
  }, (_key, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
} finally { await fixture.cleanup(); }
