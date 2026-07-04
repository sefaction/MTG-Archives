ALTER TABLE "Trade"
  ADD COLUMN IF NOT EXISTS "proposerDestinationLocationId" TEXT,
  ADD COLUMN IF NOT EXISTS "receiverDestinationLocationId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Trade_proposerDestinationLocationId_fkey'
  ) THEN
    ALTER TABLE "Trade"
      ADD CONSTRAINT "Trade_proposerDestinationLocationId_fkey"
      FOREIGN KEY ("proposerDestinationLocationId") REFERENCES "InventoryLocation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Trade_receiverDestinationLocationId_fkey'
  ) THEN
    ALTER TABLE "Trade"
      ADD CONSTRAINT "Trade_receiverDestinationLocationId_fkey"
      FOREIGN KEY ("receiverDestinationLocationId") REFERENCES "InventoryLocation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Trade_proposerDestinationLocationId_idx"
  ON "Trade"("proposerDestinationLocationId");

CREATE INDEX IF NOT EXISTS "Trade_receiverDestinationLocationId_idx"
  ON "Trade"("receiverDestinationLocationId");
