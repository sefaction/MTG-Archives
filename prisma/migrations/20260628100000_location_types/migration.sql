CREATE TABLE IF NOT EXISTS "LocationType" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LocationType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LocationType_normalizedName_key" ON "LocationType"("normalizedName");
CREATE INDEX IF NOT EXISTS "LocationType_active_name_idx" ON "LocationType"("active", "name");

INSERT INTO "LocationType" ("id", "name", "normalizedName", "createdAt", "updatedAt")
VALUES
  ('loc-type-box', 'Box', 'box', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('loc-type-binder', 'Binder', 'binder', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('loc-type-shelf', 'Shelf', 'shelf', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('loc-type-deckbox', 'Deckbox', 'deckbox', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('loc-type-case', 'Case', 'case', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('loc-type-bulk', 'Bulk', 'bulk', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('loc-type-unassigned', 'Unassigned', 'unassigned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('loc-type-other', 'Other', 'other', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("normalizedName") DO NOTHING;

INSERT INTO "LocationType" ("id", "name", "normalizedName", "createdAt", "updatedAt")
SELECT
  'loc-type-existing-' || md5(normalized),
  name,
  normalized,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT
    trim("type") AS name,
    trim(both '-' from regexp_replace(lower(trim("type")), '[^a-z0-9]+', '-', 'g')) AS normalized
  FROM "InventoryLocation"
  WHERE "type" IS NOT NULL AND trim("type") <> ''
) existing
WHERE normalized <> ''
ON CONFLICT ("normalizedName") DO NOTHING;
