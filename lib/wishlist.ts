import {
  Card,
  DeckSection,
  InventoryLocationKind,
  PrismaClient,
  TradeWishlistStatus,
} from "@prisma/client";
import { isBasicLandCard } from "./card-types";
import { cardPriceUsd } from "./deck-search";
import { matchesDeckCardPrinting } from "./deck-commitments";

export type WishlistCardSummary = Pick<
  Card,
  | "id"
  | "scryfallId"
  | "oracleId"
  | "name"
  | "manaCost"
  | "manaValue"
  | "typeLine"
  | "oracleText"
  | "colorIdentity"
  | "setCode"
  | "setName"
  | "collectorNumber"
  | "rarity"
  | "imageUri"
  | "prices"
>;

export type WishlistManualSource = {
  id: string;
  cardId: string;
  quantity: number;
  priority: string | null;
  notes: string | null;
  desiredFinish: string | null;
  desiredCondition: string | null;
  desiredLanguage: string | null;
};

export type WishlistDeckSource = {
  deckId: string;
  deckName: string;
  deckCardId: string;
  section: DeckSection;
  requiredQuantity: number;
  committedQuantity: number;
  committedToOtherDecks: number;
  missingQuantity: number;
  selectedPrinting: WishlistCardSummary | null;
  availableExact: number;
  availableOther: number;
  anotherOwnedPrintingAvailable: boolean;
  availableUncommittedCopyExists: boolean;
  commitOptions: Array<{
    inventoryItemId: string;
    locationName: string;
    quantity: number;
    exact: boolean;
  }>;
};

export type WishlistTradeSource = {
  id: string;
  cardId: string;
  quantity: number;
  status: TradeWishlistStatus | string;
  notes: string | null;
  targetOwnerPlayerId: string;
  targetOwnerName: string;
  targetInventoryItemId: string | null;
};

export type WishlistInventoryCounts = {
  ownedTotal: number;
  available: number;
  committedToDecks: number;
  committedToOtherDecks: number;
};

export type WishlistInventoryBreakdown = {
  availableByLocation: Array<{ name: string; quantity: number }>;
  committedByDeck: Array<{ name: string; quantity: number }>;
  exactOwned: number;
  exactAvailable: number;
  otherPrintingOwned: number;
  otherPrintingAvailable: number;
  otherPrintings: Array<{
    cardId: string;
    name: string;
    setCode: string;
    collectorNumber: string;
    quantity: number;
    available: number;
  }>;
};

export type WishlistGroup = {
  key: string;
  card: WishlistCardSummary;
  manualQuantity: number;
  deckQuantity: number;
  tradeQuantity: number;
  totalWanted: number;
  inventory: WishlistInventoryCounts;
  inventoryBreakdown: WishlistInventoryBreakdown;
  estimatedPrice: number | null;
  estimatedMissingCost: number | null;
  sources: {
    manual: WishlistManualSource[];
    decks: WishlistDeckSource[];
    trade: WishlistTradeSource[];
  };
  sourceLabel: string;
};

export type WishlistSummary = {
  manualRows: number;
  deckRows: number;
  tradeRows: number;
  totalWantedQuantity: number;
  missingFromInventoryQuantity: number;
  availableToCommitQuantity: number;
  estimatedMissingCost: number | null;
};

export type WishlistView = {
  groups: WishlistGroup[];
  summary: WishlistSummary;
};

type BuildInput = {
  manualItems: Array<WishlistManualSource & { card: WishlistCardSummary }>;
  decks: Array<{
    id: string;
    name: string;
    cards: Array<{
      id: string;
      cardId: string | null;
      scryfallId: string | null;
      oracleId: string | null;
      cardName: string;
      section: DeckSection;
      quantity: number;
      card: WishlistCardSummary | null;
    }>;
  }>;
  inventoryItems: Array<{
    id: string;
    cardId: string;
    quantity: number;
    card: {
      id: string;
      oracleId: string | null;
      name: string;
      setCode?: string | null;
      collectorNumber?: string | null;
    };
    location: {
      id: string;
      name: string;
      kind: InventoryLocationKind | string;
      deckId: string | null;
    } | null;
  }>;
  tradeItems?: Array<WishlistTradeSource & { card: WishlistCardSummary }>;
};

