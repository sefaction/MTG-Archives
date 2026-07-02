export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { TradeStatus, TradeWishlistStatus } from "@prisma/client";
import {
  actOnTrade,
  cancelTradeWishlistItem,
  confirmPhysicalTrade,
  createTrade,
} from "./actions";
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
import {
  TradeCardPreview,
  type TradeCardSummary,
} from "@/components/TradeCardPreview";
import { ColorIdentityIcons } from "@/components/mtg/CardSymbols";
import { normalizePlayerColor } from "@/lib/player-colors";

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
  view?: string;
  wishlistView?: string;
};
type TradeWishlistView = "table" | "binder" | "spoiler";
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
    typeLine?: string | null;
    oracleText?: string | null;
    manaCost?: string | null;
    rarity?: string | null;
    colorIdentity?: unknown;
    prices?: unknown;
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
function tradeWishlistView(value?: string): TradeWishlistView {
  return value === "binder" || value === "spoiler" ? value : "table";
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

function selectedPriceLabel(prices: unknown) {
  const values = prices && typeof prices === "object" ? (prices as any) : {};
  const mtgjson =
    values.mtgjson && typeof values.mtgjson === "object"
      ? (values.mtgjson as any)
      : {};
  const value =
    mtgjson.price ??
    mtgjson.usd ??
    values.usd ??
    values.usd_foil ??
    values.usd_etched ??
    "";
  return value ? `$${Number(value).toFixed(2)}` : "";
}

function toTradeCardSummary({
  id,
  item,
  snap = {},
  card,
  ownerLabel,
  roleLabel,
  notes,
}: {
  id: string;
  item?: any;
  snap?: TradeSnapshot;
  card?: any;
  ownerLabel?: string;
  roleLabel?: string;
  notes?: string | null;
}): TradeCardSummary {
  const resolvedCard = item?.card ?? card ?? null;
  return {
    id,
    name: resolvedCard?.name ?? snap.cardName ?? "Transferred inventory item",
    imageUri: cardImage(item, snap),
    setCode: resolvedCard?.setCode ?? snap.setCode ?? "",
    collectorNumber:
      resolvedCard?.collectorNumber ?? snap.collectorNumber ?? "",
    typeLine: resolvedCard?.typeLine ?? "",
    oracleText: resolvedCard?.oracleText ?? "",
    manaCost: resolvedCard?.manaCost ?? "",
    colorIdentity: resolvedCard?.colorIdentity,
    rarity: resolvedCard?.rarity ?? "",
    condition: item?.condition ?? "",
    foilStatus: item?.foilStatus ?? "",
    quantity: item?.quantity ?? undefined,
    ownerLabel,
    roleLabel,
    priceLabel: selectedPriceLabel(resolvedCard?.prices),
    notes: notes ?? "",
  };
}

function CompactSection({
  title,
  summary,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn(filterPanelClass, "group space-y-3")}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="inline text-xl font-semibold">{title}</h2>
          {summary ? (
            <span className="ml-3 text-sm text-zinc-400">{summary}</span>
          ) : null}
        </div>
        <span className="flex items-center gap-2 text-sm text-zinc-400">
          {typeof count === "number" ? (
            <span className="rounded border border-zinc-800 px-2 py-1">
              {count}
            </span>
          ) : null}
          <span className="rounded border border-zinc-800 px-2 py-1 group-open:hidden">
            Open
          </span>
          <span className="hidden rounded border border-zinc-800 px-2 py-1 group-open:inline">
            Collapse
          </span>
        </span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

function WishlistViewToggle({ active }: { active: TradeWishlistView }) {
  const options: Array<{ value: TradeWishlistView; label: string }> = [
    { value: "table", label: "Table" },
    { value: "binder", label: "Binder" },
    { value: "spoiler", label: "Visual spoiler" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {options.map((option) => (
        <Link
          key={option.value}
          href={
            option.value === "table"
              ? "/trades"
              : `/trades?wishlistView=${option.value}`
          }
          className={cn(
            filterButtonClass,
            active === option.value && "border-sky-500 bg-sky-950/40",
          )}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

type TradeWishlistRow = {
  id: string;
  card: TradeCardSummary;
  personLabel: string;
  personColor?: string | null;
  quantity: number;
  notes?: string | null;
  negotiateHref: string;
  negotiateLabel: string;
  cancelId?: string;
};

function playerColorStyle(color?: string | null) {
  return { backgroundColor: normalizePlayerColor(color) };
}

function TradeWishlistActions({ row }: { row: TradeWishlistRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={row.negotiateHref} className={filterPrimaryButtonClass}>
        {row.negotiateLabel}
      </Link>
      {row.cancelId ? (
        <form action={cancelTradeWishlistItem}>
          <input
            type="hidden"
            name="tradeWishlistItemId"
            value={row.cancelId}
          />
          <SubmitButton
            pendingLabel="Cancelling..."
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-red-700 hover:text-red-100"
          >
            Cancel
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function TradeWishlistDirection({
  title,
  rows,
  emptyMessage,
  personHeader,
  view,
}: {
  title: string;
  rows: TradeWishlistRow[];
  emptyMessage: string;
  personHeader: string;
  view: TradeWishlistView;
}) {
  return (
    <details open className="rounded border border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2">
        <span className="font-semibold text-sky-100">{title}</span>
        <span className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
          {rows.length}
        </span>
      </summary>
      {rows.length ? (
        view === "table" ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Card</th>
                  <th className="px-3 py-2 font-medium">Color</th>
                  <th className="px-3 py-2 font-medium">{personHeader}</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="align-middle transition-colors hover:bg-zinc-900/60"
                  >
                    <td className="px-3 py-2">
                      <TradeCardPreview
                        card={row.card}
                        compact
                        variant="text"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <ColorIdentityIcons
                        value={
                          Array.isArray(row.card.colorIdentity)
                            ? row.card.colorIdentity.map(String)
                            : typeof row.card.colorIdentity === "string"
                              ? row.card.colorIdentity
                              : null
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-zinc-200">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={playerColorStyle(row.personColor)}
                          aria-hidden="true"
                        />
                        {row.personLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-200">{row.quantity}</td>
                    <td className="max-w-xs px-3 py-2 text-zinc-400">
                      {row.notes || "-"}
                    </td>
                    <td className="px-3 py-2">
                      <TradeWishlistActions row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : view === "binder" ? (
          <div className="grid gap-3 p-3 md:grid-cols-2 2xl:grid-cols-3">
            {rows.map((row) => (
              <article
                key={row.id}
                className="rounded border border-zinc-800 bg-zinc-950/50 p-3"
              >
                <TradeCardPreview card={row.card} compact />
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                  <span>{personHeader}</span>
                  <span className="text-right text-zinc-200">
                    {row.personLabel}
                  </span>
                  <span>Quantity</span>
                  <span className="text-right text-zinc-200">
                    {row.quantity}
                  </span>
                </div>
                {row.notes ? (
                  <p className="mt-2 text-xs text-zinc-500">{row.notes}</p>
                ) : null}
                <div className="mt-3">
                  <TradeWishlistActions row={row} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {rows.map((row) => (
              <article key={row.id} className="min-w-0">
                <TradeCardPreview card={row.card} variant="spoiler" />
                <div className="mt-2 space-y-1 text-xs text-zinc-400">
                  <div className="truncate">{row.personLabel}</div>
                  <div>Qty {row.quantity}</div>
                  <TradeWishlistActions row={row} />
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        <p className="p-3 text-sm text-zinc-500">{emptyMessage}</p>
      )}
    </details>
  );
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
  const tradeView = params.view === "history" ? "history" : "active";
  const activeWishlistView = tradeWishlistView(params.wishlistView);
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
            ownerUser: { include: { player: true } },
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
  const activeSections = [
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
  ] as const;
  const historySections = [
    [
      "Completed",
      visibleTrades.filter((t) => t.status === TradeStatus.COMPLETED),
    ],
    [
      "Cancelled / Declined",
      visibleTrades.filter((t) => terminalStatuses.includes(t.status)),
    ],
  ] as const;
  const sections = tradeView === "history" ? historySections : activeSections;
  const activeTradeCount = activeSections.reduce(
    (sum, [, trades]) => sum + trades.length,
    0,
  );
  const historyTradeCount = historySections.reduce(
    (sum, [, trades]) => sum + trades.length,
    0,
  );
  const myTradeWishlistRows: TradeWishlistRow[] = myTradeWishlist.map(
    (item) => ({
      id: item.id,
      card: toTradeCardSummary({
        id: item.id,
        item: item.targetInventoryItem,
        card: item.card,
        ownerLabel: item.targetOwnerPlayer.displayName,
        roleLabel: "I want",
        notes: item.notes,
      }),
      personLabel: item.targetOwnerPlayer.displayName,
      personColor: item.targetOwnerPlayer.color,
      quantity: item.quantity,
      notes: item.notes,
      negotiateHref: `/trades?receiverId=${item.targetOwnerPlayerId}${
        item.targetInventoryItemId
          ? `&requestedInventoryItemId=${item.targetInventoryItemId}`
          : ""
      }`,
      negotiateLabel: "Negotiate",
      cancelId: item.id,
    }),
  );
  const wantedFromMeRows: TradeWishlistRow[] = wantedFromMe.map((item) => {
    const requester = item.ownerUser.displayName || item.ownerUser.username;
    return {
      id: item.id,
      card: toTradeCardSummary({
        id: item.id,
        item: item.targetInventoryItem,
        card: item.card,
        ownerLabel: "Your public inventory",
        roleLabel: `Wanted by ${requester}`,
        notes: item.notes,
      }),
      personLabel: requester,
      personColor: item.ownerUser.player?.color,
      quantity: item.quantity,
      notes: item.notes,
      negotiateHref: `/trades?receiverId=${item.ownerUser.playerId || ""}${
        item.targetInventoryItemId
          ? `&offeredInventoryItemId=${item.targetInventoryItemId}`
          : ""
      }`,
      negotiateLabel: "Negotiate",
    };
  });

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Trades</h1>
          <p className="text-sm text-zinc-400">
            Build active negotiations by default. Completed and cancelled trades
            live in history.
          </p>
        </div>
        <nav className="flex gap-2" aria-label="Trade view">
          <Link
            href="/trades"
            className={cn(
              filterButtonClass,
              tradeView === "active" && "border-sky-500 bg-sky-950/40",
            )}
          >
            Active ({activeTradeCount})
          </Link>
          <Link
            href="/trades?view=history"
            className={cn(
              filterButtonClass,
              tradeView === "history" && "border-sky-500 bg-sky-950/40",
            )}
          >
            History ({historyTradeCount})
          </Link>
        </nav>
      </div>
      {tradeView === "active" ? (
        <>
          <CompactSection
            title="Create Trade Proposal"
            summary={`Partner: ${
              players.find((player) => player.id === receiverId)?.displayName ||
              "choose partner"
            }`}
            defaultOpen={Boolean(
              params.offeredInventoryItemId || params.requestedInventoryItemId,
            )}
          >
            <p className="mb-3 max-w-3xl text-sm text-zinc-400">
              Search each side only when you need to add a card. Current trade
              rule is one card for one card.
            </p>
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
                players.find((player) => player.id === proposerId)
                  ?.displayName || "You"
              }
              receiverName={
                players.find((player) => player.id === receiverId)
                  ?.displayName || "Trade partner"
              }
              initialOfferedItem={
                initialOfferedItem
                  ? toTradeBuilderItem(initialOfferedItem)
                  : null
              }
              initialRequestedItem={
                initialRequestedItem
                  ? toTradeBuilderItem(initialRequestedItem)
                  : null
              }
            />
          </CompactSection>

          <CompactSection
            title="Trade Wishlist"
            summary="Public-inventory wants grouped by direction"
            count={myTradeWishlistRows.length + wantedFromMeRows.length}
            defaultOpen
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-400">
                Dense table by default, with inventory-style card views when
                image scanning is faster.
              </p>
              <WishlistViewToggle active={activeWishlistView} />
            </div>
            <div className="grid gap-4">
              <TradeWishlistDirection
                title={`Cards I want (${myTradeWishlistRows.length})`}
                rows={myTradeWishlistRows}
                emptyMessage="No public inventory trade wants yet."
                personHeader="From"
                view={activeWishlistView}
              />
              <TradeWishlistDirection
                title={`Wanted from me (${wantedFromMeRows.length})`}
                rows={wantedFromMeRows}
                emptyMessage="No one has wishlisted your public cards for trade yet."
                personHeader="Wanted by"
                view={activeWishlistView}
              />
            </div>
          </CompactSection>
        </>
      ) : null}

      {sections.map(([title, trades], index) => (
        <CompactSection
          key={title}
          title={title}
          count={trades.length}
          defaultOpen={index === 0 && trades.length > 0}
        >
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
              const offeredCard = toTradeCardSummary({
                id: `${trade.id}-offered`,
                item: trade.offeredInventoryItem,
                snap: offeredSnapshot,
                ownerLabel: trade.proposerPlayer.displayName,
                roleLabel: "Offered",
              });
              const requestedCard = toTradeCardSummary({
                id: `${trade.id}-requested`,
                item: trade.requestedInventoryItem,
                snap: requestedSnapshot,
                ownerLabel: trade.receiverPlayer.displayName,
                roleLabel: "Requested",
              });
              return (
                <article
                  key={trade.id}
                  className="rounded border border-zinc-800 p-4 space-y-3"
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {trade.proposerPlayer.displayName} {"<->"}{" "}
                        {trade.receiverPlayer.displayName}
                      </h3>
                      <p className="text-sm text-zinc-400">
                        Status: {statusLabel(trade.status)} - Proposed{" "}
                        {trade.proposedAt.toLocaleString()}{" "}
                        {other ? `- Trade partner: ${other.displayName}` : ""}
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
                  <div className="grid gap-3 md:grid-cols-2">
                    <TradeCardPreview card={offeredCard} />
                    <TradeCardPreview card={requestedCard} />
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
                          - {event.createdAt.toLocaleString()}{" "}
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
                            pendingLabel="Accepting trade..."
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
                            pendingLabel="Declining trade..."
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
                          pendingLabel="Cancelling trade..."
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
                          pendingLabel="Confirming exchange..."
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
                            pendingLabel="Cancelling trade..."
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
                            pendingLabel="Force completing..."
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
        </CompactSection>
      ))}
    </main>
  );
}
