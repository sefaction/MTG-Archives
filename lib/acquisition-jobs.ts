import { randomUUID } from "node:crypto";
import {
  Prisma,
  type AcquisitionProcessingJob,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { acquisitionRefreshPriority } from "./acquisition-processing-priority";
import { PRINTING_STAGE } from "./acquisition-printing";
import { CATALOG_RECONCILIATION_STAGE } from "./acquisition-catalog-status";
import { VISUAL_STAGE, visualNativeSchema } from "./acquisition-visual";
import { acquisitionAnalysisCandidateFence, acquisitionAnalysisJobSql, acquisitionAnalysisOutputMatches } from "./acquisition-analysis-scope";
import { captureCorrectionPublication } from "./acquisition-correction-library";

// Queue operations are worker-only: never expose these as user-facing routes.
// Handlers return versioned evidence; they must not mutate candidates/inventory.
const optionsSchema = z.object({
  workerId: z.string().min(1).max(100),
  stages: z.array(z.string().min(1).max(200)).min(1).max(10),
  limit: z.number().int().min(1).max(2).default(1),
  leaseMs: z.number().int().min(1000).max(300000).default(60000),
});
export type ClaimedAcquisitionJob = AcquisitionProcessingJob & {
  leaseToken: string;
};
export class AcquisitionJobSupersededError extends Error {}
const active = {
  session: {
    cancelledAt: null, trashedAt: null, deletedAt: null,
    phase: { notIn: ["DRAFT", "CANCELLED"] as ("DRAFT" | "CANCELLED")[] },
    ownerPlayer: { active: true },
    createdByUser: { isActive: true, forcePasswordChange: false },
  },
};

export async function claimAcquisitionJobs(
  db: PrismaClient,
  value: z.input<typeof optionsSchema>,
  now = new Date(),
): Promise<ClaimedAcquisitionJob[]> {
  const options = optionsSchema.parse(value);
  // Count reconciliation, retakes and review can advance the candidate while
  // inference is queued. Retire obsolete attempts before spending native work.
  // A live lease still owns its attempt. Canonical preparation uses immutable
  // photo bytes and deliberately keeps its separate completion fence below.
  await db.$executeRaw`
    UPDATE "AcquisitionProcessingJob" j SET status='SUPERSEDED',
      "leaseToken"=NULL, "leaseExpiresAt"=NULL, "errorCode"='INPUT_CHANGED', "updatedAt"=${now}
    FROM "AcquisitionCandidate" c
    WHERE c.id=j."candidateId" AND j.stage IN (${Prisma.join(options.stages)})
      AND j.stage<>'photo-canonical-v1'
      AND (j.status='PENDING' OR (j.status='RUNNING' AND j."leaseExpiresAt"<=${now}))
      AND (c.revision<>j."candidateRevision" OR NOT ${acquisitionAnalysisJobSql()}
        OR EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id))`;
  // Exhausted crashes become visible failures; no forever-RUNNING rows.
  await db.acquisitionProcessingJob.updateMany({
    where: {
      status: "RUNNING",
      leaseExpiresAt: { lte: now },
      attempts: { gte: db.acquisitionProcessingJob.fields.maxAttempts },
    },
    data: {
      status: "FAILED",
      leaseToken: null,
      leaseExpiresAt: null,
      errorCode: "LEASE_EXHAUSTED",
    },
  });
  const eligible: Prisma.AcquisitionProcessingJobWhereInput = {
    run: active,
    candidate: { receipt: null },
    stage: { in: options.stages },
    attempts: { lt: db.acquisitionProcessingJob.fields.maxAttempts },
    OR: [
      { status: "PENDING", availableAt: { lte: now } },
      { status: "RUNNING", leaseExpiresAt: { lte: now } },
    ],
  };
  // Share this stage across owners before sharing each owner's runs. A single
  // owner's many unfinished batches must not multiply its share of the worker.
  // Derive owner turns from existing durable run turns; no new queue identity.
  // First results precede refreshes within each owner, then rotate equal-priority
  // runs. Keep FIFO within that class and the second head for lease CAS races.
  const priority = acquisitionRefreshPriority(Prisma.sql`j."artifactId"`,
    Prisma.sql`j."candidateId"`, Prisma.sql`j.stage`);
  const candidates = await db.$queryRaw<{id: string; runId: string; stage: string; candidateRevision: number; input: Prisma.JsonValue}[]>`
    WITH eligible_jobs AS (
      SELECT j.id, j."runId", j.stage, j.input, j."candidateRevision", j."availableAt", j."createdAt", s."ownerPlayerId",
        ${priority} AS "refreshPriority"
      FROM "AcquisitionProcessingJob" j
      JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
      JOIN "AcquisitionRun" r ON r.id=j."runId"
      JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      JOIN "Player" p ON p.id=s."ownerPlayerId"
      JOIN "User" u ON u.id=s."createdByUserId"
      WHERE j.stage IN (${Prisma.join(options.stages)}) AND j.attempts<j."maxAttempts"
        AND ((j.status='PENDING' AND j."availableAt"<=${now})
          OR (j.status='RUNNING' AND j."leaseExpiresAt"<=${now}))
        AND s.phase NOT IN ('DRAFT','CANCELLED') AND s."cancelledAt" IS NULL AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL
        AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
        AND (j.stage='photo-canonical-v1' OR
          (c.revision=j."candidateRevision" AND ${acquisitionAnalysisJobSql()}))
        AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=j."candidateId")
    ), ranked AS (
      SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e."runId", e.stage
        ORDER BY e."refreshPriority", e."availableAt", e."createdAt", e.id) AS position
      FROM eligible_jobs e
    ), owner_turns AS (
      SELECT s."ownerPlayerId", t.stage, MAX(t."lastClaimedAt") AS "lastClaimedAt"
      FROM "AcquisitionProcessingTurn" t
      JOIN "AcquisitionRun" r ON r.id=t."runId"
      JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      WHERE t.stage IN (${Prisma.join(options.stages)})
      GROUP BY s."ownerPlayerId", t.stage
    ), heads AS (
      SELECT q.*, COALESCE(t."lastClaimedAt", TIMESTAMP '1970-01-01') AS "runTurn"
      FROM ranked q LEFT JOIN "AcquisitionProcessingTurn" t
        ON t."runId"=q."runId" AND t.stage=q.stage WHERE q.position<=2
    ), shared AS (
      SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h."ownerPlayerId", h.stage
        ORDER BY h."refreshPriority", h."runTurn", h.position, h."availableAt", h."createdAt", h.id) AS "ownerPosition"
      FROM heads h
    )
    SELECT q.id, q."runId", q.stage, q."candidateRevision", q.input FROM shared q
    LEFT JOIN owner_turns t ON t."ownerPlayerId"=q."ownerPlayerId" AND t.stage=q.stage
    ORDER BY COALESCE(t."lastClaimedAt", TIMESTAMP '1970-01-01'), q."ownerPosition",
      q."runTurn", q.position, q."availableAt", q."createdAt", q.id LIMIT 32`;
  const result: ClaimedAcquisitionJob[] = [];
  for (const candidate of candidates) {
    if (result.length >= options.limit) break;
    const leaseToken = `${options.workerId}:${randomUUID()}`;
    const changed = await db.$transaction(async tx => {
      const claimed = await tx.acquisitionProcessingJob.updateMany({
        where: { ...eligible, id: candidate.id, candidateRevision: candidate.candidateRevision,
          candidate: { receipt: null, ...(candidate.stage === "photo-canonical-v1" ? {} : {
            revision: candidate.candidateRevision, excluded: false,
            ...acquisitionAnalysisCandidateFence(candidate.input),
          }) } },
        data: {
          status: "RUNNING", leaseToken,
          leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
          attempts: { increment: 1 }, errorCode: null,
        },
      });
      if (claimed.count) await tx.$executeRaw`
        INSERT INTO "AcquisitionProcessingTurn" ("runId", stage, "lastClaimedAt")
        VALUES (${candidate.runId}, ${candidate.stage}, ${now})
        ON CONFLICT ("runId", stage) DO UPDATE SET "lastClaimedAt"=
          GREATEST("AcquisitionProcessingTurn"."lastClaimedAt", EXCLUDED."lastClaimedAt")`;
      return claimed;
    });
    if (!changed.count) continue;
    // The granted attempt can be retired after its transaction commits. A
    // missing row is no longer work; database failures still propagate.
    const job = await db.acquisitionProcessingJob.findUnique({
      where: { id: candidate.id },
    });
    if (job?.leaseToken === leaseToken)
      result.push(job as ClaimedAcquisitionJob);
  }
  return result;
}
function lease(
  job: ClaimedAcquisitionJob,
  now: Date,
): Prisma.AcquisitionProcessingJobWhereInput {
  return {
    id: job.id,
    status: "RUNNING",
    leaseToken: job.leaseToken,
    leaseExpiresAt: { gt: now },
  };
}
export async function heartbeatAcquisitionJob(
  db: PrismaClient,
  job: ClaimedAcquisitionJob,
  leaseMs = 60000,
  now = new Date(),
) {
  z.number().int().min(1000).max(300000).parse(leaseMs);
  const changed = await db.acquisitionProcessingJob.updateMany({
    where: { ...lease(job, now), run: active },
    data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  return changed.count === 1;
}
export async function completeAcquisitionJob(
  db: PrismaClient,
  job: ClaimedAcquisitionJob,
  output: Prisma.InputJsonObject,
  now = new Date(),
) {
  if (Buffer.byteLength(JSON.stringify(output)) > 65536)
    throw new Error("Processing evidence too large");
  // Compare-and-swap includes the expected candidate revision. Evidence cannot
  // appear current after retakes, count edits or human review changed its input.
  const current = {
    revision: job.candidateRevision,
    excluded: false,
    ...acquisitionAnalysisCandidateFence(job.input),
  };
  return db.$transaction(async (tx) => {
    const run = await tx.acquisitionRun.findUniqueOrThrow({
      where: { id: job.runId },
    });
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${run.sessionId} FOR UPDATE`;
    // Preview bytes belong to an immutable photo, independently of the review
    // revision. Recognition evidence still uses the strict fence below.
    let candidateFence: Prisma.AcquisitionCandidateWhereInput = current;
    let canonicalCurrent = true;
    if (job.stage === VISUAL_STAGE) {
      const input = z.object({photoId: z.string().uuid(), digest: z.string(), model: z.string()}).parse(job.input);
      const scope = z.object({ownerPlayerId: z.string(), inputKind: z.enum(["PHOTO", "CARD_SCAN"])}).safeParse(output.visualReuse);
      const visual = visualNativeSchema.safeParse(output.visual);
      // Legacy synthetic callers omit reuse identity; real new handlers always
      // provide it. A malformed supplied identity cannot bypass owner guards.
      const valid = (output.visualReuse === undefined || scope.success) && visual.success &&
        visual.data.photoDigest === input.digest && visual.data.descriptor === input.model && output.photoId === input.photoId &&
        acquisitionAnalysisOutputMatches(job.input, output, job.stage);
      const completed = await tx.$executeRaw`
        UPDATE "AcquisitionProcessingJob" j SET status='COMPLETE', output=${JSON.stringify(output)}::jsonb,
          "leaseToken"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=clock_timestamp()
        FROM "AcquisitionCandidate" c
        JOIN "AcquisitionRun" r ON r.id=c."runId"
        JOIN "AcquisitionSession" s ON s.id=r."sessionId"
        JOIN "Player" p ON p.id=s."ownerPlayerId"
        JOIN "User" u ON u.id=s."createdByUserId"
        JOIN "AcquisitionPhoto" photo ON photo.id=${input.photoId} AND photo."runId"=r.id
        JOIN "AcquisitionCaptureSlot" slot ON slot.id=photo."slotId"
        WHERE j.id=${job.id} AND j.status='RUNNING' AND j."leaseToken"=${job.leaseToken}
          AND j.stage=${VISUAL_STAGE} AND j."candidateRevision"=${job.candidateRevision}
          AND j."runId"=${job.runId} AND j."candidateId"=${job.candidateId} AND j."artifactId"=${job.artifactId}
          AND j.input=${JSON.stringify(job.input)}::jsonb
          AND j."leaseExpiresAt">clock_timestamp() AND j."runId"=r.id AND j."candidateId"=c.id
          AND c.revision=${job.candidateRevision} AND ${acquisitionAnalysisJobSql()}
          AND s.phase NOT IN ('DRAFT','CANCELLED') AND s."cancelledAt" IS NULL AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
          AND ${valid}
          AND (${!scope.success} OR (s."ownerPlayerId"=${scope.success ? scope.data.ownerPlayerId : ""}
            AND photo."inputKind"::text=${scope.success ? scope.data.inputKind : ""}))
          AND photo.ready AND photo."purgedAt" IS NULL AND photo.digest=${input.digest}
          AND photo."slotId"=c."physicalId" AND photo.generation=slot.generation
          AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)`;
      if (completed) { await captureCorrectionPublication(tx, job, output); return "COMPLETE" as const; }
      const superseded = await tx.$executeRaw`
        UPDATE "AcquisitionProcessingJob" SET status='SUPERSEDED', "leaseToken"=NULL,
          "leaseExpiresAt"=NULL, "errorCode"='INPUT_CHANGED', "updatedAt"=clock_timestamp()
        WHERE id=${job.id} AND status='RUNNING' AND "leaseToken"=${job.leaseToken}
          AND "leaseExpiresAt">clock_timestamp()`;
      return superseded ? "SUPERSEDED" as const : "STALE_LEASE" as const;
    }
    if (job.stage === PRINTING_STAGE) {
      const input = z.object({catalogJobId: z.string().uuid(), photoId: z.string().uuid(), digest: z.string()}).parse(job.input);
      const scope = z.object({ownerPlayerId: z.string()}).safeParse(output.printingReuse);
      // One publication predicate, including the actual database clock. A
      // refreshed catalog (or expired lease while waiting for the session lock)
      // must not turn an earlier handler check into publication authority.
      const completed = await tx.$executeRaw`
        UPDATE "AcquisitionProcessingJob" j SET status='COMPLETE', output=${JSON.stringify(output)}::jsonb,
          "leaseToken"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=clock_timestamp()
        FROM "AcquisitionCandidate" c
        JOIN "AcquisitionRun" r ON r.id=c."runId"
        JOIN "AcquisitionSession" s ON s.id=r."sessionId"
        JOIN "Player" p ON p.id=s."ownerPlayerId"
        JOIN "User" u ON u.id=s."createdByUserId"
        JOIN "AcquisitionPhoto" photo ON photo.id=${input.photoId} AND photo."runId"=r.id
        JOIN "AcquisitionCaptureSlot" slot ON slot.id=photo."slotId"
        JOIN "AcquisitionProcessingJob" source ON source.id=${input.catalogJobId}
        WHERE j.id=${job.id} AND j.status='RUNNING' AND j."leaseToken"=${job.leaseToken}
          AND j.stage=${PRINTING_STAGE} AND j."candidateRevision"=${job.candidateRevision}
          AND j."runId"=${job.runId} AND j."candidateId"=${job.candidateId} AND j."artifactId"=${job.artifactId}
          AND j.input=${JSON.stringify(job.input)}::jsonb
          AND j."leaseExpiresAt">clock_timestamp() AND j."runId"=r.id AND j."candidateId"=c.id
          AND c.revision=${job.candidateRevision} AND ${acquisitionAnalysisJobSql()}
          AND s.phase NOT IN ('DRAFT','CANCELLED') AND s."cancelledAt" IS NULL AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
          AND (${!scope.success} OR s."ownerPlayerId"=${scope.success ? scope.data.ownerPlayerId : ""})
          AND photo.ready AND photo."purgedAt" IS NULL AND photo.digest=${input.digest}
          AND photo."slotId"=c."physicalId" AND photo.generation=slot.generation
          AND source.status='COMPLETE' AND source.stage=${CATALOG_RECONCILIATION_STAGE}
          AND source."runId"=j."runId" AND source."artifactId"=j."artifactId"
          AND source."candidateId"=j."candidateId" AND source."candidateRevision"=${job.candidateRevision}
          AND ${output.sourceCatalogJobId === input.catalogJobId}
          AND ${acquisitionAnalysisOutputMatches(job.input, output, job.stage)}
          AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
          AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer
            WHERE newer.stage=source.stage AND newer."candidateId"=c.id AND newer."candidateRevision"=c.revision
              AND (newer."createdAt",newer.id)>(source."createdAt",source.id))`;
      if (completed) { await captureCorrectionPublication(tx, job, output); return "COMPLETE" as const; }
      const superseded = await tx.$executeRaw`
        UPDATE "AcquisitionProcessingJob" SET status='SUPERSEDED', "leaseToken"=NULL,
          "leaseExpiresAt"=NULL, "errorCode"='INPUT_CHANGED', "updatedAt"=clock_timestamp()
        WHERE id=${job.id} AND status='RUNNING' AND "leaseToken"=${job.leaseToken}
          AND "leaseExpiresAt">clock_timestamp()`;
      return superseded ? "SUPERSEDED" as const : "STALE_LEASE" as const;
    }
    if (job.stage === "photo-canonical-v1") {
      const input = z
        .object({ photoId: z.string().uuid(), digest: z.string() })
        .parse(job.input);
      const photo = await tx.acquisitionPhoto.findUnique({
        where: { id: input.photoId },
        include: { slot: true },
      });
      canonicalCurrent = Boolean(
        photo &&
        photo.ready &&
        !photo.purgedAt &&
        photo.digest === input.digest &&
        photo.runId === job.runId &&
        photo.generation === photo.slot.generation,
      );
      candidateFence = { excluded: false };
    }
    if (job.stage !== "photo-canonical-v1") {
      const [scoped] = await tx.$queryRaw<{id: string}[]>`
        SELECT j.id FROM "AcquisitionProcessingJob" j
        JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
        WHERE j.id=${job.id} AND j.input=${JSON.stringify(job.input)}::jsonb
          AND j."leaseExpiresAt">clock_timestamp() AND ${acquisitionAnalysisJobSql()}`;
      canonicalCurrent = Boolean(scoped) && acquisitionAnalysisOutputMatches(job.input, output, job.stage);
    }
    const completed = await tx.acquisitionProcessingJob.updateMany({
      where: {
        ...lease(job, now),
        ...(canonicalCurrent ? {} : { id: { in: [] } }),
        run: active,
        candidate: { ...candidateFence, receipt: null },
      },
      data: {
        status: "COMPLETE",
        output,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (completed.count) { await captureCorrectionPublication(tx, job, output); return "COMPLETE" as const; }
    const superseded = await tx.acquisitionProcessingJob.updateMany({
      where: lease(job, now),
      data: {
        status: "SUPERSEDED",
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: "INPUT_CHANGED",
      },
    });
    return superseded.count
      ? ("SUPERSEDED" as const)
      : ("STALE_LEASE" as const);
  });
}
export async function failAcquisitionJob(
  db: PrismaClient,
  job: ClaimedAcquisitionJob,
  now = new Date(),
) {
  const exhausted = job.attempts >= job.maxAttempts;
  const changed = await db.acquisitionProcessingJob.updateMany({
    where: lease(job, now),
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      leaseToken: null,
      leaseExpiresAt: null,
      availableAt: new Date(
        now.getTime() + Math.min(60000, 1000 * 2 ** (job.attempts - 1)),
      ),
      errorCode: "PROCESSING_FAILED",
    },
  });
  return changed.count === 1;
}

export type AcquisitionStageHandler = (
  job: ClaimedAcquisitionJob,
  signal: AbortSignal,
) => Promise<Prisma.InputJsonObject>;

// No detached web task owns processing. A separate worker calls this bounded
// tick; durable leases make process exit safe. Adapter timeouts must stop native
// child processes on abort; late handler results have no publication authority.
export async function runAcquisitionJobsOnce(
  db: PrismaClient,
  handlers: Record<string, AcquisitionStageHandler>,
  workerId: string,
  options: { timeoutMs?: number; leaseMs?: number } = {},
) {
  const timeoutMs = z
    .number()
    .int()
    .min(100)
    .max(240000)
    .parse(options.timeoutMs ?? 45000);
  const leaseMs = z
    .number()
    .int()
    .min(timeoutMs + 500)
    .max(300000)
    .parse(options.leaseMs ?? 60000);
  if (!Object.keys(handlers).length)
    return { claimed: 0, complete: 0, failed: 0, superseded: 0 };
  const jobs = await claimAcquisitionJobs(db, {
    workerId,
    stages: Object.keys(handlers),
    leaseMs,
  });
  const result = {
    claimed: jobs.length,
    complete: 0,
    failed: 0,
    superseded: 0,
  };
  for (const job of jobs) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        handlers[job.stage](job, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Processing timeout"));
          }, timeoutMs);
        }),
      ]);
      const state = await completeAcquisitionJob(db, job, output);
      if (state === "COMPLETE") result.complete++;
      else result.superseded++;
    } catch (error) {
      if (error instanceof AcquisitionJobSupersededError) {
        const changed = await db.acquisitionProcessingJob.updateMany({
          where: lease(job, new Date()), data: {status: "SUPERSEDED", leaseToken: null, leaseExpiresAt: null, errorCode: null},
        });
        if (changed.count) result.superseded++;
      } else if (await failAcquisitionJob(db, job)) result.failed++;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
  return result;
}
