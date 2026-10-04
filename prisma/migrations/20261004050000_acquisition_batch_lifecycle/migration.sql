ALTER TABLE "AcquisitionSession"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "trashedAt" TIMESTAMP(3),
  ADD COLUMN "trashExpiresAt" TIMESTAMP(3),
  ADD COLUMN "phaseBeforeTrash" "AcquisitionPhase",
  ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "AcquisitionSession_ownerPlayerId_trashedAt_updatedAt_id_idx"
  ON "AcquisitionSession"("ownerPlayerId", "trashedAt", "updatedAt", "id");
CREATE INDEX "AcquisitionSession_trashExpiresAt_deletedAt_idx"
  ON "AcquisitionSession"("trashExpiresAt", "deletedAt");
