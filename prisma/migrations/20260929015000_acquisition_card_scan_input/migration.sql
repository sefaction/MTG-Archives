CREATE TYPE "AcquisitionImageInputKind" AS ENUM ('PHOTO', 'CARD_SCAN');
ALTER TABLE "AcquisitionPhoto" ADD COLUMN "inputKind" "AcquisitionImageInputKind" NOT NULL DEFAULT 'PHOTO';
