-- Additive and nullable: existing runs deliberately remain unknown.
ALTER TABLE "ScannerRun" ADD COLUMN "helperIdentity" JSONB;
