CREATE TABLE "CollectorWishlistItem" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "setCode" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "cardName" TEXT NOT NULL,
    "collectorNumber" TEXT,
    "preferredFinish" TEXT NOT NULL,
    "allowOtherSets" BOOLEAN NOT NULL DEFAULT false,
    "allowOtherFinishes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectorWishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollectorWishlistItem_ownerUserId_setCode_mode_targetKey_key"
    ON "CollectorWishlistItem"("ownerUserId", "setCode", "mode", "targetKey");
CREATE INDEX "CollectorWishlistItem_ownerUserId_createdAt_idx"
    ON "CollectorWishlistItem"("ownerUserId", "createdAt");

ALTER TABLE "CollectorWishlistItem" ADD CONSTRAINT "CollectorWishlistItem_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
