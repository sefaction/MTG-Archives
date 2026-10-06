-- AlterTable
ALTER TABLE "AcquisitionPhoto" ADD COLUMN     "correctionCohortId" TEXT,
ADD COLUMN     "correctionControl" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correctionSamplingBasisPoints" INTEGER,
ADD COLUMN     "correctionSamplingEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstMachineEvidence" JSONB;

-- CreateTable
CREATE TABLE "CorrectionLibraryAccount" (
    "ownerPlayerId" TEXT NOT NULL,
    "displayKey" TEXT NOT NULL,
    "limitBytes" BIGINT NOT NULL DEFAULT 64000000000,
    "preservedBytes" BIGINT NOT NULL DEFAULT 0,
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "evidenceBytes" BIGINT NOT NULL DEFAULT 0,
    "cohortId" TEXT NOT NULL,
    "sampleBasisPoints" INTEGER NOT NULL DEFAULT 200,
    "sampleCap" INTEGER NOT NULL DEFAULT 200,
    "selectedControls" INTEGER NOT NULL DEFAULT 0,
    "lastCleanupAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCaptureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrectionLibraryAccount_pkey" PRIMARY KEY ("ownerPlayerId")
);

-- CreateTable
CREATE TABLE "CorrectionBlob" (
    "id" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "reserved" BOOLEAN NOT NULL DEFAULT false,
    "preservedAt" TIMESTAMP(3),
    "deleteClaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionExample" (
    "id" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "blobId" TEXT NOT NULL,
    "sourcePhotoId" TEXT NOT NULL,
    "sourceCandidateId" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "sourceGeneration" INTEGER NOT NULL,
    "physicalCopyGroup" TEXT NOT NULL,
    "sourceMetadata" JSONB,
    "normalControl" BOOLEAN NOT NULL DEFAULT false,
    "cohortId" TEXT,
    "label" JSONB,
    "labelState" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "metadataBytes" INTEGER NOT NULL DEFAULT 0,
    "firstEvidenceId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrectionExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionReviewEvent" (
    "id" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "sourceCandidateId" TEXT NOT NULL,
    "candidateRevision" INTEGER NOT NULL,
    "sourcePhotoId" TEXT,
    "exampleId" TEXT,
    "actorId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "evidenceIds" TEXT[],
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionEvidence" (
    "id" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "sourcePhotoId" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRetentionPin" (
    "id" TEXT NOT NULL,
    "blobId" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionRetentionPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionCaptureOutbox" (
    "id" TEXT NOT NULL,
    "blobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrectionCaptureOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionLibraryAccess" (
    "id" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "exampleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionLibraryAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionBackupGuard" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "CorrectionBackupGuard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Older archive restores can preserve removal intent before this migration.
CREATE TABLE IF NOT EXISTS "CorrectionDeletionTombstone" (
    "ownerPlayerId" TEXT NOT NULL,
    "sourcePhotoId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrectionDeletionTombstone_pkey" PRIMARY KEY ("ownerPlayerId","sourcePhotoId")
);

-- CreateIndex
CREATE INDEX "CorrectionBlob_state_deleteClaimedAt_idx" ON "CorrectionBlob"("state", "deleteClaimedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionBlob_ownerPlayerId_digest_key" ON "CorrectionBlob"("ownerPlayerId", "digest");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionBlob_id_ownerPlayerId_key" ON "CorrectionBlob"("id", "ownerPlayerId");

-- CreateIndex
CREATE INDEX "CorrectionExample_ownerPlayerId_deletedAt_createdAt_id_idx" ON "CorrectionExample"("ownerPlayerId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CorrectionExample_blobId_deletedAt_idx" ON "CorrectionExample"("blobId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionExample_ownerPlayerId_sourcePhotoId_key" ON "CorrectionExample"("ownerPlayerId", "sourcePhotoId");

-- CreateIndex
CREATE INDEX "CorrectionReviewEvent_ownerPlayerId_sourcePhotoId_createdAt_idx" ON "CorrectionReviewEvent"("ownerPlayerId", "sourcePhotoId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CorrectionReviewEvent_exampleId_idx" ON "CorrectionReviewEvent"("exampleId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionReviewEvent_ownerPlayerId_sourceCandidateId_candi_key" ON "CorrectionReviewEvent"("ownerPlayerId", "sourceCandidateId", "candidateRevision");

-- CreateIndex
CREATE INDEX "CorrectionEvidence_ownerPlayerId_sourcePhotoId_idx" ON "CorrectionEvidence"("ownerPlayerId", "sourcePhotoId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionEvidence_ownerPlayerId_bundleHash_key" ON "CorrectionEvidence"("ownerPlayerId", "bundleHash");

-- CreateIndex
CREATE INDEX "CorrectionRetentionPin_sessionId_releasedAt_idx" ON "CorrectionRetentionPin"("sessionId", "releasedAt");

-- CreateIndex
CREATE INDEX "CorrectionRetentionPin_photoId_releasedAt_idx" ON "CorrectionRetentionPin"("photoId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionRetentionPin_blobId_photoId_key" ON "CorrectionRetentionPin"("blobId", "photoId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionCaptureOutbox_blobId_key" ON "CorrectionCaptureOutbox"("blobId");

-- CreateIndex
CREATE INDEX "CorrectionCaptureOutbox_status_availableAt_leaseExpiresAt_idx" ON "CorrectionCaptureOutbox"("status", "availableAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "CorrectionLibraryAccess_ownerPlayerId_createdAt_idx" ON "CorrectionLibraryAccess"("ownerPlayerId", "createdAt");

-- CreateIndex
CREATE INDEX "CorrectionBackupGuard_releasedAt_idx" ON "CorrectionBackupGuard"("releasedAt");

-- AddForeignKey
ALTER TABLE "CorrectionBlob" ADD CONSTRAINT "CorrectionBlob_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "CorrectionLibraryAccount"("ownerPlayerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionExample" ADD CONSTRAINT "CorrectionExample_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "CorrectionLibraryAccount"("ownerPlayerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionExample" ADD CONSTRAINT "CorrectionExample_blobId_ownerPlayerId_fkey" FOREIGN KEY ("blobId", "ownerPlayerId") REFERENCES "CorrectionBlob"("id", "ownerPlayerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionReviewEvent" ADD CONSTRAINT "CorrectionReviewEvent_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "CorrectionLibraryAccount"("ownerPlayerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionEvidence" ADD CONSTRAINT "CorrectionEvidence_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "CorrectionLibraryAccount"("ownerPlayerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRetentionPin" ADD CONSTRAINT "CorrectionRetentionPin_blobId_ownerPlayerId_fkey" FOREIGN KEY ("blobId", "ownerPlayerId") REFERENCES "CorrectionBlob"("id", "ownerPlayerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionCaptureOutbox" ADD CONSTRAINT "CorrectionCaptureOutbox_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "CorrectionBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionLibraryAccess" ADD CONSTRAINT "CorrectionLibraryAccess_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "CorrectionLibraryAccount"("ownerPlayerId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CorrectionLibraryAccount" ADD CONSTRAINT "CorrectionLibraryAccount_bounds" CHECK (
  "limitBytes">0 AND "preservedBytes">=0 AND "reservedBytes">=0 AND "evidenceBytes">=0
  AND "sampleBasisPoints" BETWEEN 0 AND 10000 AND "sampleCap">=0 AND "selectedControls" BETWEEN 0 AND "sampleCap"
  AND "displayKey" ~ '^[a-f0-9]{64}$');
ALTER TABLE "CorrectionBlob" ADD CONSTRAINT "CorrectionBlob_bounds" CHECK (
  "bytes" BETWEEN 1 AND 10485760 AND "digest" ~ '^[a-f0-9]{64}$'
  AND state IN ('PENDING','PRESERVED','DELETING','DELETED'));
ALTER TABLE "CorrectionExample" ADD CONSTRAINT "CorrectionExample_bounds" CHECK (
  "metadataBytes">=0 AND "sourceGeneration">=0 AND "labelState" IN ('UNVERIFIED','WITHDRAWN','REMOVED'));
ALTER TABLE "CorrectionReviewEvent" ADD CONSTRAINT "CorrectionReviewEvent_bounds" CHECK (bytes>=0 AND "candidateRevision">=0);
ALTER TABLE "CorrectionEvidence" ADD CONSTRAINT "CorrectionEvidence_bounds" CHECK (bytes BETWEEN 1 AND 524288);
ALTER TABLE "CorrectionCaptureOutbox" ADD CONSTRAINT "CorrectionCaptureOutbox_bounds" CHECK (attempts>=0 AND
  status IN ('PENDING','WAITING_FOR_SPACE','RUNNING','COMPLETE','REMOVED') AND
  (status='RUNNING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL OR
   status<>'RUNNING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL));
