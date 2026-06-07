-- Add narrow indexes for paginated inventory list queries and public visibility filtering.
CREATE INDEX "User_publicProfileEnabled_isActive_inventoryDefaultVisibility_idx"
  ON "User"("publicProfileEnabled", "isActive", "inventoryDefaultVisibility");

CREATE INDEX "InventoryLocation_ownerPlayerId_visibility_active_idx"
  ON "InventoryLocation"("ownerPlayerId", "visibility", "active");

CREATE INDEX "InventoryLocation_visibility_active_idx"
  ON "InventoryLocation"("visibility", "active");

CREATE INDEX "InventoryItem_currentOwnerId_quantity_createdAt_idx"
  ON "InventoryItem"("currentOwnerId", "quantity", "createdAt");

CREATE INDEX "InventoryItem_locationId_quantity_idx"
  ON "InventoryItem"("locationId", "quantity");

CREATE INDEX "InventoryItem_cardId_quantity_idx"
  ON "InventoryItem"("cardId", "quantity");

CREATE INDEX "InventoryItem_foilStatus_condition_language_idx"
  ON "InventoryItem"("foilStatus", "condition", "language");
