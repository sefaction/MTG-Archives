import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync,
  utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { copyVerifiedPricingRecoveryFiles, pruneStalePricingRecoveryPartials,
  verifyPricingRecoveryCopyDestination } from
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
    await assert.rejects(verifyPricingRecoveryCopyDestination(source, source), /outside BACKUP_DIR\/pricing/);
    const sibling = join(source, "pricing-recovery");
    mkdirSync(sibling);
    assert.deepEqual(await verifyPricingRecoveryCopyDestination(source, sibling),
      { source: resolve(source, "pricing"), destination: resolve(sibling) });
    await assert.rejects(verifyPricingRecoveryCopyDestination(source,
      join(source, "pricing")), /outside BACKUP_DIR\/pricing/);
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
      /outside BACKUP_DIR\/pricing/);
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

test("off-hours cleanup removes only week-old unpublished recovery copies", async () => {
  const base = mkdtempSync(join(tmpdir(), "pricing-recovery-partials-"));
  try {
    const nested = join(base, "raw", "2026-01-05");
    mkdirSync(nested, { recursive: true });
    const suffix = "12345678-1234-4123-8123-123456789abc";
    const stale = join(nested, `segment.csv.gz.partial-${suffix}`);
    const recent = join(base, `before.dump.partial-${suffix}`);
    const published = join(nested, "segment.csv.gz");
    const unrelated = join(nested, "notes.partial-unknown");
    for (const path of [stale, recent, published, unrelated])
      writeFileSync(path, "verified fixture");
    const now = Date.now();
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    utimesSync(published, old, old);
    utimesSync(unrelated, old, old);
    assert.deepEqual(await pruneStalePricingRecoveryPartials(base, now),
      { eligible: 1, removed: 0, bytes: 16 });
    assert.ok(existsSync(stale));
    assert.deepEqual(await pruneStalePricingRecoveryPartials(base, now, true),
      { eligible: 1, removed: 1, bytes: 16 });
    assert.ok(!existsSync(stale));
    for (const path of [recent, published, unrelated]) assert.ok(existsSync(path));
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

test("enabled maintenance requires an isolated verification database", () => {
  const base = mkdtempSync(join(tmpdir(), "pricing-maintenance-verifier-"));
  try {
    const source = join(base, "source"), destination = join(base, "destination");
    mkdirSync(join(source, "pricing"), { recursive: true });
    mkdirSync(destination);
    const result = spawnSync(process.execPath,
      ["--import", "tsx", "scripts/pricing-archive-maintenance.ts", "--once", "--apply"],
      { env: { ...process.env,
        PRICING_DATABASE_URL: "postgresql://local:local@localhost:5432/local",
        PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1", MTG_LOCAL_PILOT_TEST: "1",
        BACKUP_DIR: source, PRICING_RECOVERY_COPY_DIR: destination,
        PRICING_VERIFY_DATABASE_URL: "" },
        encoding: "utf8", timeout: 20_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PRICING_VERIFY_DATABASE_URL is required/);
  } finally {
    const target = resolve(base);
    assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}`));
    rmSync(target, { recursive: true, force: true });
  }
});
