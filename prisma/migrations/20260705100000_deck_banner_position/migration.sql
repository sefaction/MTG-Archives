ALTER TABLE "Deck"
  ADD COLUMN IF NOT EXISTS "bannerPositionX" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "bannerPositionY" INTEGER NOT NULL DEFAULT 50;

UPDATE "Deck"
SET
  "bannerPositionX" = 50
WHERE "bannerPositionX" IS NULL;

UPDATE "Deck"
SET
  "bannerPositionY" = 50
WHERE "bannerPositionY" IS NULL;