function cardIdentity(
  card: Pick<Card, "id" | "oracleId" | "name"> | WishlistCardSummary | null,
  fallbackName?: string | null,
  fallbackOracle?: string | null,
) {
  if (card?.oracleId) return `oracle:${card.oracleId}`;
  if (fallbackOracle) return `oracle:${fallbackOracle}`;
  return `name:${(card?.name || fallbackName || "unknown").trim().replace(/\s+/g, " ").toLowerCase()}`;
}

function isDeckLocation(
  location: BuildInput["inventoryItems"][number]["location"],
) {
  return (
    location?.kind === InventoryLocationKind.DECK || Boolean(location?.deckId)
  );
}

function inventoryBreakdownForCard(
  inventoryItems: BuildInput["inventoryItems"],
  card: WishlistCardSummary,
): WishlistInventoryBreakdown {
  const key = cardIdentity(card);
  const availableLocations = new Map<string, number>();
  const committedDecks = new Map<string, number>();
  const otherPrintings = new Map<
    string,
    {
      cardId: string;
      name: string;
      setCode: string;
      collectorNumber: string;
      quantity: number;
      available: number;
    }
  >();
  let exactOwned = 0;
  let exactAvailable = 0;
  let otherPrintingOwned = 0;
  let otherPrintingAvailable = 0;

  for (const item of inventoryItems) {
    if (cardIdentity(item.card) !== key) continue;
    const deckLoc = isDeckLocation(item.location);
    const locationName = item.location?.name || "Unassigned";
    const exact = item.cardId === card.id;
    if (exact) {
      exactOwned += item.quantity;
      if (!deckLoc) exactAvailable += item.quantity;
    } else {
      otherPrintingOwned += item.quantity;
      if (!deckLoc) otherPrintingAvailable += item.quantity;
      const current = otherPrintings.get(item.cardId) ?? {
        cardId: item.cardId,
        name: item.card.name,
        setCode: item.card.setCode || "",
        collectorNumber: item.card.collectorNumber || "",
        quantity: 0,
        available: 0,
      };
      current.quantity += item.quantity;
      if (!deckLoc) current.available += item.quantity;
      otherPrintings.set(item.cardId, current);
    }
    if (deckLoc) {
      committedDecks.set(
        locationName,
        (committedDecks.get(locationName) ?? 0) + item.quantity,
      );
    } else {
      availableLocations.set(
        locationName,
        (availableLocations.get(locationName) ?? 0) + item.quantity,
      );
    }
  }

  return {
    availableByLocation: [...availableLocations.entries()].map(
      ([name, quantity]) => ({ name, quantity }),
    ),
    committedByDeck: [...committedDecks.entries()].map(([name, quantity]) => ({
      name,
      quantity,
    })),
    exactOwned,
    exactAvailable,
    otherPrintingOwned,
    otherPrintingAvailable,
    otherPrintings: [...otherPrintings.values()],
  };
}

function addCountsForCard(
  inventoryItems: BuildInput["inventoryItems"],
  card: WishlistCardSummary,
): WishlistInventoryCounts {
  const key = cardIdentity(card);
  return inventoryItems.reduce(
    (counts, item) => {
      if (cardIdentity(item.card) !== key) return counts;
      counts.ownedTotal += item.quantity;
      if (isDeckLocation(item.location))
        counts.committedToDecks += item.quantity;
      else counts.available += item.quantity;
      return counts;
    },
    {
      ownedTotal: 0,
      available: 0,
      committedToDecks: 0,
      committedToOtherDecks: 0,
    },
  );
}

