import { ImportResolutionJob, PrismaClient } from "@prisma/client";

import { findOrImportCard } from "./card-import";

export const ACTIVE_IMPORT_RESOLUTION_STATUSES = ["QUEUED", "RUNNING"];
export const TERMINAL_IMPORT_RESOLUTION_STATUSES = [
  "COMPLETED",
  "COMPLETED_WITH_REVIEW",
  "FAILED",
  "CANCELLED",
  "STALE",
];

export type ImportResolutionJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_REVIEW"
  | "FAILED"
  | "CANCELLED"
  | "STALE";

export type ImportResolutionJobConfig = {
  batchSize: number;
  maxBatchesPerRun: number;
  pollIntervalMs: number;
  staleJobTimeoutMinutes: number;
};

export type ParsedImportRowForResolution = {
  name?: string;
  setCode?: string;
  collectorNumber?: string;
  scryfallId?: string;
};

export type ResolutionRow = {
  id: string;
  status: string;
  message: string | null;
  cardPrintingId: string | null;
  parsedRowJson: unknown;
};

export type ResolutionAttemptRecorder = (
  item: {
    id: string;
    status: string;
    message: string | null;
    parsedRowJson: unknown;
  },
  mode: string,
  nextStatus: string,
  method: string,
  confidence: string,
  queryUsed: string | null,
  message: string,
  cardId?: string | null,
  scryfallId?: string | null,
  candidates?: unknown,
  error?: unknown,
) => Promise<void>;

export type ResolutionJobProcessorOptions = {
  prisma: PrismaClient;
  jobId: string;
  config?: Partial<ImportResolutionJobConfig>;
  findCard?: typeof findOrImportCard;
  recordAttempt?: ResolutionAttemptRecorder;
  buildQuery?: (row: ParsedImportRowForResolution) => string;
  recalculateBatchCounts?: (batchId: string) => Promise<void>;
  logger?: Pick<typeof console, "error" | "warn" | "log">;
};

export function getImportResolutionJobConfig(): ImportResolutionJobConfig {
  return {
    batchSize: positiveInt(process.env.IMPORT_RESOLVE_BATCH_SIZE, 50),
    maxBatchesPerRun: nonNegativeInt(
      process.env.IMPORT_RESOLVE_MAX_BATCHES_PER_RUN,
      0,
    ),
    pollIntervalMs: positiveInt(
      process.env.IMPORT_RESOLVE_POLL_INTERVAL_MS,
      1500,
    ),
    staleJobTimeoutMinutes: positiveInt(
      process.env.IMPORT_RESOLVE_STALE_JOB_TIMEOUT_MINUTES,
      15,
    ),
  };
}

export function isActiveImportResolutionStatus(status: string) {
  return ACTIVE_IMPORT_RESOLUTION_STATUSES.includes(status);
}

