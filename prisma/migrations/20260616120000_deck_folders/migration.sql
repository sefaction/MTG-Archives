-- Add personal nested folders for decks.
CREATE TABLE "DeckFolder" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeckFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Deck" ADD COLUMN "folderId" TEXT;

CREATE INDEX "DeckFolder_ownerUserId_idx" ON "DeckFolder"("ownerUserId");
CREATE INDEX "DeckFolder_parentId_idx" ON "DeckFolder"("parentId");
CREATE UNIQUE INDEX "DeckFolder_ownerUserId_parentId_name_key" ON "DeckFolder"("ownerUserId", "parentId", "name");
CREATE INDEX "Deck_folderId_idx" ON "Deck"("folderId");

ALTER TABLE "DeckFolder" ADD CONSTRAINT "DeckFolder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckFolder" ADD CONSTRAINT "DeckFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DeckFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DeckFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
