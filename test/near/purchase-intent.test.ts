import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Interface, Transaction, keccak256 } from "ethers";
import {
  DEFAULT_EXECUTION_LIMITS, DEFAULT_GAS_BUFFER_BPS, HACKATHON_TARGET_USDC,
  MAX_EXPECTED_FEE_BPS, SEPOLIA_ASSETS,
} from "../../src/purchase/config.js";
import { formatUsdcAmount, parseUsdcAmount } from "../../src/purchase/amounts.js";
import { assertPurchaseTerms, createPurchaseTerms } from "../../src/purchase/terms.js";
import { addPaymentClaim, paymentClaimId } from "../../src/purchase/claims.js";
import {
  assertErc20AssetIntent, assertPreparedAssetTransfer, buildErc20AssetTransfer,
  createErc20AssetIntent, validateAssetTransferPreflight,
  type AssetPreflightSnapshot, type PreparedAssetTransfer,
} from "../../src/evm/asset-intent.js";
import { buildUnsignedErc20Transfer } from "../../src/evm/erc20-transfer.js";
import { VERIFIED_IDENTITIES } from "../../src/near/identities.js";
import { recordedState } from "./fixtures/recorded-mpc.js";

// Synthetic, fixed, public offline fixtures. These prices and observations have
// no freshness, approval, or live-chain meaning and do not demonstrate execution.
const ETH_PRICE = { numerator: 2500n, denominator: 1n, source: "offline fixture: ETH/USD = 2500" };
const LINK_PRICE = { numerator: 10n, denominator: 1n, source: "offline fixture: LINK/USD = 10" };
const FEES = { nonce: 1, estimatedGas: 50_001n, maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n };
const CLAIM = { chainId: 11155111n, transactionHash: "0x" + "ab".repeat(32), logIndex: 0n };
const erc20 = new Interface(["function transfer(address,uint256) returns (bool)"]);
// Recorded public bytecode is used solely to exercise the pinned identity
// check. It is not a live RPC response or evidence of a purchase execution.
const USDC_CODE = JSON.parse(readFileSync(new URL("./fixtures/sepolia-usdc.json", import.meta.url), "utf8")) as { tokenCode: string; codeHash: string };

function terms(amount = "10") {
  return createPurchaseTerms({ investmentUsdcBaseUnits: parseUsdcAmount(amount), ethPrice: ETH_PRICE, linkPrice: LINK_PRICE });
}

function usdcSnapshot(value: PreparedAssetTransfer, overrides: Partial<AssetPreflightSnapshot> = {}): AssetPreflightSnapshot {
  return {
    chainId: 11155111n, senderAddress: value.intent.senderAddress, tokenAddress: value.intent.tokenAddress,
    tokenCode: USDC_CODE.tokenCode, tokenDecimals: 6, senderCode: "0x", recipientCode: "0x",
    pendingNonce: FEES.nonce, estimatedGas: FEES.estimatedGas, tokenBalance: 20_000_000n,
    nativeBalance: 50_000_000_000_000_000n, baseFeePerGas: 2000n,
    usdcPaused: false, senderBlacklisted: false, recipientBlacklisted: false, ...overrides,
  };
}