export function isTerminalImportResolutionStatus(status: string) {
  return TERMINAL_IMPORT_RESOLUTION_STATUSES.includes(status);
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function isRetryableResolutionStatus(status: string) {
  return ["unmatched", "error", "suggested_match"].includes(status);
}

export function hasDeterministicResolutionInput(
  row: ParsedImportRowForResolution,
) {
  return Boolean(
    row.scryfallId?.trim() ||
    (row.setCode?.trim() && row.collectorNumber?.trim()) ||
    (row.setCode?.trim() && row.name?.trim()),
  );
}

export function isEligibleForAutomaticResolution(item: ResolutionRow) {
  if (item.cardPrintingId) return false;
  if (!isRetryableResolutionStatus(item.status)) return false;
  const parsed = (item.parsedRowJson || {}) as ParsedImportRowForResolution;
  if (!parsed.name?.trim() && !parsed.scryfallId?.trim()) return false;
  return hasDeterministicResolutionInput(parsed);
}

export function resolutionMethodFromMatch(
  match: Awaited<ReturnType<typeof findOrImportCard>>,
) {
  return match.method?.toLowerCase() ?? "unresolved";
}

export function confidenceFromMatch(
  match: Awaited<ReturnType<typeof findOrImportCard>>,
) {
  if (match.confidence !== undefined) return String(match.confidence);
  if (match.status === "matched" || match.status === "new") return "high";
  if (match.status === "ambiguous") return "low";
  return "low";
}

function rowIdentityKey(item: ResolutionRow) {
  const parsed = (item.parsedRowJson || {}) as ParsedImportRowForResolution;
  return JSON.stringify({
    scryfallId: parsed.scryfallId?.trim() || null,
    name: parsed.name?.trim().toLowerCase() || null,
    setCode: parsed.setCode?.trim().toLowerCase() || null,
    collectorNumber: parsed.collectorNumber?.trim() || null,
  });
}

function toNextStatus(match: Awaited<ReturnType<typeof findOrImportCard>>) {
  if (match.status === "matched" || match.status === "new") return "resolved";
  if (match.status === "unmatched" && !match.retryable) return "not_found";
  return match.status;
}

function terminalStatusForCounts(counts: {
  manualReviewRows: number;
  failedRows: number;
  transientErrorRows: number;
}) {
  if (counts.transientErrorRows > 0 || counts.failedRows > 0) return "FAILED";
  if (counts.manualReviewRows > 0) return "COMPLETED_WITH_REVIEW";
  return "COMPLETED";
}

export async function getLatestImportResolutionJob(
  prisma: PrismaClient,
  importBatchId: string,
) {
  return prisma.importResolutionJob.findFirst({
    where: { importBatchId },
    orderBy: { createdAt: "desc" },
  });
}

export async function markStaleImportResolutionJobs(
  prisma: PrismaClient,
  importBatchId: string,
  config = getImportResolutionJobConfig(),
) {
  const cutoff = new Date(
    Date.now() - config.staleJobTimeoutMinutes * 60 * 1000,
  );
  await prisma.importResolutionJob.updateMany({
    where: {
      importBatchId,
      status: "RUNNING",
      OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: cutoff } }],
    },
    data: {
      status: "STALE",
      completedAt: new Date(),
      currentMessage:
        "Resolution job became stale before completion. Resume to continue remaining rows.",
      errorSummary: "Last heartbeat exceeded stale-job timeout.",
    },
  });
}

