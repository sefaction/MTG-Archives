import {
  DeckCard,
  InventoryLocationKind,
  Prisma,
  PrismaClient,
  Visibility,
} from "@prisma/client";
import { normalizeLocationName } from "./inventory-locations";

export type DeckLocationDeck = {
  id: string;
  name: string;
  visibility: Visibility;
  ownerUser: { playerId: string | null };
};

export type DeckCommitmentInventoryItem = {
  id?: string;
  cardId: string;
  quantity: number;
  locationId?: string | null;
  card: { id: string; oracleId?: string | null; name: string };
  location?: {
    id: string;
    name: string;
    kind?: InventoryLocationKind | string;
    deckId?: string | null;
  } | null;
};

export type DeckCardCommitmentInput = {
  cardId?: string | null;
  oracleId?: string | null;
  cardName: string;
  quantity: number;
};

export function deckLocationName(deckName: string) {
  return `Deck: ${deckName.trim().replace(/\s+/g, " ")}`;
}

function normalizedDeckLocationCandidates(deck: { id: string; name: string }) {
  const preferred = deckLocationName(deck.name);
  return [preferred, `${preferred} (${deck.id.slice(0, 8)})`];
}

export async function ensureDeckLocation(
  prisma: PrismaClient | Prisma.TransactionClient,
  deck: DeckLocationDeck,
) {
  const ownerPlayerId = deck.ownerUser.playerId;
  if (!ownerPlayerId) {
    throw new Error("Deck owner is not linked to an inventory owner.");
  }
  const existing = await prisma.inventoryLocation.findUnique({
    where: { deckId: deck.id },
  });
  const names = normalizedDeckLocationCandidates(deck);
  let name = names[0];
  let normalizedName = normalizeLocationName(name);
  const conflicting = await prisma.inventoryLocation.findFirst({
    where: {
      ownerPlayerId,
      normalizedName,
      ...(existing ? { id: { not: existing.id } } : {}),
    },
  });
  if (conflicting) {
    name = names[1];
    normalizedName = normalizeLocationName(name);
  }
  const data = {
    ownerPlayerId,
    name,
    normalizedName,
    description: `System-managed deck location for ${deck.name}.`,
    type: "Deck",
    kind: InventoryLocationKind.DECK,
    deckId: deck.id,
    systemManaged: true,
    active: true,
    visibility: deck.visibility,
  };
  if (existing) {
    return prisma.inventoryLocation.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.inventoryLocation.create({ data });
}

export function isDeckLocation(
  location?: {
    kind?: InventoryLocationKind | string;
    deckId?: string | null;
  } | null,
) {
  return (
    location?.kind === InventoryLocationKind.DECK || Boolean(location?.deckId)
  );
}

export function matchesDeckCardPrinting(
  deckCard: DeckCardCommitmentInput,
  item: DeckCommitmentInventoryItem,
) {
  if (deckCard.cardId && item.card.id === deckCard.cardId) return "exact";
  if (deckCard.oracleId && item.card.oracleId === deckCard.oracleId)
    return "other";
  if (
    !deckCard.oracleId &&
    item.card.name.trim().replace(/\s+/g, " ").toLowerCase() ===
      deckCard.cardName.trim().replace(/\s+/g, " ").toLowerCase()
  ) {
    return "other";
  }
  return null;
}

export function summarizeDeckCommitmentOwnership(
  deckCard: DeckCardCommitmentInput,
  inventoryItems: DeckCommitmentInventoryItem[],
  deckId?: string | null,
) {
  const totals = {
    exactOwned: 0,
    otherOwned: 0,
    availableExact: 0,
    availableOther: 0,
    committedThisExact: 0,
    committedThisOther: 0,
    committedOtherDecksExact: 0,
    committedOtherDecksOther: 0,
    locationParts: new Map<string, number>(),
  };
  for (const item of inventoryItems) {
    const match = matchesDeckCardPrinting(deckCard, item);
    if (!match) continue;
    const exact = match === "exact";
    if (exact) totals.exactOwned += item.quantity;
    else totals.otherOwned += item.quantity;

    const deckLoc = isDeckLocation(item.location);
    const committedHere = deckLoc && item.location?.deckId === deckId;
    const committedElsewhere = deckLoc && item.location?.deckId !== deckId;
    if (!deckLoc) {
      if (exact) totals.availableExact += item.quantity;
      else totals.availableOther += item.quantity;
    } else if (committedHere) {
      if (exact) totals.committedThisExact += item.quantity;
      else totals.committedThisOther += item.quantity;
    } else if (committedElsewhere) {
      if (exact) totals.committedOtherDecksExact += item.quantity;
      else totals.committedOtherDecksOther += item.quantity;
    }
    const name = item.location?.name ?? "Unassigned";
    totals.locationParts.set(
      name,
      (totals.locationParts.get(name) ?? 0) + item.quantity,
    );
  }
  const owned = totals.exactOwned + totals.otherOwned;
  const available = totals.availableExact + totals.availableOther;
  const committedToThisDeck =
    totals.committedThisExact + totals.committedThisOther;
  const committedToOtherDecks =
    totals.committedOtherDecksExact + totals.committedOtherDecksOther;
  const missing = Math.max(0, deckCard.quantity - owned);
  const commitmentMissing = Math.max(
    0,
    deckCard.quantity - committedToThisDeck,
  );
  const locationSummary = [...totals.locationParts.entries()]
    .slice(0, 3)
    .map(([name, quantity]) => `${name}: ${quantity}`)
    .join(" · ");
  return {
    owned,
    exactOwned: totals.exactOwned,
    otherOwned: totals.otherOwned,
    available,
    availableExact: totals.availableExact,
    availableOther: totals.availableOther,
    committedToThisDeck,
    committedThisExact: totals.committedThisExact,
    committedThisOther: totals.committedThisOther,
    committedToOtherDecks,
    committedOtherDecksExact: totals.committedOtherDecksExact,
    committedOtherDecksOther: totals.committedOtherDecksOther,
    needed: deckCard.quantity,
    missing,
    commitmentMissing,
    enoughOwned: owned >= deckCard.quantity,
    enoughAvailableOrCommittedHere:
      available + committedToThisDeck >= deckCard.quantity,
    locationSummary,
  };
}

export function auditDeckMoveSnapshot(
  item: {
    id: string;
    currentOwnerId: string;
    originalOpenerId: string;
    cardId: string;
    foil: boolean;
    foilStatus: string;
    condition: string;
    language: string;
    locationId: string | null;
    quantity: number;
    sourceType: string;
    notes: string | null;
  },
  extra: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    inventoryItemId: item.id,
    currentOwnerId: item.currentOwnerId,
    originalOpenerId: item.originalOpenerId,
    cardId: item.cardId,
    foil: item.foil,
    foilStatus: item.foilStatus,
    condition: item.condition,
    language: item.language,
    locationId: item.locationId,
    quantity: item.quantity,
    sourceType: item.sourceType,
    notes: item.notes,
    ...extra,
  };
}
