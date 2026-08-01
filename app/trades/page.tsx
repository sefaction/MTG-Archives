export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { getAccessScope, requireLogin } from "@/lib/auth";
import {
  InventoryLocationKind,
  TradeLineSide,
  TradeStatus,
  TradeWishlistStatus,
} from "@prisma/client";
import {
  actOnTrade,
  cancelTradeWishlistItem,
  confirmPhysicalTrade,
  createTrade,
} from "./actions";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { TradeBuilder, type TradeBuilderItem } from "@/components/TradeBuilder";
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
import { normalizePlayerColor } from "@/lib/player-colors";
import { ensureDefaultLocation } from "@/lib/inventory-locations";
import { selectTradeCardPrice } from "@/lib/trade-value";
import { TradeValueSummary } from "@/components/TradeValueSummary";
import { TradePairingCard } from "@/components/TradePairingCard";
import type { TradePairingSide } from "@/lib/trade-pairing";

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
  counterTradeId?: string;
  view?: string;
};
type TradePageView = "desk" | "wishlist" | "active" | "history";
type TradeSnapshot = {
  cardName?: string;
  setCode?: string;
  collectorNumber?: string;
  imageUri?: string | null;
  imageUris?: { small?: string; normal?: string } | null;
  condition?: string;
  foilStatus?: string;
  tradeQuantity?: number;
  priceAmount?: number | null;
  priceLabel?: string;
  priceProvider?: string;
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
function cardName(item: TradeCard, snap: TradeSnapshot) {
  return item?.card.name ?? snap.cardName ?? "Transferred inventory item";
}
function toTradeBuilderItem(
  item: {
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
      typeLine?: string | null;
      colorIdentity?: unknown;
      prices?: unknown;
    };
    location?: { name: string } | null;
  },
  preferredPriceProvider?: string | null,
) {
  const price = selectTradeCardPrice(
    item.card.prices,
    item.foilStatus,
    preferredPriceProvider,
  );
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
    typeLine: item.card.typeLine ?? "",
    colorIdentity: item.card.colorIdentity,
    priceLabel: price.label,
    priceAmount: price.amount,
    priceProvider: price.provider,
    locationName: item.location?.name ?? "Unassigned",
  };
}

function toTradeCardSummary({
  id,
  item,
  snap = {},
  card,
  ownerLabel,
  roleLabel,
  notes,
  quantity,
  preferredPriceProvider,
}: {
  id: string;
  item?: any;
  snap?: TradeSnapshot;
  card?: any;
  ownerLabel?: string;
  roleLabel?: string;
  notes?: string | null;
  quantity?: number;
  preferredPriceProvider?: string | null;
}): TradeCardSummary {
  const resolvedCard = item?.card ?? card ?? null;
  const selectedPrice = resolvedCard
    ? selectTradeCardPrice(
        resolvedCard.prices,
        item?.foilStatus ?? snap.foilStatus,
        preferredPriceProvider,
      )
    : {
        amount: snap.priceAmount ?? null,
        label: snap.priceLabel ?? "",
        provider: snap.priceProvider ?? "",
      };
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
    condition: item?.condition ?? snap.condition ?? "",
    foilStatus: item?.foilStatus ?? snap.foilStatus ?? "",
    quantity: quantity ?? item?.quantity ?? snap.tradeQuantity ?? undefined,
    ownerLabel,
    roleLabel,
    priceLabel: selectedPrice.label,
    priceAmount: selectedPrice.amount,
    priceProvider: selectedPrice.provider,
    notes: notes ?? "",
  };
}

function tradeSideLabel(cards: TradeCardSummary[]) {
  if (cards.length === 1) {
    return `${cards[0].quantity ?? 1}× ${cards[0].name}`;
  }
  const quantity = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0);
  return `${quantity} cards · ${cards.length} lines`;
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

