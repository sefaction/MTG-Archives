import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrReuseImportResolutionJob,
  isEligibleForAutomaticResolution,
  processImportResolutionJob,
} from "../lib/import-resolution-job";

function makeRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index + 1}`,
    importBatchId: "batch-1",
    rowNumber: index + 1,
    status: "unmatched",
    message: null,
    cardPrintingId: null,
    parsedRowJson: {
      name: "Sol Ring",
      setCode: "cmm",
      collectorNumber: "001",
    },
  }));
}

function makeFakePrisma(rows = makeRows(0)) {
  let jobCounter = 0;
  const jobs: any[] = [];
  const batch = {
    id: "batch-1",
    totalRows: rows.length,
    items: rows,
  };
  const prisma = {
    importResolutionJob: {
      findFirst: async ({ where }: any) =>
        jobs.find(
          (job) =>
            (!where?.importBatchId ||
              job.importBatchId === where.importBatchId) &&
            (!where?.status?.in || where.status.in.includes(job.status)),
        ) ?? null,
      findUnique: async ({ where }: any) =>
        jobs.find((job) => job.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const job = {
          id: `job-${++jobCounter}`,
          processedRows: 0,
          resolvedRows: 0,
          cacheHitRows: 0,
          scryfallMatchRows: 0,
          manualReviewRows: 0,
          notFoundRows: 0,
          transientErrorRows: 0,
          failedRows: 0,
          scryfallRequestsMade: 0,
          scryfallRateLimitWaits: 0,
          currentChunk: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        jobs.push(job);
        return job;
      },
      update: async ({ where, data }: any) => {
        const job = jobs.find((candidate) => candidate.id === where.id);
        if (!job) throw new Error("job not found");
        Object.assign(job, data, { updatedAt: new Date() });
        return job;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const job of jobs) {
          if (where?.importBatchId && job.importBatchId !== where.importBatchId)
            continue;
          if (where?.status && job.status !== where.status) continue;
          Object.assign(job, data);
          count += 1;
        }
        return { count };
      },
    },
    importBatch: {
      findUnique: async () => batch,
    },
    importBatchItem: {
      findMany: async ({ take }: any) =>
        rows
          .filter(
            (row) =>
              row.importBatchId === "batch-1" &&
              row.cardPrintingId === null &&
              ["unmatched", "error", "suggested_match"].includes(row.status),
          )
          .slice(0, take),
      count: async ({ where }: any) =>
        rows.filter(
          (row) =>
            row.importBatchId === where.importBatchId &&
            row.cardPrintingId === null &&
            where.status.in.includes(row.status),
        ).length,
      update: async ({ where, data }: any) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("row not found");
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { prisma, jobs, rows };
}

test("starting resolution creates and then reuses an active job", async () => {
  const { prisma } = makeFakePrisma(makeRows(2));
  const first = await createOrReuseImportResolutionJob({
    prisma: prisma as any,
    importBatchId: "batch-1",
    createdByUserId: "user-1",
  });
  const second = await createOrReuseImportResolutionJob({
    prisma: prisma as any,
    importBatchId: "batch-1",
    createdByUserId: "user-1",
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.job.id, second.job.id);
});

test("a stale job is resumed instead of duplicated", async () => {
  const { prisma, jobs } = makeFakePrisma(makeRows(2));
  const first = await createOrReuseImportResolutionJob({
    prisma: prisma as any,
    importBatchId: "batch-1",
    createdByUserId: "user-1",
  });
  await (prisma as any).importResolutionJob.update({
    where: { id: first.job.id },
    data: { status: "STALE", completedAt: new Date() },
  });
  const resumed = await createOrReuseImportResolutionJob({
    prisma: prisma as any,
    importBatchId: "batch-1",
    createdByUserId: "user-1",
  });
  assert.equal(resumed.created, false);
  assert.equal(resumed.job.id, first.job.id);
  assert.equal(resumed.job.status, "QUEUED");
  assert.equal(jobs.length, 1);
});

test("a 120-row job with batch size 50 completes in three chunks", async () => {
  const { prisma, rows } = makeFakePrisma(makeRows(120));
  const { job } = await createOrReuseImportResolutionJob({
    prisma: prisma as any,
    importBatchId: "batch-1",
    createdByUserId: "user-1",
  });
  let finderCalls = 0;
  const completed = await processImportResolutionJob({
    prisma: prisma as any,
    jobId: job.id,
    config: { batchSize: 50, maxBatchesPerRun: 0 },
    findCard: async () => {
      finderCalls += 1;
      return {
        status: "matched" as const,
        card: { id: "card-1", scryfallId: "scry-1" } as any,
        message: "Matched local card catalog by set and collector number",
        method: "SET_COLLECTOR" as const,
        confidence: 1,
        requestsMade: 0,
        cacheHit: true,
      };
    },
  });

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.currentChunk, 3);
  assert.equal(completed.processedRows, 120);
  assert.equal(completed.resolvedRows, 120);
  assert.equal(
    finderCalls,
    3,
    "duplicate identities are reused within each chunk",
  );
  assert.equal(
    rows.every((row) => row.status === "resolved"),
    true,
  );
});

test("manual-review rows are not automatically eligible", () => {
  assert.equal(
    isEligibleForAutomaticResolution({
      id: "row-1",
      status: "ambiguous",
      message: null,
      cardPrintingId: null,
      parsedRowJson: { name: "Sol Ring" },
    }),
    false,
  );
});
