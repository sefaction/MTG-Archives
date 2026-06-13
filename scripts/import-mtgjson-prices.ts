import { prisma } from "../lib/prisma";
import {
  importMtgjsonPrices,
  type MtgjsonPriceImportKind,
} from "../lib/mtgjson-prices";

async function main() {
  const arg = process.argv[2] || "today";
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
