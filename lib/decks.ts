import {
  DeckFormat,
  DeckSection,
  DefaultCollectionVisibility,
  Prisma,
  Visibility,
} from "@prisma/client";
import { isBasicLandCard } from "./card-types";
import { summarizeDeckCommitmentOwnership } from "./deck-commitments";
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

export const DEFAULT_DECK_CARD_SECTION = DeckSection.MAINBOARD;

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

export function isDeckTotalSection(section: DeckSection | string) {
  return (
    section !== DeckSection.SIDEBOARD && section !== DeckSection.MAYBEBOARD
  );
}

export function deckCardCount(
  cards: Array<{ quantity: number; section: DeckSection | string }>,
) {
  return cards
    .filter((card) => isDeckTotalSection(card.section))
    .reduce((total, card) => total + card.quantity, 0);
}

export type DeckOwnershipInput = {
  cardId?: string | null;
  oracleId?: string | null;
  cardName: string;
  quantity: number;
  typeLine?: string | null;
  cardFaces?: unknown;
  card?: { typeLine?: string | null; cardFaces?: unknown } | null;
};

export type InventoryOwnershipInput = {
  id?: string;
  quantity: number;
  location?: {
    id?: string;
    name: string;
    kind?: string;
    deckId?: string | null;
  } | null;
  card: { id: string; oracleId?: string | null; name: string };
};

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function summarizeDeckCardOwnership(
  deckCard: DeckOwnershipInput,
  inventoryItems: InventoryOwnershipInput[],
  deckId?: string | null,
) {
  const summary = summarizeDeckCommitmentOwnership(
    deckCard,
    inventoryItems.map((item) => ({
      id: item.id,
      cardId: item.card.id,
      quantity: item.quantity,
      card: item.card,
      location: item.location
        ? {
            id: item.location.id ?? "",
            name: item.location.name,
            kind: item.location.kind,
            deckId: item.location.deckId,
          }
        : null,
    })),
    deckId,
  );
  const basicLand = isBasicLandCard({
    typeLine: deckCard.typeLine ?? deckCard.card?.typeLine,
    cardFaces: deckCard.cardFaces ?? deckCard.card?.cardFaces,
  });
  return {
    ...summary,
    missing: basicLand ? 0 : summary.missing,
    enoughOwned: basicLand ? true : summary.enoughOwned,
    isBasicLand: basicLand,
    wishlistMissing: basicLand ? 0 : summary.missing,
    exactMissing: basicLand
      ? 0
      : Math.max(0, deckCard.quantity - summary.exactOwned),
    matchType: deckCard.cardId
      ? "Exact printing + other printings"
      : "Oracle/name fallback",
  };
}

export function deckRowCount(cards: Array<{ section: DeckSection | string }>) {
  return cards.filter((card) => card.section !== DeckSection.MAYBEBOARD).length;
}

export function deckTotalQuantity(
  cards: Array<{ quantity: number; section: DeckSection | string }>,
) {
  return cards
    .filter((card) => isDeckTotalSection(card.section))
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

export type DeckCoverageInput = {
  quantity: number;
  exactOwned: number;
  otherOwned: number;
  committedToThisDeck: number;
  isBasicLand?: boolean;
};

export function summarizeEffectiveDeckCoverage(rows: DeckCoverageInput[]) {
  return rows.reduce(
    (totals, row) => {
      const quantity = Math.max(0, row.quantity);
      const exactOwned = Math.min(quantity, Math.max(0, row.exactOwned));
      const otherOwned = Math.min(
        quantity - exactOwned,
        Math.max(0, row.otherOwned),
      );
      const physicallyCommitted = Math.min(
        quantity,
        Math.max(0, row.committedToThisDeck),
      );
      const assumedBasicLandOwned = row.isBasicLand
        ? quantity - exactOwned - otherOwned
        : 0;
      const assumedBasicLandCommitted = row.isBasicLand
        ? quantity - physicallyCommitted
        : 0;

      return {
        totalQuantity: totals.totalQuantity + quantity,
        exactOwned: totals.exactOwned + exactOwned,
        otherOwned: totals.otherOwned + otherOwned,
        assumedBasicLandOwned:
          totals.assumedBasicLandOwned + assumedBasicLandOwned,
        missing:
          totals.missing +
          (row.isBasicLand ? 0 : quantity - exactOwned - otherOwned),
        physicallyCommitted: totals.physicallyCommitted + physicallyCommitted,
        assumedBasicLandCommitted:
          totals.assumedBasicLandCommitted + assumedBasicLandCommitted,
        effectiveCommitted:
          totals.effectiveCommitted +
          physicallyCommitted +
          assumedBasicLandCommitted,
      };
    },
    {
      totalQuantity: 0,
      exactOwned: 0,
      otherOwned: 0,
      assumedBasicLandOwned: 0,
      missing: 0,
      physicallyCommitted: 0,
      assumedBasicLandCommitted: 0,
      effectiveCommitted: 0,
    },
  );
}

export function pluralizeDeckCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function deckSectionSummaryParts(
  cards: Array<{ quantity: number; section: DeckSection | string }>,
) {
  const sectionTotals = deckSectionQuantityTotals(cards);
  return [
    `${deckTotalQuantity(cards)} total cards`,
    ...(sectionTotals.COMMANDER > 0
      ? [pluralizeDeckCount(sectionTotals.COMMANDER, "commander")]
      : []),
    `${sectionTotals.MAINBOARD} mainboard`,
    ...(sectionTotals.SIDEBOARD > 0
      ? [`${sectionTotals.SIDEBOARD} sideboard`]
      : []),
    ...(sectionTotals.MAYBEBOARD > 0
      ? [`${sectionTotals.MAYBEBOARD} maybeboard`]
      : []),
  ];
}
