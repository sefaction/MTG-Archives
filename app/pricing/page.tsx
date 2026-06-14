export const dynamic = "force-dynamic";

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { requireLogin, getAccessScope } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getPricingAnalytics,
  getPricingFilterOptions,
  money,
  type PricingRange,
  type PricingScope,
} from "@/lib/pricing-analytics";

function signedMoney(value: number, currency: string) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${money(Math.abs(value), currency)}`;
}

function pct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-sm text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-50">{value}</p>
      {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
    </div>
  );
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireLogin();
  const accessScope = await getAccessScope(user);
  if (!accessScope) return null;
  const pricingAnalyticsEnabled = process.env.ENABLE_PRICING_ANALYTICS !== "false";
  if (!pricingAnalyticsEnabled) {
    return (
      <main className="space-y-6 p-8">
        <Nav />
        <h1 className="text-3xl font-bold">Pricing analytics</h1>
        <p className="rounded border border-amber-800 bg-amber-950/20 p-4 text-amber-100">
          Pricing analytics are temporarily disabled by ENABLE_PRICING_ANALYTICS=false.
        </p>
      </main>
    );
  }
  const params = await searchParams;
  const scope = (params.scope === "location" || params.scope === "card" ? params.scope : "collection") as PricingScope;
  const range = (["7", "30", "90", "all"].includes(String(params.range)) ? String(params.range) : "30") as PricingRange;
  const provider = String(params.provider || user.preferredPriceProvider || "tcgplayer");
  const finish = String(params.finish || "any");
  const priceType = String(params.priceType || "retail");
  const currency = String(params.currency || "USD").toUpperCase();
  const locationId = typeof params.locationId === "string" ? params.locationId : undefined;
  const cardId = typeof params.cardId === "string" ? params.cardId : undefined;

  const ownerWhere = accessScope.mode === "admin" ? {} : { currentOwnerId: accessScope.playerId || "" };
  const [filterOptions, locations, cards, analytics] = await Promise.all([
    getPricingFilterOptions(),
    prisma.inventoryLocation.findMany({
      where: accessScope.mode === "admin" ? {} : { ownerPlayerId: accessScope.playerId || "" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.inventoryItem.findMany({
      where: { quantity: { gt: 0 }, ...ownerWhere },
      distinct: ["cardId"],
      take: 200,
      orderBy: { card: { name: "asc" } },
      select: { card: { select: { id: true, name: true, setCode: true, collectorNumber: true } } },
    }),
    getPricingAnalytics({ accessScope, scope, locationId, cardId, provider, finish, priceType, currency, range }),
  ]);

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Pricing analytics</h1>
          <p className="text-zinc-400">
            Collection, location, and card value trends use current inventory quantities with historical prices.
          </p>
        </div>
        <Link className="rounded border border-sky-700 px-3 py-2 text-sm text-sky-100" href="/admin/prices">
          Manage price imports
        </Link>
      </div>

      <form className="grid gap-3 rounded border border-zinc-800 p-4 md:grid-cols-6" action="/pricing">
        <label className="text-sm">
          <span className="text-zinc-400">Scope</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="scope" defaultValue={scope}>
            <option value="collection">Collection</option>
            <option value="location">Location</option>
            <option value="card">Card</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Range</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="range" defaultValue={range}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="all">All history</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Provider</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="provider" defaultValue={provider}>
            {[...new Set([provider, ...filterOptions.providers, "scryfall"])].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Finish</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="finish" defaultValue={finish}>
            <option value="any">Inventory finish</option>
            {filterOptions.finishes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Price type</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="priceType" defaultValue={priceType}>
            {[...new Set([priceType, ...filterOptions.priceTypes])].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Currency</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="currency" defaultValue={currency}>
            {[...new Set([currency, ...filterOptions.currencies])].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-3">
          <span className="text-zinc-400">Location scope</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="locationId" defaultValue={locationId || ""}>
            <option value="">All locations</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-3">
          <span className="text-zinc-400">Card scope</span>
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2" name="cardId" defaultValue={cardId || ""}>
            <option value="">Select a card</option>
            {cards.map(({ card }) => <option key={card.id} value={card.id}>{card.name} ({card.setCode.toUpperCase()} #{card.collectorNumber})</option>)}
          </select>
        </label>
        <button className="rounded bg-sky-600 px-3 py-2 text-sm font-semibold md:col-span-6" type="submit">Update analytics</button>
      </form>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Current value" value={money(analytics.currentValue, analytics.currency)} detail={`${analytics.totalCards} cards · ${analytics.uniqueCards} unique`} />
        <SummaryCard label={`${analytics.range}-day change`} value={`${signedMoney(analytics.valueChange, analytics.currency)} (${pct(analytics.percentChange)})`} />
        <SummaryCard label="Missing prices" value={String(analytics.missingPrices)} detail="Inventory copies without selected pricing" />
        <SummaryCard label="Scope" value={analytics.scope} detail={analytics.cardLabel || "Current quantities · historical prices"} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-zinc-800 p-4">
          <h2 className="text-xl font-semibold">Top gainers</h2>
          <div className="mt-3 space-y-2">
            {analytics.topGainers.map((row) => (
              <div key={`${row.cardId}-${row.finish}`} className="flex justify-between gap-3 border-b border-zinc-900 pb-2 text-sm">
                <span>{row.name} <span className="text-zinc-500">{row.setCode.toUpperCase()} #{row.collectorNumber} · {row.quantity} copies</span></span>
                <span className="text-emerald-300">{signedMoney(row.valueChange, analytics.currency)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded border border-zinc-800 p-4">
          <h2 className="text-xl font-semibold">Top losers</h2>
          <div className="mt-3 space-y-2">
            {analytics.topLosers.map((row) => (
              <div key={`${row.cardId}-${row.finish}`} className="flex justify-between gap-3 border-b border-zinc-900 pb-2 text-sm">
                <span>{row.name} <span className="text-zinc-500">{row.setCode.toUpperCase()} #{row.collectorNumber} · {row.quantity} copies</span></span>
                <span className="text-rose-300">{signedMoney(row.valueChange, analytics.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded border border-zinc-800 p-4">
        <h2 className="text-xl font-semibold">Location values</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-400"><tr><th>Location</th><th>Cards</th><th>Unique</th><th>Current</th><th>Change</th></tr></thead>
            <tbody>
              {analytics.locationRows.map((row) => (
                <tr key={row.id || "unassigned"} className="border-t border-zinc-900">
                  <td className="py-2">{row.name}</td><td>{row.quantity}</td><td>{row.uniqueCards}</td><td>{money(row.currentValue, analytics.currency)}</td><td>{signedMoney(row.valueChange, analytics.currency)} ({pct(row.percentChange)})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {analytics.cardHistory.length ? (
        <section className="rounded border border-zinc-800 p-4">
          <h2 className="text-xl font-semibold">Individual card price history</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-400"><tr><th>Date</th><th>Provider</th><th>Finish</th><th>Type</th><th>Price</th></tr></thead>
              <tbody>
                {analytics.cardHistory.map((row, index) => (
                  <tr key={`${row.observedDate}-${row.provider}-${row.finish}-${index}`} className="border-t border-zinc-900">
                    <td className="py-2">{row.observedDate}</td><td>{row.providerLabel}</td><td>{row.finish}</td><td>{row.priceType}</td><td>{money(row.price, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
