CREATE TABLE "CommanderLeagueDeck" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommanderLeagueDeck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueDeckCard" (
  "id" TEXT NOT NULL,
  "deckId" TEXT NOT NULL,
  "cardId" TEXT,
  "scryfallId" TEXT,
  "oracleId" TEXT,
  "cardName" TEXT NOT NULL,
  "section" "DeckSection" NOT NULL DEFAULT 'MAINBOARD',
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "isCommander" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommanderLeagueDeckCard_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommanderLeagueDeckSubmission" ADD COLUMN "sourceLeagueDeckId" TEXT;
ALTER TABLE "CommanderLeagueDeckSubmission" DROP CONSTRAINT "CommanderLeagueDeckSubmission_sourceDeckId_fkey";
DROP INDEX "CommanderLeagueDeckSubmission_sourceDeckId_idx";
ALTER TABLE "CommanderLeagueDeckSubmission" DROP COLUMN "sourceDeckId";

CREATE UNIQUE INDEX "CommanderLeagueDeck_memberId_name_key" ON "CommanderLeagueDeck"("memberId", "name");
CREATE INDEX "CommanderLeagueDeck_leagueId_updatedAt_idx" ON "CommanderLeagueDeck"("leagueId", "updatedAt");
CREATE INDEX "CommanderLeagueDeckCard_deckId_section_idx" ON "CommanderLeagueDeckCard"("deckId", "section");
CREATE INDEX "CommanderLeagueDeckCard_cardId_idx" ON "CommanderLeagueDeckCard"("cardId");
CREATE INDEX "CommanderLeagueDeckCard_oracleId_idx" ON "CommanderLeagueDeckCard"("oracleId");
CREATE INDEX "CommanderLeagueDeckCard_cardName_idx" ON "CommanderLeagueDeckCard"("cardName");
CREATE INDEX "CommanderLeagueDeckSubmission_sourceLeagueDeckId_idx" ON "CommanderLeagueDeckSubmission"("sourceLeagueDeckId");

ALTER TABLE "CommanderLeagueDeck" ADD CONSTRAINT "CommanderLeagueDeck_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "CommanderLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeck" ADD CONSTRAINT "CommanderLeagueDeck_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CommanderLeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeckCard" ADD CONSTRAINT "CommanderLeagueDeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "CommanderLeagueDeck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeckCard" ADD CONSTRAINT "CommanderLeagueDeckCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeckSubmission" ADD CONSTRAINT "CommanderLeagueDeckSubmission_sourceLeagueDeckId_fkey" FOREIGN KEY ("sourceLeagueDeckId") REFERENCES "CommanderLeagueDeck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
