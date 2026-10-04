import type { PrismaClient } from "@prisma/client";
import {
  PHOTO_RETENTION_DAYS_AFTER_COMMIT,
  removeAcquisitionPhotoBytes,
} from "./acquisition-files";

/** Bounded worker maintenance. Receipt membership and elapsed commit age are
 * independent prerequisites; a stray purgeAfter cannot delete unfinished cards.
 * Unlink first, then mark. A crash between them retries missing files safely. */
export async function purgeCommittedAcquisitionPhotos(
  db: PrismaClient,
  now = new Date(),
) {
  const cutoff = new Date(
    now.getTime() - PHOTO_RETENTION_DAYS_AFTER_COMMIT * 24 * 60 * 60 * 1000,
  );
  // Filter by actual receipt in SQL before LIMIT so unrelated pending photos
  // cannot starve the cleanup queue even if they have an invalid expiry value.
  const photos = await db.$queryRaw<{ id: string; sessionId: string }[]>`
    SELECT p.id,session.id AS "sessionId" FROM "AcquisitionPhoto" p
    JOIN "AcquisitionCandidate" c ON c."runId"=p."runId" AND c."physicalId"=p."slotId"
    JOIN "AcquisitionCommitMember" m ON m."candidateId"=c.id AND m."runId"=c."runId"
    JOIN "AcquisitionCommit" r ON r.id=m."commitId" AND r."runId"=m."runId"
    JOIN "AcquisitionRun" run ON run.id=p."runId"
    JOIN "AcquisitionSession" session ON session.id=run."sessionId"
    WHERE session."trashedAt" IS NULL AND session."deletedAt" IS NULL
      AND p."purgedAt" IS NULL AND p."purgeAfter" <= ${now} AND r."createdAt" <= ${cutoff}
    ORDER BY p."purgeAfter",p.id LIMIT 25
  `;
  let purged = 0,
    failed = 0;
  for (const photo of photos) {
    try {
      purged += await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${photo.sessionId} FOR UPDATE`;
        const session = await tx.acquisitionSession.findUnique({where: {id: photo.sessionId}});
        if (!session || session.trashedAt || session.deletedAt) return 0;
        const current = await tx.acquisitionPhoto.findUnique({where: {id: photo.id}});
        if (!current || current.purgedAt || !current.purgeAfter || current.purgeAfter > now) return 0;
        await removeAcquisitionPhotoBytes(photo.id);
        const changed = await tx.acquisitionPhoto.updateMany({
          where: { id: photo.id, purgedAt: null, purgeAfter: { lte: now } },
          data: { purgedAt: now },
        });
        return changed.count;
      });
    } catch {
      failed++;
    }
  }
  return { purged, failed };
}

/** Expired Trash removes originals/previews, never Inventory or immutable
 * acquisition receipts. An accepted scanner transfer must drain first. The
 * session lock fences restoration; expiry is irreversible before any unlink. */
export async function purgeTrashedAcquisitionPhotos(db: PrismaClient, now = new Date()) {
  const batches = await db.$queryRaw<{id: string}[]>`
    SELECT s.id FROM "AcquisitionSession" s JOIN "AcquisitionRun" r ON r."sessionId"=s.id
    WHERE s."trashedAt" IS NOT NULL AND s."trashExpiresAt"<=${now}
      AND (s."deletedAt" IS NULL OR EXISTS (SELECT 1 FROM "AcquisitionPhoto" p WHERE p."runId"=r.id AND p."purgedAt" IS NULL))
      AND NOT EXISTS (SELECT 1 FROM "ScannerRun" scan WHERE scan."acquisitionRunId"=r.id AND scan.status NOT IN ('DRAINED','CANCELLED_BEFORE_START'))
    ORDER BY s."trashExpiresAt",s.id LIMIT 5`;
  let purged = 0, failed = 0, expired = 0;
  for (const batch of batches) {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${batch.id} FOR UPDATE`;
      const session = await tx.acquisitionSession.findUniqueOrThrow({where: {id: batch.id}, include: {run: true}});
      if (!session.trashedAt || !session.trashExpiresAt || session.trashExpiresAt > now || !session.run) return;
      if (await tx.scannerRun.count({where: {acquisitionRunId: session.run.id, status: {notIn: ["DRAINED", "CANCELLED_BEFORE_START"]}}})) return;
      if (!session.deletedAt) {
        await tx.acquisitionSession.update({where: {id: session.id}, data: {deletedAt: now, phase: "CANCELLED", scannerReserved: 0}});
        expired++;
      }
      const photos = await tx.acquisitionPhoto.findMany({where: {runId: session.run.id, purgedAt: null}, orderBy: {id: "asc"}, take: 25});
      for (const photo of photos) {
        try {
          await removeAcquisitionPhotoBytes(photo.id);
          await tx.acquisitionPhoto.update({where: {id: photo.id}, data: {purgedAt: now}});
          purged++;
        } catch { failed++; }
      }
    }, {timeout: 30000});
  }
  return {expired, purged, failed};
}
