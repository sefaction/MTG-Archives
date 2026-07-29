ALTER TABLE "NotificationPreference"
  ADD COLUMN "webhookEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "NotificationWebhookEndpoint" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "urlEncrypted" TEXT NOT NULL,
  "urlHint" TEXT NOT NULL,
  "secretEncrypted" TEXT NOT NULL,
  "secretHint" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "allowPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationPreference_category_webhookEnabled_idx"
  ON "NotificationPreference"("category", "webhookEnabled");

CREATE UNIQUE INDEX "NotificationWebhookEndpoint_userId_name_key"
  ON "NotificationWebhookEndpoint"("userId", "name");

CREATE INDEX "NotificationWebhookEndpoint_userId_enabled_createdAt_idx"
  ON "NotificationWebhookEndpoint"("userId", "enabled", "createdAt");

ALTER TABLE "NotificationWebhookEndpoint"
  ADD CONSTRAINT "NotificationWebhookEndpoint_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
