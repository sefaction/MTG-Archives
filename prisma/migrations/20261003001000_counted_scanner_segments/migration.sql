-- Each physical feed has its own durable execution/journal identity. Existing
-- runs remain segment zero; their behavior and recovery identity are unchanged.
ALTER TABLE "ScannerRun" ADD COLUMN "physicalTarget" INTEGER,
  ADD COLUMN "sequenceOffset" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "segment" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "counted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ScannerRun" sr SET "physicalTarget" = s.target
FROM "AcquisitionRun" ar JOIN "AcquisitionSession" s ON s.id = ar."sessionId"
WHERE sr."acquisitionRunId" = ar.id;
ALTER TABLE "ScannerRun" DROP CONSTRAINT "ScannerRun_acquisitionRunId_key";
CREATE UNIQUE INDEX "ScannerRun_acquisitionRunId_segment_key" ON "ScannerRun"("acquisitionRunId", "segment");
ALTER TABLE "AcquisitionSession" ADD COLUMN "scannerReserved" INTEGER;
ALTER TABLE "ScannerRun" ADD CONSTRAINT "ScannerRun_counted_segment_bounds"
  CHECK ("segment" >= 0 AND "sequenceOffset" >= 0 AND
    (NOT counted OR ("physicalTarget" IS NOT NULL AND "physicalTarget" BETWEEN 1 AND 5000)));
ALTER TABLE "AcquisitionSession" ADD CONSTRAINT "AcquisitionSession_scanner_reserved_bounds"
  CHECK ("scannerReserved" IS NULL OR "scannerReserved" >= 0);
