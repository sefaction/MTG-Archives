import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isAdminUser } from "./auth-policy";
import type { AcquisitionActor } from "./acquisition-store";
import { PRINTING_STAGE } from "./acquisition-printing";
import type {AcquisitionBatchStates} from "./acquisition-batch-state";

export const batchDashboardQuery = z.object({
  view: z.enum(["pending", "all", "closed", "cancelled", "trash"]).catch("pending"),
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().min(1).max(20000).catch(1),
});
export type BatchDashboardRow = {
  id: string; batchNumber: number; phase: string; cancelled: boolean; trashed: boolean;
  updatedAt: string; trashExpiresAt: string | null; location: string | null; section: string;
  owner: string; captured: number; evaluated: number; assigned: number; confirmed: number;
  added: number; ignored: number; processing: number; failed: number; pending: boolean;
  draining: boolean;
  states: AcquisitionBatchStates;
};
export type BatchDashboard = {
  rows: BatchDashboardRow[]; total: number; page: number; pages: number;
  totals: {batches: number; pending: number; captured: number; evaluated: number; assigned: number; confirmed: number; added: number; ignored: number};
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
  const [result] = await db.$queryRaw<{rows: BatchDashboardRow[]; total: number; page: number; totals: BatchDashboard["totals"]}[]>`
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
    ), latest_checks AS (
      -- Resolve the newest printing job once per candidate/artifact. A lateral
      -- sort/limit for every retained card inflates both execution and JIT work
      -- even when this owner has no printing jobs at all.
      SELECT DISTINCT ON (j."candidateId", j."artifactId")
        j."candidateId", j."artifactId", j.status
      FROM "AcquisitionProcessingJob" j JOIN sessions s ON s."runId"=j."runId"
      WHERE j.stage=${PRINTING_STAGE}
      ORDER BY j."candidateId",j."artifactId",j."createdAt" DESC,j.id DESC
    ), failed_checks AS (
      SELECT DISTINCT j."candidateId",j."candidateRevision",j."artifactId"
      FROM "AcquisitionProcessingJob" j JOIN sessions s ON s."runId"=j."runId"
      WHERE j.status='FAILED'
    ), counts AS (
      SELECT s.id, COUNT(c.id)::int AS captured,
        COUNT(c.id) FILTER (WHERE NOT c.ignored AND (review.confirmed OR checked.status='COMPLETE'))::int AS evaluated,
        COUNT(c.id) FILTER (WHERE NOT c.ignored AND (s."storageAssigned" OR receipt."candidateId" IS NOT NULL))::int AS assigned,
        COUNT(c.id) FILTER (WHERE NOT c.ignored AND review.confirmed)::int AS confirmed,
        COUNT(receipt."candidateId")::int AS added,
        COUNT(c.id) FILTER (WHERE c.ignored)::int AS ignored,
        COUNT(c.id) FILTER (WHERE receipt."candidateId" IS NULL AND c.ignored)::int AS "ignoredPending",
        COUNT(c.id) FILTER (WHERE receipt."candidateId" IS NULL AND NOT c.ignored AND review.confirmed)::int AS "confirmedPending",
        COUNT(c.id) FILTER (WHERE receipt."candidateId" IS NULL AND NOT c.ignored AND NOT review.confirmed AND checked.status='COMPLETE')::int AS "evaluatedPending",
        COUNT(c.id) FILTER (WHERE NOT c.ignored AND receipt."candidateId" IS NULL AND NOT review.confirmed AND checked.status IS DISTINCT FROM 'COMPLETE')::int AS processing,
        COUNT(c.id) FILTER (WHERE NOT c.ignored AND receipt."candidateId" IS NULL AND NOT review.confirmed AND failed."candidateId" IS NOT NULL)::int AS failed
      FROM sessions s LEFT JOIN "AcquisitionCandidate" c ON c."runId"=s."runId" AND NOT c.excluded
      LEFT JOIN "AcquisitionCommitMember" receipt ON receipt."candidateId"=c.id
      LEFT JOIN "AcquisitionCaptureSlot" slot ON slot.id=c."physicalId" AND slot."runId"=c."runId"
      LEFT JOIN "AcquisitionPhoto" photo ON photo."slotId"=slot.id AND photo.generation=slot.generation AND photo.ready AND photo.side='FRONT'
      LEFT JOIN "AcquisitionArtifact" artifact ON artifact."runId"=c."runId" AND artifact."sourceId"=photo.id
      LEFT JOIN latest_checks checked ON checked."candidateId"=c.id AND checked."artifactId"=artifact.id
      LEFT JOIN failed_checks failed ON failed."candidateId"=c.id AND failed."artifactId"=artifact.id AND failed."candidateRevision"=c.revision
      CROSS JOIN LATERAL (SELECT COALESCE(c.review->>'cardId','')<>'' AND COALESCE(c.review->>'language','')<>''
        AND COALESCE(c.review->>'condition','')<>'' AND COALESCE(c.review->>'finish','UNKNOWN')<>'UNKNOWN' AS confirmed) review
      GROUP BY s.id
    ), metrics AS (
      SELECT s.id,s."batchNumber",s.phase,s.cancelled,s.trashed,s.draining,s."updatedAt",s."trashExpiresAt",s.location,s.section,s.owner,
        c.captured,c.evaluated,c.assigned,c.confirmed,c.added,c.ignored,c.processing,c.failed,
        jsonb_build_object('queued',c.processing,'evaluated',c."evaluatedPending",
          'confirmed',c."confirmedPending",'inventory',c.added,'ignored',c."ignoredPending") AS states,
        (NOT s.cancelled AND (c.captured>c.added+c.ignored OR s.phase IN ('DRAFT','CAPTURING','PAUSED','STOPPING'))) AS pending
      FROM sessions s JOIN counts c ON c.id=s.id
    ), filtered AS (
      SELECT * FROM metrics WHERE ${filter} AND (${query.q === ""} OR "batchNumber"::text ILIKE ${search}
        OR COALESCE(location,'') ILIKE ${search} OR section ILIKE ${search} OR owner ILIKE ${search})
    ), pagination AS (
      SELECT COUNT(*)::int AS total,
        GREATEST(1, LEAST(${query.page}::int, CEIL(COUNT(*) / 25.0)::int)) AS page FROM filtered
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM (
      SELECT id,"batchNumber",phase,cancelled,trashed,draining,"updatedAt","trashExpiresAt",location,section,owner,
        captured,evaluated,assigned,confirmed,added,ignored,processing,failed,pending,states FROM filtered
      ORDER BY "updatedAt" DESC,id DESC LIMIT 25 OFFSET (SELECT (page - 1) * 25 FROM pagination)) page),'[]'::jsonb) AS rows,
      (SELECT total FROM pagination) AS total, (SELECT page FROM pagination) AS page,
      (SELECT jsonb_build_object('batches',COUNT(*),'pending',COUNT(*) FILTER (WHERE pending),
        'captured',COALESCE(SUM(captured),0),'evaluated',COALESCE(SUM(evaluated),0),'assigned',COALESCE(SUM(assigned),0),
        'confirmed',COALESCE(SUM(confirmed),0),'added',COALESCE(SUM(added),0),'ignored',COALESCE(SUM(ignored),0)) FROM metrics WHERE NOT trashed) AS totals
  `;
  return {...result, pages: Math.max(1, Math.ceil(result.total / 25))};
}
