export const dynamic = "force-dynamic";

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { TradeStatus, TradeWishlistStatus } from "@prisma/client";
import { actOnTrade, confirmPhysicalTrade, createTrade } from "./actions";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { TradeBuilder } from "@/components/TradeBuilder";
import {
  cn,
  filterButtonClass,
  filterFieldClass,
  filterPanelClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";

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

type SearchParams = {
  proposerId?: string;
  receiverId?: string;
  offeredInventoryItemId?: string;
  requestedInventoryItemId?: string;
};
type TradeSnapshot = {
  cardName?: string;
  setCode?: string;
  collectorNumber?: string;
  imageUri?: string | null;
  imageUris?: { small?: string; normal?: string } | null;
};
type TradeCard = {
  card: {
    name: string;
    imageUri?: string | null;
    imageUris?: unknown;
    setCode?: string | null;
    collectorNumber?: string | null;
  };
} | null;

function snapshot(value: unknown): TradeSnapshot {
  return value && typeof value === "object" ? (value as TradeSnapshot) : {};
}
function cardImage(
  item?: { card?: { imageUri?: string | null; imageUris?: unknown } } | null,
  snap: TradeSnapshot = {},
) {
  const images = item?.card?.imageUris as
    { small?: string; normal?: string } | null | undefined;
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
function cardName(item: TradeCard, snap: TradeSnapshot) {
  return item?.card.name ?? snap.cardName ?? "Transferred inventory item";
}
function toTradeBuilderItem(item: {
  id: string;
  condition: string;
  foilStatus: string;
  quantity: number;
  card: {
    name: string;
    setCode: string;
    collectorNumber: string;
    imageUri?: string | null;
    imageUris?: unknown;
  };
}) {
  return {
    id: item.id,
    cardName: item.card.name,
    setCode: item.card.setCode,
    collectorNumber: item.card.collectorNumber,
    condition: item.condition,
    foilStatus: item.foilStatus,
    quantity: item.quantity,
    available: item.quantity,
    imageUri: cardImage(item),
  };
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
      proposerPlayer: true,
      receiverPlayer: true,
      offeredInventoryItem: { include: { card: true } },
      requestedInventoryItem: { include: { card: true } },
      events: {
        orderBy: { createdAt: "asc" },
        include: { actorPlayer: true, actorUser: true },
      },
    },
    orderBy: { proposedAt: "desc" },
  });
  const [myTradeWishlist, wantedFromMe] = await Promise.all([
    prisma.tradeWishlistItem.findMany({
      where: { ownerUserId: user.id, status: TradeWishlistStatus.OPEN },
      include: {
        card: true,
        targetOwnerPlayer: true,
        targetInventoryItem: { include: { card: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    user.playerId
      ? prisma.tradeWishlistItem.findMany({
          where: {
            targetOwnerPlayerId: user.playerId,
            status: TradeWishlistStatus.OPEN,
          },
          include: {
            ownerUser: true,
            card: true,
            targetInventoryItem: { include: { card: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);
  const [initialOfferedItem, initialRequestedItem] = await Promise.all([
    params.offeredInventoryItemId
      ? prisma.inventoryItem.findFirst({
          where: {
            id: params.offeredInventoryItemId,
            currentOwnerId: proposerId,
            quantity: { gt: 0 },
            OR: [{ locationId: null }, { location: { kind: "NORMAL" } }],
          },
          include: { card: true },
        })
      : Promise.resolve(null),
    params.requestedInventoryItemId
      ? prisma.inventoryItem.findFirst({
          where: {
            id: params.requestedInventoryItemId,
            currentOwnerId: receiverId,
            quantity: { gt: 0 },
            OR: [{ locationId: null }, { location: { kind: "NORMAL" } }],
          },
          include: { card: true },
        })
      : Promise.resolve(null),
  ]);
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
      <section className={cn(filterPanelClass, "space-y-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Create Trade Proposal</h2>
            <p className="max-w-3xl text-sm text-zinc-400">
              Search each side as needed instead of loading full collections.
              This keeps the page fast and gives us a cleaner path toward
              multi-card negotiation and trade wishlists.
            </p>
          </div>
          <span className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
            1-for-1 foundation
          </span>
        </div>
        <form method="get" className="grid gap-2 md:grid-cols-3">
          {isAdmin ? (
            <label className={filterFieldClass}>
              Proposer
              <select
                name="proposerId"
                defaultValue={proposerId}
                className={cn(filterSelectClass, "mt-1 w-full")}
              >
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className={filterFieldClass}>
            Trade partner
            <select
              name="receiverId"
              defaultValue={receiverId}
              className={cn(filterSelectClass, "mt-1 w-full")}
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
          <button className={cn(filterButtonClass, "md:self-end")}>
            Set partner
          </button>
        </form>
        <TradeBuilder
          key={[
            proposerId,
            receiverId,
            initialOfferedItem?.id ?? "",
            initialRequestedItem?.id ?? "",
          ].join(":")}
          createTradeAction={createTrade}
          proposerPlayerId={isAdmin ? proposerId : undefined}
          proposerOwnerId={proposerId}
          receiverPlayerId={receiverId}
          proposerName={
            players.find((player) => player.id === proposerId)?.displayName ||
            "You"
          }
          receiverName={
            players.find((player) => player.id === receiverId)?.displayName ||
            "Trade partner"
          }
          initialOfferedItem={
            initialOfferedItem ? toTradeBuilderItem(initialOfferedItem) : null
          }
          initialRequestedItem={
            initialRequestedItem
              ? toTradeBuilderItem(initialRequestedItem)
              : null
          }
        />
      </section>

      <section className={cn(filterPanelClass, "space-y-4")}>
        <div>
          <h2 className="text-xl font-semibold">Trade Wishlist</h2>
          <p className="text-sm text-zinc-400">
            Public-inventory wants are collected here so either side can start a
            focused negotiation without loading full collections.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-semibold text-sky-100">Cards I want</h3>
            {myTradeWishlist.length ? (
              myTradeWishlist.map((item) => {
                const image = cardImage(item.targetInventoryItem, {
                  imageUri: item.card.imageUri,
                  imageUris: item.card.imageUris as any,
                });
                return (
                  <article
                    key={item.id}
                    className="flex gap-3 rounded border border-zinc-800 p-3"
                  >
                    {image ? (
                      <img src={image} alt="" className="h-20 rounded" />
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-zinc-100">
                        {item.card.name}
                      </p>
                      <p className="text-zinc-400">
                        From {item.targetOwnerPlayer.displayName} · qty{" "}
                        {item.quantity}
                      </p>
                      {item.notes ? (
                        <p className="text-zinc-500">{item.notes}</p>
                      ) : null}
                    </div>
                    <Link
                      href={`/trades?receiverId=${item.targetOwnerPlayerId}${
                        item.targetInventoryItemId
                          ? `&requestedInventoryItemId=${item.targetInventoryItemId}`
                          : ""
                      }`}
                      className={cn(filterPrimaryButtonClass, "self-start")}
                    >
                      Negotiate
                    </Link>
                  </article>
                );
              })
            ) : (
              <p className="text-sm text-zinc-500">
                No public inventory trade wants yet.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-sky-100">Wanted from me</h3>
            {wantedFromMe.length ? (
              wantedFromMe.map((item) => {
                const image = cardImage(item.targetInventoryItem, {
                  imageUri: item.card.imageUri,
                  imageUris: item.card.imageUris as any,
                });
                return (
                  <article
                    key={item.id}
                    className="flex gap-3 rounded border border-zinc-800 p-3"
                  >
                    {image ? (
                      <img src={image} alt="" className="h-20 rounded" />
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-zinc-100">
                        {item.card.name}
                      </p>
                      <p className="text-zinc-400">
                        Wanted by{" "}
                        {item.ownerUser.displayName || item.ownerUser.username}{" "}
                        · qty {item.quantity}
                      </p>
                      {item.notes ? (
                        <p className="text-zinc-500">{item.notes}</p>
                      ) : null}
                    </div>
                    <Link
                      href={`/trades?receiverId=${item.ownerUser.playerId || ""}${
                        item.targetInventoryItemId
                          ? `&offeredInventoryItemId=${item.targetInventoryItemId}`
                          : ""
                      }`}
                      className={cn(filterPrimaryButtonClass, "self-start")}
                    >
                      Negotiate
                    </Link>
                  </article>
                );
              })
            ) : (
              <p className="text-sm text-zinc-500">
                No one has wishlisted your public cards for trade yet.
              </p>
            )}
          </div>
        </div>
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
                        <div className="text-xs text-zinc-400">qty 1</div>
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
                        <div className="text-xs text-zinc-400">qty 1</div>
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
