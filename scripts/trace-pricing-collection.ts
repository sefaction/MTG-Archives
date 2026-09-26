import { PrismaClient } from "@prisma/client";
import { finishForFoilStatus, selectPreferredCardPrice } from "../lib/price-history";
import { queryPricingJson } from "../lib/pricing-db-query";
import { getPricingDashboard, type PricingDashboardOptions } from
  "../lib/pricing-worker-store";
import { usdCopyValue } from "../lib/pricing-workspace";

if (process.argv.slice(2).join(" ") !== "--run" ||
    process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Use --run with MTG_LOCAL_PILOT_TEST=1 for local read-only tracing");
const url = process.env.PRICING_DATABASE_URL;
if (!url || !["pricing-postgres", "localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Collection tracing supports only the local Pricing source");

async function main() {
  const prisma = new PrismaClient();
  try {
    const [largest] = await prisma.$queryRaw<Array<{ currentOwnerId: string }>>`
      SELECT "currentOwnerId" FROM "InventoryItem" WHERE quantity > 0
      GROUP BY "currentOwnerId" ORDER BY COUNT(*) DESC LIMIT 1`;
    if (!largest) throw new Error("No local owner has inventory");
    const items = await prisma.inventoryItem.findMany({
      where: { currentOwnerId: largest.currentOwnerId, quantity: { gt: 0 },
        card: { mtgjsonUuid: { not: null } } },
      select: { quantity: true, foilStatus: true,
        card: { select: { mtgjsonUuid: true, setCode: true } } },
    });
    const owned = new Map<string, NonNullable<PricingDashboardOptions["ownedCards"]>[number]>();
    for (const item of items) {
      const uuid = item.card.mtgjsonUuid;
      if (!uuid) continue;
      const finish = finishForFoilStatus(item.foilStatus);
      const key = `${uuid}\u0000${finish}`;
      const prior = owned.get(key);
      owned.set(key, { mtgjsonUuid: uuid, finish, setCode: item.card.setCode,
        quantity: (prior?.quantity ?? 0) + item.quantity });
    }
    const samples = [];
    for (let trial = 0; trial < 3; trial++) {
      const phases: Array<{ query: string; ms: number }> = [];
      const start = Date.now();
      const inventoryStart = Date.now();
      const inventory = await prisma.inventoryItem.findMany({
        where: { currentOwnerId: largest.currentOwnerId, quantity: { gt: 0 } },
        select: { quantity: true, foilStatus: true,
          card: { select: { prices: true, mtgjsonUuid: true,
            setCode: true, name: true } },
          location: { select: { id: true, name: true, deckId: true,
            kind: true, deck: { select: { id: true, name: true } } } } },
      });
      const inventoryMs = Date.now() - inventoryStart;
      const valuationStart = Date.now();
      let totalValue = 0;
      for (const item of inventory) {
        const selected = selectPreferredCardPrice(undefined, item.card.prices, {
          finish: finishForFoilStatus(item.foilStatus),
        });
        totalValue += usdCopyValue(selected, item.quantity).value;
      }
      const valuationMs = Date.now() - valuationStart;
      if (!Number.isFinite(totalValue)) throw new Error("Invalid collection valuation in trace");
      const dashboard = await getPricingDashboard({ view: "collection", range: "90",
        ownedCards: [...owned.values()] }, async <T>(sql: string) => {
        const began = Date.now();
        const result = await queryPricingJson<T>(sql);
        const query = sql.includes("price_daily_summary") ? "trend" :
          sql.includes("COUNT(DISTINCT mtgjson_uuid)") ? "stats" : "state";
        phases.push({ query, ms: Date.now() - began });
        return result;
      });
      if (!dashboard.available) throw new Error("Pricing collection unavailable during trace");
      samples.push({ totalMs: Date.now() - start, inventoryMs, valuationMs,
        inventoryRows: inventory.length, phases });
    }
    console.log(JSON.stringify({ mode: "pricing-collection-trace",
      ownedRows: items.length, ownedScopes: owned.size, samples }));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
