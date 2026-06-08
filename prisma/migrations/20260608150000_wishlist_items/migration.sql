CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priority" TEXT,
    "notes" TEXT,
    "desiredFinish" TEXT,
    "desiredCondition" TEXT,
    "desiredLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WishlistItem_ownerUserId_cardId_key" ON "WishlistItem"("ownerUserId", "cardId");
CREATE INDEX "WishlistItem_ownerUserId_updatedAt_idx" ON "WishlistItem"("ownerUserId", "updatedAt");
CREATE INDEX "WishlistItem_cardId_idx" ON "WishlistItem"("cardId");

ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
