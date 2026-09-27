-- Deck search additionally matches card type. Keep its OR branch indexable.
CREATE INDEX "Card_typeLine_trgm_idx" ON "Card" USING GIN ("typeLine" gin_trgm_ops);
