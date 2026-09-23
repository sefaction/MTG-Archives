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

import {
  cleanPricingView as cleanView,
  pricingWorkspaceHref as pricingHref,
  usdCopyValue,
  collectionValueLabel,
} from "@/lib/pricing-workspace";

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
  ownedCards: Array<{ mtgjsonUuid: string; quantity: number }>;
  setOptions: Array<{ value: string; label: string }>;
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

function cleanSetFilter(value: string | undefined) {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z0-9_]{2,8}$/.test(clean) ? clean : "";
}

function cleanPercentFilter(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1000, parsed)) : null;
}

function cleanDirectionFilter(value: string | undefined) {
  return value === "gainers" || value === "losers" ? value : "all";
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
      ownedCards: [],
      setOptions: [],
    };
  }

  const items = await prisma.inventoryItem.findMany({
    where: { currentOwnerId: ownerPlayerId, quantity: { gt: 0 } },
    select: {
      quantity: true,
      foilStatus: true,
      card: { select: { prices: true, mtgjsonUuid: true, setCode: true } },
      location: {
        select: {
          id: true,
          name: true,
          deckId: true,
          kind: true,
          deck: { select: { id: true, name: true } },
        },
      },
    },
  });

  const locationRows = new Map<string, CollectionValueRow>();
  const deckRows = new Map<string, CollectionValueRow>();
  const ownedCards = new Map<string, number>();
  const setOptions = new Map<string, string>();
  let totalQuantity = 0;
  let totalValue = 0;
  let missingPriceQuantity = 0;

  for (const item of items) {
    const selected = selectPreferredCardPrice(undefined, item.card.prices, {
      finish: finishForFoilStatus(item.foilStatus),
      preferredProvider: preferredProvider || undefined,
    });
    const { value, missing } = usdCopyValue(selected, item.quantity);
    totalQuantity += item.quantity;
    totalValue += value;
    missingPriceQuantity += missing;

    if (item.card.mtgjsonUuid) {
      ownedCards.set(
        item.card.mtgjsonUuid,
        (ownedCards.get(item.card.mtgjsonUuid) ?? 0) + item.quantity,
      );
    }
    if (item.card.setCode) {
      setOptions.set(item.card.setCode.toUpperCase(), item.card.setCode);
    }

    const isDeckLocation = Boolean(item.location?.deckId);
    if (!isDeckLocation) {
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
    }

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
    ownedCards: [...ownedCards.entries()].map(([mtgjsonUuid, quantity]) => ({
      mtgjsonUuid,
      quantity,
    })),
    setOptions: [...setOptions.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label: label.toUpperCase() })),
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
    <section className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      </div>
      <div
        className="max-h-[32rem] overflow-auto"
        role="region"
        aria-label={`${title} table`}
        tabIndex={0}
      >
        <table className="min-w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2 text-right">Cards</th>
              <th className="px-4 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-900">
                  <td className="max-w-[26rem] px-4 py-2 text-zinc-100">
                    <span className="line-clamp-1" title={row.label}>
                      {row.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {numberLabel(row.quantity)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-zinc-100">
                    {collectionValueLabel(
                      row.value,
                      row.quantity,
                      row.missingPriceQuantity,
                    )}
                    {row.missingPriceQuantity > 0 ? (
                      <span className="block text-xs font-normal text-[var(--app-muted)]">
                        {numberLabel(row.missingPriceQuantity)} unpriced copies
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={3}>
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

function TrendChart({
  title,
  points,
  currency,
}: {
  title: string;
  points: Array<{ observedDate: string; value: number }>;
  currency: string;
}) {
  const width = 900;
  const height = 260;
  const padding = 28;
  const values = points.map((point) => point.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x =
        padding +
        (points.length <= 1
          ? 0
          : (index / (points.length - 1)) * (width - padding * 2));
      const y =
        height -
        padding -
        ((point.value - min) / span) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const latest = points[points.length - 1];
  const first = points[0];
  const change = first && latest ? latest.value - first.value : null;

  return (
    <section className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Daily total of filtered owned cards with available MTGJSON prices.
          </p>
        </div>
        {latest ? (
          <div className="text-right text-sm">
            <div className="font-semibold text-zinc-100">
              {money(latest.value, currency)}
            </div>
            <div
              className={
                change == null || change >= 0
                  ? "text-emerald-200"
                  : "text-red-200"
              }
            >
              {change == null || change >= 0 ? "+" : ""}
              {change == null ? "--" : money(change, currency)}
            </div>
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {points.length ? (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={title}
            className="h-64 w-full rounded border border-zinc-900 bg-zinc-950"
          >
            <line
              x1={padding}
              x2={width - padding}
              y1={height - padding}
              y2={height - padding}
              stroke="rgb(63 63 70)"
            />
            <line
              x1={padding}
              x2={padding}
              y1={padding}
              y2={height - padding}
              stroke="rgb(63 63 70)"
            />
            <path
              d={path}
              fill="none"
              stroke="rgb(125 211 252)"
              strokeWidth="3"
            />
            {points.map((point, index) => {
              if (points.length > 30 && index % Math.ceil(points.length / 30)) {
                return null;
              }
              const x =
                padding +
                (points.length <= 1
                  ? 0
                  : (index / (points.length - 1)) * (width - padding * 2));
              const y =
                height -
                padding -
                ((point.value - min) / span) * (height - padding * 2);
              return (
                <circle
                  key={point.observedDate}
                  cx={x}
                  cy={y}
                  r="3"
                  fill="rgb(186 230 253)"
                >
                  <title>
                    {point.observedDate}: {money(point.value, currency)}
                  </title>
                </circle>
              );
            })}
          </svg>
        ) : (
          <div className="rounded border border-zinc-900 p-8 text-center text-sm text-zinc-500">
            No trend data found for these filters.
          </div>
        )}
      </div>
    </section>
  );
}

function PricingFilters({
  params,
  setOptions,
}: {
  params: Record<string, string | undefined>;
  setOptions: Array<{ value: string; label: string }>;
}) {
  return (
    <form
      method="get"
      className="grid min-w-0 gap-3 rounded border border-zinc-800 bg-zinc-950/60 p-4 md:grid-cols-5"
    >
      <input type="hidden" name="view" value={cleanView(params.view)} />
      {["provider", "finish", "priceType", "currency"].map((key) =>
        params[key] ? (
          <input key={key} type="hidden" name={key} value={params[key]} />
        ) : null,
      )}
      <label className="min-w-0 text-sm text-zinc-300">
        Set
        <select
          name="set"
          defaultValue={cleanSetFilter(params.set)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        >
          <option value="">All owned sets</option>
          {setOptions.map((set) => (
            <option key={set.value} value={set.value}>
              {set.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-zinc-300">
        Change
        <select
          name="direction"
          defaultValue={cleanDirectionFilter(params.direction)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        >
          <option value="all">Any direction</option>
          <option value="gainers">Gainers only</option>
          <option value="losers">Losers only</option>
        </select>
      </label>
      <label className="text-sm text-zinc-300">
        Minimum %
        <input
          name="minPercent"
          type="number"
          min="0"
          max="1000"
          step="1"
          defaultValue={params.minPercent ?? ""}
          placeholder="50"
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        />
      </label>
      <label className="text-sm text-zinc-300">
        Range
        <select
          name="range"
          defaultValue={params.range ?? "90"}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        >
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="all">All history</option>
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button className="rounded border border-sky-600 bg-sky-950/50 px-3 py-2 text-sm text-sky-100">
          Apply
        </button>
        <a
          href={pricingHref({}, cleanView(params.view))}
          className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
        >
          Clear
        </a>
      </div>
    </form>
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
    <section className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      </div>
      <div
        className="max-h-[32rem] overflow-auto"
        role="region"
        aria-label={`${title} table`}
        tabIndex={0}
      >
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
      aria-current={active ? "page" : undefined}
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
  const collectionValue = await getCollectionValueSummary({
    ownerPlayerId: user.playerId,
    preferredProvider: user.preferredPriceProvider,
  });
  const setFilter = cleanSetFilter(params.set);
  const minPercentFilter = cleanPercentFilter(params.minPercent);
  const directionFilter = cleanDirectionFilter(params.direction);
  const dashboard = await getPricingDashboard({
    provider: params.provider,
    finish: params.finish,
    priceType: params.priceType,
    currency: params.currency,
    range: params.range as never,
    ownedCards: collectionValue.ownedCards,
    setCode: setFilter,
    minPercentChange: minPercentFilter,
    changeDirection: directionFilter,
  });
  const [topGainers, topLosers, topPercentMoves] = await Promise.all([
    enrichMovers(dashboard.topGainers),
    enrichMovers(dashboard.topLosers),
    enrichMovers(dashboard.topPercentMoves),
  ]);

  return (
    <main className="min-w-0 space-y-4 p-4 sm:p-8">
      <Nav />
      <section className="space-y-3 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Pricing analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Your collection estimates, historical trends and market changes.
              Pricing is read-only; your inventory quantities stay unchanged.
            </p>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
            History: {dashboard.provider} / {dashboard.finish} /{" "}
            {dashboard.priceType} / {dashboard.currency} / {dashboard.range}{" "}
            days
          </div>
        </div>
        {!dashboard.available ? (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
            Pricing analytics are unavailable: {dashboard.error}
          </div>
        ) : null}
      </section>

      <section className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60">
        <nav
          aria-label="Pricing tasks"
          className="flex flex-wrap gap-2 border-b border-zinc-800 px-4 pt-3"
        >
          <TabLink
            href={pricingHref(params, "collection")}
            active={activeView === "collection"}
          >
            Collection value
          </TabLink>
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
        </nav>
      </section>

      {activeView === "collection" ? (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <StatCard
              label="Collection value"
              value={collectionValueLabel(
                collectionValue.totalValue,
                collectionValue.totalQuantity,
                collectionValue.missingPriceQuantity,
              )}
              detail={`${numberLabel(
                collectionValue.totalQuantity,
              )} copies; ${numberLabel(collectionValue.missingPriceQuantity)} unpriced (USD)`}
            />
            <StatCard
              label="Deck value"
              value={collectionValueLabel(
                collectionValue.deckRows.reduce(
                  (total, row) => total + row.value,
                  0,
                ),
                collectionValue.deckRows.reduce(
                  (total, row) => total + row.quantity,
                  0,
                ),
                collectionValue.deckRows.reduce(
                  (total, row) => total + row.missingPriceQuantity,
                  0,
                ),
              )}
              detail={`${numberLabel(collectionValue.deckRows.length)} decks; ${numberLabel(collectionValue.deckRows.reduce((total, row) => total + row.missingPriceQuantity, 0))} unpriced copies (USD)`}
            />
            <StatCard
              label="Unpriced copies"
              value={numberLabel(collectionValue.missingPriceQuantity)}
              detail="Excluded from current USD estimates"
            />
          </section>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
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
          <p className="text-sm text-[var(--app-muted)]">
            Current estimates: USD, preferred provider{" "}
            {user.preferredPriceProvider}, with available provider/finish
            fallbacks. Cached prices may be stale.{" "}
            {numberLabel(collectionValue.missingPriceQuantity)} copies without a
            usable USD price are excluded, not valued at zero. Current totals
            cover your whole collection; filters below affect historical results
            only.
          </p>
          <section
            aria-label="Historical collection prices"
            className="min-w-0 space-y-3"
          >
            <p className="text-sm text-[var(--app-muted)]">
              Historical scope: {dashboard.provider} / {dashboard.finish} /{" "}
              {dashboard.priceType} / {dashboard.currency}. Latest observed{" "}
              {dateLabel(dashboard.stats.latestObservedDate)}.{" "}
              {numberLabel(dashboard.stats.pricedCardCount)} owned printings
              with history.
            </p>
            <PricingFilters
              params={params}
              setOptions={collectionValue.setOptions}
            />
            <TrendChart
              title="Collection price trend"
              points={dashboard.valueTrend}
              currency={dashboard.currency}
            />
          </section>
        </>
      ) : activeView === "market" ? (
        <>
          <PricingFilters
            params={params}
            setOptions={collectionValue.setOptions}
          />
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
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
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
            <StatCard
              label="Cards without price"
              value={numberLabel(collectionValue.missingPriceQuantity)}
              detail="Current collection rows excluded from value totals"
            />
          </section>
          <section className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60">
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
