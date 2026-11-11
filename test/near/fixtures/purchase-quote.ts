import { VERIFIED_IDENTITIES } from "../../../src/near/identities.js";
import { createPurchaseTerms } from "../../../src/purchase/terms.js";
import { parseUsdcAmount } from "../../../src/purchase/amounts.js";
import { prepareDemonstrationPrices, approveDemonstrationPrices, createOfflinePriceSet, toAllocationPrices,
  type PriceAsset, type PriceInput, type PriceSet, type DemonstrationPriceInput } from "../../../src/purchase/prices.js";
import { createPurchaseQuote } from "../../../src/purchase/quote.js";
import { PURCHASE_FEE_LEGS } from "../../../src/purchase/fee-eligibility.js";
import type { CompletePurchaseCosts } from "../../../src/purchase/costs.js";
import type { FundingInventorySnapshot } from "../../../src/purchase/journal.js";
import { SEPOLIA_ASSETS } from "../../../src/purchase/config.js";
import { MPC_SIGN_REQUEST_BYTES, type MpcFundingInputs } from "../../../src/near/mpc-funding.js";

// Fixed synthetic observations and simulated approvals ONLY. Even branches using
// mode:'live' exercise validation with injected data; they make no network calls,
// obtain no human approval and constitute no live readiness or execution proof.
export const AT = "2026-11-06T03:00:00.000Z";
export const seconds = (value: number) => new Date(Date.parse(AT) + value * 1000).toISOString();
export function fundingInputs(gasPrice = 100_000_000n): MpcFundingInputs {
  return { protocolVersion: 88, requestBytes: MPC_SIGN_REQUEST_BYTES,
    receiptSendGas: "108059500000", receiptExecutionGas: "108059500000",
    functionCallSendGas: "2319861500000", functionCallExecutionGas: "2319861500000",
    functionCallByteSendGas: "2235934", functionCallByteExecutionGas: "2235934",
    blockGasPriceYocto: gasPrice.toString(), receiptPurchaseFloorYocto: "1000000000",
    gasRefundPenalty: { numerator: "0", denominator: "100" }, minimumGasRefundPenalty: "0" };
}
export function priceInput(id = "offline-purchase-10", providerId = "synthetic-provider-A"): DemonstrationPriceInput {
  const rates = { ETH: 2500n, LINK: 10n, NEAR: 1n };
  const prices = Object.fromEntries((["ETH", "LINK", "NEAR"] as const).map(asset => [asset, {
    asset, quoteCurrency: "USD", numerator: rates[asset], denominator: 1n,
    sourceUrl: `https://example.invalid/synthetic-${asset.toLowerCase()}-reference`,
    sourceReference: "Fixed offline price assumption; no current market observation",
    originalObservedAt: "2026-11-01T00:00:00.000Z",
  }])) as unknown as Record<PriceAsset, PriceInput>;
  return { purchaseId: id, providerId, validFrom: AT, expiresAt: seconds(300), prices };
}
export function prices(approved = false, input = priceInput()): PriceSet {
  if (!approved) return createOfflinePriceSet(input);
  const packet = prepareDemonstrationPrices(input);
  return approveDemonstrationPrices(packet, { approvedDigest: packet.approvalDigest, reference: "SIMULATED approval for offline tests only", approvedAt: AT });
}
export function termsFor(value: PriceSet, amount = "10") {
  return createPurchaseTerms({ investmentUsdcBaseUnits: parseUsdcAmount(amount),
    ...toAllocationPrices(value, { purchaseId: value.purchaseId, asOf: AT, purpose: "offline" }) });
}
export function costs(value: PriceSet, amount = "10", mode: "offline" | "live" = "offline"): CompletePurchaseCosts {
  const terms = termsFor(value, amount);
  return { schemaVersion: 1, kind: "six-cost-observations", purchaseId: value.purchaseId, termsHash: terms.termsHash,
    mode, sampledAt: AT, expiresAt: seconds(300), reference: "Synthetic six-cost fixtures, never real network observations",
    evmObservation: { chainId: 11155111n, blockNumber: 100n, blockHash: `0x${"11".repeat(32)}`,
      sourceUrl: "https://example.invalid/offline-sepolia-rpc", reference: "Synthetic canonical-block fixture" },
    nearObservation: { networkId: "testnet", blockHeight: 1000n, blockHash: "1".repeat(32),
      sourceUrl: "https://example.invalid/offline-near-rpc", reference: "Synthetic NEAR gas-price fixture", gasPriceYoctoNear: 100_000_000n,
      fundingInputs: fundingInputs() },
    evm: PURCHASE_FEE_LEGS.map((leg, index) => {
      const payer = index === 0 ? "investor" as const : "treasury" as const;
      const asset = index === 0 ? "USDC" as const : index === 1 ? "LINK" as const : "ETH" as const;
      return { leg, payer, senderAddress: VERIFIED_IDENTITIES[payer].evmAddress,
        recipientAddress: VERIFIED_IDENTITIES[payer === "investor" ? "treasury" : "investor"].evmAddress,
        asset, tokenAddress: asset === "ETH" ? null : SEPOLIA_ASSETS[asset].address, decimals: asset === "USDC" ? 6 : 18,
        amountBaseUnits: index === 0 ? terms.investmentUsdcBaseUnits : index === 1 ? terms.quantities.linkBaseUnits : terms.quantities.ethWei,
        estimatedGas: [50_000n, 60_000n, 21_000n][index]!, observedBaseFeePerGasWei: 1_000_000_000n,
        assumedBaseFeePerGasWei: 1_000_000_000n, maxFeePerGasWei: 5_000_000_000n, maxPriorityFeePerGasWei: 100_000_000n };
    }),
    near: PURCHASE_FEE_LEGS.map((leg, index) => {
      const payer = index === 0 ? "investor" as const : "treasury" as const;
      return { leg, payer, accountId: VERIFIED_IDENTITIES[payer].accountId, contractId: "v1.signer-prod.testnet", domainId: 0,
        derivationPath: "wealthpixels/sepolia/v1", estimatedExecutionGas: 8_000_000_000_000n, transactionOverheadGas: 1_000_000_000_000n,
        attachedGas: 100_000_000_000_000n, attachedDepositYoctoNear: 1n,
        executionAssumptionReference: "Synthetic conservative signing gas; explicit offline fixture, no live MPC request" };
    }) };
}
// Existing fixture consumers intentionally retain historical V1 deadlines and hashes.
export function fixtureQuote(amount = "10", prepayment = false, id = "offline-purchase-10", schemaVersion: 1 | 2 = 1) {
  const p = prices(prepayment, priceInput(id)), c = costs(p, amount, prepayment ? "live" : "offline");
  return createPurchaseQuote({ schemaVersion, purchaseId: id, purpose: prepayment ? "prepayment" : "offline",
    investmentUsdcBaseUnits: parseUsdcAmount(amount), prices: p, costs: c, createdAt: AT });
}
export function inventory(): FundingInventorySnapshot {
  return { mode: "live", observedAt: AT, chainId: 11155111n, treasuryAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
    treasuryNearAccountId: VERIFIED_IDENTITIES.treasury.accountId, investorNearAccountId: VERIFIED_IDENTITIES.investor.accountId,
    investorAddress: VERIFIED_IDENTITIES.investor.evmAddress, linkTokenAddress: SEPOLIA_ASSETS.LINK.address, usdcTokenAddress: SEPOLIA_ASSETS.USDC.address,
    blockNumber: 100n, blockHash: `0x${"11".repeat(32)}`, nearBlockHeight: 1000n, nearBlockHash: "1".repeat(32),
    sourceUrl: "https://example.invalid/offline-funding-observations", reference: "Synthetic funds only; never checked actual accounts",
    treasuryEthWei: 50_000_000_000_000_000n, treasuryLinkBaseUnits: 24_100_000_000_000_000_000n,
    investorEthWei: 50_000_000_000_000_000n, investorUsdcBaseUnits: 20_000_000n,
    treasurySpendableNearYocto: 9n * 10n ** 24n, investorSpendableNearYocto: 9n * 10n ** 24n };
}
