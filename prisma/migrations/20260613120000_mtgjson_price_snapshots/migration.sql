-- Add MTGJSON card identity and local provider-specific price history.
ALTER TABLE "Card" ADD COLUMN "mtgjsonUuid" TEXT;

CREATE TABLE "CardPriceSnapshot" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "mtgjsonUuid" TEXT,
  "provider" TEXT NOT NULL,
  "finish" TEXT NOT NULL,
  "priceType" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "price" DECIMAL(12,4) NOT NULL,
  "observedDate" TIMESTAMP(3) NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CardPriceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Card_mtgjsonUuid_key" ON "Card"("mtgjsonUuid");
CREATE UNIQUE INDEX "CardPriceSnapshot_cardId_provider_finish_priceType_currency_observedDate_key"
  ON "CardPriceSnapshot"("cardId", "provider", "finish", "priceType", "currency", "observedDate");
CREATE INDEX "CardPriceSnapshot_cardId_observedDate_idx" ON "CardPriceSnapshot"("cardId", "observedDate");
CREATE INDEX "CardPriceSnapshot_provider_observedDate_idx" ON "CardPriceSnapshot"("provider", "observedDate");
CREATE INDEX "CardPriceSnapshot_observedDate_idx" ON "CardPriceSnapshot"("observedDate");
CREATE INDEX "CardPriceSnapshot_mtgjsonUuid_idx" ON "CardPriceSnapshot"("mtgjsonUuid");

ALTER TABLE "CardPriceSnapshot" ADD CONSTRAINT "CardPriceSnapshot_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
