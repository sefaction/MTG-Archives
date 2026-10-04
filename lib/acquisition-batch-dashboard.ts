import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isAdminUser } from "./auth-policy";
import type { AcquisitionActor } from "./acquisition-store";
import { PRINTING_STAGE } from "./acquisition-printing";

export const batchDashboardQuery = z.object({
  view: z.enum(["pending", "all", "closed", "cancelled", "trash"]).catch("pending"),
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().min(1).max(20000).catch(1),
});
export type BatchDashboardRow = {
  id: string; batchNumber: number; phase: string; cancelled: boolean; trashed: boolean;
  updatedAt: string; trashExpiresAt: string | null; location: string | null; section: string;
  owner: string; captured: number; evaluated: number; assigned: number; confirmed: number;
  added: number; processing: number; failed: number; pending: boolean;
  draining: boolean;
};
export type BatchDashboard = {
  rows: BatchDashboardRow[]; total: number; page: number; pages: number;
  totals: {batches: number; pending: number; captured: number; evaluated: number; assigned: number; confirmed: number; added: number};
};

/** Counts physical candidates once, with only the current retained photo and
 * latest printing check. Job retries/stages/generations cannot inflate totals.
 * Filtering and pagination happen in PostgreSQL, never per-card hydration. */
export async function getAcquisitionBatchDashboard(db: PrismaClient, actor: AcquisitionActor, raw: unknown): Promise<BatchDashboard> {
  const query = batchDashboardQuery.parse(raw);
  const user = await db.user.findUnique({where: {id: actor.userId}, include: {player: true}});
  if (!user?.isActive || user.forcePasswordChange || !(actor.adminMode && isAdminUser(user, user.player) || user.player?.active))
    throw new Error("Capture batches unavailable");
  const owner = actor.adminMode && isAdminUser(user, user.player) ? Prisma.sql`TRUE` : Prisma.sql`s."ownerPlayerId"=${user.playerId}`;
  const search = `%${query.q.replace(/[\\%_]/g, char => "\\" + char)}%`;
  const filter = query.view === "trash" ? Prisma.sql`trashed` : query.view === "cancelled" ? Prisma.sql`NOT trashed AND cancelled` :
    query.view === "closed" ? Prisma.sql`NOT trashed AND NOT cancelled AND NOT pending` :
    query.view === "pending" ? Prisma.sql`NOT trashed AND pending` : Prisma.sql`NOT trashed`;
  const [result] = await db.$queryRaw<{rows: BatchDashboardRow[]; total: number; totals: BatchDashboard["totals"]}[]>`
    WITH sessions AS (
      SELECT s.*, r.id AS "runId", l.name AS location, p."displayName" AS owner,
        (s."cancelledAt" IS NOT NULL OR s.phase='CANCELLED') AS cancelled,
        (s."trashedAt" IS NOT NULL) AS trashed,
        EXISTS (SELECT 1 FROM "ScannerRun" scan WHERE scan."acquisitionRunId"=r.id AND NOT
          (scan.status IN ('DRAINED','CANCELLED_BEFORE_START') OR scan.status='ERROR' AND scan.outcome IS NOT NULL AND scan.outcome<>'null'::jsonb)) AS draining,
        (l.id IS NOT NULL AND l.active AND NOT l."systemManaged" AND l.kind='NORMAL' AND l."ownerPlayerId"=s."ownerPlayerId") AS "storageAssigned"
      FROM "AcquisitionSession" s JOIN "AcquisitionRun" r ON r."sessionId"=s.id
      JOIN "Player" p ON p.id=s."ownerPlayerId" LEFT JOIN "InventoryLocation" l ON l.id=s."locationId"
      WHERE ${owner} AND s."deletedAt" IS NULL AND r."providerId" IN ('phone-photo-v1','windows-scanner-simplex-v1')
    ), counts AS (
      SELECT s.id, COUNT(c.id)::int AS captured,
        COUNT(c.id) FILTER (WHERE review.confirmed OR checked.status='COMPLETE')::int AS evaluated,
        COUNT(c.id) FILTER (WHERE s."storageAssigned" OR receipt."candidateId" IS NOT NULL)::int AS assigned,
        COUNT(c.id) FILTER (WHERE review.confirmed)::int AS confirmed,
        COUNT(receipt."candidateId")::int AS added,
        COUNT(c.id) FILTER (WHERE receipt."candidateId" IS NULL AND NOT review.confirmed AND checked.status IS DISTINCT FROM 'COMPLETE')::int AS processing,
        COUNT(c.id) FILTER (WHERE receipt."candidateId" IS NULL AND NOT review.confirmed AND EXISTS (
          SELECT 1 FROM "AcquisitionProcessingJob" j WHERE j."artifactId"=artifact.id AND j."candidateId"=c.id AND j."candidateRevision"=c.revision AND j.status='FAILED'
        ))::int AS failed
      FROM sessions s LEFT JOIN "AcquisitionCandidate" c ON c."runId"=s."runId" AND NOT c.excluded
      LEFT JOIN "AcquisitionCommitMember" receipt ON receipt."candidateId"=c.id
      LEFT JOIN "AcquisitionCaptureSlot" slot ON slot.id=c."physicalId" AND slot."runId"=c."runId"
      LEFT JOIN "AcquisitionPhoto" photo ON photo."slotId"=slot.id AND photo.generation=slot.generation AND photo.ready
      LEFT JOIN "AcquisitionArtifact" artifact ON artifact."runId"=c."runId" AND artifact."sourceId"=photo.id
      LEFT JOIN LATERAL (SELECT j.status FROM "AcquisitionProcessingJob" j WHERE j."candidateId"=c.id AND j."artifactId"=artifact.id AND j.stage=${PRINTING_STAGE}
        ORDER BY j."createdAt" DESC,j.id DESC LIMIT 1) checked ON TRUE
      CROSS JOIN LATERAL (SELECT COALESCE(c.review->>'cardId','')<>'' AND COALESCE(c.review->>'language','')<>''
        AND COALESCE(c.review->>'condition','')<>'' AND COALESCE(c.review->>'finish','UNKNOWN')<>'UNKNOWN' AS confirmed) review
      GROUP BY s.id
    ), metrics AS (
      SELECT s.id,s."batchNumber",s.phase,s.cancelled,s.trashed,s.draining,s."updatedAt",s."trashExpiresAt",s.location,s.section,s.owner,
        c.captured,c.evaluated,c.assigned,c.confirmed,c.added,c.processing,c.failed,
        (NOT s.cancelled AND (c.captured>c.added OR s.phase IN ('DRAFT','CAPTURING','PAUSED','STOPPING'))) AS pending
      FROM sessions s JOIN counts c ON c.id=s.id
    ), filtered AS (
      SELECT * FROM metrics WHERE ${filter} AND (${query.q === ""} OR "batchNumber"::text ILIKE ${search}
        OR COALESCE(location,'') ILIKE ${search} OR section ILIKE ${search} OR owner ILIKE ${search})
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM (
      SELECT id,"batchNumber",phase,cancelled,trashed,draining,"updatedAt","trashExpiresAt",location,section,owner,
        captured,evaluated,assigned,confirmed,added,processing,failed,pending FROM filtered
      ORDER BY "updatedAt" DESC,id DESC LIMIT 25 OFFSET ${(query.page - 1) * 25}) page),'[]'::jsonb) AS rows,
      (SELECT COUNT(*)::int FROM filtered) AS total,
      (SELECT jsonb_build_object('batches',COUNT(*),'pending',COUNT(*) FILTER (WHERE pending),
        'captured',COALESCE(SUM(captured),0),'evaluated',COALESCE(SUM(evaluated),0),'assigned',COALESCE(SUM(assigned),0),
        'confirmed',COALESCE(SUM(confirmed),0),'added',COALESCE(SUM(added),0)) FROM metrics WHERE NOT trashed) AS totals
  `;
  return {...result, page: query.page, pages: Math.max(1, Math.ceil(result.total / 25))};
}