test("purchase configuration identifies official Sepolia USDC at six decimals and keeps the ten-USDC target illustrative", () => {
  assert.equal(HACKATHON_TARGET_USDC, "10");
  assert.equal(MAX_EXPECTED_FEE_BPS, 1000n);
  assert.equal(DEFAULT_GAS_BUFFER_BPS, 2000n);
  assert.equal(SEPOLIA_ASSETS.USDC.address, "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
  assert.equal(SEPOLIA_ASSETS.USDC.decimals, 6);
  assert.equal(SEPOLIA_ASSETS.LINK.address, "0x779877A7B0D9E8603169DdbD7836e478b4624789");
  assert.equal(SEPOLIA_ASSETS.LINK.decimals, 18);
  for (const asset of Object.values(SEPOLIA_ASSETS)) {
    assert.match(asset.codeHash, /^0x[0-9a-f]{64}$/i);
    assert.ok(Object.isFrozen(asset));
  }
  assert.ok(Object.isFrozen(SEPOLIA_ASSETS));
});

test("parses and formats variable USDC amounts exactly without floating-point conversion", () => {
  for (const value of ["1", "5", "10", "20", "100"]) {
    assert.equal(parseUsdcAmount(value), BigInt(value) * 1_000_000n);
    assert.equal(formatUsdcAmount(parseUsdcAmount(value)), `${value}.000000`);
  }
  assert.equal(parseUsdcAmount("0.000001"), 1n);
  assert.equal(parseUsdcAmount("1.234567"), 1_234_567n);
  assert.equal(parseUsdcAmount("9007199254740993.000001"), 9_007_199_254_740_993_000_001n);
  assert.equal(formatUsdcAmount(1n), "0.000001");
  assert.equal(formatUsdcAmount(9_007_199_254_740_993_000_001n), "9007199254740993.000001");
});

test("rejects invalid or inexact USDC quantities and never accepts a JS number as money", () => {
  for (const value of [0, 1, 0.1, NaN, Infinity, null, undefined, {}, "", "0", "0.000000", "-1", "+1", "1e3", "0.0000001", "1.2345678", " 1", "1 ", "1,000"]) {
    assert.throws(() => parseUsdcAmount(value));
  }
  assert.throws(() => parseUsdcAmount((1n << 256n).toString()));
  for (const value of [-1n, 1 as unknown as bigint, 1n << 256n]) assert.throws(() => formatUsdcAmount(value));
});

test("one, five, ten, twenty and one hundred USDC produce exact independently held allocation quantities", () => {
  for (const amount of ["1", "5", "10", "20", "100"]) {
    const quote = terms(amount), multiplier = BigInt(amount);
    assert.equal(quote.investmentUsdcBaseUnits, multiplier * 1_000_000n);
    assert.deepEqual(quote.allocationBps, { eth: 5000n, link: 5000n });
    assert.equal(quote.quantities.ethWei, multiplier * 200_000_000_000_000n);
    assert.equal(quote.quantities.linkBaseUnits, multiplier * 50_000_000_000_000_000n);
    assertPurchaseTerms(quote, quote.termsHash);
  }
  const micro = terms("0.000001");
  assert.equal(micro.quantities.ethWei, 200_000_000n);
  assert.equal(micro.quantities.linkBaseUnits, 50_000_000_000n);
});

test("asset conversion retains rational precision until the final base-unit floor", () => {
  const quote = createPurchaseTerms({
    investmentUsdcBaseUnits: 1n,
    ethPrice: { ...ETH_PRICE, numerator: 3n },
    linkPrice: { ...LINK_PRICE, numerator: 7n },
  });
  assert.equal(quote.quantities.ethWei, 166_666_666_666n);
  assert.equal(quote.quantities.linkBaseUnits, 71_428_571_428n);
  assert.equal(quote.quantities.ethWei * quote.rounding.ethDenominator + quote.rounding.ethRemainder, 1n * 5000n * 10n ** 18n);
  assert.equal(quote.quantities.linkBaseUnits * quote.rounding.linkDenominator + quote.rounding.linkRemainder, 1n * 5000n * 10n ** 18n);
  assert.ok(quote.rounding.ethRemainder >= 0n && quote.rounding.ethRemainder < quote.rounding.ethDenominator);
  assert.ok(quote.rounding.linkRemainder >= 0n && quote.rounding.linkRemainder < quote.rounding.linkDenominator);
  const equivalentRational = createPurchaseTerms({
    investmentUsdcBaseUnits: parseUsdcAmount("10"),
    ethPrice: { ...ETH_PRICE, numerator: 250_000n, denominator: 100n },
    linkPrice: { ...LINK_PRICE, numerator: 1000n, denominator: 100n },
  });
  assert.deepEqual(equivalentRational.quantities, terms().quantities);
  const weighted = createPurchaseTerms({ investmentUsdcBaseUnits: 10_000_000n, ethPrice: ETH_PRICE, linkPrice: LINK_PRICE,
    allocationBps: { eth: 4000n, link: 6000n } });
  assert.equal(weighted.quantities.ethWei, 1_600_000_000_000_000n);
  assert.equal(weighted.quantities.linkBaseUnits, 600_000_000_000_000_000n);
  assert.notEqual(weighted.termsHash, terms().termsHash);
});

test("terms reject invalid investment, price, allocation and quantities below asset precision", () => {
  const base = { investmentUsdcBaseUnits: 10_000_000n, ethPrice: ETH_PRICE, linkPrice: LINK_PRICE };
  for (const investmentUsdcBaseUnits of [0n, -1n, 1n << 256n, 10 as unknown as bigint]) {
    assert.throws(() => createPurchaseTerms({ ...base, investmentUsdcBaseUnits }));
  }
  for (const price of [{ ...ETH_PRICE, numerator: 0n }, { ...ETH_PRICE, numerator: -1n },
    { ...ETH_PRICE, denominator: 0n }, { ...ETH_PRICE, denominator: -1n }, { ...ETH_PRICE, source: "" }]) {
    assert.throws(() => createPurchaseTerms({ ...base, ethPrice: price }));
    assert.throws(() => createPurchaseTerms({ ...base, linkPrice: price }));
  }
  for (const allocationBps of [{ eth: 5000n, link: 4999n }, { eth: -1n, link: 10001n }, { eth: 0n, link: 10000n }]) {
    assert.throws(() => createPurchaseTerms({ ...base, allocationBps }));
  }
  assert.throws(() => createPurchaseTerms({ ...base, investmentUsdcBaseUnits: 1n, ethPrice: { ...ETH_PRICE, numerator: 10n ** 30n } }));
});

test("approved purchase terms are deterministic, deeply frozen and bind amount, allocation, prices and provenance", () => {
  const inputPrice = { ...ETH_PRICE }, quote = createPurchaseTerms({ investmentUsdcBaseUnits: 10_000_000n, ethPrice: inputPrice, linkPrice: LINK_PRICE });
  const before = quote.termsHash;
  inputPrice.numerator = 1n;
  assert.equal(quote.termsHash, before);
  assert.equal(quote.prices.ETH.numerator, 2500n);
  assert.equal(terms().termsHash, before);
  assert.match(before, /^0x[0-9a-f]{64}$/);
  for (const value of [quote, quote.allocationBps, quote.prices, quote.prices.ETH, quote.prices.LINK, quote.quantities]) assert.ok(Object.isFrozen(value));
  assert.notEqual(terms("5").termsHash, before);
  const changedSource = createPurchaseTerms({ investmentUsdcBaseUnits: 10_000_000n, ethPrice: { ...ETH_PRICE, source: "another offline fixture" }, linkPrice: LINK_PRICE });
  assert.notEqual(changedSource.termsHash, before);
  assert.throws(() => assertPurchaseTerms(changedSource, before));
  for (const changed of [
    { ...quote, investmentUsdcBaseUnits: quote.investmentUsdcBaseUnits + 1n },
    { ...quote, allocationBps: { eth: 4000n, link: 6000n } },
    { ...quote, quantities: { ...quote.quantities, ethWei: quote.quantities.ethWei + 1n } },
    { ...quote, quantities: { ...quote.quantities, linkBaseUnits: quote.quantities.linkBaseUnits + 1n } },
    { ...quote, prices: { ...quote.prices, ETH: { ...quote.prices.ETH, source: "altered provenance" } } },
    { ...quote, chainId: 1n as 11155111n },
    { ...quote, usdcDecimals: 18 as 6 },
    { ...quote, investorAddress: VERIFIED_IDENTITIES.treasury.evmAddress },
    { ...quote, mpc: { ...quote.mpc, rootPublicKey: "altered public root" } },
    { ...quote, termsHash: "0x" + "00".repeat(32) },
  ]) assert.throws(() => assertPurchaseTerms(changed, before));
});

test("asset intents bind Investor USDC payment and Treasury variable LINK delivery to the approved terms", () => {
  for (const amount of ["1", "5", "10", "20", "100"]) {
    const quote = terms(amount);
    const payment = createErc20AssetIntent(quote, "usdc-payment", quote.termsHash);
    assert.equal(payment.role, "investor");
    assert.equal(payment.senderAddress, VERIFIED_IDENTITIES.investor.evmAddress);
    assert.equal(payment.recipientAddress, VERIFIED_IDENTITIES.treasury.evmAddress);
    assert.equal(payment.tokenAddress, SEPOLIA_ASSETS.USDC.address);
    assert.equal(payment.tokenDecimals, 6);
    assert.equal(payment.amountBaseUnits, parseUsdcAmount(amount));
    const delivery = createErc20AssetIntent(quote, "link-delivery", quote.termsHash);
    assert.equal(delivery.role, "treasury");
    assert.equal(delivery.senderAddress, VERIFIED_IDENTITIES.treasury.evmAddress);
    assert.equal(delivery.recipientAddress, VERIFIED_IDENTITIES.investor.evmAddress);
    assert.equal(delivery.tokenAddress, SEPOLIA_ASSETS.LINK.address);
    assert.equal(delivery.tokenDecimals, 18);
    assert.equal(delivery.amountBaseUnits, quote.quantities.linkBaseUnits);
    for (const intent of [payment, delivery]) {
      assert.equal(intent.termsHash, quote.termsHash);
      assertErc20AssetIntent(intent, quote, quote.termsHash);
      assert.ok(Object.isFrozen(intent));
    }
  }
});

test("intent validation rejects wrong token, role, recipient, sender, decimals, amount and approved terms digest", () => {
  const quote = terms();
  for (const leg of ["usdc-payment", "link-delivery"] as const) {
    const intent = createErc20AssetIntent(quote, leg, quote.termsHash);
    for (const changed of [
      { ...intent, tokenAddress: "0x1111111111111111111111111111111111111111" },
      { ...intent, tokenDecimals: intent.tokenDecimals === 6 ? 18 : 6 },
      { ...intent, role: intent.role === "treasury" ? "investor" as const : "treasury" as const },
      { ...intent, senderAddress: intent.recipientAddress, recipientAddress: intent.senderAddress },
      { ...intent, recipientAddress: "0x1111111111111111111111111111111111111111" },
      { ...intent, amountBaseUnits: intent.amountBaseUnits + 1n },
      { ...intent, amountBaseUnits: 0n },
      { ...intent, termsHash: terms("5").termsHash },
    ]) assert.throws(() => assertErc20AssetIntent(changed, quote, quote.termsHash));
    assert.throws(() => assertErc20AssetIntent(intent, quote, terms("5").termsHash));
    assert.throws(() => createErc20AssetIntent(quote, leg, terms("5").termsHash));
  }
  assert.throws(() => createErc20AssetIntent(quote, "eth-delivery" as "usdc-payment", quote.termsHash));
});

test("pure asset transfer construction encodes exact token units with the existing EIP-1559 builder and ceil20% gas buffer", () => {
  const quote = terms();
  for (const leg of ["usdc-payment", "link-delivery"] as const) {
    const intent = createErc20AssetIntent(quote, leg, quote.termsHash);
    const value = buildErc20AssetTransfer(intent, quote, FEES);
    const tx = Transaction.from(value.prepared.unsignedSerialized), decoded = erc20.decodeFunctionData("transfer", tx.data);
    assert.equal(tx.type, 2);
    assert.equal(tx.chainId, 11155111n);
    assert.equal(tx.to, intent.tokenAddress);
    assert.equal(tx.value, 0n);
    assert.equal(tx.signature, null);
    assert.equal(decoded[0], intent.recipientAddress);
    assert.equal(decoded[1], intent.amountBaseUnits);
    assert.equal(value.prepared.gasLimit, 60_002n);
    assert.equal(value.prepared.maximumFeeWei, 300_010_000n);
    assert.equal(value.prepared.nonce, 1);
    assert.equal(value.prepared.maxFeePerGas, 5000n);
    assert.equal(value.prepared.maxPriorityFeePerGas, 1000n);
    assertPreparedAssetTransfer(value, quote, quote.termsHash);
    assert.ok(Object.isFrozen(value));
  }
});

test("asset construction preserves protective gas, price and total-fee caps", () => {
  const quote = terms(), intent = createErc20AssetIntent(quote, "usdc-payment", quote.termsHash);
  for (const limits of [
    { ...DEFAULT_EXECUTION_LIMITS, gasLimitCap: 60_001n },
    { ...DEFAULT_EXECUTION_LIMITS, maxFeePerGasCap: 4999n },
    { ...DEFAULT_EXECUTION_LIMITS, maxTotalFeeWei: 300_009_999n },
    { ...DEFAULT_EXECUTION_LIMITS, gasLimitCap: 0n },
    { ...DEFAULT_EXECUTION_LIMITS, gasBufferBps: 1999n },
    { ...DEFAULT_EXECUTION_LIMITS, gasBufferBps: 0n },
    { ...DEFAULT_EXECUTION_LIMITS, gasBufferBps: 10001n },
  ]) assert.throws(() => buildErc20AssetTransfer(intent, quote, FEES, limits));
  for (const fields of [
    { ...FEES, estimatedGas: 0n }, { ...FEES, estimatedGas: -1n },
    { ...FEES, nonce: -1 }, { ...FEES, maxPriorityFeePerGas: 5001n },
  ]) assert.throws(() => buildErc20AssetTransfer(intent, quote, fields));
});

test("prepared intent checks reject self-consistent transaction substitutions and altered approval metadata", () => {
  const quote = terms(), intent = createErc20AssetIntent(quote, "usdc-payment", quote.termsHash);
  const value = buildErc20AssetTransfer(intent, quote, FEES);
  for (const changes of [
    { amount: value.prepared.amount + 1n },
    { tokenAddress: SEPOLIA_ASSETS.LINK.address },
    { senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress, recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress },
    { gasLimit: value.prepared.gasLimit + 1n },
  ]) {
    const prepared = buildUnsignedErc20Transfer({ ...value.prepared, ...changes });
    assert.throws(() => assertPreparedAssetTransfer({ ...value, prepared }, quote, quote.termsHash));
  }
  for (const changed of [
    { ...value, estimatedGas: value.estimatedGas + 1n },
    { ...value, prepared: { ...value.prepared, unsignedHash: "0x" + "00".repeat(32) } },
    { ...value, prepared: { ...value.prepared, unsignedSerialized: "0x02" } },
  ]) assert.throws(() => assertPreparedAssetTransfer(changed, quote, quote.termsHash));
  assert.throws(() => assertPreparedAssetTransfer(value, quote, terms("20").termsHash));
});

test("offline USDC snapshot preflight requires exact asset identity and all pause and blacklist observations", () => {
  const quote = terms(), intent = createErc20AssetIntent(quote, "usdc-payment", quote.termsHash);
  const value = buildErc20AssetTransfer(intent, quote, FEES), snapshot = usdcSnapshot(value);
  assert.equal(USDC_CODE.codeHash, SEPOLIA_ASSETS.USDC.codeHash);
  const result = validateAssetTransferPreflight(value, quote, snapshot);
  assert.equal(result.checkedNonce, 1);
  assert.equal(result.remainingTokenBalance, 10_000_000n);
  const exact = validateAssetTransferPreflight(value, quote, usdcSnapshot(value, {
    tokenBalance: intent.amountBaseUnits, nativeBalance: value.prepared.maximumFeeWei,
  }));
  assert.equal(exact.remainingTokenBalance, 0n);
  assert.equal(exact.remainingNativeBalanceAtMaxFee, 0n);
  for (const overrides of [
    { tokenDecimals: 18 }, { tokenCode: "0x" }, { tokenCode: "0x60006000" },
    { senderCode: "0x6000" }, { recipientCode: "0x6000" },
    { usdcPaused: true }, { senderBlacklisted: true }, { recipientBlacklisted: true },
    { usdcPaused: undefined }, { senderBlacklisted: undefined }, { recipientBlacklisted: undefined },
  ]) assert.throws(() => validateAssetTransferPreflight(value, quote, usdcSnapshot(value, overrides)));
});

test("asset preflight rejects stale nonce, wrong chain or sender, insufficient funding and unsuitable fees", () => {
  const quote = terms(), intent = createErc20AssetIntent(quote, "usdc-payment", quote.termsHash);
  const value = buildErc20AssetTransfer(intent, quote, FEES);
  for (const overrides of [
    { chainId: 1n }, { senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress },
    { tokenAddress: SEPOLIA_ASSETS.LINK.address }, { pendingNonce: 2 },
    { estimatedGas: value.prepared.gasLimit + 1n }, { tokenBalance: intent.amountBaseUnits - 1n },
    { nativeBalance: value.prepared.maximumFeeWei - 1n }, { baseFeePerGas: 4001n },
  ]) assert.throws(() => validateAssetTransferPreflight(value, quote, usdcSnapshot(value, overrides)));
  assert.throws(() => validateAssetTransferPreflight(value, quote, usdcSnapshot(value), {
    ...DEFAULT_EXECUTION_LIMITS, maxTotalFeeWei: DEFAULT_EXECUTION_LIMITS.maxTotalFeeWei + 1n,
  }));
});

test("fresh gas observations retain the full twenty-percent buffer without rebuilding the approved transaction", () => {
  const quote = terms(), intent = createErc20AssetIntent(quote, "usdc-payment", quote.termsHash);
  const value = buildErc20AssetTransfer(intent, quote, FEES);
  const originalHash = value.prepared.unsignedHash;
  assert.equal(value.prepared.gasLimit, 60_002n);
  for (const estimatedGas of [50_001n, 40_000n]) {
    const result = validateAssetTransferPreflight(value, quote, usdcSnapshot(value, { estimatedGas }));
    assert.equal(result.checkedNonce, FEES.nonce);
  }
  // Both raw estimates fit the signed 60002 gas limit, but their twenty-percent
  // safety buffers do not. A fresh preflight must stop rather than consume it.
  for (const estimatedGas of [50_002n, 60_000n]) {
    assert.throws(() => validateAssetTransferPreflight(value, quote, usdcSnapshot(value, { estimatedGas })));
  }
  assert.equal(value.prepared.unsignedHash, originalHash);
  assert.equal(value.prepared.gasLimit, 60_002n);
  assert.equal(value.estimatedGas, FEES.estimatedGas);
});

test("LINK preflight reuses recorded public token code for variable quote-sized Treasury inventory", () => {
  const tokenCode = recordedState().preflight.snapshot.tokenCode;
  assert.equal(keccak256(tokenCode), SEPOLIA_ASSETS.LINK.codeHash);
  for (const amount of ["1", "5", "10", "20", "100"]) {
    const quote = terms(amount), intent = createErc20AssetIntent(quote, "link-delivery", quote.termsHash);
    const value = buildErc20AssetTransfer(intent, quote, FEES);
    const snapshot: AssetPreflightSnapshot = {
      chainId: 11155111n, senderAddress: VERIFIED_IDENTITIES.treasury.evmAddress,
      tokenAddress: SEPOLIA_ASSETS.LINK.address, tokenCode, tokenDecimals: 18,
      senderCode: "0x", recipientCode: "0x", pendingNonce: FEES.nonce,
      estimatedGas: FEES.estimatedGas, tokenBalance: quote.quantities.linkBaseUnits,
      nativeBalance: value.prepared.maximumFeeWei, baseFeePerGas: 2000n,
    };
    const result = validateAssetTransferPreflight(value, quote, snapshot);
    assert.equal(result.remainingTokenBalance, 0n);
    assert.equal(result.remainingNativeBalanceAtMaxFee, 0n);
    for (const changes of [
      { tokenDecimals: 6 }, { tokenCode: USDC_CODE.tokenCode },
      { tokenBalance: quote.quantities.linkBaseUnits - 1n },
    ]) assert.throws(() => validateAssetTransferPreflight(value, quote, { ...snapshot, ...changes }));
  }
});

test("payment claim identities prevent one public payment event being consumed twice", () => {
  const id = paymentClaimId(CLAIM), first = addPaymentClaim([], CLAIM);
  assert.deepEqual(first, [id]);
  assert.ok(Object.isFrozen(first));
  assert.throws(() => addPaymentClaim(first, CLAIM));
  assert.throws(() => addPaymentClaim(first, { ...CLAIM, transactionHash: CLAIM.transactionHash.toUpperCase().replace("0X", "0x") }));
  const secondEvent = addPaymentClaim(first, { ...CLAIM, logIndex: 1n });
  assert.equal(secondEvent.length, 2);
  assert.notEqual(secondEvent[0], secondEvent[1]);
  assert.deepEqual(first, [id]);
  assert.throws(() => addPaymentClaim(["malformed previous claim"], CLAIM));
  for (const invalid of [
    { ...CLAIM, chainId: 1n }, { ...CLAIM, transactionHash: "0x1234" },
    { ...CLAIM, logIndex: -1n }, { ...CLAIM, logIndex: 0.5 as unknown as bigint },
    { ...CLAIM, logIndex: 1 as unknown as bigint }, { ...CLAIM, logIndex: 1n << 256n },
  ]) assert.throws(() => paymentClaimId(invalid));
});

test("offline intent construction is deterministic and has no network, signing or broadcasting capability", () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Offline purchase fixture must never fetch"); };
  try {
    const quote = terms(), intent = createErc20AssetIntent(quote, "usdc-payment", quote.termsHash);
    assert.deepEqual(buildErc20AssetTransfer(intent, quote, FEES), buildErc20AssetTransfer(intent, quote, FEES));
    assert.equal(calls, 0);
    assert.equal("sign" in intent, false);
    assert.equal("broadcast" in intent, false);
  } finally { globalThis.fetch = original; }
});
