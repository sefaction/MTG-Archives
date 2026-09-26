import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("raw retention refuses apply without all local pilot opt-ins", () => {
  const result = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-retention-pass.ts", "--apply"],
    { env: { ...process.env, PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "1",
      PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1", MTG_LOCAL_PILOT_TEST: "0" },
      encoding: "utf8", timeout: 20_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /three explicit local pilot opt-ins/);
});
