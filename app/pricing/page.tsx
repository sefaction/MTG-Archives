export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { requireLogin } from "@/lib/auth";
import { money } from "@/lib/pricing-analytics";
import {
  finishForFoilStatus,
  selectPreferredCardPrice,
} from "@/lib/price-history";
import {
  getPricingDashboard,
  type PricingDashboardMover,
} from "@/lib/pricing-worker-store";
import { prisma } from "@/lib/prisma";

type PricingView = "market" | "data";

type CollectionValueRow = {
  id: string;
  label: string;
  quantity: number;
  value: number;
  missingPriceQuantity: number;
};

type CollectionValueSummary = {
  totalQuantity: number;
  totalValue: number;
  missingPriceQuantity: number;
  locationRows: CollectionValueRow[];
  deckRows: CollectionValueRow[];
};

function dateLabel(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function numberLabel(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function percentLabel(value: number | null) {
  return value == null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-zinc-100">{value}</div>
      {detail ? (
        <div className="mt-1 text-xs text-zinc-500">{detail}</div>
      ) : null}
    </div>
  );
}

function addValue(
  map: Map<string, CollectionValueRow>,
  id: string,
  label: string,
  quantity: number,
  value: number,
  missingPriceQuantity: number,
) {
  const row =
    map.get(id) ??
    ({
      id,
      label,
      quantity: 0,
      value: 0,
      missingPriceQuantity: 0,
    } satisfies CollectionValueRow);
  row.quantity += quantity;
  row.value += value;
  row.missingPriceQuantity += missingPriceQuantity;
  map.set(id, row);
}

async function getCollectionValueSummary({
  ownerPlayerId,
  preferredProvider,
}: {
  ownerPlayerId: string | null;
  preferredProvider: string | null | undefined;
}): Promise<CollectionValueSummary> {
  if (!ownerPlayerId) {
    return {
      totalQuantity: 0,
      totalValue: 0,
      missingPriceQuantity: 0,
      locationRows: [],
      deckRows: [],
    };
  }

  const items = await prisma.inventoryItem.findMany({
    where: { currentOwnerId: ownerPlayerId, quantity: { gt: 0 } },
    select: {
      quantity: true,
      foilStatus: true,
      card: { select: { prices: true } },
      location: {
        select: {
          id: true,
          name: true,
          deckId: true,
          deck: { select: { id: true, name: true } },
        },
      },
    },
  });

  const locationRows = new Map<string, CollectionValueRow>();
  const deckRows = new Map<string, CollectionValueRow>();
  let totalQuantity = 0;
  let totalValue = 0;
  let missingPriceQuantity = 0;

  for (const item of items) {
    const selected = selectPreferredCardPrice(undefined, item.card.prices, {
      finish: finishForFoilStatus(item.foilStatus),
      preferredProvider: preferredProvider || undefined,
    });
    const value = (selected?.amount ?? 0) * item.quantity;
    const missing = selected ? 0 : item.quantity;
    totalQuantity += item.quantity;
    totalValue += value;
    missingPriceQuantity += missing;

    const locationId = item.location?.id ?? "unassigned";
    const locationLabel = item.location?.name ?? "Unassigned";
    addValue(
      locationRows,
      locationId,
      locationLabel,
      item.quantity,
      value,
      missing,
    );

    if (item.location?.deckId) {
      addValue(
        deckRows,
        item.location.deckId,
        item.location.deck?.name ?? item.location.name,
        item.quantity,
        value,
        missing,
      );
    }
  }

  const sortRows = (rows: Iterable<CollectionValueRow>) =>
    [...rows].sort(
      (a, b) => b.value - a.value || a.label.localeCompare(b.label),
    );

  return {
    totalQuantity,
    totalValue,
    missingPriceQuantity,
    locationRows: sortRows(locationRows.values()),
    deckRows: sortRows(deckRows.values()),
  };
}

function cardLabel(row: PricingDashboardMover) {
  const name = row.cardName || `Unmapped MTGJSON card ${row.mtgjsonUuid}`;
  const printing = [row.setCode?.toUpperCase(), row.collectorNumber]
    .filter(Boolean)
    .join(" #");
  return printing ? `${name} (${printing})` : name;
}

function ValueTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: CollectionValueRow[];
  emptyLabel: string;
}) {
  return (
    <section className="rounded border border-zinc-800 bg-zinc-950/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2 text-right">Cards</th>
              <th className="px-4 py-2 text-right">Value</th>
              <th className="px-4 py-2 text-right">No price</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-900">
                  <td className="max-w-[26rem] px-4 py-2 text-zinc-100">
                    <span className="line-clamp-1">{row.label}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {numberLabel(row.quantity)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-zinc-100">
                    {money(row.value)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-500">
                    {numberLabel(row.missingPriceQuantity)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={4}>
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MoversTable({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: PricingDashboardMover[];
  currency: string;
}) {
  return (
    <section className="rounded border border-zinc-800 bg-zinc-950/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="px-4 py-2">Card</th>
              <th className="px-4 py-2 text-right">Start</th>
              <th className="px-4 py-2 text-right">Current</th>
              <th className="px-4 py-2 text-right">Change</th>
              <th className="px-4 py-2 text-right">Percent</th>
              <th className="px-4 py-2">Range</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.mtgjsonUuid} className="border-t border-zinc-900">
                  <td className="max-w-[24rem] px-4 py-2 text-zinc-100">
                    <span className="line-clamp-1">{cardLabel(row)}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {money(row.startPrice, currency)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {money(row.currentPrice, currency)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right ${
                      row.absoluteChange >= 0
                        ? "text-emerald-200"
                        : "text-red-200"
                    }`}
                  >
                    {row.absoluteChange >= 0 ? "+" : ""}
                    {money(row.absoluteChange, currency)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {percentLabel(row.percentChange)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-500">
                    {row.startObservedDate} to {row.currentObservedDate}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={6}>
                  No price movement found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function cleanView(value: string | undefined): PricingView {
  return value === "data" ? "data" : "market";
}

function pricingHref(
  params: Record<string, string | undefined>,
  view: PricingView,
) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "view") next.set(key, value);
  }
  if (view !== "market") next.set("view", view);
  const query = next.toString();
  return query ? `/pricing?${query}` : "/pricing";
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`rounded-t border border-b-0 border-zinc-800 px-3 py-2 text-sm ${
        active
          ? "bg-zinc-900 text-sky-100"
          : "bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
      }`}
    >
      {children}
    </a>
  );
}

async function enrichMovers(rows: PricingDashboardMover[]) {
  const uuids = [...new Set(rows.map((row) => row.mtgjsonUuid))];
  if (!uuids.length) return rows;
  const cards = await prisma.card.findMany({
    where: { mtgjsonUuid: { in: uuids } },
    select: {
      mtgjsonUuid: true,
      name: true,
      setCode: true,
      collectorNumber: true,
    },
  });
  const byUuid = new Map(
    cards
      .filter((card) => card.mtgjsonUuid)
      .map((card) => [card.mtgjsonUuid as string, card]),
  );
  return rows.map((row) => {
    const card = byUuid.get(row.mtgjsonUuid);
    return card
      ? {
          ...row,
          cardName: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        }
      : row;
  });
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireLogin();
  const params = await searchParams;
  const activeView = cleanView(params.view);
  const [dashboard, collectionValue] = await Promise.all([
    getPricingDashboard({
      provider: params.provider,
      finish: params.finish,
      priceType: params.priceType,
      currency: params.currency,
      range: params.range as never,
    }),
    getCollectionValueSummary({
      ownerPlayerId: user.playerId,
      preferredProvider: user.preferredPriceProvider,
    }),
  ]);
  const [topGainers, topLosers, topPercentMoves] = await Promise.all([
    enrichMovers(dashboard.topGainers),
    enrichMovers(dashboard.topLosers),
    enrichMovers(dashboard.topPercentMoves),
  ]);

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-3 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Pricing analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Read-only MTGJSON history from the separate pricing database.
              Inventory and deck pages stay on their lightweight app-database
              price fields.
            </p>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
            {dashboard.provider} / {dashboard.finish} / {dashboard.priceType} /{" "}
            {dashboard.currency} / {dashboard.range} days
          </div>
        </div>
        {!dashboard.available ? (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
            Pricing analytics are unavailable: {dashboard.error}
          </div>
        ) : null}
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-950/60">
        <div className="flex gap-2 border-b border-zinc-800 px-4 pt-3">
          <TabLink
            href={pricingHref(params, "market")}
            active={activeView === "market"}
          >
            Market movers
          </TabLink>
          <TabLink
            href={pricingHref(params, "data")}
            active={activeView === "data"}
          >
            Data status
          </TabLink>
        </div>
      </section>

      {activeView === "market" ? (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <StatCard
              label="Collection value"
              value={money(collectionValue.totalValue)}
              detail={`${numberLabel(
                collectionValue.totalQuantity,
              )} cards tracked`}
            />
            <StatCard
              label="Deck value"
              value={money(
                collectionValue.deckRows.reduce(
                  (total, row) => total + row.value,
                  0,
                ),
              )}
              detail={`${numberLabel(collectionValue.deckRows.length)} decks`}
            />
            <StatCard
              label="Cards without price"
              value={numberLabel(collectionValue.missingPriceQuantity)}
              detail="Excluded from value totals"
            />
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <ValueTable
              title="Value by location"
              rows={collectionValue.locationRows}
              emptyLabel="No inventory locations have priced cards yet."
            />
            <ValueTable
              title="Value by deck"
              rows={collectionValue.deckRows}
              emptyLabel="No deck locations have priced cards yet."
            />
          </div>
          <section className="rounded border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 className="text-lg font-semibold text-zinc-100">
              Market movement
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Showing card-level MTGJSON movement for {dashboard.provider},{" "}
              {dashboard.finish}, {dashboard.priceType}, {dashboard.currency}
              over the selected {dashboard.range}-day range.
            </p>
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <MoversTable
              title="Top gainers"
              rows={topGainers}
              currency={dashboard.currency}
            />
            <MoversTable
              title="Top losers"
              rows={topLosers}
              currency={dashboard.currency}
            />
          </div>
          <MoversTable
            title="Largest percentage moves"
            rows={topPercentMoves}
            currency={dashboard.currency}
          />
        </>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Historical snapshots"
              value={numberLabel(dashboard.stats.snapshotCount)}
              detail={`${numberLabel(
                dashboard.stats.pricedCardCount,
              )} priced cards`}
            />
            <StatCard
              label="Latest observed"
              value={dateLabel(dashboard.stats.latestObservedDate)}
              detail={`Ingested ${dateLabel(dashboard.stats.latestIngestedAt)}`}
            />
            <StatCard
              label="Providers"
              value={numberLabel(dashboard.stats.providerCount)}
              detail={`${numberLabel(
                dashboard.stats.currencyCount,
              )} currencies`}
            />
          </section>
          <section className="rounded border border-zinc-800 bg-zinc-950/60">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-lg font-semibold text-zinc-100">
                Provider coverage
              </h2>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {dashboard.providerCoverage.length ? (
                dashboard.providerCoverage.map((row) => (
                  <div
                    key={`${row.provider}-${row.currency}`}
                    className="rounded border border-zinc-800 bg-zinc-900/50 p-3"
                  >
                    <div className="font-semibold text-zinc-100">
                      {row.provider} / {row.currency}
                    </div>
                    <div className="mt-1 text-sm text-zinc-400">
                      {numberLabel(row.snapshotCount)} snapshots across{" "}
                      {numberLabel(row.pricedCardCount)} cards
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Latest observed {dateLabel(row.latestObservedDate)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-zinc-500">
                  No provider coverage is available yet.
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
