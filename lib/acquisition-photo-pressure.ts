import { Prisma, type PrismaClient } from "@prisma/client";
import { acquisitionPhotoLimits } from "./acquisition-photo-limits";
import { removeAcquisitionPhotoBytes } from "./acquisition-files";

export const PHOTO_PRESSURE_CLEANUP_KEY = "photo-pressure-cleanup";

// COMPLETE means capture ended, not that cards were added to Inventory.
// Only receipts (or explicit exclusions) settle the candidate review queue.
const eligible = Prisma.sql`
  s."deletedAt" IS NULL AND (s."trashedAt" IS NOT NULL OR (
    s.phase='COMPLETE'
    AND EXISTS (SELECT 1 FROM "AcquisitionCandidate" c WHERE c."runId"=r.id)
    AND NOT EXISTS (SELECT 1 FROM "AcquisitionCandidate" c WHERE c."runId"=r.id AND NOT c.excluded
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id AND m."runId"=r.id))
    AND NOT EXISTS (SELECT 1 FROM "AcquisitionCaptureSlot" slot WHERE slot."runId"=r.id
      AND (NOT EXISTS (SELECT 1 FROM "AcquisitionPhoto" p WHERE p."slotId"=slot.id AND p.ready)
        OR NOT EXISTS (SELECT 1 FROM "AcquisitionCandidate" c WHERE c."runId"=r.id AND c."physicalId"=slot.id)))
  ))
  AND NOT EXISTS (SELECT 1 FROM "AcquisitionPhoto" p WHERE p."runId"=r.id AND NOT p.ready)
  AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" j WHERE j."runId"=r.id AND j.status IN ('PENDING','RUNNING'))
  AND NOT EXISTS (SELECT 1 FROM "ScannerRun" scan WHERE scan."acquisitionRunId"=r.id AND NOT
    (scan.status IN ('DRAINED','CANCELLED_BEFORE_START') OR scan.status='ERROR' AND scan.outcome IS NOT NULL AND scan.outcome<>'null'::jsonb))
  AND NOT EXISTS (SELECT 1 FROM "ScannerRun" scan JOIN "ScannerRun" root ON root.id=scan."seriesRootId"
    WHERE scan."acquisitionRunId"=r.id AND root."seriesStoppedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "ScannerRun" later WHERE later."seriesRootId"=root.id AND later."seriesOrdinal">scan."seriesOrdinal"))`;

/** Pressure starts at 90%, removes oldest eligible batches toward 80%, and
 * bounds each pass. Tombstones commit BEFORE unlink so crash recovery can never
 * restore a partially deleted batch. Receipts and Inventory are never deleted. */
