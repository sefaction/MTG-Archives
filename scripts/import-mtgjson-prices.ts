import { prisma } from "../lib/prisma";
import {
  importMtgjsonPrices,
  mapMtgjsonCards,
  type MtgjsonPriceImportKind,
} from "../lib/mtgjson-prices";

async function main() {
  const arg = process.argv[2] || "today";
  if (arg === "map" || arg === "mapping" || arg === "map-cards") {
    const report = await mapMtgjsonCards(prisma);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const kind: MtgjsonPriceImportKind =
    arg === "history" || arg === "backfill" ? "history" : "today";
  const report = await importMtgjsonPrices(prisma, kind);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