export async function createOrReuseImportResolutionJob({
  prisma,
  importBatchId,
  createdByUserId,
  config = getImportResolutionJobConfig(),
}: {
  prisma: PrismaClient;
  importBatchId: string;
  createdByUserId?: string | null;
  config?: ImportResolutionJobConfig;
}) {
  await markStaleImportResolutionJobs(prisma, importBatchId, config);
  const active = await prisma.importResolutionJob.findFirst({
    where: {
      importBatchId,
      status: { in: ACTIVE_IMPORT_RESOLUTION_STATUSES },
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) return { job: active, created: false };

  const resumable = await prisma.importResolutionJob.findFirst({
    where: { importBatchId, status: { in: ["FAILED", "STALE"] } },
    orderBy: { createdAt: "desc" },
  });
  if (resumable) {
    const job = await prisma.importResolutionJob.update({
      where: { id: resumable.id },
      data: {
        status: "QUEUED",
        completedAt: null,
        errorSummary: null,
        currentMessage:
          "Resolution job resumed. Already resolved rows will be skipped.",
      },
    });
    return { job, created: false };
  }

  const batch = await prisma.importBatch.findUnique({
    where: { id: importBatchId },
    include: { items: true },
  });
  if (!batch) throw new Error("Import batch not found.");
  const unresolved = batch.items.filter(
    (item) => !item.cardPrintingId && isRetryableResolutionStatus(item.status),
  );
  const eligible = unresolved.filter(isEligibleForAutomaticResolution);

  try {
    const job = await prisma.importResolutionJob.create({
      data: {
        importBatchId,
        totalRows: batch.totalRows || batch.items.length,
        unresolvedRowsAtStart: unresolved.length,
        eligibleRowsAtStart: eligible.length,
        createdByUserId: createdByUserId ?? null,
        status: "QUEUED",
        currentMessage: eligible.length
          ? `Queued ${eligible.length} rows for automatic resolution.`
          : "No automatically resolvable rows are currently available.",
      },
    });
    return { job, created: true };
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.importResolutionJob.findFirst({
        where: {
          importBatchId,
          status: { in: ACTIVE_IMPORT_RESOLUTION_STATUSES },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { job: existing, created: false };
    }
    throw error;
  }
}

export async function cancelImportResolutionJob(
  prisma: PrismaClient,
  jobId: string,
) {
  return prisma.importResolutionJob.update({
    where: { id: jobId },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      currentMessage: "Resolution was cancelled.",
    },
  });
}

export function serializeImportResolutionJob(job: ImportResolutionJob | null) {
  if (!job) return null;
  const terminal = isTerminalImportResolutionStatus(job.status);
  const total = job.eligibleRowsAtStart || job.unresolvedRowsAtStart || 0;
  const processed = job.processedRows;
  const percent = total ? Math.round((processed / total) * 100) : 100;
  return {
    id: job.id,
    importBatchId: job.importBatchId,
    status: job.status,
    totalRows: job.totalRows,
    unresolvedRowsAtStart: job.unresolvedRowsAtStart,
    eligibleRowsAtStart: job.eligibleRowsAtStart,
    processedRows: job.processedRows,
    resolvedRows: job.resolvedRows,
    cacheHitRows: job.cacheHitRows,
    scryfallMatchRows: job.scryfallMatchRows,
    manualReviewRows: job.manualReviewRows,
    notFoundRows: job.notFoundRows,
    transientErrorRows: job.transientErrorRows,
    failedRows: job.failedRows,
    scryfallRequestsMade: job.scryfallRequestsMade,
    scryfallRateLimitWaits: job.scryfallRateLimitWaits,
    currentChunk: job.currentChunk,
    currentMessage: job.currentMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    lastHeartbeatAt: job.lastHeartbeatAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    errorSummary: job.errorSummary,
    terminal,
    percent,
  };
}

export async function processImportResolutionJob({
  prisma,
  jobId,
  config: configInput,
  findCard = findOrImportCard,
  recordAttempt,
  buildQuery = () => "",
  recalculateBatchCounts,
  logger = console,
}: ResolutionJobProcessorOptions) {
  const config = { ...getImportResolutionJobConfig(), ...configInput };
  const startedAt = new Date();
  let job = await prisma.importResolutionJob.findUnique({
    where: { id: jobId },
  });
  if (!job) throw new Error("Import resolution job not found.");
  if (
    ["COMPLETED", "COMPLETED_WITH_REVIEW", "CANCELLED"].includes(job.status)
  ) {
    return job;
  }

  job = await prisma.importResolutionJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      startedAt: job.startedAt ?? startedAt,
      lastHeartbeatAt: startedAt,
      completedAt: null,
      errorSummary: null,
      currentMessage: "Resolution started.",
    },
  });

  const counters = {
    processedRows: job.processedRows,
    resolvedRows: job.resolvedRows,
    cacheHitRows: job.cacheHitRows,
    scryfallMatchRows: job.scryfallMatchRows,
    manualReviewRows: job.manualReviewRows,
    notFoundRows: job.notFoundRows,
    transientErrorRows: job.transientErrorRows,
    failedRows: job.failedRows,
    scryfallRequestsMade: job.scryfallRequestsMade,
    scryfallRateLimitWaits: job.scryfallRateLimitWaits,
    currentChunk: job.currentChunk,
  };

  try {
    let chunksThisRun = 0;
    for (;;) {
      const current = await prisma.importResolutionJob.findUnique({
        where: { id: jobId },
      });
      if (!current || current.status === "CANCELLED") {
        return current ?? job;
      }
      if (
        config.maxBatchesPerRun > 0 &&
        chunksThisRun >= config.maxBatchesPerRun
      ) {
        return prisma.importResolutionJob.update({
          where: { id: jobId },
          data: {
            status: "STALE",
            completedAt: new Date(),
            lastHeartbeatAt: new Date(),
            currentMessage: `Stopped after ${chunksThisRun} chunks because IMPORT_RESOLVE_MAX_BATCHES_PER_RUN is set. Resume to continue.`,
          },
        });
      }

      const nextRows = (await prisma.importBatchItem.findMany({
        where: {
          importBatchId: current.importBatchId,
          cardPrintingId: null,
          status: { in: ["unmatched", "error", "suggested_match"] },
        },
        orderBy: { rowNumber: "asc" },
        take: config.batchSize,
      })) as ResolutionRow[];
      const eligibleRows = nextRows.filter(isEligibleForAutomaticResolution);

      if (!eligibleRows.length) {
        const manualReviewRows = await prisma.importBatchItem.count({
          where: {
            importBatchId: current.importBatchId,
            cardPrintingId: null,
            status: {
              in: ["ambiguous", "unmatched", "error", "suggested_match"],
            },
          },
        });
        const status = terminalStatusForCounts({
          manualReviewRows,
          failedRows: counters.failedRows,
          transientErrorRows: counters.transientErrorRows,
        });
        const completed = await prisma.importResolutionJob.update({
          where: { id: jobId },
          data: {
            status,
            manualReviewRows,
            completedAt: new Date(),
            lastHeartbeatAt: new Date(),
            currentMessage:
              status === "COMPLETED"
                ? "Resolution completed. No automatically resolvable rows remain."
                : `Automatic resolution finished. ${manualReviewRows} rows need manual review.`,
          },
        });
        if (recalculateBatchCounts)
          await recalculateBatchCounts(completed.importBatchId);
        return completed;
      }

      counters.currentChunk += 1;
      chunksThisRun += 1;
      const firstRow = eligibleRows[0];
      const lastRow = eligibleRows[eligibleRows.length - 1];
      await prisma.importResolutionJob.update({
        where: { id: jobId },
        data: {
          currentChunk: counters.currentChunk,
          lastHeartbeatAt: new Date(),
          currentMessage: `Processing rows ${firstRow.id === lastRow.id ? "" : "in chunk "}${counters.currentChunk}.`,
        },
      });

      const matchCache = new Map<
        string,
        Awaited<ReturnType<typeof findCard>>
      >();
      for (const item of eligibleRows) {
        const parsed = (item.parsedRowJson ||
          {}) as ParsedImportRowForResolution;
        const queryUsed = buildQuery(parsed);
        try {
          const cacheKey = rowIdentityKey(item);
          let match = matchCache.get(cacheKey);
          if (!match) {
            match = await findCard(parsed as any);
            matchCache.set(cacheKey, match);
          }
          const nextStatus = toNextStatus(match);
          counters.processedRows += 1;
          counters.scryfallRequestsMade += match.requestsMade ?? 0;
          if (match.cacheHit) counters.cacheHitRows += 1;
          if ((match.requestsMade ?? 0) > 0 && match.card)
            counters.scryfallMatchRows += 1;
          if (nextStatus === "resolved") counters.resolvedRows += 1;
          if (nextStatus === "ambiguous") counters.manualReviewRows += 1;
          if (nextStatus === "not_found") counters.notFoundRows += 1;
          if (nextStatus === "unmatched" && match.retryable)
            counters.transientErrorRows += 1;

          if (recordAttempt) {
            await recordAttempt(
              item,
              "job_resolve",
              nextStatus,
              resolutionMethodFromMatch(match),
              confidenceFromMatch(match),
              queryUsed,
              match.message,
              match.card?.id,
              match.card?.scryfallId ?? null,
            );
          }
          await prisma.importBatchItem.update({
            where: { id: item.id },
            data: {
              status: nextStatus,
              message: match.message,
              cardPrintingId: match.card?.id ?? item.cardPrintingId,
            },
          });
        } catch (error) {
          counters.processedRows += 1;
          counters.failedRows += 1;
          const message =
            "Resolution failed while saving matched card data. No inventory was committed.";
          logger.error("[import-resolution-job] row failed", {
            jobId,
            importBatchId: job.importBatchId,
            rowId: item.id,
            chunk: counters.currentChunk,
            error,
          });
          if (recordAttempt) {
            await recordAttempt(
              item,
              "job_resolve",
              "error",
              "unresolved",
              "low",
              queryUsed,
              message,
              null,
              null,
              null,
              error,
            );
          }
          await prisma.importBatchItem.update({
            where: { id: item.id },
            data: { status: "error", message },
          });
        }
      }

      await prisma.importResolutionJob.update({
        where: { id: jobId },
        data: {
          ...counters,
          lastHeartbeatAt: new Date(),
          currentMessage: `${counters.resolvedRows} resolved · ${counters.cacheHitRows} cache hits · ${counters.scryfallMatchRows} Scryfall matches · ${counters.manualReviewRows} need review.`,
        },
      });
      if (recalculateBatchCounts)
        await recalculateBatchCounts(job.importBatchId);
    }
  } catch (error) {
    logger.error("[import-resolution-job] job failed", {
      jobId,
      importBatchId: job.importBatchId,
      chunk: counters.currentChunk,
      error,
    });
    return prisma.importResolutionJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        lastHeartbeatAt: new Date(),
        errorSummary: error instanceof Error ? error.message : String(error),
        currentMessage:
          "Resolution failed unexpectedly. Completed rows were preserved and the job can be resumed.",
      },
    });
  }
}
