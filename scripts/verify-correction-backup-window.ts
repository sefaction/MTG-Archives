import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import { runCorrectionCaptureOnce, releasePreservedCorrectionPins } from "../lib/acquisition-correction-worker";
import { purgeTrashedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "correction-restore-fixture");
assert.equal(process.env.UPLOADS_DATA_PATH, "/drill/uploads");
const db = new PrismaClient();
async function main() {
  assert.equal(await db.correctionBackupGuard.count({ where: { releasedAt: null } }), 1);
  assert.equal((await runCorrectionCaptureOnce(db)).preserved, 1);
  assert.equal((await runCorrectionCaptureOnce(db)).preserved, 1);
  await releasePreservedCorrectionPins(db);
  assert.equal(await db.correctionRetentionPin.count({ where: { releasedAt: null } }), 4);
  const past = new Date(Date.now()-10*86400000);
  await db.acquisitionSession.updateMany({ data: { trashedAt: past, trashExpiresAt: past } });
  assert.equal((await purgeTrashedAcquisitionPhotos(db)).purged, 0);
  await db.acquisitionSession.updateMany({ data: { trashedAt: null, trashExpiresAt: null } });
  console.log("PASS correction backup window: post-dump copies preserve all source pins through appdata staging");
}
main().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => db.$disconnect());
