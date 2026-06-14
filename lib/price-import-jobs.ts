import { Prisma } from "@prisma/client";
import os from "node:os";
import { prisma } from "./prisma";
import {
  importMtgjsonPrices,
  mapMtgjsonCards,
  type MtgjsonImportProgress,
} from "./mtgjson-prices";

export const PRICE_IMPORT_JOB_TYPES = [
  "map_mtgjson_cards",
  "import_prices_today",
  "import_prices_history",
] as const;
export type PriceImportJobType = (typeof PRICE_IMPORT_JOB_TYPES)[number];
export const ACTIVE_PRICE_JOB_STATUSES = ["queued", "running"] as const;
export const PRICE_WORKER_STALE_AFTER_MS = 2 * 60 * 1000;

export function isPriceImportJobType(value: unknown): value is PriceImportJobType {
  return PRICE_IMPORT_JOB_TYPES.includes(value as PriceImportJobType);
}

export function priceJobLabel(type: string) {
  if (type === "map_mtgjson_cards") return "Map MTGJSON card UUIDs";
  if (type === "import_prices_today") return "Import today's prices";
  if (type === "import_prices_history") return "Backfill price history";
  return type;
}

export async function createPriceImportJob(
  type: PriceImportJobType,
  requestedById?: string | null,
  db: Pick<Prisma.TransactionClient, "priceImportJob"> = prisma,
) {
  const existing = await db.priceImportJob.findFirst({
    where: { status: { in: [...ACTIVE_PRICE_JOB_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return { job: existing, existing: true };
  const job = await db.priceImportJob.create({
    data: {
      type,
      status: "queued",
      requestedById: requestedById || null,
      source:
        type === "import_prices_today"
          ? "today"
          : type === "import_prices_history"
            ? "history"
            : null,
      progressJson: { phase: "queued" },
    },
  });
  return { job, existing: false };
}

export async function listPriceImportJobs(
  db: Pick<Prisma.TransactionClient, "priceImportJob"> = prisma,
  take = 10,
) {
  return db.priceImportJob.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { requestedBy: { select: { displayName: true, username: true } } },
  });
}

export async function listPriceWorkerHeartbeats(
  db: Pick<Prisma.TransactionClient, "priceWorkerHeartbeat"> = prisma,
  take = 5,
) {
  return db.priceWorkerHeartbeat.findMany({
    take,
    orderBy: { lastSeenAt: "desc" },
  });
}

export function isPriceWorkerHeartbeatFresh(
  heartbeat: { lastSeenAt: Date | string } | null | undefined,
  now = new Date(),
) {
  if (!heartbeat) return false;
  const lastSeenAt =
    heartbeat.lastSeenAt instanceof Date
      ? heartbeat.lastSeenAt
      : new Date(heartbeat.lastSeenAt);
  return now.getTime() - lastSeenAt.getTime() <= PRICE_WORKER_STALE_AFTER_MS;
}

export async function updatePriceWorkerHeartbeat(
  workerId: string,
  db: Pick<Prisma.TransactionClient, "priceWorkerHeartbeat"> = prisma,
) {
  const now = new Date();
  return db.priceWorkerHeartbeat.upsert({
    where: { workerId },
    update: {
      lastSeenAt: now,
      hostname: os.hostname(),
      version: process.env.npm_package_version || null,
    },
    create: {
      workerId,
      startedAt: now,
      lastSeenAt: now,
      hostname: os.hostname(),
      version: process.env.npm_package_version || null,
    },
  });
}

export async function claimNextPriceImportJob(
  workerId: string,
  db: Pick<Prisma.TransactionClient, "priceImportJob"> = prisma,
) {
  const queued = await db.priceImportJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!queued) return null;
  const claimed = await db.priceImportJob.updateMany({
    where: { id: queued.id, status: "queued" },
    data: {
      status: "running",
      startedAt: new Date(),
      heartbeatAt: new Date(),
      progressJson: { phase: "claimed", workerId },
    },
  });
  if (claimed.count !== 1) return null;
  const job = await db.priceImportJob.findUnique({ where: { id: queued.id } });
  if (job) console.info(`[price-worker] claimed job ${job.id} type ${job.type}`);
  return job;
}

export async function updatePriceImportJobProgress(
  jobId: string,
  progress: MtgjsonImportProgress,
  db: Pick<Prisma.TransactionClient, "priceImportJob"> = prisma,
) {
  await db.priceImportJob.update({
    where: { id: jobId },
    data: { progressJson: progress as any, heartbeatAt: new Date() },
  });
}

export async function runPriceImportJob(
  job: { id: string; type: string },
  db: Pick<Prisma.TransactionClient, "priceImportJob" | "card" | "cardPriceSnapshot"> = prisma,
) {
  try {
    let result: unknown;
    const onProgress = (progress: MtgjsonImportProgress) =>
      updatePriceImportJobProgress(job.id, progress, db);
    if (job.type === "map_mtgjson_cards") {
      result = await mapMtgjsonCards(db, { onProgress });
    } else if (job.type === "import_prices_today") {
      result = await importMtgjsonPrices(db, "today", { onProgress });
    } else if (job.type === "import_prices_history") {
      result = await importMtgjsonPrices(db, "history", { onProgress });
    } else {
      throw new Error(`Unsupported price import job type: ${job.type}`);
    }
    await db.priceImportJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        heartbeatAt: new Date(),
        resultJson: result as any,
        errorMessage: null,
      },
    });
    console.info(`[price-worker] succeeded job ${job.id}`);
    return result;
  } catch (error: any) {
    await db.priceImportJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        heartbeatAt: new Date(),
        errorMessage: String(error?.message || error),
      },
    });
    console.error(`[price-worker] failed job ${job.id}: ${String(error?.message || error)}`);
    throw error;
  }
}

export async function runOnePriceImportJob(workerId: string) {
  const job = await claimNextPriceImportJob(workerId);
  if (!job) return null;
  await runPriceImportJob(job);
  return job;
}
