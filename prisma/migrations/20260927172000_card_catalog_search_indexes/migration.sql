-- Existing search uses ILIKE contains/name and exact ILIKE/set, plus a collector
-- number OR branch. Index every branch so bulk catalog coverage does not force
-- a table scan for ordinary card search. No uniqueness or matching rule changes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Card_name_trgm_idx" ON "Card" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Card_setCode_trgm_idx" ON "Card" USING GIN ("setCode" gin_trgm_ops);
CREATE INDEX "Card_collectorNumber_idx" ON "Card" ("collectorNumber");
