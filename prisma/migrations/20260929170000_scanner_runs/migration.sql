ALTER TABLE "AcquisitionPhoto" ADD COLUMN "sourceMetadata" JSONB;
CREATE TABLE "ScannerRun" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL REFERENCES "ScannerAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "acquisitionRunId" TEXT NOT NULL UNIQUE REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "epoch" TEXT NOT NULL,
  "requestPayload" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "device" JSONB NOT NULL,
  "settings" JSONB NOT NULL,
  "loadedCount" INTEGER NOT NULL CHECK ("loadedCount" BETWEEN 1 AND 500),
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','STARTED','DRAINED','ERROR','RECONCILIATION','CANCELLED_BEFORE_START')),
  "executionId" TEXT,
  "stopRequestedAt" TIMESTAMP(3),
  "outcome" JSONB,
  "reconciliation" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK ("status" IN ('QUEUED','CANCELLED_BEFORE_START') OR "executionId" IS NOT NULL)
);
CREATE INDEX "ScannerRun_agentId_status_createdAt_idx" ON "ScannerRun"("agentId", "status", "createdAt");
CREATE UNIQUE INDEX "ScannerRun_one_active_agent" ON "ScannerRun"("agentId") WHERE "reconciliation" IS NULL;
