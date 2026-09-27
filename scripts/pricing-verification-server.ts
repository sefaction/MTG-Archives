import { spawnSync } from "node:child_process";

function systemId(database: URL): string {
  const result = spawnSync("psql", [database.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-c", "SELECT system_identifier FROM pg_control_system();"],
  { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || !/^\d+$/.test(result.stdout.trim()))
    throw new Error("Could not verify Pricing PostgreSQL server identity");
  return result.stdout.trim();
}

/** Use the live server for existing local pilots unless an isolated verifier is configured. */
export function pricingVerificationServer(live: URL): URL {
  const configured = process.env.PRICING_VERIFY_DATABASE_URL;
  if (!configured) return new URL(live);
  const verify = new URL(configured);
  if (verify.hostname !== "pricing-verify-postgres")
    throw new Error("Pricing verifier must use the dedicated pricing-verify-postgres service");
  verify.searchParams.delete("schema");
  verify.pathname = "/postgres";
  if (systemId(live) === systemId(verify))
    throw new Error("Pricing verifier resolves to the live PostgreSQL server");
  return verify;
}
