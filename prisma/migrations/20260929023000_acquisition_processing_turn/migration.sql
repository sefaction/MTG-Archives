CREATE TABLE "AcquisitionProcessingTurn" (
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "lastClaimedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcquisitionProcessingTurn_pkey" PRIMARY KEY ("runId", "stage"),
    CONSTRAINT "AcquisitionProcessingTurn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AcquisitionProcessingJob_stage_status_availableAt_runId_idx" ON "AcquisitionProcessingJob"("stage", "status", "availableAt", "runId");
