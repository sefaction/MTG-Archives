ALTER TABLE "InventoryLocation"
  ADD COLUMN "parentLocationId" TEXT;

DROP INDEX IF EXISTS "InventoryLocation_ownerPlayerId_normalizedName_key";

CREATE UNIQUE INDEX "InventoryLocation_owner_root_name_key"
  ON "InventoryLocation"("ownerPlayerId", "normalizedName")
  WHERE "parentLocationId" IS NULL;

CREATE UNIQUE INDEX "InventoryLocation_parent_name_key"
  ON "InventoryLocation"("parentLocationId", "normalizedName")
  WHERE "parentLocationId" IS NOT NULL;

CREATE INDEX "InventoryLocation_parentLocationId_idx"
  ON "InventoryLocation"("parentLocationId");

CREATE INDEX "InventoryLocation_ownerPlayerId_parentLocationId_active_idx"
  ON "InventoryLocation"("ownerPlayerId", "parentLocationId", "active");

ALTER TABLE "InventoryLocation"
  ADD CONSTRAINT "InventoryLocation_parentLocationId_fkey"
  FOREIGN KEY ("parentLocationId")
  REFERENCES "InventoryLocation"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
