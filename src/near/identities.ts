import type { AuthorityRole } from "./config.js";

/** Public identities verified in Task 02B-1. These are not credentials. */
export const VERIFIED_IDENTITIES = Object.freeze({
  treasury: Object.freeze({
    accountId: "wealthpixels-treasury.testnet",
    accessPublicKey: "ed25519:8y8NfEhTLWFYgMCKhGLQBPVPZaEBjQvdphf29ta6BQJ1",
    evmAddress: "0x7548b35f4cb051bEEc61550FC93cB7D1E9028C87",
  }),
  investor: Object.freeze({
    accountId: "wealthpixels-investor.testnet",
    accessPublicKey: "ed25519:HYbgeU5vRTw686L5xxp3JtsyzrcBrQcpR3MtBq197DWc",
    evmAddress: "0x07FE574EdB1B2f537F9be452312C15A5b9427820",
  }),
});

export const VERIFIED_MPC_ROOT = "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3";

export function requireRole(value: unknown): AuthorityRole {
  if (value !== "treasury" && value !== "investor") throw new Error("Select --role treasury or --role investor explicitly.");
  return value;
}
