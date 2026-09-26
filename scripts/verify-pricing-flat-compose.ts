import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

type ComposeService = {
  command?: string | string[];
  depends_on?: Record<string, { condition?: string }>;
  environment?: Record<string, string>;
  ports?: unknown[];
  volumes?: { source: string; target: string }[];
};
type ComposeConfig = { services: Record<string, ComposeService> };

const env = {
  ...process.env,
  COMPOSE_PROFILES: "",
  POSTGRES_DATA_PATH: "/tmp/mtg-compose-main",
  PRICING_POSTGRES_DATA_PATH: "/tmp/mtg-compose-pricing",
  REDIS_DATA_PATH: "/tmp/mtg-compose-redis",
  UPLOADS_DATA_PATH: "/tmp/mtg-compose-uploads",
  IMPORTS_DATA_PATH: "/tmp/mtg-compose-imports",
  EXPORTS_DATA_PATH: "/tmp/mtg-compose-exports",
  BACKUPS_DATA_PATH: "/tmp/mtg-compose-backups",
  SCRYFALL_DATA_PATH: "/tmp/mtg-compose-scryfall",
  BACKUP_DIR: "/app/backups",
  MTG_LOCAL_PILOT_TEST: "0",
  PRICING_ARCHIVE_PRODUCTION_ENABLED: "0",
  PRICING_ARCHIVE_MAINTENANCE_ENABLED: "false",
  PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "0",
  PRICING_RECOVERY_COPY_DIR: "",
  PRICING_VERIFY_DATABASE_URL: "",
};

function config(profile = false): ComposeConfig {
  const args = [
    "compose",
    ...(profile ? ["--profile", "pricing-archive-maintenance"] : []),
    "-f",
    "docker-compose.unraid.flat.yml",
    "config",
    "--format",
    "json",
  ];
  return JSON.parse(execFileSync("docker", args, { env, encoding: "utf8" }));
}

const defaults = config();
assert.ok(defaults.services["pricing-worker"]);
assert.equal(defaults.services["pricing-archive-maintenance"], undefined);
assert.equal(defaults.services["pricing-verify-postgres"], undefined);
const worker = defaults.services["pricing-worker"];
assert.equal(worker.environment?.PRICING_ARCHIVE_PRODUCTION_ENABLED, "0");
assert.equal(worker.environment?.PRICING_RAW_ARCHIVE_RETENTION_ENABLED, "0");
assert.equal(worker.environment?.PRICING_ARCHIVE_MAINTENANCE_ENABLED, "false");
assert.equal(worker.environment?.MTG_LOCAL_PILOT_TEST, "0");
assert.ok(worker.volumes?.some((volume) => volume.target === "/app/backups"));

const profiled = config(true);
const maintenance = profiled.services["pricing-archive-maintenance"];
const verifier = profiled.services["pricing-verify-postgres"];
assert.ok(maintenance);
assert.ok(verifier);
assert.equal(maintenance.environment?.PRICING_ARCHIVE_PRODUCTION_ENABLED, "0");
assert.equal(maintenance.environment?.PRICING_RAW_ARCHIVE_RETENTION_ENABLED, "0");
assert.equal(maintenance.environment?.PRICING_ARCHIVE_MAINTENANCE_ENABLED, "false");
assert.equal(maintenance.environment?.MTG_LOCAL_PILOT_TEST, "0");
assert.equal(maintenance.environment?.PRICING_RECOVERY_COPY_DIR, "");
assert.equal(maintenance.environment?.PRICING_VERIFY_DATABASE_URL, "");
assert.ok(maintenance.volumes?.some((volume) => volume.target === "/app/backups"));
assert.equal(maintenance.depends_on?.["pricing-verify-postgres"]?.condition, "service_healthy");
assert.deepEqual(verifier.ports ?? [], []);
const verifierData = verifier.volumes?.find((volume) => volume.target === "/var/lib/postgresql/data");
const liveData = profiled.services["pricing-postgres"].volumes?.find(
  (volume) => volume.target === "/var/lib/postgresql/data",
);
assert.ok(verifierData);
assert.ok(liveData);
assert.notEqual(verifierData.source, liveData.source);

process.stdout.write("Flat Unraid Compose archive profile remains disabled by default.\n");
