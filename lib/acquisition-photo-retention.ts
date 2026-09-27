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
  const photos = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "AcquisitionPhoto" p
    JOIN "AcquisitionCandidate" c ON c."runId"=p."runId" AND c."physicalId"=p."slotId"
    JOIN "AcquisitionCommitMember" m ON m."candidateId"=c.id AND m."runId"=c."runId"
    JOIN "AcquisitionCommit" r ON r.id=m."commitId" AND r."runId"=m."runId"
    WHERE p."purgedAt" IS NULL AND p."purgeAfter" <= ${now} AND r."createdAt" <= ${cutoff}
    ORDER BY p."purgeAfter",p.id LIMIT 25
  `;
  let purged = 0,
    failed = 0;
  for (const photo of photos) {
    try {
      await removeAcquisitionPhotoBytes(photo.id);
      const changed = await db.acquisitionPhoto.updateMany({
        where: { id: photo.id, purgedAt: null, purgeAfter: { lte: now } },
        data: { purgedAt: now },
      });
      purged += changed.count;
    } catch {
      failed++;
    }
  }
  return { purged, failed };
}
