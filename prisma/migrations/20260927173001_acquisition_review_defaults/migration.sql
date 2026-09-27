ALTER TABLE "AcquisitionSession" ADD COLUMN "reviewDefaults" JSONB;
ALTER TABLE "AcquisitionSession" ADD COLUMN "defaultsRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AcquisitionSession" ADD CONSTRAINT "AcquisitionSession_defaults_revision" CHECK ("defaultsRevision" >= 0);
