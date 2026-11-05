import { readFileSync } from "node:fs";
import { decodeState, type ExecutionState } from "../../../src/execution/state.js";

export interface RecordedMpcOutcome {
  final_execution_status: string;
  transaction: {
    hash: string;
    signer_id: string;
    public_key: string;
    receiver_id: string;
    actions: { FunctionCall: { args: string; deposit: string; gas: number; method_name: string } }[];
    [key: string]: unknown;
  };
  status: { SuccessValue: string };
  [key: string]: unknown;
}

interface RecordedPublicFixture {
  schemaVersion: 1;
  kind: "recorded-live-public-response";
  expected: { nearHash: string; unsignedHash: string; evmHash: string; publicKey: string; sender: string };
  outcome: RecordedMpcOutcome;
  state: unknown;
}

// Historical public data only. These helpers never access runtime state, credentials or RPCs.
const fixture = JSON.parse(readFileSync(new URL("./mpc-8Lf5Nwoq.json", import.meta.url), "utf8")) as RecordedPublicFixture;
if (fixture.schemaVersion !== 1 || fixture.kind !== "recorded-live-public-response") {
  throw new Error("Unsupported recorded public MPC fixture.");
}
export const RECORDED_NEAR_HASH = fixture.expected.nearHash;
export const RECORDED_UNSIGNED_HASH = fixture.expected.unsignedHash;
export const RECORDED_EVM_HASH = fixture.expected.evmHash;
export const RECORDED_PUBLIC_KEY = fixture.expected.publicKey;
export const RECORDED_SENDER = fixture.expected.sender;

export function recordedOutcome(): RecordedMpcOutcome {
  return structuredClone(fixture.outcome);
}
export function recordedState(): ExecutionState {
  return decodeState(JSON.stringify(fixture.state));
}
