import { Card, DeckSection } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizeCardName, upsertScryfallCard } from "./card-import";
import { formatScryfallError, searchCardsResult } from "./scryfall";
import { cardPriceUsd, compareCheapestPlayableCards } from "./deck-search";

export type DeckOptimizationMode = "owned" | "cheapest";

export type DeckOptimizationStatus =
  | "ALREADY_OWNED_EXACT"
  | "SWITCH_TO_OWNED"
  | "OWNED_ONLY_OTHER_PRINTING"
  | "NO_OWNED_PRINTING_FOUND"
  | "ALREADY_CHEAPEST"
  | "SWITCH_TO_CHEAPEST"
  | "NO_CHEAPER_PRINTING_FOUND"
  | "NO_SUITABLE_PRINTING_FOUND"
  | "SCRYFALL_CACHE_ERROR"
  | "NEEDS_REVIEW"
  | "ERROR";

export type CardPrintingSummary = {
  cardId: string;
  name: string;
  setCode: string;
  setName: string | null;
  collectorNumber: string;
  rarity: string;
  priceUsd: number | null;
};

export type DeckOptimizationPreviewRow = {
  deckCardId: string;
  section: DeckSection;
  quantity: number;
  notes: string | null;
  current: CardPrintingSummary | null;
  currentOwnedQuantity: number;
  proposed: CardPrintingSummary | null;
  proposedOwnedQuantity: number;
  status: DeckOptimizationStatus;
  statusLabel: string;
  willChange: boolean;
  warnings: string[];
};

export type DeckOptimizationPreview = {
  mode: DeckOptimizationMode;
  rows: DeckOptimizationPreviewRow[];
  summary: {
    analyzedRows: number;
    changeRows: number;
    noChangeRows: number;
    errorRows: number;
  };
};

function summary(card: Card): CardPrintingSummary {
  return {
    cardId: card.id,
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    priceUsd: cardPriceUsd(card),
  };
}

function byOwnedPreference(quantityNeeded: number) {
  return (
    a: { card: Card; quantity: number },
    b: { card: Card; quantity: number },
  ) => {
    const aEnough = a.quantity >= quantityNeeded ? 1 : 0;
    const bEnough = b.quantity >= quantityNeeded ? 1 : 0;
    if (aEnough !== bEnough) return bEnough - aEnough;
    if (a.quantity !== b.quantity) return b.quantity - a.quantity;
    const price = compareCheapestPlayableCards(a.card, b.card);
    if (price !== 0) return price;
    return a.card.id.localeCompare(b.card.id);
  };
}

async function ownedCandidates(input: {
  ownerPlayerId: string;
  oracleId?: string | null;
  name: string;
}) {
  const normalized = normalizeCardName(input.name);
  const items = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: input.ownerPlayerId,
      quantity: { gt: 0 },
      card: input.oracleId
        ? { oracleId: input.oracleId }
        : { name: { equals: input.name, mode: "insensitive" } },
    },
    include: { card: true },
  });
  const grouped = new Map<string, { card: Card; quantity: number }>();
  for (const item of items) {
    if (!input.oracleId && normalizeCardName(item.card.name) !== normalized)
      continue;
    const current = grouped.get(item.cardId) ?? {
      card: item.card,
      quantity: 0,
    };
    current.quantity += item.quantity;
    grouped.set(item.cardId, current);
  }
  return [...grouped.values()];
}

async function cheapestCandidates(input: {
  oracleId?: string | null;
  name: string;
  cache: Map<string, Card[]>;
}) {
  const key = input.oracleId
    ? `oracle:${input.oracleId}`
    : `name:${normalizeCardName(input.name)}`;
  if (input.cache.has(key)) return input.cache.get(key) ?? [];
  const local = await prisma.card.findMany({
    where: input.oracleId
      ? { oracleId: input.oracleId }
      : { name: { equals: input.name, mode: "insensitive" } },
  });
  let candidates = input.oracleId
    ? local
    : local.filter(
        (card) =>
          normalizeCardName(card.name) === normalizeCardName(input.name),
      );
  if (candidates.length < 4) {
    const query = input.oracleId
      ? `oracleid:${input.oracleId} unique:prints`
      : `!"${input.name.replace(/"/g, '\\"')}" unique:prints`;
    const result = await searchCardsResult(query);
    if (result.ok) {
      const imported = await Promise.all(
        result.data.data.slice(0, 75).map((card) => upsertScryfallCard(card)),
      );
      const existing = new Set(candidates.map((card) => card.id));
      candidates = [
        ...candidates,
        ...imported.filter((card) => !existing.has(card.id)),
      ];
    } else if (candidates.length === 0) {
      throw new Error(formatScryfallError(result.error));
    }
  }
  candidates = candidates.sort(compareCheapestPlayableCards);
  input.cache.set(key, candidates);
  return candidates;
}

