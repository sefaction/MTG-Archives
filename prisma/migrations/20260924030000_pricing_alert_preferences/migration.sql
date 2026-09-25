CREATE TABLE "PricingAlertPreference" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'tcgplayer',
    "finish" TEXT NOT NULL DEFAULT 'normal',
    "priceType" TEXT NOT NULL DEFAULT 'retail',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "thresholdMode" TEXT NOT NULL DEFAULT 'absolute',
    "minAbsolute" DECIMAL(12,4) NOT NULL DEFAULT 2,
    "minPercent" DECIMAL(8,2) NOT NULL DEFAULT 25,
    "minPriorPrice" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingAlertPreference_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "PricingAlertPreference_enabled_provider_finish_currency_idx"
ON "PricingAlertPreference"("enabled", "provider", "finish", "currency");

ALTER TABLE "PricingAlertPreference" ADD CONSTRAINT "PricingAlertPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
