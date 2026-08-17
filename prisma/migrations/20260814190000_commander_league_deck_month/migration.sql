ALTER TABLE "CommanderLeagueDeck" ADD COLUMN "roundId" TEXT;
ALTER TABLE "CommanderLeagueDeck" ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "CommanderLeagueDeck" AS deck
SET "roundId" = (
  SELECT round."id"
  FROM "CommanderLeagueRound" AS round
  WHERE round."leagueId" = deck."leagueId"
  ORDER BY round."monthNumber" ASC
  LIMIT 1
);

ALTER TABLE "CommanderLeagueDeck" ALTER COLUMN "roundId" SET NOT NULL;
DROP INDEX "CommanderLeagueDeck_memberId_name_key";
CREATE UNIQUE INDEX "CommanderLeagueDeck_memberId_roundId_key" ON "CommanderLeagueDeck"("memberId", "roundId");
CREATE INDEX "CommanderLeagueDeck_roundId_idx" ON "CommanderLeagueDeck"("roundId");
ALTER TABLE "CommanderLeagueDeck" ADD CONSTRAINT "CommanderLeagueDeck_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CommanderLeagueRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
