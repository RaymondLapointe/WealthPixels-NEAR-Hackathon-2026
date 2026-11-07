import { Signature, SigningKey, Transaction, computeAddress } from "ethers";
import { createPurchaseQuote } from "../../../src/purchase/quote.js";
import { buildUnsignedErc20Transfer, assembleSignedErc20Transfer } from "../../../src/evm/erc20-transfer.js";
import { buildUnsignedNativeTransfer } from "../../../src/evm/native-transfer.js";
import { createErc20AssetIntent } from "../../../src/evm/asset-intent.js";
import { normalizeMpcOutcome } from "../../../src/near/signing.js";
import { VERIFIED_IDENTITIES } from "../../../src/near/identities.js";
import type { PurchaseLeg } from "../../../src/purchase/legs.js";
import type { SepoliaReadRpc } from "../../../src/evm/sepolia-link.js";
import { AT, costs, prices } from "./purchase-quote.js";
import { IMPLEMENTATION_PIN, purchaseReceiptRpc, type ReceiptOptions } from "./purchase-legs.js";
import { recordedOutcome, recordedState, RECORDED_NEAR_HASH, RECORDED_EVM_HASH } from "./recorded-mpc.js";

/** Historical public LINK signature plus a synthetic purchase association and
 * canonical RPC observations. No actual USDC purchase, new signature, key,
 * credential access, live RPC or blockchain execution is represented here. */
export function publicLegQuote(amount = "20", maxFee = 1028n, tip = 1000n) {
  const p = prices(), c = costs(p, amount);
  return createPurchaseQuote({ purchaseId: p.purchaseId, purpose: "offline", createdAt: AT, prices: p,
    investmentUsdcBaseUnits: BigInt(amount) * 1_000_000n, costs: { ...c, assetIdentity: { usdcImplementation: IMPLEMENTATION_PIN },
      evm: c.evm.map(leg => ({ ...leg, observedBaseFeePerGasWei: 14n, assumedBaseFeePerGasWei: 14n,
        maxFeePerGasWei: maxFee, maxPriorityFeePerGasWei: tip })) } });
}
export function authenticPublicLegFixture(options: ReceiptOptions = {}) {
  const prepared = recordedState().preflight.prepared, quote = publicLegQuote("20", prepared.maxFeePerGas, prepared.maxPriorityFeePerGas);
  const outcome = recordedOutcome(), signature = normalizeMpcOutcome(outcome, "treasury", RECORDED_NEAR_HASH, prepared.unsignedHash);
  const signed = assembleSignedErc20Transfer(prepared, signature, prepared.senderAddress);
  const rpcFixture = purchaseReceiptRpc(prepared, signed, { ...options,
    senderEthDelta: options.senderEthDelta ?? -50_700_000n, receipt: { effectiveGasPrice: "0x3f6", ...options.receipt } });
  const rpc: SepoliaReadRpc = { async request(method, params) {
    const value = await rpcFixture.rpc.request(method, params);
    return method === "eth_getBlockByNumber" && value && typeof value === "object" ? { ...value, baseFeePerGas: "0xe" } : value;
  } };
  return { quote, prepared, signed, outcome, rpc, rpcFixture, raw: rpcFixture.raw, input: {
    quote, leg: "link-delivery" as const, nearTransactionHash: RECORDED_NEAR_HASH, evmTransactionHash: RECORDED_EVM_HASH,
    unsignedHash: prepared.unsignedHash, referenceBlockNumber: 100n,
  } };
}

/** Public algebraic r/s fixture only. Its recovered key is NOT either real role.
 * Public-key recovery performs no private-key generation or signing operation. */
export function algebraicQuotedTransaction(leg: PurchaseLeg) {
  const quote = publicLegQuote("10", 5000n, 1000n), role = leg === "usdc-payment" ? "investor" : "treasury";
  const common = { chainId: 11155111n, senderAddress: VERIFIED_IDENTITIES[role].evmAddress,
    nonce: 0, gasLimit: leg === "eth-delivery" ? 25_200n : 60_000n, maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n };
  const native = leg === "eth-delivery";
  const intent = !native ? createErc20AssetIntent(quote.terms, leg, quote.terms.termsHash) : undefined;
  const intended = native ? buildUnsignedNativeTransfer({ ...common, recipientAddress: VERIFIED_IDENTITIES.investor.evmAddress,
    amountWei: quote.terms.quantities.ethWei }) : buildUnsignedErc20Transfer({ ...common, tokenAddress: intent!.tokenAddress,
    recipientAddress: intent!.recipientAddress, amount: intent!.amountBaseUnits });
  const signature = Signature.from({ r: "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    s: "0x" + "1".padStart(64, "0"), yParity: 0 });
  const publicKey = SigningKey.recoverPublicKey(intended.unsignedHash, signature), senderAddress = computeAddress(publicKey);
  const genericPrepared = "amountWei" in intended ? buildUnsignedNativeTransfer({ ...intended, senderAddress }) :
    buildUnsignedErc20Transfer({ ...intended, senderAddress });
  const tx = Transaction.from(intended.unsignedSerialized); tx.signature = signature;
  const signed = { serialized: tx.serialized, hash: tx.hash!, senderAddress };
  const hex = (n: bigint | number) => `0x${n.toString(16)}`;
  const raw = { type: "0x2", chainId: "0xaa36a7", hash: tx.hash!, from: common.senderAddress,
    to: tx.to!, value: hex(tx.value), input: tx.data, nonce: "0x0", gas: hex(tx.gasLimit), maxFeePerGas: hex(tx.maxFeePerGas!),
    maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas!), accessList: [], r: signature.r, s: signature.s, v: "0x0" };
  return { quote, role, intended, genericPrepared, publicKey, signed, raw };
}
