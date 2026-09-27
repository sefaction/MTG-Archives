-- AlterTable
ALTER TABLE "AcquisitionSession" ADD COLUMN     "batchNumber" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "AcquisitionCaptureSlot" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AcquisitionPhoto" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "uploadKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "AcquisitionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcquisitionPhoto_runId_ready_idx" ON "AcquisitionPhoto"("runId", "ready");

-- CreateIndex
CREATE INDEX "AcquisitionPhoto_purgeAfter_purgedAt_idx" ON "AcquisitionPhoto"("purgeAfter", "purgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionPhoto_runId_uploadKey_key" ON "AcquisitionPhoto"("runId", "uploadKey");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionPhoto_slotId_generation_key" ON "AcquisitionPhoto"("slotId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionSession_batchNumber_key" ON "AcquisitionSession"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCaptureSlot_id_runId_key" ON "AcquisitionCaptureSlot"("id", "runId");

-- AddForeignKey
ALTER TABLE "AcquisitionPhoto" ADD CONSTRAINT "AcquisitionPhoto_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionPhoto" ADD CONSTRAINT "AcquisitionPhoto_slotId_runId_fkey" FOREIGN KEY ("slotId", "runId") REFERENCES "AcquisitionCaptureSlot"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AcquisitionPhoto" ADD CONSTRAINT "AcquisitionPhoto_bounds_check" CHECK ("bytes" BETWEEN 1 AND 10485760 AND "width" BETWEEN 1 AND 12000 AND "height" BETWEEN 1 AND 12000 AND "width"::bigint * "height" <= 36000000 AND "generation" BETWEEN 1 AND 21);
ALTER TABLE "AcquisitionPhoto" ADD CONSTRAINT "AcquisitionPhoto_ready_check" CHECK ("ready" = ("readyAt" IS NOT NULL));
ALTER TABLE "AcquisitionCaptureSlot" ADD CONSTRAINT "AcquisitionCaptureSlot_generation_check" CHECK ("generation" BETWEEN 0 AND 21);
