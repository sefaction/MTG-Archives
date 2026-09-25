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
  ownedCards: Array<{
    mtgjsonUuid: string;
    quantity: number;
    setCode?: string | null;
    finish?: string;
    cardName?: string;
  }>;
  setOptions: Array<{ value: string; label: string }>;
};

type OwnedPriceCard = CollectionValueSummary["ownedCards"][number];

function addOwnedPriceCard(
  cards: Map<string, OwnedPriceCard>,
  item: {
    quantity: number;
    foilStatus: string;
    card: { mtgjsonUuid: string | null; setCode: string | null; name?: string };
  },
) {
  if (!item.card.mtgjsonUuid) return;
  const finish = finishForFoilStatus(item.foilStatus);
  const key = `${item.card.mtgjsonUuid}\u0000${finish}`;
  const previous = cards.get(key);
  cards.set(key, {
    mtgjsonUuid: item.card.mtgjsonUuid,
    finish,
    setCode: item.card.setCode,
    cardName: item.card.name,
    quantity: (previous?.quantity ?? 0) + item.quantity,
  });
}

function emptyCollectionValueSummary(): CollectionValueSummary {
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

async function getOwnedPriceScope(ownerPlayerId: string | null) {
  if (!ownerPlayerId)
    return { ownedCards: [], setOptions: [] } satisfies Pick<
      CollectionValueSummary,
      "ownedCards" | "setOptions"
    >;
  const items = await prisma.inventoryItem.findMany({
    where: { currentOwnerId: ownerPlayerId, quantity: { gt: 0 } },
    select: {
      quantity: true,
      foilStatus: true,
      card: { select: { mtgjsonUuid: true, setCode: true, name: true } },
    },
  });
  const ownedCards = new Map<string, OwnedPriceCard>();
  const setOptions = new Map<string, string>();
  for (const item of items) {
    addOwnedPriceCard(ownedCards, item);
    if (item.card.setCode)
      setOptions.set(item.card.setCode.toUpperCase(), item.card.setCode);
  }
  return {
    ownedCards: [...ownedCards.values()],
    setOptions: [...setOptions.entries()].map(([value, label]) => ({
      value,
      label,
    })),
  };
}

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

function cleanDollarFilter(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(1_000_000, parsed))
    : null;
}

