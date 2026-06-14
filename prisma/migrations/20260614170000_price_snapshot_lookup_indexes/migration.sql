-- Speed up latest-price projections and scoped pricing analytics after MTGJSON history imports.
CREATE INDEX IF NOT EXISTS "CardPriceSnapshot_cardId_provider_finish_priceType_currency_observedDate_idx"
  ON "CardPriceSnapshot"("cardId", "provider", "finish", "priceType", "currency", "observedDate");

CREATE INDEX IF NOT EXISTS "CardPriceSnapshot_provider_currency_observedDate_idx"
  ON "CardPriceSnapshot"("provider", "currency", "observedDate");
