ALTER TABLE "ScannerRun" ADD COLUMN "seriesRootId" TEXT,
  ADD COLUMN "seriesOrdinal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "seriesStoppedAt" TIMESTAMP(3);
CREATE INDEX "ScannerRun_seriesRootId_seriesOrdinal_segment_idx"
  ON "ScannerRun"("seriesRootId", "seriesOrdinal", "segment");
