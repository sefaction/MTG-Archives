CREATE TABLE IF NOT EXISTS "CommanderBracketRuleSet" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'scryfall',
  "sourceUrl" TEXT,
  "effectiveAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "rulesJson" JSONB NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommanderBracketRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommanderGameChanger" (
  "id" TEXT NOT NULL,
  "ruleSetId" TEXT NOT NULL,
  "oracleId" TEXT,
  "scryfallId" TEXT,
  "cardName" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommanderGameChanger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommanderBracketRuleSet_isActive_createdAt_idx" ON "CommanderBracketRuleSet"("isActive", "createdAt");
CREATE INDEX IF NOT EXISTS "CommanderGameChanger_ruleSetId_idx" ON "CommanderGameChanger"("ruleSetId");
CREATE INDEX IF NOT EXISTS "CommanderGameChanger_oracleId_idx" ON "CommanderGameChanger"("oracleId");
CREATE INDEX IF NOT EXISTS "CommanderGameChanger_scryfallId_idx" ON "CommanderGameChanger"("scryfallId");
CREATE INDEX IF NOT EXISTS "CommanderGameChanger_cardName_idx" ON "CommanderGameChanger"("cardName");

ALTER TABLE "CommanderGameChanger"
  ADD CONSTRAINT "CommanderGameChanger_ruleSetId_fkey"
  FOREIGN KEY ("ruleSetId") REFERENCES "CommanderBracketRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
