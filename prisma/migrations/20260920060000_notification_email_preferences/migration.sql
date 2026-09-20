ALTER TABLE "NotificationPreference" ADD COLUMN "emailEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "NotificationPreference_category_emailEnabled_idx" ON "NotificationPreference"("category", "emailEnabled");
