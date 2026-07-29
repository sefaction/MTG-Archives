ALTER TABLE "NotificationWebhookEndpoint"
  ADD COLUMN "deliveryType" TEXT NOT NULL DEFAULT 'SIGNED_JSON',
  ALTER COLUMN "secretEncrypted" DROP NOT NULL,
  ALTER COLUMN "secretHint" DROP NOT NULL;
