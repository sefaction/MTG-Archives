export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { money } from "@/lib/pricing-analytics";
import {
  getCardPriceHistory,
  normalizePriceHistoryRange,
  type CardPriceHistoryPoint,
} from "@/lib/pricing-worker-store";
import { prisma } from "@/lib/prisma";

function token(value: string | undefined, fallback: string) {
  return value && /^[a-zA-Z0-9_-]+$/.test(value) ? value : fallback;
}

function currencyCode(value: string | undefined) {
  const clean = value?.toUpperCase();
  return clean && /^[A-Z]{3}$/.test(clean) ? clean : "USD";
}

function ObservationPlot({ points }: { points: CardPriceHistoryPoint[] }) {
  if (!points.length) return null;
  const dates = points.map((point) => Date.parse(point.observedDate));
  const prices = points.map((point) => point.price);
  const left = Math.min(...dates);
  const right = Math.max(...dates);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const x = (date: number) =>
    30 + (right === left ? 0.5 : (date - left) / (right - left)) * 840;
  const y = (price: number) =>
    225 - (high === low ? 0.5 : (price - low) / (high - low)) * 185;
  return (
    <svg
      viewBox="0 0 900 260"
      role="img"
      aria-label="Observed card prices plotted at their actual observation dates; the table below gives exact values"
      className="h-64 w-full rounded border border-zinc-800 bg-zinc-950"
    >
      <line x1="30" x2="870" y1="225" y2="225" stroke="rgb(113 113 122)" />
      {points.map((point) => (
        <circle
          key={point.observedDate}
          cx={x(Date.parse(point.observedDate))}
          cy={y(point.price)}
          r="4"
          fill="rgb(125 211 252)"
        >
          <title>
            {point.observedDate}: {point.price}
          </title>
        </circle>
      ))}
    </svg>
  );
}

export default async function CardPricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireLogin();
  const [{ cardId }, query] = await Promise.all([params, searchParams]);
  const scope = await getAccessScope(user);
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      name: true,
      setCode: true,
      collectorNumber: true,
      mtgjsonUuid: true,
    },
  });
  if (!card) notFound();
  if (scope?.mode !== "admin") {
    const owned = user.playerId
      ? await prisma.inventoryItem.count({
          where: {
            currentOwnerId: user.playerId,
            cardId,
            quantity: { gt: 0 },
          },
        })
      : 0;
    if (!owned) notFound();
  }
  const provider = token(query.provider, "tcgplayer");
  const finish = token(query.finish, "normal");
  const priceType = token(query.priceType, "retail");
  const currency = currencyCode(query.currency);
  const range = normalizePriceHistoryRange(query.range);
  const link = (nextRange: typeof range) =>
    `/pricing/card/${encodeURIComponent(cardId)}?${new URLSearchParams({ provider, finish, priceType, currency, range: nextRange })}`;
  let history: Awaited<ReturnType<typeof getCardPriceHistory>> | null = null;
  let error: string | null = null;
  if (card.mtgjsonUuid) {
    try {
      history = await getCardPriceHistory({
        mtgjsonUuid: card.mtgjsonUuid,
        provider,
        finish,
        priceType,
        currency,
        range,
      });
    } catch (failure) {
      error =
        failure instanceof Error
          ? failure.message
          : "Card history is unavailable.";
    }
  }
  return (
    <main className="min-w-0 space-y-5 p-4 sm:p-8">
      <Nav />
      <a className="text-sm text-sky-200 underline" href="/pricing?view=market">
        Back to owned movers
      </a>
      <section className="space-y-3 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <h1 className="text-2xl font-semibold text-zinc-100">
          {card.name} · {card.setCode.toUpperCase()} #{card.collectorNumber}
        </h1>
        <p className="text-sm text-zinc-400">
          Exact-printing observations from {provider} / {finish} / {priceType} /{" "}
          {currency}. Dates without observations are left blank.
        </p>
        <nav
          aria-label="Card price history range"
          className="flex flex-wrap gap-2"
        >
          {(["7", "30", "90", "all"] as const).map((option) => (
            <a
              key={option}
              href={link(option)}
              aria-current={option === range ? "page" : undefined}
              className={`rounded border px-3 py-2 text-sm ${option === range ? "border-sky-500 bg-sky-950 text-sky-100" : "border-zinc-700 text-zinc-300"}`}
            >
              {option === "all" ? "Long term" : `${option} days`}
            </a>
          ))}
        </nav>
        {range === "all" ? (
          <p className="text-sm text-zinc-400">
            Long-term points are monthly closes. Monthly low and high
            observations appear in the table, so a brief spike is not hidden by
            the close.
          </p>
        ) : (
          <p className="text-sm text-zinc-400">
            Daily observations are anchored to the latest available price, even
            when the feed is stale.
          </p>
        )}
      </section>
      {error ? (
        <div className="rounded border border-red-800 bg-red-950/30 p-4 text-red-100">
          {error}{" "}
          <a className="underline" href={link(range)}>
            Retry
          </a>
        </div>
      ) : !card.mtgjsonUuid ? (
        <p className="rounded border border-zinc-800 p-4 text-zinc-400">
          This printing has no MTGJSON identifier yet.
        </p>
      ) : !history?.points.length ? (
        <p className="rounded border border-zinc-800 p-4 text-zinc-400">
          No observations are available for this source and range.
        </p>
      ) : (
        <section className="space-y-4 rounded border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="text-lg font-semibold text-zinc-100">
            {history.resolution === "monthly" ? "Monthly" : "Daily"}{" "}
            observations
          </h2>
          <ObservationPlot points={history.points} />
          <div
            className="max-h-[35rem] overflow-auto"
            role="region"
            aria-label="Card price observations"
            tabIndex={0}
          >
            <table className="min-w-full text-sm">
              <thead className="text-left text-zinc-400">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2 text-right">
                    {history.resolution === "monthly" ? "Close" : "Price"}
                  </th>
                  {history.resolution === "monthly" ? (
                    <>
                      <th className="p-2 text-right">Low</th>
                      <th className="p-2 text-right">High</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {history.points.map((point) => (
                  <tr
                    key={point.observedDate}
                    className="border-t border-zinc-800 text-zinc-200"
                  >
                    <td className="p-2">{point.observedDate}</td>
                    <td className="p-2 text-right">
                      {money(point.price, currency)}
                    </td>
                    {history.resolution === "monthly" ? (
                      <>
                        <td className="p-2 text-right">
                          {point.lowDate}:{" "}
                          {money(point.lowPrice ?? 0, currency)}
                        </td>
                        <td className="p-2 text-right">
                          {point.highDate}:{" "}
                          {money(point.highPrice ?? 0, currency)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
