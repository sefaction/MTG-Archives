/** Keep local drills and a reviewed production rollout as separate opt-ins. */
type ArchiveEnvironment = Record<string, string | undefined>;

export function pricingArchiveApplyMode(
  env: ArchiveEnvironment = process.env,
): "local" | "production" {
  const local = env.MTG_LOCAL_PILOT_TEST === "1";
  const production = env.PRICING_ARCHIVE_PRODUCTION_ENABLED === "1";
  if (local === production)
    throw new Error("Archive apply requires exactly one local or production opt-in");
  if (production) {
    if (env.PRICING_ARCHIVE_MAINTENANCE_ENABLED !== "1")
      throw new Error("Production archive apply requires maintenance opt-in");
    for (const name of ["BACKUP_DIR", "PRICING_RECOVERY_COPY_DIR",
      "PRICING_VERIFY_DATABASE_URL"] as const) {
      if (!env[name]?.trim())
        throw new Error(`Production archive apply requires ${name}`);
    }
  }
  return local ? "local" : "production";
}

export function pricingArchiveCanPauseImports(env: ArchiveEnvironment = process.env) {
  const local = env.MTG_LOCAL_PILOT_TEST === "1";
  const production = env.PRICING_ARCHIVE_PRODUCTION_ENABLED === "1";
  return local !== production &&
    env.PRICING_RAW_ARCHIVE_RETENTION_ENABLED === "1" &&
    env.PRICING_ARCHIVE_MAINTENANCE_ENABLED === "1" &&
    (local || (Boolean(env.BACKUP_DIR?.trim()) &&
      Boolean(env.PRICING_RECOVERY_COPY_DIR?.trim()) &&
      Boolean(env.PRICING_VERIFY_DATABASE_URL?.trim())));
}
