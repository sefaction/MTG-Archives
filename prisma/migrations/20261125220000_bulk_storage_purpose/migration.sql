ALTER TABLE "InventoryLocation" ADD COLUMN "isBulk" BOOLEAN NOT NULL DEFAULT false;
UPDATE "InventoryLocation" SET "isBulk" = true WHERE "type" = 'Bulk cleanup' AND "kind" = 'NORMAL' AND NOT "systemManaged";
