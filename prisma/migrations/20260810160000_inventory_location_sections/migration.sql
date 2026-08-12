-- Optional, on-demand physical placement within a durable inventory location.
ALTER TABLE "InventoryItem"
ADD COLUMN "locationSection" TEXT;

CREATE INDEX "InventoryItem_locationId_locationSection_idx"
ON "InventoryItem"("locationId", "locationSection");
