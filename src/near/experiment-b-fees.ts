/** Compatibility facade: Experiment B retains its exact public fee model and output format. */
export {
  calculateMpcFundingModel as calculateExperimentBFeeModel,
  type MpcFundingInputs as ExperimentBFeeInputs,
  type MpcFundingModel as ExperimentBFeeModel,
} from "./mpc-funding.js";
