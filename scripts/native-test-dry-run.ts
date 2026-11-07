import { createStandaloneNativeIntent, prepareStandaloneNative } from "../src/evm/standalone-native.js";
import { nativeSnapshot } from "../test/near/fixtures/native-delivery.js";

if (process.argv.length !== 2) throw new Error("The fixed offline native example accepts no network, credential or transaction options.");
const intent = createStandaloneNativeIntent({ testId: "offline-native-example", role: "treasury", amountWei: 1_000_000_000_000n });
const preflight = prepareStandaloneNative(intent, { maxFeePerGas: 5000n, maxPriorityFeePerGas: 1000n }, nativeSnapshot());
const { unsignedSerialized: _bytes, ...parameters } = preflight.prepared;
process.stdout.write(JSON.stringify({ kind: "offline-standalone-native-preparation-example",
  executionProof: "none; fixed synthetic balances, nonce and gas observations; no live preparation, signing or broadcast",
  intent, parameters, rawGasEstimate: preflight.snapshot.estimatedGas, bufferedGasLimit: parameters.gasLimit,
  maximumFeeWei: parameters.maximumFeeWei, operatingReserveWei: intent.policy.operatingReserveWei,
  expectedInvestorIncreaseWei: intent.amountWei, writesRuntimeState: false, signingOrBroadcastAvailable: false,
}, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
