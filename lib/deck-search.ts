import { Card, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizeCardName, upsertScryfallCard } from "./card-import";
import { formatScryfallError, searchCardsResult } from "./scryfall";

export type DeckCardSearchResult = {
  cardId: string;
  scryfallId: string;
  oracleId: string | null;
  name: string;
  manaCost: string | null;
  typeLine: string;
  setCode: string;
  setName: string | null;
  collectorNumber: string;
  rarity: string;
  imageUri: string | null;
  priceUsd: number | null;
  priceLabel: string;
  ownedQuantity: number;
  ownedExactQuantity: number;
  ownedOtherPrintingQuantity: number;
  locationSummary: string;
  finishes: string[];
  source: "owned" | "local" | "scryfall";
  badges: string[];
};

export type DeckCardSearchResponse = {
  query: string;
  message: string;
  results: DeckCardSearchResult[];
  counts: { owned: number; local: number; scryfall: number };
};

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export function cardPriceUsd(card: Pick<Card, "prices">) {
  const prices = (card.prices ?? {}) as Record<string, string | null>;
  const value = prices.usd ?? prices.usd_foil ?? prices.usd_etched ?? null;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function playableSortPenalty(
  card: Pick<
    Card,
    "digital" | "lang" | "oversized" | "layout" | "setType" | "games"
  >,
) {
  let penalty = 0;
  const games = asStringArray(card.games);
  if (card.digital) penalty += 100;
  if (card.lang && card.lang !== "en") penalty += 20;
  if (card.oversized) penalty += 50;
  if (
    ["token", "art_series", "memorabilia", "minigame"].includes(
      card.layout ?? "",
    )
  )
    penalty += 80;
  if (["token", "memorabilia", "alchemy"].includes(card.setType ?? ""))
    penalty += 40;
  if (games.length && !games.includes("paper")) penalty += 30;
  return penalty;
}

export function compareCheapestPlayableCards(a: Card, b: Card) {
  const playable = playableSortPenalty(a) - playableSortPenalty(b);
  if (playable !== 0) return playable;
  const aPrice = cardPriceUsd(a);
  const bPrice = cardPriceUsd(b);
  if (aPrice !== null && bPrice !== null && aPrice !== bPrice)
    return aPrice - bPrice;
  if (aPrice !== null && bPrice === null) return -1;
  if (aPrice === null && bPrice !== null) return 1;
  const aDate = a.releasedAt?.getTime() ?? 0;
  const bDate = b.releasedAt?.getTime() ?? 0;
  if (aDate !== bDate) return bDate - aDate;
  return `${a.setCode}:${a.collectorNumber}`.localeCompare(
    `${b.setCode}:${b.collectorNumber}`,
  );
}

export async function getOwnershipByCard(
  ownerPlayerId?: string | null,
  cardIds?: string[],
) {
  if (!ownerPlayerId)
    return new Map<string, { quantity: number; locations: string[] }>();
  const items = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: ownerPlayerId,
      quantity: { gt: 0 },
      ...(cardIds?.length ? { cardId: { in: cardIds } } : {}),
    },
    include: { location: true },
  });
  const map = new Map<string, { quantity: number; locations: string[] }>();
  for (const item of items) {
    const current = map.get(item.cardId) ?? { quantity: 0, locations: [] };
    current.quantity += item.quantity;
    if (item.location?.name && !current.locations.includes(item.location.name))
      current.locations.push(item.location.name);
    map.set(item.cardId, current);
  }
  return map;
}

async function ownedOracleTotals(
  ownerPlayerId: string | null | undefined,
  oracleIds: string[],
) {
  if (!ownerPlayerId || oracleIds.length === 0)
    return new Map<string, number>();
  const items = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: ownerPlayerId,
      quantity: { gt: 0 },
      card: { oracleId: { in: oracleIds } },
    },
    include: { card: { select: { oracleId: true } } },
  });
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!item.card.oracleId) continue;
    totals.set(
      item.card.oracleId,
      (totals.get(item.card.oracleId) ?? 0) + item.quantity,
    );
  }
  return totals;
}

