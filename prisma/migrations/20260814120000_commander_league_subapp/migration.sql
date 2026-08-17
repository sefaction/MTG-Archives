CREATE TYPE "CommanderLeagueStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "CommanderLeagueMemberRole" AS ENUM ('ADMIN', 'PLAYER');
CREATE TYPE "CommanderLeagueGameStatus" AS ENUM ('COMPLETED', 'CANCELLED');
CREATE TYPE "CommanderLeagueResult" AS ENUM ('WIN', 'LOSS', 'DRAW');

CREATE TABLE "CommanderLeague" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "year" INTEGER NOT NULL,
  "status" "CommanderLeagueStatus" NOT NULL DEFAULT 'ACTIVE',
  "winPoints" INTEGER NOT NULL DEFAULT 3,
  "drawPoints" INTEGER NOT NULL DEFAULT 1,
  "lossPoints" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommanderLeague_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueMember" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "CommanderLeagueMemberRole" NOT NULL DEFAULT 'PLAYER',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommanderLeagueMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueRound" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "monthNumber" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommanderLeagueRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueGame" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "playedAt" TIMESTAMP(3) NOT NULL,
  "status" "CommanderLeagueGameStatus" NOT NULL DEFAULT 'COMPLETED',
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommanderLeagueGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueGameParticipant" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "result" "CommanderLeagueResult" NOT NULL,
  "finishPosition" INTEGER,
  "pointsAwarded" INTEGER NOT NULL,
  CONSTRAINT "CommanderLeagueGameParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueDeckSubmission" (
  "id" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "sourceDeckId" TEXT,
  "deckName" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommanderLeagueDeckSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueDeckSnapshotCard" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "cardId" TEXT,
  "scryfallId" TEXT,
  "oracleId" TEXT,
  "cardName" TEXT NOT NULL,
  "section" "DeckSection" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "isCommander" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CommanderLeagueDeckSnapshotCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommanderLeagueLocation" (
  "leagueId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommanderLeagueLocation_pkey" PRIMARY KEY ("leagueId", "locationId")
);

CREATE UNIQUE INDEX "CommanderLeague_slug_key" ON "CommanderLeague"("slug");
CREATE UNIQUE INDEX "CommanderLeague_name_year_key" ON "CommanderLeague"("name", "year");
CREATE INDEX "CommanderLeague_status_year_idx" ON "CommanderLeague"("status", "year");
CREATE INDEX "CommanderLeague_createdByUserId_idx" ON "CommanderLeague"("createdByUserId");
CREATE UNIQUE INDEX "CommanderLeagueMember_leagueId_userId_key" ON "CommanderLeagueMember"("leagueId", "userId");
CREATE INDEX "CommanderLeagueMember_userId_active_idx" ON "CommanderLeagueMember"("userId", "active");
CREATE INDEX "CommanderLeagueMember_leagueId_active_idx" ON "CommanderLeagueMember"("leagueId", "active");
CREATE UNIQUE INDEX "CommanderLeagueRound_leagueId_monthNumber_key" ON "CommanderLeagueRound"("leagueId", "monthNumber");
CREATE INDEX "CommanderLeagueRound_leagueId_startDate_idx" ON "CommanderLeagueRound"("leagueId", "startDate");
CREATE INDEX "CommanderLeagueGame_leagueId_playedAt_idx" ON "CommanderLeagueGame"("leagueId", "playedAt");
CREATE INDEX "CommanderLeagueGame_roundId_playedAt_idx" ON "CommanderLeagueGame"("roundId", "playedAt");
CREATE INDEX "CommanderLeagueGame_createdByUserId_idx" ON "CommanderLeagueGame"("createdByUserId");
CREATE UNIQUE INDEX "CommanderLeagueGameParticipant_gameId_memberId_key" ON "CommanderLeagueGameParticipant"("gameId", "memberId");
CREATE INDEX "CommanderLeagueGameParticipant_memberId_result_idx" ON "CommanderLeagueGameParticipant"("memberId", "result");
CREATE INDEX "CommanderLeagueGameParticipant_gameId_finishPosition_idx" ON "CommanderLeagueGameParticipant"("gameId", "finishPosition");
CREATE UNIQUE INDEX "CommanderLeagueDeckSubmission_participantId_key" ON "CommanderLeagueDeckSubmission"("participantId");
CREATE INDEX "CommanderLeagueDeckSubmission_sourceDeckId_idx" ON "CommanderLeagueDeckSubmission"("sourceDeckId");
CREATE INDEX "CommanderLeagueDeckSnapshotCard_submissionId_section_idx" ON "CommanderLeagueDeckSnapshotCard"("submissionId", "section");
CREATE INDEX "CommanderLeagueDeckSnapshotCard_cardId_idx" ON "CommanderLeagueDeckSnapshotCard"("cardId");
CREATE INDEX "CommanderLeagueDeckSnapshotCard_oracleId_idx" ON "CommanderLeagueDeckSnapshotCard"("oracleId");
CREATE INDEX "CommanderLeagueDeckSnapshotCard_cardName_idx" ON "CommanderLeagueDeckSnapshotCard"("cardName");
CREATE INDEX "CommanderLeagueLocation_locationId_idx" ON "CommanderLeagueLocation"("locationId");

ALTER TABLE "CommanderLeague" ADD CONSTRAINT "CommanderLeague_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueMember" ADD CONSTRAINT "CommanderLeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "CommanderLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueMember" ADD CONSTRAINT "CommanderLeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueRound" ADD CONSTRAINT "CommanderLeagueRound_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "CommanderLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueGame" ADD CONSTRAINT "CommanderLeagueGame_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "CommanderLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueGame" ADD CONSTRAINT "CommanderLeagueGame_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CommanderLeagueRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueGame" ADD CONSTRAINT "CommanderLeagueGame_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueGameParticipant" ADD CONSTRAINT "CommanderLeagueGameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CommanderLeagueGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueGameParticipant" ADD CONSTRAINT "CommanderLeagueGameParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CommanderLeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeckSubmission" ADD CONSTRAINT "CommanderLeagueDeckSubmission_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CommanderLeagueGameParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeckSubmission" ADD CONSTRAINT "CommanderLeagueDeckSubmission_sourceDeckId_fkey" FOREIGN KEY ("sourceDeckId") REFERENCES "Deck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeckSnapshotCard" ADD CONSTRAINT "CommanderLeagueDeckSnapshotCard_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CommanderLeagueDeckSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueDeckSnapshotCard" ADD CONSTRAINT "CommanderLeagueDeckSnapshotCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueLocation" ADD CONSTRAINT "CommanderLeagueLocation_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "CommanderLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommanderLeagueLocation" ADD CONSTRAINT "CommanderLeagueLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