export async function purgeAcquisitionPhotosUnderPressure(db: PrismaClient, now = new Date()) {
  const limits = acquisitionPhotoLimits();
  const owners = await db.$queryRaw<{id: string}[]>`
    SELECT s."ownerPlayerId" AS id FROM "AcquisitionPhoto" p
    JOIN "AcquisitionRun" r ON r.id=p."runId" JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    WHERE p."purgedAt" IS NULL GROUP BY s."ownerPlayerId" HAVING SUM(p.bytes)>=${limits.owner * .9}`;
  // Retry durable deletions even when earlier unlinks already relieved pressure.
  const retry = await db.$queryRaw<{id: string}[]>`
    SELECT s.id FROM "AcquisitionSession" s JOIN "AcquisitionRun" r ON r."sessionId"=s.id
    WHERE s."deletedAt" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "AcquisitionCommand" c WHERE c."runId"=r.id AND c."requestKey"=${PHOTO_PRESSURE_CLEANUP_KEY})
      AND EXISTS (SELECT 1 FROM "AcquisitionPhoto" p WHERE p."runId"=r.id AND p."purgedAt" IS NULL)
    ORDER BY s."deletedAt",s.id LIMIT 5`;
  const candidates = owners.length ? await db.$queryRaw<{id: string}[]>(Prisma.sql`
    SELECT s.id FROM "AcquisitionSession" s JOIN "AcquisitionRun" r ON r."sessionId"=s.id
    WHERE s."ownerPlayerId" IN (${Prisma.join(owners.map(o => o.id))}) AND ${eligible}
      AND EXISTS (SELECT 1 FROM "AcquisitionPhoto" p WHERE p."runId"=r.id AND p."purgedAt" IS NULL)
    ORDER BY s."createdAt",s.id LIMIT 5`) : [];
  const batches = [...new Map([...retry, ...candidates].map(b => [b.id,b])).values()].slice(0,5);
  let expired = 0, purged = 0, failed = 0;
  for (const batch of batches) {
    try {
      const runId = await db.$transaction(async tx => {
        const initial = await tx.acquisitionSession.findUnique({where: {id: batch.id}, include: {run: true}});
        if (!initial?.run) return null;
        const roots = await tx.scannerRun.findMany({where: {acquisitionRunId: initial.run.id}, select: {seriesRootId: true}});
        for (const root of [...new Set(roots.flatMap(r => r.seriesRootId ? [r.seriesRootId] : []))].sort())
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scanner-series-v1:${root}`},0))`;
        await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE "acquisitionRunId"=${initial.run.id} ORDER BY segment FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${batch.id} FOR UPDATE`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.ownerPlayerId},314))`;
        const session = await tx.acquisitionSession.findUniqueOrThrow({where: {id: batch.id}});
        if (session.deletedAt) {
          const marker = await tx.acquisitionCommand.findUnique({where: {runId_requestKey: {runId: initial.run.id, requestKey: PHOTO_PRESSURE_CLEANUP_KEY}}});
          return marker ? initial.run.id : null;
        }
        const usage = await tx.acquisitionPhoto.aggregate({where: {run: {session: {ownerPlayerId: session.ownerPlayerId}}, purgedAt: null}, _sum: {bytes: true}});
        if ((usage._sum.bytes ?? 0) <= limits.owner * .8) return null;
        const checked = await tx.$queryRaw<{id: string}[]>(Prisma.sql`
          SELECT s.id FROM "AcquisitionSession" s JOIN "AcquisitionRun" r ON r."sessionId"=s.id
          WHERE s.id=${batch.id} AND ${eligible}`);
        if (!checked.length) return null;
        await tx.acquisitionSession.update({where: {id: session.id}, data: {deletedAt: now,
          trashedAt: session.trashedAt ?? now, trashExpiresAt: now, phase: "CANCELLED", scannerReserved: 0, revision: {increment: 1}}});
        await tx.acquisitionProcessingJob.updateMany({where: {runId: initial.run.id, status: {in: ["PENDING","RUNNING","FAILED"]}},
          data: {status: "SUPERSEDED", errorCode: "BATCH_STOPPED", leaseToken: null, leaseExpiresAt: null}});
        await tx.acquisitionCommand.create({data: {runId: initial.run.id, requestKey: PHOTO_PRESSURE_CLEANUP_KEY,
          payload: JSON.stringify({reason: "PHOTO_STORAGE_PRESSURE", ownerLimitBytes: limits.owner, retainedBytes: usage._sum.bytes, at: now.toISOString()})}});
        expired++;
        return initial.run.id;
      }, {timeout: 30000});
      if (!runId) continue;
      const photos = await db.acquisitionPhoto.findMany({where: {runId, purgedAt: null}, orderBy: {id: "asc"}, take: 25});
      for (const photo of photos) {
        try {
          await removeAcquisitionPhotoBytes(photo.id);
          purged += (await db.acquisitionPhoto.updateMany({where: {id: photo.id, purgedAt: null}, data: {purgedAt: now}})).count;
        } catch { failed++; }
      }
    } catch { failed++; }
  }
  return {expired, purged, failed};
}
