CREATE TABLE "AcquisitionCatalogRefresh" (
  "id" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "sourceBytes" BIGINT NOT NULL,
  "expectedRows" INTEGER NOT NULL,
  "processedRows" INTEGER NOT NULL DEFAULT 0,
  "createdCards" INTEGER NOT NULL DEFAULT 0,
  "updatedCards" INTEGER NOT NULL DEFAULT 0,
  "preservedCards" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "errorCode" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AcquisitionCatalogRefresh_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AcquisitionCatalogRefresh_progress" CHECK (
    "sourceBytes" > 0 AND "expectedRows" > 0 AND "processedRows" >= 0 AND
    "processedRows" <= "expectedRows" AND "createdCards" >= 0 AND
    "updatedCards" >= 0 AND "preservedCards" >= 0 AND
    "createdCards" + "updatedCards" + "preservedCards" = "processedRows"
  ),
  CONSTRAINT "AcquisitionCatalogRefresh_status" CHECK (
    "status" IN ('RUNNING','FAILED','COMPLETE') AND
    (("status" = 'COMPLETE' AND "processedRows" = "expectedRows" AND "completedAt" IS NOT NULL)
      OR ("status" <> 'COMPLETE' AND "completedAt" IS NULL))
  )
);
CREATE UNIQUE INDEX "AcquisitionCatalogRefresh_sourceDigest_key" ON "AcquisitionCatalogRefresh"("sourceDigest");
CREATE INDEX "AcquisitionCatalogRefresh_status_completedAt_idx" ON "AcquisitionCatalogRefresh"("status", "completedAt");
ALTER TABLE "AcquisitionCatalogRefresh" ADD CONSTRAINT "AcquisitionCatalogRefresh_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
