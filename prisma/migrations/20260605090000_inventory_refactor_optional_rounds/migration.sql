-- First inventory refactor pass: decouple inventory imports and trades from required league rounds.
ALTER TABLE "InventoryItem" ALTER COLUMN "roundId" DROP NOT NULL;
ALTER TABLE "ImportBatch" ALTER COLUMN "selectedRoundId" DROP NOT NULL;
ALTER TABLE "Trade" ALTER COLUMN "tradeRoundId" DROP NOT NULL;
ALTER TABLE "League" ALTER COLUMN "appDisplayName" SET DEFAULT 'MTG Inventory';
