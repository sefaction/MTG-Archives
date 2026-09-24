export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { z } from "zod";
import { Nav } from "@/components/Nav";
import { requireLogin } from "@/lib/auth";
import { money } from "@/lib/pricing-analytics";
import { prisma } from "@/lib/prisma";

const movement = z.object({
  mtgjsonUuid: z.string(),
  cardId: z.string().nullable(),
  cardName: z.string().nullable(),
  setCode: z.string().nullable(),
  collectorNumber: z.string().nullable(),
  startPrice: z.number(),
  currentPrice: z.number(),
  absoluteChange: z.number(),
  percentChange: z.number().nullable(),
  priorDate: z.string(),
  currentDate: z.string(),
  ownedQuantity: z.number(),
  collectionImpact: z.number(),
});
const digest = z.object({
  observedDate: z.string(),
  provider: z.string(),
  finish: z.string(),
  priceType: z.string(),
  currency: z.string(),
  totalMovers: z.number(),
  generatedAt: z.string(),
  shownMovers: z.array(movement).max(100),
});

export default async function PricingDigestPage({
  params,
}: {
  params: Promise<{ observedDate: string }>;
}) {
  const user = await requireLogin();
  const { observedDate } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate)) notFound();
  const notification = await prisma.notification.findUnique({
    where: {
      recipientUserId_sourceType_sourceId: {
        recipientUserId: user.id,
        sourceType: "pricing_digest",
        sourceId: observedDate,
      },
    },
    select: { metadataJson: true, title: true },
  });
  if (!notification) notFound();
  const parsed = digest.safeParse(notification.metadataJson);
  if (!parsed.success || parsed.data.observedDate !== observedDate) notFound();
  const data = parsed.data;
  const cardIds = data.shownMovers
    .map((item) => item.cardId)
    .filter((id): id is string => Boolean(id));
  const owned =
    user.playerId && cardIds.length
      ? await prisma.inventoryItem.findMany({
          where: {
            currentOwnerId: user.playerId,
            cardId: { in: cardIds },
            quantity: { gt: 0 },
          },
          select: { cardId: true },
        })
      : [];
  const ownedIds = new Set(owned.map((item) => item.cardId));
  return (
    <main className="min-w-0 space-y-4 p-4 sm:p-8">
      <Nav />
      <a
        href="/settings/pricing-alerts"
        className="text-sm text-sky-200 underline"
      >
        Back to Pricing digest settings
      </a>
      <section className="space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <h1 className="text-2xl font-semibold">{notification.title}</h1>
        <p className="text-sm text-zinc-400">
          {data.provider} / {data.finish} / {data.priceType} / {data.currency}.
          Prices and owned quantities captured{" "}
          {new Date(data.generatedAt).toLocaleString()}. Later corrections or
          inventory changes appear in live Pricing history.
        </p>
        {data.totalMovers > data.shownMovers.length ? (
          <p className="text-sm text-amber-200">
            Showing the {data.shownMovers.length} largest impacts of{" "}
            {data.totalMovers} movements.
          </p>
        ) : null}
      </section>
      <div
        role="region"
        aria-label="Pricing digest movements"
        tabIndex={0}
        className="max-h-[40rem] overflow-auto rounded border border-zinc-800"
      >
        <table className="min-w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="p-2">Exact printing</th>
              <th className="p-2">Observed</th>
              <th className="p-2 text-right">Prior</th>
              <th className="p-2 text-right">Current</th>
              <th className="p-2 text-right">Change</th>
              <th className="p-2 text-right">Percent</th>
              <th className="p-2 text-right">Owned</th>
              <th className="p-2 text-right">Collection impact</th>
            </tr>
          </thead>
          <tbody>
            {data.shownMovers.map((item) => {
              const label = `${item.cardName ?? item.mtgjsonUuid} (${item.setCode?.toUpperCase() ?? "?"} #${item.collectorNumber ?? "?"})`;
              return (
                <tr
                  key={item.mtgjsonUuid}
                  className="border-t border-zinc-800 text-zinc-200"
                >
                  <td className="p-2">
                    {item.cardId && ownedIds.has(item.cardId) ? (
                      <a
                        className="text-sky-200 underline"
                        href={`/pricing/card/${encodeURIComponent(item.cardId)}?${new URLSearchParams({ provider: data.provider, finish: data.finish, priceType: data.priceType, currency: data.currency, range: "all" })}`}
                      >
                        {label}
                      </a>
                    ) : (
                      <>
                        {label}
                        <span className="block text-xs text-zinc-500">
                          No longer owned
                        </span>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-2">
                    {item.priorDate} to {item.currentDate}
                  </td>
                  <td className="p-2 text-right">
                    {money(item.startPrice, data.currency)}
                  </td>
                  <td className="p-2 text-right">
                    {money(item.currentPrice, data.currency)}
                  </td>
                  <td className="p-2 text-right">
                    {money(item.absoluteChange, data.currency)}
                  </td>
                  <td className="p-2 text-right">
                    {item.percentChange == null
                      ? "—"
                      : `${item.percentChange.toFixed(2)}%`}
                  </td>
                  <td className="p-2 text-right">{item.ownedQuantity}</td>
                  <td className="p-2 text-right">
                    {money(item.collectionImpact, data.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