export async function buildDeckOptimizationPreview(input: {
  deckId: string;
  ownerPlayerId: string;
  mode: DeckOptimizationMode;
  rowIds?: string[];
}): Promise<DeckOptimizationPreview> {
  const cards = await prisma.deckCard.findMany({
    where: {
      deckId: input.deckId,
      ...(input.rowIds?.length ? { id: { in: input.rowIds } } : {}),
    },
    include: { card: true },
    orderBy: [{ section: "asc" }, { cardName: "asc" }],
  });
  const cheapestCache = new Map<string, Card[]>();
  const rows: DeckOptimizationPreviewRow[] = [];
  for (const deckCard of cards) {
    try {
      const currentCard = deckCard.card;
      const currentOwned = currentCard
        ? await ownedCandidates({
            ownerPlayerId: input.ownerPlayerId,
            oracleId: null,
            name: currentCard.name,
          })
        : [];
      const exactOwned =
        currentOwned.find((owned) => owned.card.id === deckCard.cardId)
          ?.quantity ?? 0;
      if (!currentCard) {
        rows.push({
          deckCardId: deckCard.id,
          section: deckCard.section,
          quantity: deckCard.quantity,
          notes: deckCard.notes,
          current: null,
          currentOwnedQuantity: 0,
          proposed: null,
          proposedOwnedQuantity: 0,
          status: "NEEDS_REVIEW",
          statusLabel: "Needs review",
          willChange: false,
          warnings: ["Deck row has no selected printing."],
        });
        continue;
      }

      if (input.mode === "owned") {
        const owned = (
          await ownedCandidates({
            ownerPlayerId: input.ownerPlayerId,
            oracleId: currentCard.oracleId,
            name: currentCard.name,
          })
        ).sort(byOwnedPreference(deckCard.quantity));
        if (exactOwned >= deckCard.quantity) {
          rows.push({
            deckCardId: deckCard.id,
            section: deckCard.section,
            quantity: deckCard.quantity,
            notes: deckCard.notes,
            current: summary(currentCard),
            currentOwnedQuantity: exactOwned,
            proposed: summary(currentCard),
            proposedOwnedQuantity: exactOwned,
            status: "ALREADY_OWNED_EXACT",
            statusLabel: "Already owned exact printing",
            willChange: false,
            warnings: [],
          });
          continue;
        }
        const proposed = owned.find(
          (candidate) => candidate.card.id !== currentCard.id,
        );
        if (!proposed) {
          rows.push({
            deckCardId: deckCard.id,
            section: deckCard.section,
            quantity: deckCard.quantity,
            notes: deckCard.notes,
            current: summary(currentCard),
            currentOwnedQuantity: exactOwned,
            proposed: null,
            proposedOwnedQuantity: 0,
            status: "NO_OWNED_PRINTING_FOUND",
            statusLabel: "No owned printing found",
            willChange: false,
            warnings: [],
          });
          continue;
        }
        rows.push({
          deckCardId: deckCard.id,
          section: deckCard.section,
          quantity: deckCard.quantity,
          notes: deckCard.notes,
          current: summary(currentCard),
          currentOwnedQuantity: exactOwned,
          proposed: summary(proposed.card),
          proposedOwnedQuantity: proposed.quantity,
          status:
            proposed.quantity >= deckCard.quantity
              ? "SWITCH_TO_OWNED"
              : "OWNED_ONLY_OTHER_PRINTING",
          statusLabel:
            proposed.quantity >= deckCard.quantity
              ? "Switch to owned printing"
              : "Owned only as other printing",
          willChange: true,
          warnings:
            proposed.quantity >= deckCard.quantity
              ? []
              : ["Owned printing does not cover full deck quantity."],
        });
      } else {
        const candidates = await cheapestCandidates({
          oracleId: currentCard.oracleId,
          name: currentCard.name,
          cache: cheapestCache,
        });
        const cheapest = candidates[0];
        if (!cheapest) {
          rows.push({
            deckCardId: deckCard.id,
            section: deckCard.section,
            quantity: deckCard.quantity,
            notes: deckCard.notes,
            current: summary(currentCard),
            currentOwnedQuantity: exactOwned,
            proposed: null,
            proposedOwnedQuantity: 0,
            status: "NO_SUITABLE_PRINTING_FOUND",
            statusLabel: "No suitable printing found",
            willChange: false,
            warnings: [],
          });
          continue;
        }
        const proposedOwned =
          (
            await ownedCandidates({
              ownerPlayerId: input.ownerPlayerId,
              oracleId: null,
              name: cheapest.name,
            })
          ).find((owned) => owned.card.id === cheapest.id)?.quantity ?? 0;
        const currentPrice = cardPriceUsd(currentCard);
        const cheapestPrice = cardPriceUsd(cheapest);
        const already = cheapest.id === currentCard.id;
        rows.push({
          deckCardId: deckCard.id,
          section: deckCard.section,
          quantity: deckCard.quantity,
          notes: deckCard.notes,
          current: summary(currentCard),
          currentOwnedQuantity: exactOwned,
          proposed: summary(cheapest),
          proposedOwnedQuantity: proposedOwned,
          status: already
            ? "ALREADY_CHEAPEST"
            : currentPrice !== null &&
                cheapestPrice !== null &&
                cheapestPrice >= currentPrice
              ? "NO_CHEAPER_PRINTING_FOUND"
              : "SWITCH_TO_CHEAPEST",
          statusLabel: already
            ? "Already cheapest printing"
            : currentPrice !== null &&
                cheapestPrice !== null &&
                cheapestPrice >= currentPrice
              ? "No cheaper printing found"
              : "Switch to cheapest printing",
          willChange:
            !already &&
            !(
              currentPrice !== null &&
              cheapestPrice !== null &&
              cheapestPrice >= currentPrice
            ),
          warnings:
            cheapestPrice === null
              ? ["Selected fallback has no USD price."]
              : [],
        });
      }
    } catch (error) {
      rows.push({
        deckCardId: deckCard.id,
        section: deckCard.section,
        quantity: deckCard.quantity,
        notes: deckCard.notes,
        current: deckCard.card ? summary(deckCard.card) : null,
        currentOwnedQuantity: 0,
        proposed: null,
        proposedOwnedQuantity: 0,
        status: input.mode === "cheapest" ? "SCRYFALL_CACHE_ERROR" : "ERROR",
        statusLabel:
          input.mode === "cheapest" ? "Scryfall/cache error" : "Error",
        willChange: false,
        warnings: [
          error instanceof Error
            ? error.message
            : "Unknown optimization error.",
        ],
      });
    }
  }
  return {
    mode: input.mode,
    rows,
    summary: {
      analyzedRows: rows.length,
      changeRows: rows.filter((row) => row.willChange).length,
      noChangeRows: rows.filter((row) => !row.willChange).length,
      errorRows: rows.filter(
        (row) =>
          row.status === "ERROR" || row.status === "SCRYFALL_CACHE_ERROR",
      ).length,
    },
  };
}

export function mergeDeckOptimizationRowsForTest(
  rows: Array<{
    id: string;
    cardId: string;
    section: DeckSection;
    quantity: number;
  }>,
  change: { id: string; proposedCardId: string },
) {
  const changed = rows.find((row) => row.id === change.id);
  if (!changed) return { rows: rows.map((row) => ({ ...row })), merged: 0 };
  const output = rows
    .filter((row) => row.id !== change.id)
    .map((row) => ({ ...row }));
  const existing = output.find(
    (candidate) =>
      candidate.cardId === change.proposedCardId &&
      candidate.section === changed.section,
  );
  if (existing) {
    existing.quantity += changed.quantity;
    return { rows: output, merged: 1 };
  }
  output.push({ ...changed, cardId: change.proposedCardId });
  return { rows: output, merged: 0 };
}
