CREATE TABLE "NotificationPreference" (
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "category")
);

CREATE TABLE "TradeWishlistNotificationActivity" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "targetOwnerPlayerId" TEXT NOT NULL,
  "tradeWishlistItemId" TEXT NOT NULL,
  "cardName" TEXT NOT NULL,
  "quantityAdded" INTEGER NOT NULL DEFAULT 1,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TradeWishlistNotificationActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationPreference_category_inAppEnabled_idx"
  ON "NotificationPreference"("category", "inAppEnabled");

CREATE INDEX "TradeWishlistNotificationActivity_processedAt_createdAt_idx"
  ON "TradeWishlistNotificationActivity"("processedAt", "createdAt");

CREATE INDEX "TradeWishlistNotificationActivity_targetOwnerPlayerId_processedAt_createdAt_idx"
  ON "TradeWishlistNotificationActivity"("targetOwnerPlayerId", "processedAt", "createdAt");

CREATE INDEX "TradeWishlistNotificationActivity_tradeWishlistItemId_idx"
  ON "TradeWishlistNotificationActivity"("tradeWishlistItemId");

CREATE INDEX "TradeWishlistNotificationActivity_actorUserId_idx"
  ON "TradeWishlistNotificationActivity"("actorUserId");

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeWishlistNotificationActivity"
  ADD CONSTRAINT "TradeWishlistNotificationActivity_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeWishlistNotificationActivity"
  ADD CONSTRAINT "TradeWishlistNotificationActivity_targetOwnerPlayerId_fkey"
  FOREIGN KEY ("targetOwnerPlayerId") REFERENCES "Player"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeWishlistNotificationActivity"
  ADD CONSTRAINT "TradeWishlistNotificationActivity_tradeWishlistItemId_fkey"
  FOREIGN KEY ("tradeWishlistItemId") REFERENCES "TradeWishlistItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
