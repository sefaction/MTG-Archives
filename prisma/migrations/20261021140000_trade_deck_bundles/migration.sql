CREATE TABLE "TradeDeckBundle" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "side" "TradeLineSide" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "deckId" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "snapshotDigest" TEXT NOT NULL,
    "receiptJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeDeckBundle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradeDeckBundle_snapshotDigest_check" CHECK ("snapshotDigest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "TradeDeckBundle_snapshotJson_check" CHECK (jsonb_typeof("snapshotJson") = 'object')
);

CREATE UNIQUE INDEX "TradeDeckBundle_tradeId_deckId_key" ON "TradeDeckBundle"("tradeId", "deckId");
CREATE UNIQUE INDEX "TradeDeckBundle_id_tradeId_side_key" ON "TradeDeckBundle"("id", "tradeId", "side");
CREATE INDEX "TradeDeckBundle_deckId_idx" ON "TradeDeckBundle"("deckId");
CREATE INDEX "TradeDeckBundle_tradeId_side_position_idx" ON "TradeDeckBundle"("tradeId", "side", "position");

ALTER TABLE "TradeDeckBundle" ADD CONSTRAINT "TradeDeckBundle_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeDeckBundle" ADD CONSTRAINT "TradeDeckBundle_deckId_fkey"
    FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeLine" ADD COLUMN "deckBundleId" TEXT;
CREATE INDEX "TradeLine_deckBundleId_idx" ON "TradeLine"("deckBundleId");
ALTER TABLE "TradeLine" ADD CONSTRAINT "TradeLine_deckBundleId_tradeId_side_fkey"
    FOREIGN KEY ("deckBundleId", "tradeId", "side") REFERENCES "TradeDeckBundle"("id", "tradeId", "side")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeLine" ADD CONSTRAINT "TradeLine_deckBundle_quantity_check"
    CHECK ("deckBundleId" IS NULL OR "quantity" > 0);
