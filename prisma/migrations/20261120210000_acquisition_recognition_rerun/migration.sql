CREATE TABLE "AcquisitionRecognitionRerun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorUserId" TEXT NOT NULL,
  "ownerPlayerId" TEXT,
  "scope" TEXT NOT NULL CHECK ("scope" IN ('MINE','ALL')),
  "requestKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','RUNNING','COMPLETE','CANCELLED')),
  "cursor" TEXT NOT NULL DEFAULT '',
  "queued" INTEGER NOT NULL DEFAULT 0 CHECK ("queued">=0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CHECK (("scope"='MINE' AND "ownerPlayerId" IS NOT NULL) OR ("scope"='ALL' AND "ownerPlayerId" IS NULL))
);
CREATE UNIQUE INDEX "AcquisitionRecognitionRerun_actorUserId_requestKey_key" ON "AcquisitionRecognitionRerun"("actorUserId","requestKey");
CREATE INDEX "AcquisitionRecognitionRerun_actorUserId_scope_createdAt_idx" ON "AcquisitionRecognitionRerun"("actorUserId","scope","createdAt");
CREATE INDEX "AcquisitionRecognitionRerun_status_idx" ON "AcquisitionRecognitionRerun"("status");
CREATE UNIQUE INDEX "AcquisitionRecognitionRerun_one_active" ON "AcquisitionRecognitionRerun"((1)) WHERE "status" IN ('QUEUED','RUNNING');
