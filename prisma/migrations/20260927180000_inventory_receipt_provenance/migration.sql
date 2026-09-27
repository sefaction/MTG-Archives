-- Unknown opener is explicit. Existing rows retain their recorded provenance.
ALTER TABLE "InventoryItem" ALTER COLUMN "originalOpenerId" DROP NOT NULL;
ALTER TYPE "InventorySourceType" ADD VALUE 'ACQUISITION';
