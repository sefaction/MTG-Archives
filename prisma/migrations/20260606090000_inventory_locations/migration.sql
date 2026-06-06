CREATE TABLE IF NOT EXISTS "InventoryLocation" (
  "id" TEXT NOT NULL,
  "ownerPlayerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "InventoryLocation"
    ADD CONSTRAINT "InventoryLocation_ownerPlayerId_fkey"
    FOREIGN KEY ("ownerPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLocation_ownerPlayerId_normalizedName_key"
  ON "InventoryLocation"("ownerPlayerId", "normalizedName");
CREATE INDEX IF NOT EXISTS "InventoryLocation_ownerPlayerId_active_idx"
  ON "InventoryLocation"("ownerPlayerId", "active");

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

INSERT INTO "InventoryLocation" ("id", "ownerPlayerId", "name", "normalizedName", "description", "type", "active", "createdAt", "updatedAt")
SELECT 'loc_' || replace(p."id", '-', '_') || '_unassigned', p."id", 'Unassigned', 'unassigned', 'Default location for inventory without a known physical location.', 'Unassigned', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Player" p
WHERE EXISTS (SELECT 1 FROM "InventoryItem" i WHERE i."currentOwnerId" = p."id")
ON CONFLICT ("ownerPlayerId", "normalizedName") DO NOTHING;

UPDATE "InventoryItem" i
SET "locationId" = l."id"
FROM "InventoryLocation" l
WHERE i."locationId" IS NULL
  AND l."ownerPlayerId" = i."currentOwnerId"
  AND l."normalizedName" = 'unassigned';

DO $$ BEGIN
  ALTER TABLE "InventoryItem"
    ADD CONSTRAINT "InventoryItem_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS "InventoryItem_currentOwnerId_originalOpenerId_cardId_foil_condition_roundId_key";
CREATE INDEX IF NOT EXISTS "InventoryItem_currentOwnerId_cardId_foilStatus_condition_language_idx"
  ON "InventoryItem"("currentOwnerId", "cardId", "foilStatus", "condition", "language");
CREATE INDEX IF NOT EXISTS "InventoryItem_locationId_idx" ON "InventoryItem"("locationId");
