import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { claimCorrectionCapture, completeCorrectionCapture } from "../lib/acquisition-correction-worker";
import { prepareCorrectionBlob } from "../lib/acquisition-correction-files";
import { readAcquisitionPhotoBytes } from "../lib/acquisition-files";
import assert from "node:assert/strict";
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "correction-restore-fixture");
assert.equal(process.env.UPLOADS_DATA_PATH, "/drill/uploads");
const db = new PrismaClient();
async function main() {
  const phase = process.argv[2]; assert.ok(["PREPARED", "PUBLISHED"].includes(phase));
  const claim = await claimCorrectionCapture(db); assert.ok(claim);
  const pin = await db.correctionRetentionPin.findFirstOrThrow({ where: { blobId: claim.blobId, releasedAt: null } });
  const bytes = await readAcquisitionPhotoBytes(pin.photoId, "raw", claim.blob.digest);
  const staged = await prepareCorrectionBlob(claim.blob.ownerPlayerId, claim.blob.digest, bytes, claim.leaseToken!);
  const ready = () => writeFile("/drill/copy-ready.json", JSON.stringify({ phase, claim }));
  if (phase === "PREPARED") { await ready(); await setTimeout(3600000); }
  else await completeCorrectionCapture(db, claim, async () => { await staged.publish(); await ready(); await setTimeout(3600000); });
}
main().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => db.$disconnect());
