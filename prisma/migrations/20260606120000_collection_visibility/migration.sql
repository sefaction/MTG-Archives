-- Add privacy-safe collection visibility defaults and per-location overrides.
CREATE TYPE "DefaultCollectionVisibility" AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'PUBLIC', 'INHERIT');

ALTER TABLE "User"
  ADD COLUMN "inventoryDefaultVisibility" "DefaultCollectionVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "deckDefaultVisibility" "DefaultCollectionVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "publicProfileEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicSlug" TEXT,
  ADD COLUMN "publicDisplayName" TEXT;

ALTER TABLE "InventoryLocation"
  ADD COLUMN "visibility" "Visibility" NOT NULL DEFAULT 'INHERIT';

CREATE UNIQUE INDEX "User_publicSlug_key" ON "User"("publicSlug");
