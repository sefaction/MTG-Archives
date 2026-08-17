ALTER TABLE "CommanderLeagueDeck" ADD COLUMN "archiveDeckId" TEXT;

INSERT INTO "Deck" (
  "id", "ownerUserId", "name", "description", "format", "visibility",
  "bannerPositionX", "bannerPositionY", "bannerZoom", "createdAt", "updatedAt"
)
SELECT
  'league_' || leagueDeck."id",
  member."userId",
  leagueDeck."name",
  leagueDeck."description",
  'COMMANDER'::"DeckFormat",
  'PUBLIC'::"Visibility",
  50, 50, 100,
  leagueDeck."createdAt",
  leagueDeck."updatedAt"
FROM "CommanderLeagueDeck" AS leagueDeck
JOIN "CommanderLeagueMember" AS member ON member."id" = leagueDeck."memberId";

UPDATE "CommanderLeagueDeck"
SET "archiveDeckId" = 'league_' || "id";

INSERT INTO "DeckCard" (
  "id", "deckId", "cardId", "scryfallId", "oracleId", "cardName",
  "section", "quantity", "isCommander", "createdAt", "updatedAt"
)
SELECT
  'league_' || card."id",
  'league_' || card."deckId",
  card."cardId",
  card."scryfallId",
  card."oracleId",
  card."cardName",
  card."section",
  card."quantity",
  card."isCommander",
  card."createdAt",
  card."updatedAt"
FROM "CommanderLeagueDeckCard" AS card;

DROP TABLE "CommanderLeagueDeckCard";

ALTER TABLE "CommanderLeagueDeck" ALTER COLUMN "archiveDeckId" SET NOT NULL;
CREATE UNIQUE INDEX "CommanderLeagueDeck_archiveDeckId_key" ON "CommanderLeagueDeck"("archiveDeckId");
ALTER TABLE "CommanderLeagueDeck" ADD CONSTRAINT "CommanderLeagueDeck_archiveDeckId_fkey" FOREIGN KEY ("archiveDeckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
