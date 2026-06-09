DO $$ BEGIN
  CREATE TYPE "InventoryLocationKind" AS ENUM ('NORMAL', 'DECK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "InventoryLocation"
  ADD COLUMN IF NOT EXISTS "kind" "InventoryLocationKind" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "deckId" TEXT,
  ADD COLUMN IF NOT EXISTS "systemManaged" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLocation_deckId_key" ON "InventoryLocation"("deckId");
CREATE INDEX IF NOT EXISTS "InventoryLocation_ownerPlayerId_kind_active_idx" ON "InventoryLocation"("ownerPlayerId", "kind", "active");

DO $$ BEGIN
  ALTER TABLE "InventoryLocation"
    ADD CONSTRAINT "InventoryLocation_deckId_fkey"
    FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