type TradeWishlistRow = {
  id: string;
  card: TradeCardSummary;
  personId: string;
  personLabel: string;
  personColor?: string | null;
  quantity: number;
  notes?: string | null;
  negotiateHref: string;
  negotiateLabel: string;
  cancelId?: string;
  pairingItem?: TradeBuilderItem | null;
};

function playerColorStyle(color?: string | null) {
  return { backgroundColor: normalizePlayerColor(color) };
}

function TradeDeskLane({
  title,
  subtitle,
  rows,
  emptyMessage,
  actionLabel,
  pairingSide,
}: {
  title: string;
  subtitle: string;
  rows: TradeWishlistRow[];
  emptyMessage: string;
  actionLabel: string;
  pairingSide: TradePairingSide;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/45">
      <header className="border-b border-zinc-800 bg-zinc-900/70 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-sky-100">{title}</h2>
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
            {rows.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      </header>
      <div className="max-h-[42rem] space-y-2 overflow-y-auto p-2">
        {rows.length ? (
          rows.map((row) => (
            <TradePairingCard
              key={row.id}
              side={pairingSide}
              item={row.pairingItem}
              addLabel={actionLabel}
            >
              <TradeCardPreview card={row.card} compact />
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="text-zinc-400">
                  Qty {row.quantity}
                  {row.card.priceLabel ? ` · ${row.card.priceLabel}` : ""}
                </span>
                <span className="inline-flex items-center gap-1.5 text-zinc-500">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={playerColorStyle(row.personColor)}
                    aria-hidden="true"
                  />
                  {row.personLabel}
                </span>
              </div>
              {row.notes ? (
                <p className="mt-2 line-clamp-2 text-xs text-zinc-500">
                  {row.notes}
                </p>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                {!row.pairingItem ? (
                  <Link
                    href={row.negotiateHref}
                    className={cn(
                      filterPrimaryButtonClass,
                      "flex-1 text-center",
                    )}
                  >
                    Find tradeable copy
                  </Link>
                ) : (
                  <span className="flex-1 text-[11px] text-zinc-600">
                    Drop onto an opposite card to pair both.
                  </span>
                )}
                {row.cancelId ? (
                  <form action={cancelTradeWishlistItem}>
                    <input
                      type="hidden"
                      name="tradeWishlistItemId"
                      value={row.cancelId}
                    />
                    <SubmitButton
                      pendingLabel="..."
                      className={cn(filterButtonClass, "px-2 py-1.5 text-xs")}
                    >
                      Cancel
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            </TradePairingCard>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  );
}

function groupTradeWishlistRows(rows: TradeWishlistRow[]) {
  const groups = new Map<
    string,
    {
      personId: string;
      personLabel: string;
      personColor?: string | null;
      rows: TradeWishlistRow[];
    }
  >();
  for (const row of rows) {
    const current = groups.get(row.personId);
    if (current) current.rows.push(row);
    else {
      groups.set(row.personId, {
        personId: row.personId,
        personLabel: row.personLabel,
        personColor: row.personColor,
        rows: [row],
      });
    }
  }
  return Array.from(groups.values()).sort((left, right) =>
    left.personLabel.localeCompare(right.personLabel),
  );
}

function TradeWishlistOverviewColumn({
  title,
  subtitle,
  rows,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  rows: TradeWishlistRow[];
  emptyMessage: string;
}) {
  const groups = groupTradeWishlistRows(rows);
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/45">
      <header className="border-b border-zinc-800 bg-zinc-900/70 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-sky-100">{title}</h2>
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
            {rows.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      </header>
      <div className="space-y-3 p-3">
        {groups.length ? (
          groups.map((group) => (
            <section
              key={group.personId}
              className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/55"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/55 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={playerColorStyle(group.personColor)}
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-zinc-200">
                    {group.personLabel}
                  </h3>
                  <span className="text-xs text-zinc-500">
                    {group.rows.length}{" "}
                    {group.rows.length === 1 ? "card" : "cards"}
                  </span>
                </div>
                <Link
                  href={`/trades?receiverId=${group.personId}`}
                  className={cn(filterPrimaryButtonClass, "text-xs")}
                >
                  Open Trade Desk
                </Link>
              </header>
              <div className="grid gap-2 p-2 sm:grid-cols-2">
                {group.rows.map((row) => (
                  <article
                    key={row.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2"
                  >
                    <TradeCardPreview card={row.card} compact />
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-500">
                      <span>Qty {row.quantity}</span>
                      <span>{row.card.priceLabel || "Price unavailable"}</span>
                    </div>
                    {row.notes ? (
                      <p className="mt-2 line-clamp-2 text-xs text-zinc-500">
                        {row.notes}
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      <Link
                        href={row.negotiateHref}
                        className={cn(
                          filterButtonClass,
                          "flex-1 text-center text-xs",
                        )}
                      >
                        Add at Trade Desk
                      </Link>
                      {row.cancelId ? (
                        <form action={cancelTradeWishlistItem}>
                          <input
                            type="hidden"
                            name="tradeWishlistItemId"
                            value={row.cancelId}
                          />
                          <SubmitButton
                            pendingLabel="..."
                            className={cn(
                              filterButtonClass,
                              "px-2 py-1.5 text-xs",
                            )}
                          >
                            Cancel
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-10 text-center text-sm text-zinc-500">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  );
}

function TradeViewNav({
  active,
  wishlistCount,
  activeTradeCount,
  historyTradeCount,
}: {
  active: TradePageView;
  wishlistCount: number;
  activeTradeCount: number;
  historyTradeCount: number;
}) {
  const options: Array<{
    value: TradePageView;
    label: string;
    href: string;
    count?: number;
  }> = [
    { value: "desk", label: "Trade Desk", href: "/trades" },
    {
      value: "wishlist",
      label: "Trade Wishlist",
      href: "/trades?view=wishlist",
      count: wishlistCount,
    },
    {
      value: "active",
      label: "Active Trades",
      href: "/trades?view=active",
      count: activeTradeCount,
    },
    {
      value: "history",
      label: "History",
      href: "/trades?view=history",
      count: historyTradeCount,
    },
  ];
  return (
    <nav
      className="flex flex-wrap gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-1"
      aria-label="Trade view"
    >
      {options.map((option) => (
        <Link
          key={option.value}
          href={option.href}
          className={cn(
            "rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100",
            active === option.value && "bg-sky-950/60 text-sky-100",
          )}
        >
          {option.label}
          {typeof option.count === "number" ? ` (${option.count})` : ""}
        </Link>
      ))}
    </nav>
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
  const tradeView: TradePageView =
    params.view === "wishlist" ||
    params.view === "active" ||
    params.view === "history"
      ? params.view
      : "desk";
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

  if (user.playerId) await ensureDefaultLocation(prisma, user.playerId);
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
      lines: {
        orderBy: [{ side: "asc" }, { position: "asc" }],
        include: { inventoryItem: { include: { card: true } } },
      },
      events: {
        orderBy: { createdAt: "asc" },
        include: { actorPlayer: true, actorUser: true },
      },
    },
    orderBy: { proposedAt: "desc" },
  });
  const myDestinationLocations = user.playerId
    ? await prisma.inventoryLocation.findMany({
        where: {
          ownerPlayerId: user.playerId,
          active: true,
          kind: InventoryLocationKind.NORMAL,
          systemManaged: false,
        },
        orderBy: { name: "asc" },
      })
    : [];
  const [myTradeWishlist, wantedFromMe] = await Promise.all([
    prisma.tradeWishlistItem.findMany({
      where: { ownerUserId: user.id, status: TradeWishlistStatus.OPEN },
      include: {
        card: true,
        targetOwnerPlayer: true,
        targetInventoryItem: { include: { card: true, location: true } },
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
            targetInventoryItem: { include: { card: true, location: true } },
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
  const needsMyResponse = visibleTrades.filter(
    (t) =>
      t.status === TradeStatus.PROPOSED && t.receiverPlayerId === user.playerId,
  );
  const waitingOnPartnerResponse = visibleTrades.filter(
    (t) =>
      t.status === TradeStatus.PROPOSED && t.proposerPlayerId === user.playerId,
  );
  const needsMyPhysicalConfirmation = visibleTrades.filter(
    (t) =>
      physicalStatuses.includes(t.status) &&
      ((t.proposerPlayerId === user.playerId && !t.proposerCommittedAt) ||
        (t.receiverPlayerId === user.playerId && !t.receiverCommittedAt)),
  );
  const waitingOnPartnerPhysical = visibleTrades.filter(
    (t) =>
      physicalStatuses.includes(t.status) &&
      ((t.proposerPlayerId === user.playerId &&
        t.proposerCommittedAt &&
        !t.receiverCommittedAt) ||
        (t.receiverPlayerId === user.playerId &&
          t.receiverCommittedAt &&
          !t.proposerCommittedAt)),
  );
  const prioritizedActiveTradeIds = new Set(
    [
      needsMyResponse,
      waitingOnPartnerResponse,
      needsMyPhysicalConfirmation,
      waitingOnPartnerPhysical,
    ]
      .flat()
      .map((trade) => trade.id),
  );
  const otherActiveTrades = visibleTrades.filter(
    (t) =>
      activeStatuses.includes(t.status) && !prioritizedActiveTradeIds.has(t.id),
  );
  const activeSections = [
    ["Needs My Response", needsMyResponse],
    ["Needs My Physical Confirmation", needsMyPhysicalConfirmation],
    ["Waiting On Partner", waitingOnPartnerResponse],
    ["Waiting On Partner Physical Confirmation", waitingOnPartnerPhysical],
    ["Other Active Trades", otherActiveTrades],
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
  const sections =
    tradeView === "history"
      ? historySections
      : tradeView === "active"
        ? activeSections
        : [];
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
        preferredPriceProvider: user.preferredPriceProvider,
      }),
      personId: item.targetOwnerPlayerId,
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
      pairingItem: item.targetInventoryItem
        ? toTradeBuilderItem(
            item.targetInventoryItem,
            user.preferredPriceProvider,
          )
        : null,
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
        preferredPriceProvider: user.preferredPriceProvider,
      }),
      personId: item.ownerUser.playerId || "",
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
      pairingItem: item.targetInventoryItem
        ? toTradeBuilderItem(
            item.targetInventoryItem,
            user.preferredPriceProvider,
          )
        : null,
    };
  });
  const selectedPartner =
    players.find((player) => player.id === receiverId) ?? null;
  const partnerWants = myTradeWishlistRows.filter(
    (row) => row.personId === receiverId,
  );
  const partnerWantsFromMe = wantedFromMeRows.filter(
    (row) => row.personId === receiverId,
  );

  return (
    <main className="space-y-5 p-4 sm:p-6 xl:p-8">
      <Nav />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Trades</h1>
          <p className="text-sm text-zinc-400">
            Pair wishlist cards, build proposals, and manage exchanges.
          </p>
        </div>
        <TradeViewNav
          active={tradeView}
          wishlistCount={myTradeWishlistRows.length + wantedFromMeRows.length}
          activeTradeCount={activeTradeCount}
          historyTradeCount={historyTradeCount}
        />
      </div>
      {tradeView === "wishlist" ? (
        <section className="space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/45 p-3">
            <h2 className="text-lg font-semibold text-zinc-100">
              Trade Wishlist
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Every open person-to-person want, grouped by trade partner. Open a
              partner&apos;s desk to pair cards and build a proposal.
            </p>
          </div>
          <div className="grid items-start gap-3 xl:grid-cols-2">
            <TradeWishlistOverviewColumn
              title="Cards I want"
              subtitle="Cards you have requested from other owners."
              rows={myTradeWishlistRows}
              emptyMessage="You have no open trade-wishlist requests."
            />
            <TradeWishlistOverviewColumn
              title="Wanted from me"
              subtitle="Cards other owners have requested from you."
              rows={wantedFromMeRows}
              emptyMessage="No one currently has an open request from your inventory."
            />
          </div>
        </section>
      ) : null}
      {tradeView === "desk" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/45 p-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                Trade Desk
              </h2>
              <p className="text-xs text-zinc-500">
                Choose one partner, then add cards from either wishlist lane or
                inventory search.
              </p>
            </div>
            <form method="get" className="flex flex-wrap items-end gap-2">
              {isAdmin ? (
                <label className={cn(filterFieldClass, "min-w-44")}>
                  Proposer
                  <select
                    name="proposerId"
                    defaultValue={proposerId}
                    className={cn(filterSelectClass, "mt-1 w-full")}
                  >
                    {players.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={cn(filterFieldClass, "min-w-52")}>
                Trade partner
                <select
                  name="receiverId"
                  defaultValue={receiverId}
                  className={cn(filterSelectClass, "mt-1 w-full")}
                >
                  {players
                    .filter((player) => player.id !== proposerId)
                    .map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <button className={filterButtonClass}>Load desk</button>
            </form>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border border-sky-900/60 bg-sky-950/20 px-3 py-2 text-center text-xs text-sky-100">
            <span>Pairing board:</span>
            <span className="text-zinc-400">
              drag a wishlist card into its proposal slot, or drop it onto a
              card in the opposite lane to add both.
            </span>
          </div>

          <div className="grid items-start gap-3 xl:grid-cols-[minmax(15rem,0.85fr)_minmax(23rem,1.3fr)_minmax(15rem,0.85fr)]">
            <TradeDeskLane
              title="Cards I want"
              subtitle={`From ${selectedPartner?.displayName || "this partner"}`}
              rows={partnerWants}
              emptyMessage={`You have no open wants from ${selectedPartner?.displayName || "this partner"}.`}
              actionLabel="Request"
              pairingSide="requested"
            />
            <div className="xl:sticky xl:top-3">
              <TradeBuilder
                key={[
                  proposerId,
                  receiverId,
                  params.counterTradeId ?? "",
                  initialOfferedItem?.id ?? "",
                  initialRequestedItem?.id ?? "",
                ].join(":")}
                createTradeAction={createTrade}
                proposerPlayerId={isAdmin ? proposerId : undefined}
                proposerOwnerId={proposerId}
                receiverPlayerId={receiverId}
                counterTradeId={params.counterTradeId}
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
                    ? toTradeBuilderItem(
                        initialOfferedItem,
                        user.preferredPriceProvider,
                      )
                    : null
                }
                initialRequestedItem={
                  initialRequestedItem
                    ? toTradeBuilderItem(
                        initialRequestedItem,
                        user.preferredPriceProvider,
                      )
                    : null
                }
              />
            </div>
            <TradeDeskLane
              title="Wanted from me"
              subtitle={`Requested by ${selectedPartner?.displayName || "this partner"}`}
              rows={partnerWantsFromMe}
              emptyMessage={`${selectedPartner?.displayName || "This partner"} has no open wants from your public inventory.`}
              actionLabel="Offer"
              pairingSide="offered"
            />
          </div>
        </section>
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
              const offeredLines = trade.lines.filter(
                (line) => line.side === TradeLineSide.PROPOSER,
              );
              const requestedLines = trade.lines.filter(
                (line) => line.side === TradeLineSide.RECEIVER,
              );
              const offeredCards = offeredLines.length
                ? offeredLines.map((line) =>
                    toTradeCardSummary({
                      id: line.id,
                      item: line.inventoryItem,
                      snap: snapshot(line.snapshotJson),
                      ownerLabel: trade.proposerPlayer.displayName,
                      roleLabel: "Offered",
                      quantity: line.quantity,
                      preferredPriceProvider: user.preferredPriceProvider,
                    }),
                  )
                : [
                    toTradeCardSummary({
                      id: `${trade.id}-offered`,
                      item: trade.offeredInventoryItem,
                      snap: offeredSnapshot,
                      ownerLabel: trade.proposerPlayer.displayName,
                      roleLabel: "Offered",
                      quantity: 1,
                      preferredPriceProvider: user.preferredPriceProvider,
                    }),
                  ];
              const requestedCards = requestedLines.length
                ? requestedLines.map((line) =>
                    toTradeCardSummary({
                      id: line.id,
                      item: line.inventoryItem,
                      snap: snapshot(line.snapshotJson),
                      ownerLabel: trade.receiverPlayer.displayName,
                      roleLabel: "Requested",
                      quantity: line.quantity,
                      preferredPriceProvider: user.preferredPriceProvider,
                    }),
                  )
                : [
                    toTradeCardSummary({
                      id: `${trade.id}-requested`,
                      item: trade.requestedInventoryItem,
                      snap: requestedSnapshot,
                      ownerLabel: trade.receiverPlayer.displayName,
                      roleLabel: "Requested",
                      quantity: 1,
                      preferredPriceProvider: user.preferredPriceProvider,
                    }),
                  ];
              const incomingCards = userIsProposer
                ? requestedCards
                : offeredCards;
              const displayLeftCards = userIsReceiver
                ? requestedCards
                : offeredCards;
              const displayRightCards = userIsReceiver
                ? offeredCards
                : requestedCards;
              const displayLeftPlayer = userIsReceiver
                ? trade.receiverPlayer
                : trade.proposerPlayer;
              const displayRightPlayer = userIsReceiver
                ? trade.proposerPlayer
                : trade.receiverPlayer;
              const templateOfferedId =
                offeredLines[0]?.inventoryItemId ??
                trade.offeredInventoryItemId ??
                "";
              const templateRequestedId =
                requestedLines[0]?.inventoryItemId ??
                trade.requestedInventoryItemId ??
                "";
              const canUseExactTemplate =
                offeredCards.length === 1 &&
                requestedCards.length === 1 &&
                Boolean(templateOfferedId && templateRequestedId);
              const savedDestinationLocationId = userIsProposer
                ? trade.proposerDestinationLocationId
                : trade.receiverDestinationLocationId;
              return (
                <details
                  key={trade.id}
                  className="group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40"
                >
                  <summary className="grid cursor-pointer list-none items-center gap-3 p-3 transition-colors hover:bg-zinc-900/60 md:grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.4fr)_auto]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold">
                          {other?.displayName || "Trade"}
                        </h3>
                        {receiverNeedsAction || userNeedsPhysical ? (
                          <span className="shrink-0 rounded-full border border-amber-700 px-2 py-0.5 text-[11px] text-amber-200">
                            Action needed
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-zinc-500">
                        {trade.proposedAt.toLocaleString()}
                      </p>
                    </div>
                    <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
                      <span className="truncate rounded bg-zinc-900 px-2 py-1 text-zinc-200">
                        {tradeSideLabel(displayLeftCards)}
                      </span>
                      <span className="text-zinc-600">for</span>
                      <span className="truncate rounded bg-zinc-900 px-2 py-1 text-zinc-200">
                        {tradeSideLabel(displayRightCards)}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="rounded-full border border-zinc-700 px-2 py-1 text-xs capitalize text-zinc-400">
                        {statusLabel(trade.status).replaceAll("_", " ")}
                      </span>
                      <span className="text-xs text-zinc-500 group-open:hidden">
                        Open
                      </span>
                      <span className="hidden text-xs text-zinc-500 group-open:inline">
                        Close
                      </span>
                    </div>
                  </summary>
                  <div className="space-y-3 border-t border-zinc-800 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-zinc-400">
                        {displayLeftPlayer.displayName} {"<->"}{" "}
                        {displayRightPlayer.displayName}
                      </p>
                      {receiverNeedsAction || userNeedsPhysical ? (
                        <span className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-200">
                          Action needed
                        </span>
                      ) : null}
                      {trade.status === TradeStatus.PROPOSED ? (
                        <Link
                          href={
                            canUseExactTemplate
                              ? userIsReceiver
                                ? `/trades?receiverId=${trade.proposerPlayerId}&offeredInventoryItemId=${templateRequestedId}&requestedInventoryItemId=${templateOfferedId}&counterTradeId=${trade.id}`
                                : `/trades?receiverId=${trade.receiverPlayerId}&offeredInventoryItemId=${templateOfferedId}&requestedInventoryItemId=${templateRequestedId}`
                              : `/trades?receiverId=${
                                  userIsReceiver
                                    ? trade.proposerPlayerId
                                    : trade.receiverPlayerId
                                }${
                                  userIsReceiver
                                    ? `&counterTradeId=${trade.id}`
                                    : ""
                                }`
                          }
                          className={cn(filterButtonClass, "self-start")}
                        >
                          {canUseExactTemplate
                            ? userIsReceiver
                              ? "Counter From This"
                              : "Use As Template"
                            : userIsReceiver
                              ? "Start New Counter"
                              : "Start New Trade"}
                        </Link>
                      ) : null}
                    </div>
                    {trade.message ? (
                      <p className="text-sm text-zinc-300">{trade.message}</p>
                    ) : null}
                    <TradeValueSummary
                      compact
                      leftLabel={`${displayLeftPlayer.displayName} offers`}
                      rightLabel={`${displayRightPlayer.displayName} offers`}
                      leftLines={displayLeftCards}
                      rightLines={displayRightCards}
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      <section className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase text-zinc-500">
                          {displayLeftPlayer.displayName} offers
                        </h4>
                        {displayLeftCards.map((card) => (
                          <TradeCardPreview key={card.id} card={card} />
                        ))}
                      </section>
                      <section className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase text-zinc-500">
                          {displayRightPlayer.displayName} offers
                        </h4>
                        {displayRightCards.map((card) => (
                          <TradeCardPreview key={card.id} card={card} />
                        ))}
                      </section>
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
                      {trade.status === TradeStatus.PROPOSED &&
                      userIsReceiver ? (
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
                      {trade.status === TradeStatus.PROPOSED &&
                      userIsProposer ? (
                        <form action={actOnTrade}>
                          <input
                            type="hidden"
                            name="tradeId"
                            value={trade.id}
                          />
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
                        <form
                          action={confirmPhysicalTrade}
                          className="flex flex-wrap items-end gap-2 rounded border border-zinc-800 bg-zinc-950/50 p-3"
                        >
                          <input
                            type="hidden"
                            name="tradeId"
                            value={trade.id}
                          />
                          <label className="min-w-64 text-sm text-zinc-300">
                            Move {incomingCards.length} incoming card{" "}
                            {incomingCards.length === 1 ? "line" : "lines"} to
                            <select
                              name="destinationLocationId"
                              required
                              defaultValue={
                                savedDestinationLocationId ??
                                myDestinationLocations[0]?.id ??
                                ""
                              }
                              className={cn(filterSelectClass, "mt-1 w-full")}
                            >
                              {myDestinationLocations.map((location) => (
                                <option key={location.id} value={location.id}>
                                  {location.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <SubmitButton
                            pendingLabel="Confirming exchange..."
                            className={filterPrimaryButtonClass}
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
                            <input
                              type="hidden"
                              name="forceComplete"
                              value="1"
                            />
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
                  </div>
                </details>
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
