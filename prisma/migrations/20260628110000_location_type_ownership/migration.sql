ALTER TABLE "LocationType"
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "LocationType_createdByUserId_idx" ON "LocationType"("createdByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LocationType_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "LocationType"
      ADD CONSTRAINT "LocationType_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
