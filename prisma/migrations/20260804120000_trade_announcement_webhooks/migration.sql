ALTER TABLE "NotificationDeliveryJob"
  ALTER COLUMN "notificationId" DROP NOT NULL,
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'notification',
  ADD COLUMN "sourceId" TEXT;

UPDATE "NotificationDeliveryJob"
SET "sourceId" = "notificationId"
WHERE "sourceId" IS NULL;

ALTER TABLE "NotificationDeliveryJob"
  ALTER COLUMN "sourceId" SET NOT NULL;

DROP INDEX "NotificationDeliveryJob_notificationId_transport_destinationKey_key";

CREATE UNIQUE INDEX "NotificationDeliveryJob_sourceType_sourceId_transport_destinationKey_key"
  ON "NotificationDeliveryJob"("sourceType", "sourceId", "transport", "destinationKey");

CREATE TABLE "TradeAnnouncementWebhookEndpoint" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "deliveryType" TEXT NOT NULL DEFAULT 'SIGNED_JSON',
  "urlEncrypted" TEXT NOT NULL,
  "urlHint" TEXT NOT NULL,
  "secretEncrypted" TEXT,
  "secretHint" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "allowPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeAnnouncementWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeAnnouncementWebhookEndpoint_name_key"
  ON "TradeAnnouncementWebhookEndpoint"("name");

CREATE INDEX "TradeAnnouncementWebhookEndpoint_enabled_createdAt_idx"
  ON "TradeAnnouncementWebhookEndpoint"("enabled", "createdAt");
