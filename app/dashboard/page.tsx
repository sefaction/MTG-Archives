export const dynamic = "force-dynamic";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { TradeStatus } from "@prisma/client";

const openTradeStatuses = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const accessScope = user ? await getAccessScope(user) : null;
  const adminModeActive = accessScope?.mode === "admin";
  const ownerId = user?.playerId ?? "";
  const authMessage =
    params.auth === "required"
      ? "Please log in to access this page."
      : params.auth === "denied"
        ? "You do not have permission to access that page."
        : params.auth === "admin-mode"
          ? "Enter Admin Mode to use that action."
          : "";

  const [
    uniqueEntries,
    physicalCards,
    foilCards,
    incomingTrades,
    outgoingTrades,
    recentItems,
    adminUsers,
    adminCards,
    adminOpenTrades,
  ] = await Promise.all([
    ownerId
      ? prisma.inventoryItem.count({
          where: { currentOwnerId: ownerId, quantity: { gt: 0 } },
        })
      : Promise.resolve(0),
    ownerId
      ? prisma.inventoryItem.aggregate({
          where: { currentOwnerId: ownerId, quantity: { gt: 0 } },
          _sum: { quantity: true },
        })
      : Promise.resolve({ _sum: { quantity: 0 } }),
    ownerId
      ? prisma.inventoryItem.aggregate({
          where: { currentOwnerId: ownerId, quantity: { gt: 0 }, foil: true },
          _sum: { quantity: true },
        })
      : Promise.resolve({ _sum: { quantity: 0 } }),
    ownerId
      ? prisma.trade.count({
          where: { receiverPlayerId: ownerId, status: TradeStatus.PROPOSED },
        })
      : Promise.resolve(0),
    ownerId
      ? prisma.trade.count({
          where: {
            proposerPlayerId: ownerId,
            status: { in: openTradeStatuses },
          },
        })
      : Promise.resolve(0),
    ownerId
      ? prisma.inventoryItem.findMany({
          where: { currentOwnerId: ownerId, quantity: { gt: 0 } },
          include: { card: true },
          orderBy: { updatedAt: "desc" },
          take: 5,
        })
      : Promise.resolve([]),
    adminModeActive
      ? prisma.user.count({ where: { isActive: true } })
      : Promise.resolve(0),
    adminModeActive
      ? prisma.inventoryItem.aggregate({
          where: { quantity: { gt: 0 } },
          _sum: { quantity: true },
        })
      : Promise.resolve({ _sum: { quantity: 0 } }),
    adminModeActive
      ? prisma.trade.count({ where: { status: { in: openTradeStatuses } } })
      : Promise.resolve(0),
  ]);

  return (
    <main className="min-w-0 space-y-4 p-4 sm:p-8">
      <Nav />
      <div>
        <h1 className="text-3xl font-bold">
          {adminModeActive ? "Admin Dashboard" : "My Dashboard"}
        </h1>
        <p className="text-zinc-400">
          {adminModeActive
            ? "Your collection summary, with a separate system overview below."
            : "A quick view of your MTG inventory and open trade activity."}
        </p>
      </div>
      {authMessage ? (
        <p className="rounded border border-amber-800 bg-amber-950/40 p-3 text-amber-100">
          {authMessage}
        </p>
      ) : null}
      {!user ? (
        <p className="rounded border border-zinc-800 p-4 text-zinc-300">
          Log in to see personal inventory and trade counts. Public inventory
          browsing remains available.
        </p>
      ) : null}
      <section aria-label="Your collection and trades" className="space-y-2">
        <h2 className="font-semibold">Your collection and trades</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["Unique entries", uniqueEntries],
            ["Physical cards", physicalCards._sum.quantity ?? 0],
            ["Foil cards", foilCards._sum.quantity ?? 0],
            ["Incoming proposals", incomingTrades],
            ["Outgoing open trades", outgoingTrades],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded border border-zinc-800 p-4"
            >
              <p className="text-sm text-zinc-400">{label}</p>
              <p className="text-2xl font-bold">{String(value)}</p>
            </div>
          ))}
        </div>
      </section>
      <section
        aria-label="Collection tasks"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        <Link className="rounded border border-zinc-800 p-4" href="/inventory">
          <h2 className="font-semibold">Inventory</h2>
          <p className="text-sm text-zinc-400">
            Search, filter, edit, and export card inventory.
          </p>
        </Link>
        <Link className="rounded border border-zinc-800 p-4" href="/imports">
          <h2 className="font-semibold">Import</h2>
          <p className="text-sm text-zinc-400">
            Upload a CSV, review matches, and add cards.
          </p>
        </Link>
        <Link className="rounded border border-zinc-800 p-4" href="/trades">
          <h2 className="font-semibold">Trades</h2>
          <p className="text-sm text-zinc-400">
            Create and respond to user-to-user trade proposals.
          </p>
        </Link>
        <Link
          className="rounded border border-cyan-800 bg-cyan-950/20 p-4"
          href="/league"
        >
          <h2 className="font-semibold text-cyan-100">Commander League</h2>
          <p className="text-sm text-zinc-400">
            Open standings, record games, and browse League decks.
          </p>
        </Link>
        <Link
          className="rounded border border-zinc-800 p-4"
          href="/public/inventory"
        >
          <h2 className="font-semibold">Public Inventory</h2>
          <p className="text-sm text-zinc-400">
            Browse public cards and collections shared by users.
          </p>
        </Link>
      </section>
      <section className="rounded border border-zinc-800 p-4">
        <h2 className="mb-3 text-xl font-semibold">
          Recently updated inventory
        </h2>
        {recentItems.length ? (
          <ul className="space-y-2">
            {recentItems.map((item) => (
              <li
                key={item.id}
                className="flex justify-between gap-3 border-b border-zinc-900 pb-2"
              >
                <span>
                  {item.card.name} ({item.card.setCode.toUpperCase()} #
                  {item.card.collectorNumber})
                </span>
                <span className="text-zinc-400">qty {item.quantity}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">
            No inventory entries yet. Use Import to upload a CSV or add cards.
          </p>
        )}
      </section>
      {adminModeActive ? (
        <section className="rounded border border-zinc-800 p-4">
          <h2 className="mb-3 text-xl font-semibold">Admin overview</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Active users", adminUsers],
              ["Cards across all users", adminCards._sum.quantity ?? 0],
              ["Currently open trades", adminOpenTrades],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded border border-zinc-900 p-3"
              >
                <p className="text-sm text-zinc-400">{label}</p>
                <p className="text-2xl font-bold">{String(value)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
