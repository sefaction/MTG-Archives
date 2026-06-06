export const dynamic = "force-dynamic";

import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { TradeStatus } from "@prisma/client";
import { actOnTrade, confirmPhysicalTrade, createTrade } from "./actions";
import { SubmitButton } from "@/components/feedback/SubmitButton";

const activeStatuses: TradeStatus[] = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];
const terminalStatuses: TradeStatus[] = [
  TradeStatus.COMPLETED,
  TradeStatus.DECLINED,
  TradeStatus.CANCELLED,
  TradeStatus.CANCELED,
];
const physicalStatuses: TradeStatus[] = [
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];

type SearchParams = { proposerId?: string; receiverId?: string };
type TradeSnapshot = {
  cardName?: string;
  setCode?: string;
  collectorNumber?: string;
  imageUri?: string | null;
  imageUris?: { small?: string; normal?: string } | null;
  roundName?: string;
};
type TradeCard = {
  card: {
    name: string;
    imageUri?: string | null;
    imageUris?: unknown;
    setCode?: string | null;
    collectorNumber?: string | null;
  };
  round?: { name: string } | null;
} | null;

function snapshot(value: unknown): TradeSnapshot {
  return value && typeof value === "object" ? (value as TradeSnapshot) : {};
}
function cardImage(
  item?: { card?: { imageUri?: string | null; imageUris?: unknown } } | null,
  snap: TradeSnapshot = {},
) {
  const images = item?.card?.imageUris as
    | { small?: string; normal?: string }
    | null
    | undefined;
  return (
    images?.small ??
    images?.normal ??
    item?.card?.imageUri ??
    snap.imageUris?.small ??
    snap.imageUris?.normal ??
    snap.imageUri ??
    ""
  );
}
function statusLabel(status: TradeStatus) {
  return status.toLowerCase();
}
function itemLabel(item: {
  card: { name: string; setCode: string; collectorNumber: string };
  condition: string;
  foilStatus: string;
  quantity: number;
  round?: { name: string } | null;
}) {
  return `${item.card.name} (${item.card.setCode.toUpperCase()} #${item.card.collectorNumber}) • ${item.foilStatus.toLowerCase()} • ${item.condition} • ${item.round?.name ?? "No acquisition group"} • qty ${item.quantity}`;
}
function cardName(item: TradeCard, snap: TradeSnapshot) {
  return item?.card.name ?? snap.cardName ?? "Transferred inventory item";
}
function roundName(item: TradeCard, snap: TradeSnapshot) {
  return item?.round?.name ?? snap.roundName ?? "No acquisition group";
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireLogin();
  const accessScope = await getAccessScope(user);
  const isAdmin = accessScope?.mode === "admin";
  const params = await searchParams;
  const players = await prisma.player.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
  });
  const proposerId = isAdmin
    ? params.proposerId || user.playerId || players[0]?.id || ""
    : user.playerId || "";
  const receiverId =
    params.receiverId || players.find((p) => p.id !== proposerId)?.id || "";
  if (!isAdmin && !user.playerId)
    return (
      <main className="p-8">
        <Nav />
        <p className="rounded border border-red-800 p-3">
          Your user account is not linked to an inventory owner, so you cannot
          trade yet. Ask an admin to save your account.
        </p>
      </main>
    );

  const inventory = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: { in: [proposerId, receiverId].filter(Boolean) },
      quantity: { gt: 0 },
    },
    include: {
      card: true,
      currentOwner: true,
      originalOpener: true,
      round: true,
    },
    orderBy: [
      { currentOwner: { displayName: "asc" } },
      { card: { name: "asc" } },
    ],
  });
  const visibleTrades = await prisma.trade.findMany({
    where: isAdmin
      ? {}
      : {
          OR: [
            { proposerPlayerId: user.playerId! },
            { receiverPlayerId: user.playerId! },
          ],
        },
    include: {
      tradeRound: true,
      proposerPlayer: true,
      receiverPlayer: true,
      offeredInventoryItem: { include: { card: true, round: true } },
      requestedInventoryItem: { include: { card: true, round: true } },
      events: {
        orderBy: { createdAt: "asc" },
        include: { actorPlayer: true, actorUser: true },
      },
    },
    orderBy: { proposedAt: "desc" },
  });
  const activeReservations = await prisma.trade.findMany({
    where: { status: { in: activeStatuses } },
    select: { offeredInventoryItemId: true, requestedInventoryItemId: true },
  });
  const reservedCount = new Map<string, number>();
  for (const trade of activeReservations) {
    for (const id of [
      trade.offeredInventoryItemId,
      trade.requestedInventoryItemId,
    ]) {
      if (id) reservedCount.set(id, (reservedCount.get(id) || 0) + 1);
    }
  }
  const available = (id: string, quantity: number) =>
    Math.max(0, quantity - (reservedCount.get(id) || 0));

  const myInventory = inventory.filter(
    (item) => item.currentOwnerId === proposerId,
  );
  const partnerInventory = inventory.filter(
    (item) => item.currentOwnerId === receiverId,
  );
  const sections = [
    [
      "My Active Trades",
      visibleTrades.filter(
        (t) =>
          activeStatuses.includes(t.status) &&
          (t.proposerPlayerId === user.playerId ||
            t.receiverPlayerId === user.playerId),
      ),
    ],
    [
      "Proposed To Me",
      visibleTrades.filter(
        (t) =>
          t.status === TradeStatus.PROPOSED &&
          t.receiverPlayerId === user.playerId,
      ),
    ],
    [
      "Awaiting Physical Exchange",
      visibleTrades.filter((t) => physicalStatuses.includes(t.status)),
    ],
    [
      "Completed",
      visibleTrades.filter((t) => t.status === TradeStatus.COMPLETED),
    ],
    [
      "Cancelled / Declined",
      visibleTrades.filter((t) => terminalStatuses.includes(t.status)),
    ],
  ] as const;

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <h1 className="text-3xl font-bold">Trades</h1>
      <section className="rounded border border-zinc-800 p-4 space-y-3">
        <h2 className="text-xl font-semibold">Create 1-for-1 Trade Proposal</h2>
        <p className="text-sm text-zinc-400">
          Trades reserve exactly one offered card and one requested card.
          Inventory only transfers after both users confirm the physical
          exchange.
        </p>
        <form method="get" className="grid md:grid-cols-3 gap-2">
          {isAdmin ? (
            <label className="text-sm">
              Proposer
              <select
                name="proposerId"
                defaultValue={proposerId}
                className="w-full border p-2 bg-zinc-900"
              >
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-sm">
            Trade partner
            <select
              name="receiverId"
              defaultValue={receiverId}
              className="w-full border p-2 bg-zinc-900"
            >
              {players
                .filter((p) => p.id !== proposerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
            </select>
          </label>
          <button className="border px-3 py-2 md:self-end">Load cards</button>
        </form>
        <form action={createTrade} className="grid md:grid-cols-2 gap-3">
          <input type="hidden" name="receiverPlayerId" value={receiverId} />
          {isAdmin ? (
            <input type="hidden" name="proposerPlayerId" value={proposerId} />
          ) : null}
          <label className="text-sm">
            One card I am offering
            <select
              name="offeredInventoryItemId"
              required
              className="w-full border p-2 bg-zinc-900"
            >
              {myInventory.map((item) => (
                <option
                  key={item.id}
                  disabled={available(item.id, item.quantity) < 1}
                  value={item.id}
                >
                  {itemLabel(item)} • available{" "}
                  {available(item.id, item.quantity)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            One card I am requesting
            <select
              name="requestedInventoryItemId"
              required
              className="w-full border p-2 bg-zinc-900"
            >
              {partnerInventory.map((item) => (
                <option
                  key={item.id}
                  disabled={available(item.id, item.quantity) < 1}
                  value={item.id}
                >
                  {itemLabel(item)} • available{" "}
                  {available(item.id, item.quantity)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Message / notes
            <textarea
              name="message"
              className="w-full border p-2 bg-zinc-900"
            />
          </label>
          <SubmitButton
            pendingLabel="Proposing trade…"
            className="border px-3 py-2 md:col-span-2"
          >
            Submit Proposal
          </SubmitButton>
        </form>
      </section>

      {sections.map(([title, trades]) => (
        <section key={title} className="space-y-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          {trades.length ? (
            trades.map((trade) => {
              const other =
                trade.proposerPlayerId === user.playerId
                  ? trade.receiverPlayer
                  : trade.proposerPlayer;
              const offeredSnapshot = snapshot(trade.offeredSnapshotJson);
              const requestedSnapshot = snapshot(trade.requestedSnapshotJson);
              const userIsProposer = trade.proposerPlayerId === user.playerId;
              const userIsReceiver = trade.receiverPlayerId === user.playerId;
              const receiverNeedsAction =
                trade.status === TradeStatus.PROPOSED && userIsReceiver;
              const userNeedsPhysical =
                physicalStatuses.includes(trade.status) &&
                ((userIsProposer && !trade.proposerCommittedAt) ||
                  (userIsReceiver && !trade.receiverCommittedAt));
              const userConfirmedPhysical =
                physicalStatuses.includes(trade.status) &&
                ((userIsProposer && trade.proposerCommittedAt) ||
                  (userIsReceiver && trade.receiverCommittedAt));
              const waitingPlayer = physicalStatuses.includes(trade.status)
                ? trade.proposerCommittedAt
                  ? trade.receiverPlayer.displayName
                  : trade.proposerPlayer.displayName
                : "";
              return (
                <article
                  key={trade.id}
                  className="rounded border border-zinc-800 p-4 space-y-3"
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {trade.tradeRound?.name
                          ? `${trade.tradeRound.name}: `
                          : ""}
                        {trade.proposerPlayer.displayName} ↔{" "}
                        {trade.receiverPlayer.displayName}
                      </h3>
                      <p className="text-sm text-zinc-400">
                        Status: {statusLabel(trade.status)} • Proposed{" "}
                        {trade.proposedAt.toLocaleString()}{" "}
                        {other ? `• Trade partner: ${other.displayName}` : ""}
                      </p>
                      {receiverNeedsAction || userNeedsPhysical ? (
                        <span className="inline-block rounded border border-amber-700 px-2 py-1 text-xs text-amber-200">
                          Action needed
                        </span>
                      ) : null}
                    </div>
                    {trade.message ? (
                      <p className="text-sm text-zinc-300">{trade.message}</p>
                    ) : null}
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="flex gap-3 rounded border border-zinc-900 p-2">
                      {cardImage(
                        trade.offeredInventoryItem,
                        offeredSnapshot,
                      ) ? (
                        <img
                          src={cardImage(
                            trade.offeredInventoryItem,
                            offeredSnapshot,
                          )}
                          alt=""
                          className="h-24 rounded"
                        />
                      ) : null}
                      <div>
                        <div className="text-xs text-zinc-400">
                          Offered by {trade.proposerPlayer.displayName}
                        </div>
                        <div>
                          {cardName(
                            trade.offeredInventoryItem,
                            offeredSnapshot,
                          )}
                        </div>
                        <div className="text-xs text-zinc-400">
                          qty 1 •{" "}
                          {roundName(
                            trade.offeredInventoryItem,
                            offeredSnapshot,
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3 rounded border border-zinc-900 p-2">
                      {cardImage(
                        trade.requestedInventoryItem,
                        requestedSnapshot,
                      ) ? (
                        <img
                          src={cardImage(
                            trade.requestedInventoryItem,
                            requestedSnapshot,
                          )}
                          alt=""
                          className="h-24 rounded"
                        />
                      ) : null}
                      <div>
                        <div className="text-xs text-zinc-400">
                          Requested from {trade.receiverPlayer.displayName}
                        </div>
                        <div>
                          {cardName(
                            trade.requestedInventoryItem,
                            requestedSnapshot,
                          )}
                        </div>
                        <div className="text-xs text-zinc-400">
                          qty 1 •{" "}
                          {roundName(
                            trade.requestedInventoryItem,
                            requestedSnapshot,
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <details className="text-sm">
                    <summary className="cursor-pointer">Timeline</summary>
                    <div className="mt-2 space-y-1">
                      {trade.events.map((event) => (
                        <div
                          key={event.id}
                          className="border-l border-zinc-700 pl-2"
                        >
                          <span className="font-semibold">
                            {event.eventType}
                          </span>{" "}
                          — {event.createdAt.toLocaleString()}{" "}
                          {event.actorPlayer
                            ? `by ${event.actorPlayer.displayName}`
                            : event.actorUser
                              ? `by ${event.actorUser.username}`
                              : ""}
                          <div className="text-zinc-400">{event.message}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    {trade.status === TradeStatus.PROPOSED && userIsReceiver ? (
                      <>
                        <form action={actOnTrade}>
                          <input
                            type="hidden"
                            name="tradeId"
                            value={trade.id}
                          />
                          <SubmitButton
                            pendingLabel="Accepting trade…"
                            name="action"
                            value="accept"
                            className="border px-3 py-2"
                          >
                            Accept
                          </SubmitButton>
                        </form>
                        <form action={actOnTrade}>
                          <input
                            type="hidden"
                            name="tradeId"
                            value={trade.id}
                          />
                          <SubmitButton
                            pendingLabel="Declining trade…"
                            name="action"
                            value="decline"
                            className="border px-3 py-2"
                          >
                            Decline
                          </SubmitButton>
                        </form>
                      </>
                    ) : null}
                    {trade.status === TradeStatus.PROPOSED && userIsProposer ? (
                      <form action={actOnTrade}>
                        <input type="hidden" name="tradeId" value={trade.id} />
                        <input
                          type="hidden"
                          name="reason"
                          value="Cancelled by proposer."
                        />
                        <SubmitButton
                          pendingLabel="Cancelling trade…"
                          name="action"
                          value="cancel"
                          className="border px-3 py-2"
                        >
                          Cancel
                        </SubmitButton>
                      </form>
                    ) : null}
                    {userNeedsPhysical ? (
                      <form action={confirmPhysicalTrade}>
                        <input type="hidden" name="tradeId" value={trade.id} />
                        <SubmitButton
                          pendingLabel="Confirming exchange…"
                          className="border px-3 py-2"
                        >
                          Confirm Physical Trade
                        </SubmitButton>
                      </form>
                    ) : null}
                    {userConfirmedPhysical ? (
                      <span className="rounded border border-emerald-800 px-3 py-2 text-sm text-emerald-200">
                        You have confirmed physical exchange.
                      </span>
                    ) : null}
                    {physicalStatuses.includes(trade.status) &&
                    !userNeedsPhysical &&
                    waitingPlayer ? (
                      <span className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300">
                        Waiting for {waitingPlayer} to confirm physical
                        exchange.
                      </span>
                    ) : null}
                    {isAdmin && !terminalStatuses.includes(trade.status) ? (
                      <>
                        <form action={actOnTrade} className="flex gap-1">
                          <input
                            type="hidden"
                            name="tradeId"
                            value={trade.id}
                          />
                          <input
                            name="reason"
                            required
                            placeholder="admin cancel reason"
                            className="border p-2 bg-zinc-900"
                          />
                          <SubmitButton
                            pendingLabel="Cancelling trade…"
                            name="action"
                            value="cancel"
                            className="border px-3 py-2"
                          >
                            Admin Cancel
                          </SubmitButton>
                        </form>
                        <form
                          action={confirmPhysicalTrade}
                          className="flex gap-1"
                        >
                          <input
                            type="hidden"
                            name="tradeId"
                            value={trade.id}
                          />
                          <input type="hidden" name="forceComplete" value="1" />
                          <input
                            name="reason"
                            required
                            placeholder="force complete reason"
                            className="border p-2 bg-zinc-900"
                          />
                          <SubmitButton
                            pendingLabel="Force completing…"
                            className="border px-3 py-2"
                          >
                            Force Complete
                          </SubmitButton>
                        </form>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="text-sm text-zinc-400">No trades in this section.</p>
          )}
        </section>
      ))}
    </main>
  );
}
