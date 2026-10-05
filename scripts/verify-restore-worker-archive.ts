import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createBackup, restoreBackup } from "../lib/backup";
import { verifyRestoreWorkers } from "./verify-restore-workers";
import { captureRestoreWorkers, verifyRestoredWorkers } from "./restore-worker-projection";

// Docker runner provides a UUID-owned empty database on an internal network.
const url = new URL(process.env.DATABASE_URL || "http://invalid");
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
assert.equal(url.hostname, "restore-fixture");
assert.equal(url.pathname, "/acquisition_restore_fixture");
assert.equal(process.env.BACKUP_DIR, "/tmp/mtg-worker-restore-backups");
const db = new PrismaClient();
async function main() {
  await verifyRestoreWorkers(db, async () => {
    const expected = await captureRestoreWorkers(db);
    assert.equal(expected.jobs.runningIds.length, 8);
    assert.equal(expected.lookups.runningIds.length, 1);
    const started = Date.now();
    const backup = await createBackup();
    assert.equal((await restoreBackup(backup.path)).dryRun, true);
    assert.deepEqual(await captureRestoreWorkers(db), expected, "Dry run must preserve claims");
    const unexpired = await db.acquisitionProcessingJob.count({ where: { status: "RUNNING", leaseExpiresAt: { gt: new Date() } } });
    assert.equal(unexpired, 8, "Nonzero live claims must survive capture until actual restore");
    assert.equal(await db.acquisitionCatalogLookup.count({ where: { status: "RUNNING", leaseExpiresAt: { gt: new Date() } } }), 1);
    const result = await restoreBackup(backup.path, { force: true, confirmation: "RESTORE" });
    assert.equal(result.dryRun, false);
    assert.ok("workerClaimsInvalidated" in result && result.workerClaimsInvalidated);
    await verifyRestoredWorkers(db, expected);
    assert.ok(Date.now() - started < 180000, "Force restore must finish within captured catalog lease lifetime");
    console.log(JSON.stringify({ forceRestore: true, processingLiveClaims: unexpired, catalogLiveClaims: 1, elapsedMs: Date.now() - started, fullFieldProjections: true }));
  });
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