export function buildWishlistView(input: BuildInput): WishlistView {
  const groups = new Map<string, WishlistGroup>();
  const ensureGroup = (card: WishlistCardSummary) => {
    const key = cardIdentity(card);
    const existing = groups.get(key);
    if (existing) return existing;
    const estimatedPrice = cardPriceUsd(card as Card);
    const group: WishlistGroup = {
      key,
      card,
      manualQuantity: 0,
      deckQuantity: 0,
      tradeQuantity: 0,
      totalWanted: 0,
      inventory: addCountsForCard(input.inventoryItems, card),
      inventoryBreakdown: inventoryBreakdownForCard(input.inventoryItems, card),
      estimatedPrice,
      estimatedMissingCost: null,
      sources: { manual: [], decks: [], trade: [] },
      sourceLabel: "Manual",
    };
    groups.set(key, group);
    return group;
  };

  for (const item of input.manualItems) {
    const group = ensureGroup(item.card);
    group.manualQuantity += item.quantity;
    group.sources.manual.push({
      id: item.id,
      cardId: item.cardId,
      quantity: item.quantity,
      priority: item.priority,
      notes: item.notes,
      desiredFinish: item.desiredFinish,
      desiredCondition: item.desiredCondition,
      desiredLanguage: item.desiredLanguage,
    });
  }

  for (const deck of input.decks) {
    for (const deckCard of deck.cards) {
      if (!deckCard.card || isBasicLandCard(deckCard.card)) continue;
      const committedQuantity = input.inventoryItems.reduce((total, item) => {
        if (item.location?.deckId !== deck.id) return total;
        return matchesDeckCardPrinting(deckCard, item)
          ? total + item.quantity
          : total;
      }, 0);
      const committedToOtherDecks = input.inventoryItems.reduce(
        (total, item) => {
          if (!item.location?.deckId || item.location.deckId === deck.id)
            return total;
          return matchesDeckCardPrinting(deckCard, item)
            ? total + item.quantity
            : total;
        },
        0,
      );
      const missingQuantity = Math.max(
        0,
        deckCard.quantity - committedQuantity,
      );
      if (missingQuantity <= 0) continue;
      const commitOptions = input.inventoryItems
        .filter(
          (item) =>
            !isDeckLocation(item.location) &&
            matchesDeckCardPrinting(deckCard, item),
        )
        .map((item) => ({
          inventoryItemId: item.id,
          locationName: item.location?.name || "Unassigned",
          quantity: item.quantity,
          exact: item.cardId === deckCard.cardId,
        }));
      const availableExact = commitOptions
        .filter((option) => option.exact)
        .reduce((sum, option) => sum + option.quantity, 0);
      const availableOther = commitOptions
        .filter((option) => !option.exact)
        .reduce((sum, option) => sum + option.quantity, 0);
      const group = ensureGroup(deckCard.card);
      group.deckQuantity += missingQuantity;
      group.sources.decks.push({
        deckId: deck.id,
        deckName: deck.name,
        deckCardId: deckCard.id,
        section: deckCard.section,
        requiredQuantity: deckCard.quantity,
        committedQuantity,
        committedToOtherDecks,
        missingQuantity,
        selectedPrinting: deckCard.card,
        availableExact,
        availableOther,
        anotherOwnedPrintingAvailable: availableOther > 0,
        availableUncommittedCopyExists: availableExact + availableOther > 0,
        commitOptions,
      });
    }
  }

  for (const item of input.tradeItems ?? []) {
    const group = ensureGroup(item.card);
    group.tradeQuantity += item.quantity;
    group.sources.trade.push({
      id: item.id,
      cardId: item.cardId,
      quantity: item.quantity,
      status: item.status,
      notes: item.notes,
      targetOwnerPlayerId: item.targetOwnerPlayerId,
      targetOwnerName: item.targetOwnerName,
      targetInventoryItemId: item.targetInventoryItemId,
    });
  }

  for (const group of groups.values()) {
    group.totalWanted =
      group.manualQuantity + group.deckQuantity + group.tradeQuantity;
    group.sourceLabel = [
      group.manualQuantity > 0 ? "Manual" : "",
      group.deckQuantity > 0 ? "Deck" : "",
      group.tradeQuantity > 0 ? "Trade" : "",
    ]
      .filter(Boolean)
      .join(" + ");
    const inventoryShortfall = Math.max(
      0,
      group.totalWanted - group.inventory.ownedTotal,
    );
    group.estimatedMissingCost =
      group.estimatedPrice === null
        ? null
        : inventoryShortfall * group.estimatedPrice;
  }

  const ordered = [...groups.values()].sort(
    (a, b) =>
      b.totalWanted - a.totalWanted || a.card.name.localeCompare(b.card.name),
  );
  const knownCosts = ordered
    .map((g) => g.estimatedMissingCost)
    .filter((value): value is number => value !== null);
  return {
    groups: ordered,
    summary: {
      manualRows: input.manualItems.length,
      deckRows: ordered.reduce(
        (sum, group) => sum + group.sources.decks.length,
        0,
      ),
      tradeRows: ordered.reduce(
        (sum, group) => sum + group.sources.trade.length,
        0,
      ),
      totalWantedQuantity: ordered.reduce(
        (sum, group) => sum + group.totalWanted,
        0,
      ),
      missingFromInventoryQuantity: ordered.reduce(
        (sum, group) =>
          sum + Math.max(0, group.totalWanted - group.inventory.ownedTotal),
        0,
      ),
      availableToCommitQuantity: ordered.reduce(
        (sum, group) =>
          sum +
          group.sources.decks.reduce(
            (deckSum, deck) =>
              deckSum +
              Math.min(
                deck.missingQuantity,
                deck.availableExact + deck.availableOther,
              ),
            0,
          ),
        0,
      ),
      estimatedMissingCost: knownCosts.length
        ? knownCosts.reduce((sum, value) => sum + value, 0)
        : null,
    },
  };
}

