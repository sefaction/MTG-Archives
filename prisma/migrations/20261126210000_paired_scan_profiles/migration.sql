ALTER TABLE "Card" ALTER COLUMN "scryfallId" DROP NOT NULL;
ALTER TABLE "Card" ADD COLUMN "applicationIdentityKey" TEXT, ADD COLUMN "applicationIdentityKind" TEXT;
CREATE UNIQUE INDEX "Card_applicationIdentityKey_key" ON "Card"("applicationIdentityKey");
CREATE TABLE "ApplicationCardFace" (
  "cardId" TEXT NOT NULL, "position" INTEGER NOT NULL, "sourceCardId" TEXT NOT NULL,
  "sourceFace" INTEGER NOT NULL, "identityKey" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  CONSTRAINT "ApplicationCardFace_pkey" PRIMARY KEY ("cardId","position"),
  CONSTRAINT "ApplicationCardFace_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ApplicationCardFace_sourceCardId_fkey" FOREIGN KEY ("sourceCardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ApplicationCardFace_position_check" CHECK ("position" IN (0,1)),
  CONSTRAINT "ApplicationCardFace_sourceFace_check" CHECK ("sourceFace" IN (0,1))
);
CREATE INDEX "ApplicationCardFace_sourceCardId_idx" ON "ApplicationCardFace"("sourceCardId");
ALTER TABLE "AcquisitionSession" ADD COLUMN "scanProfile" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "AcquisitionCandidate" ADD COLUMN "pairedReview" JSONB;
ALTER TABLE "AcquisitionCaptureSlot" ADD COLUMN "pairingEvidence" JSONB;
ALTER TABLE "AcquisitionPhoto" ADD COLUMN "side" TEXT NOT NULL DEFAULT 'FRONT';
DROP INDEX "AcquisitionPhoto_slotId_generation_key";
CREATE UNIQUE INDEX "AcquisitionPhoto_slotId_generation_side_key" ON "AcquisitionPhoto"("slotId","generation","side");
ALTER TABLE "AcquisitionSession" ADD CONSTRAINT "AcquisitionSession_scanProfile_check" CHECK ("scanProfile" IN ('STANDARD','TOKEN','ART'));
ALTER TABLE "AcquisitionPhoto" ADD CONSTRAINT "AcquisitionPhoto_side_check" CHECK ("side" IN ('FRONT','BACK','UNKNOWN'));

ALTER TABLE "AcquisitionPhoto" ADD COLUMN "captureSlotId" TEXT, ADD COLUMN "captureGeneration" INTEGER;
