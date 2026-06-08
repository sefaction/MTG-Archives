import {
  DeckFormat,
  DeckSection,
  DefaultCollectionVisibility,
  Prisma,
  Visibility,
} from "@prisma/client";
import { resolveDeckVisibility } from "./visibility";

export const deckFormatLabels: Record<DeckFormat, string> = {
  COMMANDER: "Commander",
  STANDARD: "Standard",
  MODERN: "Modern",
  PIONEER: "Pioneer",
  LEGACY: "Legacy",
  VINTAGE: "Vintage",
  PAUPER: "Pauper",
  CASUAL: "Casual",
  OTHER: "Other",
};

export const deckSectionLabels: Record<DeckSection, string> = {
  MAINBOARD: "Mainboard",
  SIDEBOARD: "Sideboard",
  COMMANDER: "Commander",
  MAYBEBOARD: "Maybeboard",
};

export const deckSections: DeckSection[] = [
  DeckSection.COMMANDER,
  DeckSection.MAINBOARD,
  DeckSection.SIDEBOARD,
  DeckSection.MAYBEBOARD,
];

export function deckFormatLabel(format: DeckFormat | string) {
  return deckFormatLabels[format as DeckFormat] ?? format;
}

export function deckSectionLabel(section: DeckSection | string) {
  return deckSectionLabels[section as DeckSection] ?? section;
}

export function normalizePositiveQuantity(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 999);
}

export function canManageDeck(
  user: { id: string } | null | undefined,
  deck: { ownerUserId: string } | null | undefined,
  adminModeEnabled = false,
) {
  if (!user || !deck) return false;
  return adminModeEnabled || deck.ownerUserId === user.id;
}

export function canViewDeck(
  user: { id: string } | null | undefined,
  deck:
    | {
        ownerUserId: string;
        visibility: Visibility;
        ownerUser: {
          deckDefaultVisibility: DefaultCollectionVisibility;
          publicProfileEnabled: boolean;
          isActive: boolean;
        };
      }
    | null
    | undefined,
  adminModeEnabled = false,
) {
  if (!deck) return false;
  if (adminModeEnabled || user?.id === deck.ownerUserId) return true;
  if (!deck.ownerUser.isActive || !deck.ownerUser.publicProfileEnabled) {
    return false;
  }
  return (
    resolveDeckVisibility(
      deck.ownerUser.deckDefaultVisibility,
      deck.visibility,
    ) === DefaultCollectionVisibility.PUBLIC
  );
}

export function publicDeckWhere(): Prisma.DeckWhereInput {
  return {
    ownerUser: { isActive: true, publicProfileEnabled: true },
    OR: [
      { visibility: Visibility.PUBLIC },
      {
        visibility: Visibility.INHERIT,
        ownerUser: {
          deckDefaultVisibility: DefaultCollectionVisibility.PUBLIC,
        },
      },
    ],
  };
}

export function deckCardCount(
  cards: Array<{ quantity: number; section: DeckSection | string }>,
) {
  return cards
    .filter((card) => card.section !== DeckSection.MAYBEBOARD)
    .reduce((total, card) => total + card.quantity, 0);
}

export type DeckOwnershipInput = {
  cardId?: string | null;
  oracleId?: string | null;
  cardName: string;
  quantity: number;
};

export type InventoryOwnershipInput = {
  quantity: number;
  location?: { name: string } | null;
  card: { id: string; oracleId?: string | null; name: string };
};

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function summarizeDeckCardOwnership(
  deckCard: DeckOwnershipInput,
  inventoryItems: InventoryOwnershipInput[],
) {
  const exactItems = deckCard.cardId
    ? inventoryItems.filter((item) => item.card.id === deckCard.cardId)
    : [];
  const fallbackItems = inventoryItems.filter((item) => {
    if (deckCard.oracleId && item.card.oracleId === deckCard.oracleId)
      return true;
    return normalizeName(item.card.name) === normalizeName(deckCard.cardName);
  });
  const fallbackOnlyItems = fallbackItems.filter(
    (item) => !deckCard.cardId || item.card.id !== deckCard.cardId,
  );
  const exactOwned = exactItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const otherOwned = fallbackOnlyItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const owned = exactOwned + otherOwned;
  const locations = [
    ...new Set(
      [...exactItems, ...fallbackOnlyItems]
        .map((item) => item.location?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  return {
    owned,
    exactOwned,
    otherOwned,
    needed: deckCard.quantity,
    missing: Math.max(0, deckCard.quantity - owned),
    exactMissing: Math.max(0, deckCard.quantity - exactOwned),
    enoughOwned: owned >= deckCard.quantity,
    matchType: deckCard.cardId
      ? "Exact printing + other printings"
      : "Oracle/name fallback",
    locationSummary: locations.slice(0, 3).join(", "),
  };
}

export function deckRowCount(cards: Array<{ section: DeckSection | string }>) {
  return cards.filter((card) => card.section !== DeckSection.MAYBEBOARD).length;
}

export function deckTotalQuantity(
  cards: Array<{ quantity: number; section: DeckSection | string }>,
) {
  return cards
    .filter((card) => card.section !== DeckSection.MAYBEBOARD)
    .reduce((total, card) => total + card.quantity, 0);
}

export function deckSectionQuantityTotals(
  cards: Array<{ quantity: number; section: DeckSection | string }>,
) {
  return deckSections.reduce(
    (totals, section) => ({
      ...totals,
      [section]: cards
        .filter((card) => card.section === section)
        .reduce((total, card) => total + card.quantity, 0),
    }),
    {} as Record<DeckSection, number>,
  );
}

export function summarizeDeckOwnershipTotals(
  deckCards: DeckOwnershipInput[],
  inventoryItems: InventoryOwnershipInput[],
) {
  return deckCards.reduce(
    (totals, deckCard) => {
      const owned = summarizeDeckCardOwnership(deckCard, inventoryItems);
      return {
        totalQuantity: totals.totalQuantity + deckCard.quantity,
        exactOwned:
          totals.exactOwned + Math.min(deckCard.quantity, owned.exactOwned),
        otherOwned:
          totals.otherOwned +
          Math.min(
            Math.max(
              0,
              deckCard.quantity - Math.min(deckCard.quantity, owned.exactOwned),
            ),
            owned.otherOwned,
          ),
        missing: totals.missing + owned.missing,
      };
    },
    { totalQuantity: 0, exactOwned: 0, otherOwned: 0, missing: 0 },
  );
}
