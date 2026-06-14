export const dynamic = "force-dynamic";

import { requireAdminMode } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  importMtgjsonTodayAction,
  backfillMtgjsonHistoryAction,
} from "./actions";
import { mtgjsonPriceFileUrl } from "@/lib/mtgjson-prices";
import {
  collectionValueHistory,
  formatSelectedPrice,
  inventoryValueByProvider,
  PRICE_PROVIDER_OPTIONS,
  providerLabel,
} from "@/lib/price-history";

export default async function AdminPricesPage() {
  await requireAdminMode();
  const [
    snapshotCount,
    matchedCards,
    providerRows,
    lastSnapshot,
    inventoryItems,
  ] = await Promise.all([
    prisma.cardPriceSnapshot.count(),
    prisma.card.count({ where: { mtgjsonUuid: { not: null } } }),
    prisma.cardPriceSnapshot.groupBy({
      by: ["provider"],
      _count: { _all: true },
    }),
    prisma.cardPriceSnapshot.findFirst({ orderBy: { importedAt: "desc" } }),
    prisma.inventoryItem.findMany({
      where: { quantity: { gt: 0 } },
      select: {
        quantity: true,
        foilStatus: true,
        card: {
          select: {
            prices: true,
            priceSnapshots: {
              orderBy: [{ observedDate: "desc" }],
              take: 90,
            },
          },
        },
      },
    }),
  ]);
  const unmatchedCards = await prisma.card.count({
    where: { mtgjsonUuid: null },
  });
  const providers = providerRows.map((row) => row.provider).sort();
  const providerValueRows = PRICE_PROVIDER_OPTIONS.filter(
    (option) => option.value !== "scryfall",
  ).map((option) => ({
    provider: option.value,
    label: option.label,
    value: inventoryValueByProvider(
      inventoryItems.map((item) => ({
        quantity: item.quantity,
        foilStatus: item.foilStatus,
        card: item.card,
      })),
      { preferredProvider: option.value },
    ),
  }));
  const historyRows = collectionValueHistory(
    inventoryItems.map((item) => ({
      quantity: item.quantity,
      foilStatus: item.foilStatus,
      card: item.card,
    })),
    {
      provider: process.env.MTGJSON_PRICE_PROVIDER_DEFAULT || "tcgplayer",
      days: 14,
    },
  );

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <div>
        <h1 className="text-3xl font-bold">Price imports</h1>
        <p className="text-zinc-400">
          MTGJSON prices are imported on demand and stored as local
          provider-specific snapshots.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Snapshots stored</p>
          <p className="text-2xl font-bold">{snapshotCount}</p>
        </div>
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Cards mapped to MTGJSON</p>
          <p className="text-2xl font-bold">{matchedCards}</p>
          <p className="text-xs text-zinc-500">
            Unmapped local cards: {unmatchedCards}
          </p>
        </div>
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Last successful import</p>
          <p className="text-lg font-semibold">
            {lastSnapshot?.importedAt.toISOString() ?? "Never"}
          </p>
          <p className="text-xs text-zinc-500">
            Latest observed date:{" "}
            {lastSnapshot?.observedDate.toISOString().slice(0, 10) ?? "—"}
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">MTGJSON import controls</h2>
        <p className="text-sm text-zinc-400">
          Current snapshots download {mtgjsonPriceFileUrl("today")}. Historical
          backfill downloads {mtgjsonPriceFileUrl("history")} and can be large,
          so run it intentionally.
        </p>
        <div className="flex flex-wrap gap-3">
          <form action={importMtgjsonTodayAction}>
            <SubmitButton
              pendingLabel="Importing…"
              className="rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600"
            >
              Import today’s prices
            </SubmitButton>
          </form>
          <form action={backfillMtgjsonHistoryAction}>
            <SubmitButton
              pendingLabel="Backfilling…"
              className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
            >
              Backfill 90-day price history
            </SubmitButton>
          </form>
        </div>
      </section>

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">Providers available</h2>
        <p className="text-sm text-zinc-400">
          {providers.length
            ? providers.map(providerLabel).join(", ")
            : "No MTGJSON providers imported yet."}
        </p>
      </section>

      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">Collection value history</h2>
        <p className="text-sm text-zinc-400">
          Current collection value by provider and recent daily value points are
          calculated from inventory quantities and stored MTGJSON snapshots.
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          {providerValueRows.map((row) => (
            <div
              key={row.provider}
              className="rounded border border-zinc-800 p-3"
            >
              <p className="text-xs text-zinc-400">{row.label}</p>
              <p className="text-lg font-semibold">
                {formatSelectedPrice({
                  amount: row.value,
                  provider: row.provider,
                  providerLabel: row.label,
                  finish: "normal",
                  priceType: "retail",
                  currency: "USD",
                  observedDate: new Date(),
                  source: "mtgjson",
                })}
              </p>
            </div>
          ))}
        </div>
        {historyRows.length ? (
          <table className="text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="pr-4 text-left">Date</th>
                <th className="text-left">Value</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => (
                <tr key={row.date}>
                  <td className="pr-4">{row.date}</td>
                  <td>${row.value.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-zinc-500">
            Import MTGJSON history to populate collection value history.
          </p>
        )}
      </section>
    </main>
  );
}