function cleanThresholdMode(value: string | undefined) {
  return value === "percent" || value === "either" ? value : "absolute";
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
    return emptyCollectionValueSummary();
  }

  const items = await prisma.inventoryItem.findMany({
    where: { currentOwnerId: ownerPlayerId, quantity: { gt: 0 } },
    select: {
      quantity: true,
      foilStatus: true,
      card: {
        select: { prices: true, mtgjsonUuid: true, setCode: true, name: true },
      },
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
  const ownedCards = new Map<string, OwnedPriceCard>();
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

    addOwnedPriceCard(ownedCards, item);
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
    ownedCards: [...ownedCards.values()],
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
  resolution,
}: {
  title: string;
  points: Array<{ observedDate: string; value: number }>;
  currency: string;
  resolution: "daily" | "monthly";
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
            {resolution === "monthly" ? "Monthly closing" : "Daily"} prices
            applied to today&apos;s filtered holdings; missing observations are
            excluded.
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
  const view = cleanView(params.view);
  const market = view === "market";
  return (
    <form
      method="get"
      className="grid min-w-0 gap-3 rounded border border-zinc-800 bg-zinc-950/60 p-4 md:grid-cols-4"
    >
      <input type="hidden" name="view" value={view} />
      {!market &&
        ["provider", "finish", "priceType", "currency"].map((key) =>
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
      {market ? (
        <label className="min-w-0 text-sm text-zinc-300">
          Card name
          <input
            name="cardName"
            type="search"
            defaultValue={params.cardName ?? ""}
            placeholder="Find an owned card"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
      ) : null}
      {market ? (
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
      ) : null}
      <label className="text-sm text-zinc-300">
        {market ? "Observed within" : "Range"}
        <select
          name="range"
          defaultValue={params.range ?? (market ? "7" : "90")}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        >
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="all">All available history</option>
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
      {market ? (
        <details className="min-w-0 rounded border border-zinc-800 p-3 md:col-span-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-200">
            Price source and movement threshold · ${params.minAbsolute ?? "2"}
            {" per card by default"}
          </summary>
          <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-4">
            <label className="text-sm text-zinc-300">
              Provider
              <select
                name="provider"
                defaultValue={params.provider ?? "tcgplayer"}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              >
                {[
                  "tcgplayer",
                  "cardmarket",
                  "cardkingdom",
                  "manapool",
                  "mtgo",
                  "cardhoarder",
                ].map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-zinc-300">
              Finish
              <select
                name="finish"
                defaultValue={params.finish ?? "normal"}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              >
                <option value="normal">Normal</option>
                <option value="foil">Foil</option>
                <option value="etched">Etched</option>
              </select>
            </label>
            <label className="text-sm text-zinc-300">
              Price type
              <select
                name="priceType"
                defaultValue={params.priceType ?? "retail"}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              >
                <option value="retail">Retail</option>
                <option value="buylist">Buylist</option>
              </select>
            </label>
            <label className="text-sm text-zinc-300">
              Currency
              <input
                name="currency"
                maxLength={3}
                pattern="[A-Za-z]{3}"
                defaultValue={params.currency ?? "USD"}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
            </label>
            <label className="text-sm text-zinc-300">
              Threshold rule
              <select
                name="thresholdMode"
                defaultValue={cleanThresholdMode(params.thresholdMode)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              >
                <option value="absolute">Dollar change</option>
                <option value="percent">Percent change</option>
                <option value="either">Either threshold</option>
              </select>
            </label>
            <label className="text-sm text-zinc-300">
              Minimum per-card change
              <input
                name="minAbsolute"
                type="number"
                min="0"
                step="0.01"
                defaultValue={params.minAbsolute ?? "2"}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
            </label>
            <label className="text-sm text-zinc-300">
              Minimum percent
              <input
                name="minPercent"
                type="number"
                min="0"
                step="0.1"
                defaultValue={params.minPercent ?? "25"}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
            </label>
            <label className="text-sm text-zinc-300">
              Minimum prior price for percent
              <input
                name="minPrior"
                type="number"
                min="0"
                step="0.01"
                defaultValue={params.minPrior ?? "1"}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
            </label>
          </div>
        </details>
      ) : null}
    </form>
  );
}

function MoversTable({
  title,
  rows,
  currency,
  provider,
  finish,
  priceType,
}: {
  title: string;
  rows: PricingDashboardMover[];
  currency: string;
  provider: string;
  finish: string;
  priceType: string;
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
              <th className="px-4 py-2 text-right">Owned</th>
              <th className="px-4 py-2 text-right">Collection impact</th>
              <th className="px-4 py-2">Range</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.mtgjsonUuid} className="border-t border-zinc-900">
                  <td className="max-w-[24rem] px-4 py-2 text-zinc-100">
                    {row.cardId ? (
                      <a
                        className="text-sky-200 underline underline-offset-2"
                        href={`/pricing/card/${encodeURIComponent(row.cardId)}?${new URLSearchParams({ provider, finish, priceType, currency, range: "90" })}`}
                      >
                        {cardLabel(row)}
                      </a>
                    ) : (
                      cardLabel(row)
                    )}
                    {row.isStale ? (
                      <span className="ml-2 rounded border border-amber-700 px-1 py-0.5 text-xs text-amber-200">
                        Stale observation
                      </span>
                    ) : null}
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
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {numberLabel(row.ownedQuantity)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {money(row.collectionImpact ?? 0, currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-500">
                    {row.startObservedDate} to {row.currentObservedDate}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={8}>
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
      id: true,
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
          cardId: card.id,
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
  const collectionValue =
    activeView === "market"
      ? emptyCollectionValueSummary()
      : await getCollectionValueSummary({
          ownerPlayerId: user.playerId,
          preferredProvider: user.preferredPriceProvider,
        });
  const ownedScope =
    activeView === "market"
      ? await getOwnedPriceScope(user.playerId)
      : collectionValue;
  const setFilter = cleanSetFilter(params.set);
  const cardNameFilter = params.cardName?.trim().toLocaleLowerCase() ?? "";
  const minPercentFilter = cleanPercentFilter(params.minPercent);
  const minAbsoluteFilter = cleanDollarFilter(params.minAbsolute);
  const minPriorFilter = cleanDollarFilter(params.minPrior);
  const directionFilter = cleanDirectionFilter(params.direction);
  const dashboard = await getPricingDashboard({
    view: activeView,
    provider: params.provider,
    finish: params.finish,
    priceType: params.priceType,
    currency: params.currency,
    range: (params.range ?? (activeView === "market" ? "7" : "90")) as never,
    ownedCards:
      activeView === "market" && cardNameFilter
        ? ownedScope.ownedCards.filter((card) =>
            card.cardName?.toLocaleLowerCase().includes(cardNameFilter),
          )
        : ownedScope.ownedCards,
    setCode: setFilter,
    minPercentChange: minPercentFilter,
    minAbsoluteChange: minAbsoluteFilter,
    minPriorPrice: minPriorFilter,
    thresholdMode: cleanThresholdMode(params.thresholdMode),
    changeDirection: directionFilter,
  });
  const [topGainers, topLosers, topPercentMoves] =
    activeView === "market"
      ? await Promise.all([
          enrichMovers(dashboard.topGainers),
          enrichMovers(dashboard.topLosers),
          enrichMovers(dashboard.topPercentMoves),
        ])
      : [[], [], []];

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
            {dashboard.priceType} / {dashboard.currency} /{" "}
            {dashboard.range === "all"
              ? "all history"
              : `${dashboard.range} days`}
          </div>
        </div>
        {dashboard.summaryRefreshedAt ? (
          <p className="text-xs text-zinc-400">
            History summary refreshed {dateLabel(dashboard.summaryRefreshedAt)}.
          </p>
        ) : null}
        {!dashboard.available ? (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
            Pricing analytics are unavailable: {dashboard.error}{" "}
            <a
              className="font-semibold underline"
              href={pricingHref(params, activeView)}
            >
              Retry pricing data
            </a>
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
            Owned movers
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
              setOptions={ownedScope.setOptions}
            />
            <TrendChart
              title="Collection price trend"
              points={dashboard.valueTrend}
              currency={dashboard.currency}
              resolution={dashboard.trendResolution}
            />
          </section>
        </>
      ) : activeView === "market" ? (
        <>
          <PricingFilters params={params} setOptions={ownedScope.setOptions} />
          <section className="rounded border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 className="text-lg font-semibold text-zinc-100">
              Meaningful daily changes in your cards
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Exact owned printings with at least a $2 per-card change by
              default, from the preceding valid daily observation. Showing{" "}
              {dashboard.provider} / {dashboard.finish} / {dashboard.priceType}{" "}
              / {dashboard.currency}; observations within{" "}
              {dashboard.range === "all"
                ? "all available history"
                : `${dashboard.range} days`}
              . Change the threshold and source above. Stale prices are marked;
              cards without a preceding observation cannot be ranked yet.
            </p>
            <p className="mt-2 text-sm text-zinc-300">
              {numberLabel(dashboard.movementCoverage.pricedPrintings)} of{" "}
              {numberLabel(dashboard.movementCoverage.ownedPrintings)} owned
              printings have a price for this source;{" "}
              {numberLabel(
                dashboard.movementCoverage.ownedPrintings -
                  dashboard.movementCoverage.pricedPrintings,
              )}{" "}
              are unpriced,{" "}
              {numberLabel(dashboard.movementCoverage.withoutPrior)} have no
              prior observation, and{" "}
              {numberLabel(dashboard.movementCoverage.stalePrintings)} have
              stale prices. Latest observation:{" "}
              {dateLabel(dashboard.movementCoverage.latestObservedDate)}.
            </p>
          </section>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <MoversTable
              title="Top gainers"
              rows={topGainers}
              currency={dashboard.currency}
              provider={dashboard.provider}
              finish={dashboard.finish}
              priceType={dashboard.priceType}
            />
            <MoversTable
              title="Top losers"
              rows={topLosers}
              currency={dashboard.currency}
              provider={dashboard.provider}
              finish={dashboard.finish}
              priceType={dashboard.priceType}
            />
          </div>
          <MoversTable
            title="Largest percentage moves"
            rows={topPercentMoves}
            currency={dashboard.currency}
            provider={dashboard.provider}
            finish={dashboard.finish}
            priceType={dashboard.priceType}
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