const cardSelect = {
  id: true,
  scryfallId: true,
  oracleId: true,
  name: true,
  manaCost: true,
  manaValue: true,
  typeLine: true,
  oracleText: true,
  colorIdentity: true,
  setCode: true,
  setName: true,
  collectorNumber: true,
  rarity: true,
  imageUri: true,
  prices: true,
} as const;

export async function getWishlistView(
  prisma: PrismaClient,
  ownerUserId: string,
  ownerPlayerId: string | null | undefined,
) {
  const [manualItems, decks, inventoryItems, tradeItems] = await Promise.all([
    prisma.wishlistItem.findMany({
      where: { ownerUserId },
      include: { card: { select: cardSelect } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.deck.findMany({
      where: { ownerUserId },
      select: {
        id: true,
        name: true,
        cards: {
          select: {
            id: true,
            cardId: true,
            scryfallId: true,
            oracleId: true,
            cardName: true,
            section: true,
            quantity: true,
            card: { select: cardSelect },
          },
        },
      },
    }),
    ownerPlayerId
      ? prisma.inventoryItem.findMany({
          where: { currentOwnerId: ownerPlayerId, quantity: { gt: 0 } },
          select: {
            id: true,
            cardId: true,
            quantity: true,
            card: {
              select: {
                id: true,
                oracleId: true,
                name: true,
                setCode: true,
                collectorNumber: true,
              },
            },
            location: {
              select: { id: true, name: true, kind: true, deckId: true },
            },
          },
        })
      : Promise.resolve([]),
    prisma.tradeWishlistItem.findMany({
      where: { ownerUserId, status: TradeWishlistStatus.OPEN },
      include: {
        card: { select: cardSelect },
        targetOwnerPlayer: { select: { id: true, displayName: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return buildWishlistView({
    manualItems,
    decks,
    inventoryItems,
    tradeItems: tradeItems.map((item) => ({
      id: item.id,
      cardId: item.cardId,
      quantity: item.quantity,
      status: item.status,
      notes: item.notes,
      targetOwnerPlayerId: item.targetOwnerPlayerId,
      targetOwnerName: item.targetOwnerPlayer.displayName,
      targetInventoryItemId: item.targetInventoryItemId,
      card: item.card,
    })),
  });
}
