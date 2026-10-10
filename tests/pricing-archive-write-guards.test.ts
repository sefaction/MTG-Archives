import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const commands = [
  ["scripts/pricing-archive-maintenance.ts", "--apply", "--once"],
  ["scripts/pricing-raw-retention-pass.ts", "--apply"],
  ["scripts/pricing-daily-compact.ts", "--apply"],
  ["scripts/pricing-raw-segment-activate.ts", "--manifest", "/tmp/missing.json", "--apply"],
  ["scripts/pricing-archived-correction-apply.ts", "--date", "2026-01-01", "--apply"],
];

test("maintenance refuses disabled opt-ins before database or recovery work", () => {
  for (const value of [undefined, "", "0", "false", "true"]) {
    const env: NodeJS.ProcessEnv = { ...process.env,
      MTG_LOCAL_PILOT_TEST: "1",
      PRICING_ARCHIVE_PRODUCTION_ENABLED: "0",
      PRICING_DATABASE_URL: "postgresql://unused@127.0.0.1:1/unused",
      BACKUP_DIR: "/unavailable-maintenance-test",
      PRICING_RECOVERY_COPY_DIR: "",
      PRICING_VERIFY_DATABASE_URL: "",
    };
    delete env.PRICING_ARCHIVE_MAINTENANCE_ENABLED;
    if (value !== undefined) env.PRICING_ARCHIVE_MAINTENANCE_ENABLED = value;
    const result = spawnSync(process.execPath,
      ["--import", "tsx", "scripts/pricing-archive-maintenance.ts", "--apply", "--once"],
      { env, encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 1, `maintenance opt-in ${String(value)}`);
    assert.match(result.stderr, /Archived maintenance requires maintenance opt-in/);
    assert.doesNotMatch(result.stderr, /Pricing maintenance SQL failed|recovery copy|ECONNREFUSED/);
    assert.equal(result.stdout, "");
  }
});

test("every Pricing archive writer refuses apply without an authorized mode", () => {
  for (const args of commands) {
    const result = spawnSync(process.execPath, ["--import", "tsx", ...args], {
      env: { ...process.env, MTG_LOCAL_PILOT_TEST: "0",
        PRICING_ARCHIVE_PRODUCTION_ENABLED: "0",
        PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1",
        PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "1",
        PRICING_DATABASE_URL: "postgresql://pricing@pricing-postgres/pricing",
        BACKUP_DIR: "/tmp/unavailable-pricing-archive-test" },
      encoding: "utf8", timeout: 20_000,
    });
    assert.notEqual(result.status, 0, args[0]);
    assert.match(result.stderr, /exactly one local or production opt-in/, args[0]);
  }
});
