CREATE TABLE "DeckTag" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeckTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeckTagAssignment" (
    "deckId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeckTagAssignment_pkey" PRIMARY KEY ("deckId","tagId")
);

CREATE UNIQUE INDEX "DeckTag_ownerUserId_normalizedName_key"
ON "DeckTag"("ownerUserId", "normalizedName");

CREATE INDEX "DeckTag_ownerUserId_name_idx"
ON "DeckTag"("ownerUserId", "name");

CREATE INDEX "DeckTagAssignment_tagId_deckId_idx"
ON "DeckTagAssignment"("tagId", "deckId");

ALTER TABLE "DeckTag"
ADD CONSTRAINT "DeckTag_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeckTagAssignment"
ADD CONSTRAINT "DeckTagAssignment_deckId_fkey"
FOREIGN KEY ("deckId") REFERENCES "Deck"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeckTagAssignment"
ADD CONSTRAINT "DeckTagAssignment_tagId_fkey"
FOREIGN KEY ("tagId") REFERENCES "DeckTag"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
