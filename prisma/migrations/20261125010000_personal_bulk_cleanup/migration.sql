ALTER TABLE "User"
  ADD COLUMN "bulkCleanupEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bulkCleanupMaxCopies" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "bulkCleanupIncludeDecks" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bulkCleanupRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User" ADD CONSTRAINT "User_bulkCleanupMaxCopies_check"
  CHECK ("bulkCleanupMaxCopies" BETWEEN 0 AND 1000000);

CREATE TABLE "BulkCleanupAction" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "ownerPlayerId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resultJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BulkCleanupAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BulkCleanupAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BulkCleanupAction_actorUserId_requestId_key" ON "BulkCleanupAction"("actorUserId", "requestId");
CREATE INDEX "BulkCleanupAction_actorUserId_createdAt_id_idx" ON "BulkCleanupAction"("actorUserId", "createdAt", "id");
