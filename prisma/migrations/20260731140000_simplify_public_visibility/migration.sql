-- Existing installations are still in active testing, so make the current
-- users and their collection surfaces public before removing the redundant
-- profile-level visibility gate.
UPDATE "User"
SET
  "inventoryDefaultVisibility" = 'PUBLIC',
  "deckDefaultVisibility" = 'PUBLIC';

UPDATE "InventoryLocation"
SET "visibility" = 'PUBLIC';

UPDATE "Deck"
SET "visibility" = 'PUBLIC';

DROP INDEX IF EXISTS "User_publicProfileEnabled_isActive_inventoryDefaultVisibility_idx";
DROP INDEX IF EXISTS "User_publicProfileEnabled_isActive_deckDefaultVisibility_idx";
DROP INDEX IF EXISTS "User_publicSlug_key";

ALTER TABLE "User"
  DROP COLUMN "publicProfileEnabled",
  DROP COLUMN "publicSlug";

CREATE INDEX "User_isActive_inventoryDefaultVisibility_idx"
  ON "User"("isActive", "inventoryDefaultVisibility");

CREATE INDEX "User_isActive_deckDefaultVisibility_idx"
  ON "User"("isActive", "deckDefaultVisibility");
