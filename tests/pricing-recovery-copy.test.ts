import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { copyVerifiedPricingRecoveryFiles, verifyPricingRecoveryCopyDestination } from
  "../scripts/pricing-recovery-copy";

test("Pricing recovery copy reads back immutable archive and dump before reuse", async () => {
  const base = mkdtempSync(join(tmpdir(), "pricing-recovery-copy-"));
  try {
    const source = join(base, "source"), destination = join(base, "destination");
    const raw = join(source, "pricing", "raw", "2026-01-05");
    mkdirSync(raw, { recursive: true });
    mkdirSync(destination);
    const archive = join(raw, "segment.csv.gz");
    const dump = join(source, "pricing", "before.dump");
    writeFileSync(archive, "immutable raw segment");
    writeFileSync(dump, "consistent full Pricing dump");
    const files = [archive, dump].map((path) => ({ path,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
    assert.deepEqual(await verifyPricingRecoveryCopyDestination(source, destination),
      { source: resolve(source, "pricing"), destination: resolve(destination) });
    await assert.rejects(verifyPricingRecoveryCopyDestination(source, ""), /required/);
    await assert.rejects(verifyPricingRecoveryCopyDestination(source, source), /separate/);
    const copied = await copyVerifiedPricingRecoveryFiles(source, destination, files);
    assert.deepEqual(copied.map((item) => item.reused), [false, false]);
    for (const item of copied)
      assert.deepEqual(readFileSync(item.destination), readFileSync(item.path));
    const reused = await copyVerifiedPricingRecoveryFiles(source, destination, files);
    assert.deepEqual(reused.map((item) => item.reused), [true, true]);
    writeFileSync(copied[0].destination, "corrupt copy");
    await assert.rejects(copyVerifiedPricingRecoveryFiles(source, destination, files),
      /Existing Pricing recovery copy differs/);
    await assert.rejects(copyVerifiedPricingRecoveryFiles(source, source, files),
      /separate from the source/);
    const outside = join(base, "outside.dump");
    writeFileSync(outside, "outside source root");
    await assert.rejects(copyVerifiedPricingRecoveryFiles(source, destination,
      [{ ...files[1], path: outside }]), /outside BACKUP_DIR/);
  } finally {
    const target = resolve(base);
    assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}`));
    rmSync(target, { recursive: true, force: true });
  }
});

test("enabled maintenance refuses to start without recovery copy destination", () => {
  const result = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/pricing-archive-maintenance.ts", "--once", "--apply"],
    { env: { ...process.env,
      PRICING_DATABASE_URL: "postgresql://local:local@localhost:5432/local",
      PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1", MTG_LOCAL_PILOT_TEST: "1",
      PRICING_RECOVERY_COPY_DIR: "" },
      encoding: "utf8", timeout: 20_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PRICING_RECOVERY_COPY_DIR is required/);
});
