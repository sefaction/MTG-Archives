-- CreateTable
CREATE TABLE "AcquisitionCommit" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionCommit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionCommitMember" (
    "candidateId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "commitId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "AcquisitionCommitMember_pkey" PRIMARY KEY ("candidateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCommit_runId_requestKey_key" ON "AcquisitionCommit"("runId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCommit_id_runId_key" ON "AcquisitionCommit"("id", "runId");

-- CreateIndex
CREATE INDEX "AcquisitionCommitMember_commitId_runId_idx" ON "AcquisitionCommitMember"("commitId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionCommitMember_candidateId_runId_key" ON "AcquisitionCommitMember"("candidateId", "runId");

-- AddForeignKey
ALTER TABLE "AcquisitionCommit" ADD CONSTRAINT "AcquisitionCommit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcquisitionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionCommitMember" ADD CONSTRAINT "AcquisitionCommitMember_candidateId_runId_fkey" FOREIGN KEY ("candidateId", "runId") REFERENCES "AcquisitionCandidate"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionCommitMember" ADD CONSTRAINT "AcquisitionCommitMember_commitId_runId_fkey" FOREIGN KEY ("commitId", "runId") REFERENCES "AcquisitionCommit"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;
