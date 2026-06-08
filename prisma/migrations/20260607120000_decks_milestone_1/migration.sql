CREATE TYPE "DeckFormat" AS ENUM ('COMMANDER', 'STANDARD', 'MODERN', 'PIONEER', 'LEGACY', 'VINTAGE', 'PAUPER', 'CASUAL', 'OTHER');
CREATE TYPE "DeckSection" AS ENUM ('MAINBOARD', 'SIDEBOARD', 'COMMANDER', 'MAYBEBOARD');

CREATE TABLE "Deck" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "format" "DeckFormat" NOT NULL DEFAULT 'CASUAL',
  "visibility" "Visibility" NOT NULL DEFAULT 'INHERIT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeckCard" (
  "id" TEXT NOT NULL,
  "deckId" TEXT NOT NULL,
  "cardId" TEXT,
  "scryfallId" TEXT,
  "oracleId" TEXT,
  "cardName" TEXT NOT NULL,
  "section" "DeckSection" NOT NULL DEFAULT 'MAINBOARD',
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "isCommander" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeckCard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "User_publicProfileEnabled_isActive_deckDefaultVisibility_idx" ON "User"("publicProfileEnabled", "isActive", "deckDefaultVisibility");
CREATE INDEX "Deck_ownerUserId_updatedAt_idx" ON "Deck"("ownerUserId", "updatedAt");
CREATE INDEX "Deck_visibility_updatedAt_idx" ON "Deck"("visibility", "updatedAt");
CREATE INDEX "Deck_format_idx" ON "Deck"("format");
CREATE INDEX "DeckCard_deckId_section_idx" ON "DeckCard"("deckId", "section");
CREATE INDEX "DeckCard_cardId_idx" ON "DeckCard"("cardId");
CREATE INDEX "DeckCard_scryfallId_idx" ON "DeckCard"("scryfallId");
CREATE INDEX "DeckCard_oracleId_idx" ON "DeckCard"("oracleId");
CREATE INDEX "DeckCard_cardName_idx" ON "DeckCard"("cardName");

ALTER TABLE "Deck" ADD CONSTRAINT "Deck_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckCard" ADD CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckCard" ADD CONSTRAINT "DeckCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
