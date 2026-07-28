CREATE TYPE "TradeLineSide" AS ENUM ('PROPOSER', 'RECEIVER');

CREATE TABLE "TradeLine" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "side" "TradeLineSide" NOT NULL,
    "inventoryItemId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeLine_tradeId_side_position_idx"
ON "TradeLine"("tradeId", "side", "position");

CREATE INDEX "TradeLine_inventoryItemId_idx"
ON "TradeLine"("inventoryItemId");

ALTER TABLE "TradeLine"
ADD CONSTRAINT "TradeLine_quantity_check"
CHECK ("quantity" > 0);

ALTER TABLE "TradeLine"
ADD CONSTRAINT "TradeLine_tradeId_fkey"
FOREIGN KEY ("tradeId") REFERENCES "Trade"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeLine"
ADD CONSTRAINT "TradeLine_inventoryItemId_fkey"
FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "TradeLine" (
    "id",
    "tradeId",
    "side",
    "inventoryItemId",
    "quantity",
    "position",
    "snapshotJson",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('legacy-offered-', "id"),
    "id",
    'PROPOSER'::"TradeLineSide",
    "offeredInventoryItemId",
    1,
    0,
    COALESCE("offeredSnapshotJson", '{}'::JSONB),
    "proposedAt",
    "updatedAt"
FROM "Trade"
WHERE "offeredSnapshotJson" IS NOT NULL
   OR "offeredInventoryItemId" IS NOT NULL;

INSERT INTO "TradeLine" (
    "id",
    "tradeId",
    "side",
    "inventoryItemId",
    "quantity",
    "position",
    "snapshotJson",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('legacy-requested-', "id"),
    "id",
    'RECEIVER'::"TradeLineSide",
    "requestedInventoryItemId",
    1,
    0,
    COALESCE("requestedSnapshotJson", '{}'::JSONB),
    "proposedAt",
    "updatedAt"
FROM "Trade"
WHERE "requestedSnapshotJson" IS NOT NULL
   OR "requestedInventoryItemId" IS NOT NULL;