function cardToResult(
  card: Card,
  ownership: Map<string, { quantity: number; locations: string[] }>,
  oracleTotals: Map<string, number>,
  source: DeckCardSearchResult["source"],
): DeckCardSearchResult {
  const exact = ownership.get(card.id);
  const ownedExactQuantity = exact?.quantity ?? 0;
  const ownedOtherPrintingQuantity = Math.max(
    0,
    (card.oracleId ? (oracleTotals.get(card.oracleId) ?? 0) : 0) -
      ownedExactQuantity,
  );
  const price = cardPriceUsd(card);
  const finishes = asStringArray(card.finishes);
  const badges =
    ownedExactQuantity > 0
      ? [
          `Owned: ${ownedExactQuantity} ${ownedExactQuantity === 1 ? "copy" : "copies"}`,
        ]
      : ["Not owned"];
  if (exact?.locations.length)
    badges.push(`Owned in ${exact.locations.slice(0, 3).join(", ")}`);
  if (price !== null) badges.push(`Cheapest candidate: $${price.toFixed(2)}`);
  if (finishes.includes("foil")) badges.push("Foil available");
  return {
    cardId: card.id,
    scryfallId: card.scryfallId,
    oracleId: card.oracleId,
    name: card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    setCode: card.setCode,
    setName: card.setName,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    imageUri: card.imageUri,
    priceUsd: price,
    priceLabel: price === null ? "—" : `$${price.toFixed(2)}`,
    ownedQuantity: ownedExactQuantity,
    ownedExactQuantity,
    ownedOtherPrintingQuantity,
    locationSummary: exact?.locations.slice(0, 3).join(", ") ?? "",
    finishes,
    source,
    badges,
  };
}

export function orderDeckSearchResults(results: DeckCardSearchResult[]) {
  return [...results].sort((a, b) => {
    if (a.ownedExactQuantity !== b.ownedExactQuantity)
      return b.ownedExactQuantity - a.ownedExactQuantity;
    const sourceRank = { owned: 0, local: 1, scryfall: 2 } as const;
    if (sourceRank[a.source] !== sourceRank[b.source])
      return sourceRank[a.source] - sourceRank[b.source];
    if (a.priceUsd !== null && b.priceUsd !== null && a.priceUsd !== b.priceUsd)
      return a.priceUsd - b.priceUsd;
    if (a.priceUsd !== null && b.priceUsd === null) return -1;
    if (a.priceUsd === null && b.priceUsd !== null) return 1;
    return `${a.name}:${a.setCode}:${a.collectorNumber}`.localeCompare(
      `${b.name}:${b.setCode}:${b.collectorNumber}`,
    );
  });
}

export async function searchDeckCardPrintings(input: {
  query: string;
  ownerPlayerId?: string | null;
  includeScryfall?: boolean;
  limit?: number;
}): Promise<DeckCardSearchResponse> {
  const query = input.query.trim();
  const limit = input.limit ?? 30;
  if (query.length < 2)
    return {
      query,
      message: "Enter at least 2 characters.",
      results: [],
      counts: { owned: 0, local: 0, scryfall: 0 },
    };

  const normalizedSet = query.toLowerCase();
  const localWhere: Prisma.CardWhereInput = {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { setCode: { equals: normalizedSet, mode: "insensitive" } },
      { collectorNumber: query },
      { typeLine: { contains: query, mode: "insensitive" } },
    ],
  };
  const local = await prisma.card.findMany({
    where: localWhere,
    orderBy: [{ name: "asc" }, { releasedAt: "desc" }],
    take: limit,
  });

  let scryfallCards: Card[] = [];
  let message = local.length
    ? "Showing cached printings; broadened with Scryfall when useful."
    : "No cached printings found; searched Scryfall.";
  const shouldSearchScryfall = input.includeScryfall || local.length < 8;
  if (shouldSearchScryfall) {
    const result = await searchCardsResult(query);
    if (result.ok) {
      const existingIds = new Set(local.map((card) => card.scryfallId));
      const imported = await Promise.all(
        result.data.data
          .slice(0, limit)
          .filter((card) => !existingIds.has(card.id))
          .map((card) => upsertScryfallCard(card)),
      );
      scryfallCards = imported;
      message = `${local.length} cached and ${imported.length} Scryfall printings found.`;
    } else {
      message = `${local.length} cached printings found. Scryfall fallback failed: ${formatScryfallError(result.error)}`;
    }
  }

  const allCards = [...local, ...scryfallCards];
  const ownership = await getOwnershipByCard(
    input.ownerPlayerId,
    allCards.map((card) => card.id),
  );
  const oracleTotals = await ownedOracleTotals(input.ownerPlayerId, [
    ...new Set(
      allCards
        .map((card) => card.oracleId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]);
  const localIds = new Set(local.map((card) => card.id));
  const results = orderDeckSearchResults(
    allCards.map((card) =>
      cardToResult(
        card,
        ownership,
        oracleTotals,
        ownership.get(card.id)?.quantity
          ? "owned"
          : localIds.has(card.id)
            ? "local"
            : "scryfall",
      ),
    ),
  ).slice(0, limit);
  return {
    query,
    message,
    results,
    counts: {
      owned: results.filter((r) => r.ownedExactQuantity > 0).length,
      local: local.length,
      scryfall: scryfallCards.length,
    },
  };
}
