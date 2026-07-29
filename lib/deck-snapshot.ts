import {
  DeckFormat,
  DeckSection,
  DefaultCollectionVisibility,
  Visibility,
} from "@prisma/client";
import type { CurrentUser } from "./auth";
import { canViewDeck } from "./decks";
import { prisma } from "./prisma";
import { resolveDeckVisibility } from "./visibility";

export type DeckSnapshotImageUris = {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
};

export type DeckSnapshotFace = {
  name: string;
  manaCost: string | null;
  typeLine: string;
  imageUris: DeckSnapshotImageUris;
};

export type DeckSnapshotCardPrinting = {
  id: string;
  scryfallId: string;
  name: string;
  manaCost: string | null;
  manaValue: number | null;
  typeLine: string;
  colors: string[];
  colorIdentity: string[];
  layout: string | null;
  imageUri: string | null;
  imageUris: DeckSnapshotImageUris;
  cardFaces: DeckSnapshotFace[];
  setCode: string;
  collectorNumber: string;
};

export type DeckSnapshotEntry = {
  id: string;
  cardId: string | null;
  cardName: string;
  section: DeckSection;
  quantity: number;
  isCommander: boolean;
  card: DeckSnapshotCardPrinting | null;
};

export type DeckSnapshot = {
  id: string;
  name: string;
  description: string | null;
  format: DeckFormat;
  visibility: Visibility;
  effectiveVisibility: DefaultCollectionVisibility;
  ownerDisplayName: string;
  cards: DeckSnapshotEntry[];
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function imageUris(value: unknown): DeckSnapshotImageUris {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    ["small", "normal", "large", "png", "art_crop", "border_crop"]
      .map((key) => [key, source[key]])
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
  );
}

function cardFaces(value: unknown): DeckSnapshotFace[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (face): face is Record<string, unknown> =>
        Boolean(face) && typeof face === "object" && !Array.isArray(face),
    )
    .map((face) => ({
      name: typeof face.name === "string" ? face.name : "",
      manaCost:
        typeof (face.manaCost ?? face.mana_cost) === "string"
          ? String(face.manaCost ?? face.mana_cost)
          : null,
      typeLine:
        typeof (face.typeLine ?? face.type_line) === "string"
          ? String(face.typeLine ?? face.type_line)
          : "",
      imageUris: imageUris(face.imageUris ?? face.image_uris),
    }));
}

export async function loadVisibleDeckSnapshot(
  deckId: string,
  user: CurrentUser | null,
  adminModeEnabled = false,
): Promise<DeckSnapshot | null> {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: {
      id: true,
      name: true,
      description: true,
      format: true,
      visibility: true,
      ownerUserId: true,
      ownerUser: {
        select: {
          displayName: true,
          deckDefaultVisibility: true,
          publicProfileEnabled: true,
          isActive: true,
        },
      },
      cards: {
        orderBy: [{ section: "asc" }, { cardName: "asc" }],
        select: {
          id: true,
          cardId: true,
          cardName: true,
          section: true,
          quantity: true,
          isCommander: true,
          card: {
            select: {
              id: true,
              scryfallId: true,
              name: true,
              manaCost: true,
              manaValue: true,
              typeLine: true,
              colors: true,
              colorIdentity: true,
              layout: true,
              imageUri: true,
              imageUris: true,
              cardFaces: true,
              setCode: true,
              collectorNumber: true,
            },
          },
        },
      },
    },
  });
  if (!deck || !canViewDeck(user, deck, adminModeEnabled)) return null;

  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    format: deck.format,
    visibility: deck.visibility,
    effectiveVisibility: resolveDeckVisibility(
      deck.ownerUser.deckDefaultVisibility,
      deck.visibility,
    ),
    ownerDisplayName: deck.ownerUser.displayName,
    cards: deck.cards.map((entry) => ({
      id: entry.id,
      cardId: entry.cardId,
      cardName: entry.cardName,
      section: entry.section,
      quantity: entry.quantity,
      isCommander: entry.isCommander,
      card: entry.card
        ? {
            ...entry.card,
            colors: stringArray(entry.card.colors),
            colorIdentity: stringArray(entry.card.colorIdentity),
            imageUris: imageUris(entry.card.imageUris),
            cardFaces: cardFaces(entry.card.cardFaces),
          }
        : null,
    })),
  };
}
