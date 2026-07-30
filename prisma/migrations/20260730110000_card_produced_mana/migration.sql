ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "producedMana" JSONB;

UPDATE "Card"
SET "producedMana" = "rawScryfallJson"->'produced_mana'
WHERE "producedMana" IS NULL
  AND jsonb_typeof("rawScryfallJson"->'produced_mana') = 'array';
