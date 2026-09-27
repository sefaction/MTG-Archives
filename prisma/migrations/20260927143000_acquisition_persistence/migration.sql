-- CreateEnum
CREATE TYPE "AcquisitionPhase" AS ENUM ('DRAFT', 'CAPTURING', 'PAUSED', 'STOPPING', 'COMPLETE', 'CANCELLED');

-- CreateTable
CREATE TABLE "AcquisitionSession" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "intent" TEXT NOT NULL DEFAULT 'ADD_NEW',
    "createdByUserId" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "locationId" TEXT,
    "section" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestPayload" TEXT NOT NULL,
    "placement" JSONB NOT NULL,
    "policy" JSONB NOT NULL,
    "target" INTEGER,
    "phase" "AcquisitionPhase" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "enforcement" TEXT NOT NULL,
    "controls" TEXT[],

    CONSTRAINT "AcquisitionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "sessionRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionArtifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,

    CONSTRAINT "AcquisitionArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "physicalId" TEXT NOT NULL,
    "identityKind" TEXT NOT NULL,
    "acquisitionOrder" INTEGER NOT NULL,
    "spatialOrder" INTEGER NOT NULL,
    "expectedSides" TEXT[],
    "provisional" BOOLEAN NOT NULL,
    "uncertainty" TEXT[],
    "revision" INTEGER NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "countConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "proposal" JSONB,
    "review" JSONB,

    CONSTRAINT "AcquisitionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionObservation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "side" TEXT NOT NULL,

    CONSTRAINT "AcquisitionObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionCountCorrection" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "candidateRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionCountCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcquisitionSession_ownerPlayerId_updatedAt_id_idx" ON "AcquisitionSession"("ownerPlayerId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "AcquisitionSession_locationId_phase_idx" ON "AcquisitionSession"("locationId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionSession_createdByUserId_requestKey_key" ON "AcquisitionSession"("createdByUserId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionRun_sessionId_key" ON "AcquisitionRun"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionEvent_runId_sourceEventId_key" ON "AcquisitionEvent"("runId", "sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionEvent_runId_sessionRevision_key" ON "AcquisitionEvent"("runId", "sessionRevision");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionArtifact_runId_sourceId_key" ON "AcquisitionArtifact"("runId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionArtifact_id_runId_key" ON "AcquisitionArtifact"("id", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCandidate_runId_physicalId_key" ON "AcquisitionCandidate"("runId", "physicalId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCandidate_runId_acquisitionOrder_spatialOrder_key" ON "AcquisitionCandidate"("runId", "acquisitionOrder", "spatialOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCandidate_id_runId_key" ON "AcquisitionCandidate"("id", "runId");

-- CreateIndex
CREATE INDEX "AcquisitionObservation_artifactId_runId_idx" ON "AcquisitionObservation"("artifactId", "runId");

-- CreateIndex
CREATE INDEX "AcquisitionObservation_candidateId_runId_idx" ON "AcquisitionObservation"("candidateId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionObservation_runId_sourceId_key" ON "AcquisitionObservation"("runId", "sourceId");

-- CreateIndex
CREATE INDEX "AcquisitionCountCorrection_runId_idx" ON "AcquisitionCountCorrection"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCountCorrection_candidateId_candidateRevision_key" ON "AcquisitionCountCorrection"("candidateId", "candidateRevision");

-- AddForeignKey
ALTER TABLE "AcquisitionSession" ADD CONSTRAINT "AcquisitionSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionSession" ADD CONSTRAINT "AcquisitionSession_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionSession" ADD CONSTRAINT "AcquisitionSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionRun" ADD CONSTRAINT "AcquisitionRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AcquisitionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionEvent" ADD CONSTRAINT "AcquisitionEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionArtifact" ADD CONSTRAINT "AcquisitionArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionCandidate" ADD CONSTRAINT "AcquisitionCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionObservation" ADD CONSTRAINT "AcquisitionObservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionObservation" ADD CONSTRAINT "AcquisitionObservation_artifactId_runId_fkey" FOREIGN KEY ("artifactId", "runId") REFERENCES "AcquisitionArtifact"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionObservation" ADD CONSTRAINT "AcquisitionObservation_candidateId_runId_fkey" FOREIGN KEY ("candidateId", "runId") REFERENCES "AcquisitionCandidate"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionCountCorrection" ADD CONSTRAINT "AcquisitionCountCorrection_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionCountCorrection" ADD CONSTRAINT "AcquisitionCountCorrection_candidateId_runId_fkey" FOREIGN KEY ("candidateId", "runId") REFERENCES "AcquisitionCandidate"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionCountCorrection" ADD CONSTRAINT "AcquisitionCountCorrection_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve scalar invariants even if a caller bypasses the domain reducer.
ALTER TABLE "AcquisitionSession" ADD CONSTRAINT "AcquisitionSession_contract_check"
  CHECK ("version" = 1 AND "intent" = 'ADD_NEW' AND "revision" >= 0 AND ("target" IS NULL OR "target" >= 0));
ALTER TABLE "AcquisitionCandidate" ADD CONSTRAINT "AcquisitionCandidate_count_check"
  CHECK ("revision" >= 0 AND "acquisitionOrder" >= 0 AND "spatialOrder" >= 0
    AND "identityKind" IN ('NATIVE', 'DETECTION', 'EPISODE'));
ALTER TABLE "AcquisitionObservation" ADD CONSTRAINT "AcquisitionObservation_side_check"
  CHECK ("side" IN ('FRONT', 'BACK', 'UNKNOWN'));
ALTER TABLE "AcquisitionCountCorrection" ADD CONSTRAINT "AcquisitionCountCorrection_action_check"
  CHECK ("candidateRevision" > 0 AND length(trim("reason")) > 0
    AND "action" IN ('CONFIRM_COUNT', 'EXCLUDE_FALSE_DETECTION'));
