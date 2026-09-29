import { randomUUID } from "node:crypto";
import {
  Prisma,
  type AcquisitionProcessingJob,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";

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
  const candidates = await db.acquisitionProcessingJob.findMany({
    where: eligible,
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 32,
  });
  const result: ClaimedAcquisitionJob[] = [];
  for (const candidate of candidates) {
    if (result.length >= options.limit) break;
    const leaseToken = `${options.workerId}:${randomUUID()}`;
    const changed = await db.acquisitionProcessingJob.updateMany({
      where: { ...eligible, id: candidate.id },
      data: {
        status: "RUNNING",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
        attempts: { increment: 1 },
        errorCode: null,
      },
    });
    if (!changed.count) continue;
    const job = await db.acquisitionProcessingJob.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    if (job.leaseToken === leaseToken)
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
    review: { equals: Prisma.DbNull },
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
    if (completed.count) return "COMPLETE" as const;
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
