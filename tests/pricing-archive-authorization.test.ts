import assert from "node:assert/strict";
import test from "node:test";
import { pricingArchiveApplyMode, pricingArchiveCanPauseImports } from
  "../scripts/pricing-archive-authorization";

const production = {
  MTG_LOCAL_PILOT_TEST: "0",
  PRICING_ARCHIVE_PRODUCTION_ENABLED: "1",
  PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1",
  PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "1",
  BACKUP_DIR: "/app/backups",
  PRICING_RECOVERY_COPY_DIR: "/app/backups/pricing-recovery",
  PRICING_VERIFY_DATABASE_URL: "postgresql://verifier@pricing-verify-postgres/postgres",
};

test("archive apply keeps local and production authorizations separate", () => {
  assert.equal(pricingArchiveApplyMode({ MTG_LOCAL_PILOT_TEST: "1" }), "local");
  assert.equal(pricingArchiveApplyMode(production), "production");
  assert.throws(() => pricingArchiveApplyMode({}), /exactly one/);
  assert.throws(() => pricingArchiveApplyMode({ ...production,
    MTG_LOCAL_PILOT_TEST: "1" }), /exactly one/);
});

test("production apply requires maintenance and recovery configuration", () => {
  for (const name of ["PRICING_ARCHIVE_MAINTENANCE_ENABLED", "BACKUP_DIR",
    "PRICING_RECOVERY_COPY_DIR", "PRICING_VERIFY_DATABASE_URL"] as const) {
    assert.throws(() => pricingArchiveApplyMode({ ...production, [name]: "" }),
      new RegExp(name === "PRICING_ARCHIVE_MAINTENANCE_ENABLED" ?
        "maintenance opt-in" : name));
  }
  assert.throws(() => pricingArchiveApplyMode({ ...production,
    PRICING_RECOVERY_COPY_DIR: "/app/unrelated-recovery" }),
  /BACKUP_DIR\/pricing-recovery/);
});

test("import pause requires a complete, unambiguous retention configuration", () => {
  assert.equal(pricingArchiveCanPauseImports(production), true);
  assert.equal(pricingArchiveCanPauseImports({ ...production,
    PRICING_RECOVERY_COPY_DIR: "" }), false);
  assert.equal(pricingArchiveCanPauseImports({ ...production,
    PRICING_RECOVERY_COPY_DIR: "/app/unrelated-recovery" }), false);
  assert.equal(pricingArchiveCanPauseImports({ ...production,
    MTG_LOCAL_PILOT_TEST: "1" }), false);
  assert.equal(pricingArchiveCanPauseImports({ ...production,
    PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "0" }), false);
  assert.equal(pricingArchiveCanPauseImports({ MTG_LOCAL_PILOT_TEST: "1",
    PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1",
    PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "1" }), true);
});
