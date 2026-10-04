BEGIN;
-- Releasing a discarded, finished transfer is not a physical reconciliation.
-- Uncertain outcomes remain under the one-active-agent uniqueness fence.
ALTER TABLE "ScannerRun" ADD COLUMN "admissionReleasedAt" TIMESTAMP(3);
UPDATE "ScannerRun" scan SET "admissionReleasedAt"=CURRENT_TIMESTAMP
FROM "AcquisitionRun" r JOIN "AcquisitionSession" s ON s.id=r."sessionId"
WHERE scan."acquisitionRunId"=r.id AND s."cancelledAt" IS NOT NULL AND
  (scan.status IN ('DRAINED','CANCELLED_BEFORE_START') OR
   scan.status='ERROR' AND scan.outcome IS NOT NULL AND scan.outcome<>'null'::jsonb);
DROP INDEX "ScannerRun_one_active_agent";
CREATE UNIQUE INDEX "ScannerRun_one_active_agent" ON "ScannerRun"("agentId")
  WHERE "reconciliation" IS NULL AND "admissionReleasedAt" IS NULL;
ALTER TABLE "ScannerRun" ADD CONSTRAINT "ScannerRun_released_transfer_is_settled" CHECK (
  "admissionReleasedAt" IS NULL OR status IN ('DRAINED','CANCELLED_BEFORE_START') OR
  status='ERROR' AND outcome IS NOT NULL AND outcome<>'null'::jsonb);
COMMIT;
