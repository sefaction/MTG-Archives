DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TradeWishlistStatus') THEN
    CREATE TYPE "TradeWishlistStatus" AS ENUM ('OPEN', 'IN_TRADE', 'FULFILLED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TradeWishlistItem" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "targetOwnerPlayerId" TEXT NOT NULL,
  "targetInventoryItemId" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "status" "TradeWishlistStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TradeWishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TradeWishlistItem_ownerUserId_targetOwnerPlayerId_cardId_key"
  ON "TradeWishlistItem"("ownerUserId", "targetOwnerPlayerId", "cardId");

CREATE INDEX IF NOT EXISTS "TradeWishlistItem_ownerUserId_status_updatedAt_idx"
  ON "TradeWishlistItem"("ownerUserId", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "TradeWishlistItem_targetOwnerPlayerId_status_idx"
  ON "TradeWishlistItem"("targetOwnerPlayerId", "status");

CREATE INDEX IF NOT EXISTS "TradeWishlistItem_targetInventoryItemId_idx"
  ON "TradeWishlistItem"("targetInventoryItemId");

CREATE INDEX IF NOT EXISTS "TradeWishlistItem_cardId_idx"
  ON "TradeWishlistItem"("cardId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TradeWishlistItem_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "TradeWishlistItem"
      ADD CONSTRAINT "TradeWishlistItem_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TradeWishlistItem_cardId_fkey'
  ) THEN
    ALTER TABLE "TradeWishlistItem"
      ADD CONSTRAINT "TradeWishlistItem_cardId_fkey"
      FOREIGN KEY ("cardId") REFERENCES "Card"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TradeWishlistItem_targetOwnerPlayerId_fkey'
  ) THEN
    ALTER TABLE "TradeWishlistItem"
      ADD CONSTRAINT "TradeWishlistItem_targetOwnerPlayerId_fkey"
      FOREIGN KEY ("targetOwnerPlayerId") REFERENCES "Player"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TradeWishlistItem_targetInventoryItemId_fkey'
  ) THEN
    ALTER TABLE "TradeWishlistItem"
      ADD CONSTRAINT "TradeWishlistItem_targetInventoryItemId_fkey"
      FOREIGN KEY ("targetInventoryItemId") REFERENCES "InventoryItem"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
