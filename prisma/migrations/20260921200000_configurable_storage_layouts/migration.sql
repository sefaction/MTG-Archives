-- Null preserves legacy vault defaults without rewriting any placements.
ALTER TABLE "InventoryLocation" ADD COLUMN "storageLayout" JSONB;
ALTER TABLE "LocationType" ADD COLUMN "defaultStorageLayout" JSONB;
