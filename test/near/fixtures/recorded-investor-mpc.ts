import { readFileSync } from "node:fs";
import { decodeState, type ExecutionState } from "../../../src/execution/state.js";
import type { RecordedMpcOutcome } from "./recorded-mpc.js";

interface RecordedInvestorFixture {
  schemaVersion: 1;
  kind: "recorded-live-public-response";
  expected: { nearHash: string; unsignedHash: string; evmHash: string; publicKey: string; sender: string };
  outcome: RecordedMpcOutcome;
  state: unknown;
}

// Historical public data only. No runtime state, credentials, RPCs or signing are accessed here.
const fixture = JSON.parse(readFileSync(new URL("./mpc-4uD2MLZV.json", import.meta.url), "utf8")) as RecordedInvestorFixture;
if (fixture.schemaVersion !== 1 || fixture.kind !== "recorded-live-public-response") {
  throw new Error("Unsupported recorded public Investor MPC fixture.");
}

export const INVESTOR_NEAR_HASH = fixture.expected.nearHash;
export const INVESTOR_UNSIGNED_HASH = fixture.expected.unsignedHash;
export const INVESTOR_EVM_HASH = fixture.expected.evmHash;
export const INVESTOR_PUBLIC_KEY = fixture.expected.publicKey;
export const INVESTOR_SENDER = fixture.expected.sender;

export function recordedInvestorOutcome(): RecordedMpcOutcome {
  return structuredClone(fixture.outcome);
}
export function recordedInvestorState(): ExecutionState {
  return decodeState(JSON.stringify(fixture.state));
}
