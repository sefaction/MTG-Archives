CREATE TABLE IF NOT EXISTS "ImportResolutionJob" (
  "id" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "unresolvedRowsAtStart" INTEGER NOT NULL DEFAULT 0,
  "eligibleRowsAtStart" INTEGER NOT NULL DEFAULT 0,
  "processedRows" INTEGER NOT NULL DEFAULT 0,
  "resolvedRows" INTEGER NOT NULL DEFAULT 0,
  "cacheHitRows" INTEGER NOT NULL DEFAULT 0,
  "scryfallMatchRows" INTEGER NOT NULL DEFAULT 0,
  "manualReviewRows" INTEGER NOT NULL DEFAULT 0,
  "notFoundRows" INTEGER NOT NULL DEFAULT 0,
  "transientErrorRows" INTEGER NOT NULL DEFAULT 0,
  "failedRows" INTEGER NOT NULL DEFAULT 0,
  "scryfallRequestsMade" INTEGER NOT NULL DEFAULT 0,
  "scryfallRateLimitWaits" INTEGER NOT NULL DEFAULT 0,
  "currentChunk" INTEGER NOT NULL DEFAULT 0,
  "currentMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorSummary" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportResolutionJob_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ImportResolutionJob"
    ADD CONSTRAINT "ImportResolutionJob_importBatchId_fkey"
    FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ImportResolutionJob"
    ADD CONSTRAINT "ImportResolutionJob_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ImportResolutionJob_importBatchId_status_idx" ON "ImportResolutionJob"("importBatchId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "ImportResolutionJob_one_active_per_batch_idx"
  ON "ImportResolutionJob"("importBatchId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
