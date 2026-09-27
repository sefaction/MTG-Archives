-- CreateEnum
CREATE TYPE "AcquisitionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "AcquisitionCaptureSlot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionCaptureSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionCommand" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionProcessingJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateRevision" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "AcquisitionJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "output" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCaptureSlot_runId_requestKey_key" ON "AcquisitionCaptureSlot"("runId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCaptureSlot_runId_position_key" ON "AcquisitionCaptureSlot"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCommand_runId_requestKey_key" ON "AcquisitionCommand"("runId", "requestKey");

-- CreateIndex
CREATE INDEX "AcquisitionProcessingJob_status_availableAt_leaseExpiresAt__idx" ON "AcquisitionProcessingJob"("status", "availableAt", "leaseExpiresAt", "createdAt");

-- CreateIndex
CREATE INDEX "AcquisitionProcessingJob_runId_idx" ON "AcquisitionProcessingJob"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionProcessingJob_artifactId_candidateId_candidateRe_key" ON "AcquisitionProcessingJob"("artifactId", "candidateId", "candidateRevision", "stage", "versionKey");

-- AddForeignKey
ALTER TABLE "AcquisitionCaptureSlot" ADD CONSTRAINT "AcquisitionCaptureSlot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionCommand" ADD CONSTRAINT "AcquisitionCommand_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionProcessingJob" ADD CONSTRAINT "AcquisitionProcessingJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionProcessingJob" ADD CONSTRAINT "AcquisitionProcessingJob_artifactId_runId_fkey" FOREIGN KEY ("artifactId", "runId") REFERENCES "AcquisitionArtifact"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionProcessingJob" ADD CONSTRAINT "AcquisitionProcessingJob_candidateId_runId_fkey" FOREIGN KEY ("candidateId", "runId") REFERENCES "AcquisitionCandidate"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AcquisitionCaptureSlot" ADD CONSTRAINT "AcquisitionCaptureSlot_position_check" CHECK ("position" >= 0 AND "position" < 300);
ALTER TABLE "AcquisitionProcessingJob" ADD CONSTRAINT "AcquisitionProcessingJob_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 5 AND "attempts" <= "maxAttempts" AND "candidateRevision" >= 0);
ALTER TABLE "AcquisitionProcessingJob" ADD CONSTRAINT "AcquisitionProcessingJob_lease_check" CHECK (("status" = 'RUNNING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("status" <> 'RUNNING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL));
