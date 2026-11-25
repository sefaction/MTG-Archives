import type { PrismaClient } from "@prisma/client";
import { isBasicLandCard } from "./card-types";
import { matchesDeckCardPrinting } from "./deck-commitments";

export const publicWishlistCategories = [
  { value: "manual", label: "Manual wishes" },
  { value: "decks", label: "Deck needs" },
  { value: "members", label: "From members" },
  { value: "sets", label: "Set Completion" },
] as const;
export type PublicWishlistCategory = typeof publicWishlistCategories[number]["value"];

export function normalizePublicWishlistCategories(values: readonly unknown[]) {
  return publicWishlistCategories.filter(category => values.includes(category.value)).map(category => category.value);
}

export type PublicWish = {
  name: string;
  quantity: number;
  printing: string;
  finish: string;
  category: PublicWishlistCategory;
};

function printing(card: { setCode: string; collectorNumber: string | null }) {
  return `${card.setCode.toUpperCase()}${card.collectorNumber ? ` #${card.collectorNumber}` : ""}`;
}

function finish(value: string | null) {
  switch (value?.toUpperCase()) {
    case "NONFOIL": return "Nonfoil";
    case "FOIL": return "Foil";
    case "ETCHED": return "Etched";
    default: return "Any finish";
  }
}

const cardSelect = { id: true, name: true, setCode: true, collectorNumber: true } as const;

// Catalog references stay server-side until mapped to the public card browser.
// These are public Card IDs, never Wishlist/deck/trade/inventory source IDs.
export type PublicWishReference = PublicWish & {
  cardId?: string;
  setCode: string;
  collectorNumber: string | null;
  preferredFinish: string | null;
};
function reference(wish: PublicWish, card: { id?: string; setCode: string; collectorNumber: string | null }, preferredFinish: string | null): PublicWishReference {
  return { ...wish, cardId: card.id, setCode: card.setCode, collectorNumber: card.collectorNumber, preferredFinish };
}

// Public queries select only the fields needed to compute wishes. Never serialize
// private Wishlist views, deck names, member identities, notes or storage details.
export async function getPublicWishlistReferences(db: PrismaClient, username: string) {
  return db.$transaction(async tx => {
    const owner = await tx.user.findUnique({
      where: { username, isActive: true },
      select: { id: true, username: true, playerId: true, publicWishlistCategories: true, publicInventoryHidePricing: true },
    });
    if (!owner) return null;
    const categories = normalizePublicWishlistCategories(owner.publicWishlistCategories);
    const wishes: PublicWishReference[] = [];
    if (categories.includes("manual")) {
      const rows = await tx.wishlistItem.findMany({
        where: { ownerUserId: owner.id, quantity: { gt: 0 } },
        select: { quantity: true, desiredFinish: true, card: { select: cardSelect } },
      });
      for (const row of rows) wishes.push(reference({ name: row.card.name, quantity: row.quantity,
        printing: printing(row.card), finish: finish(row.desiredFinish), category: "manual" }, row.card, row.desiredFinish));
    }
    if (categories.includes("decks")) {
      const decks = await tx.deck.findMany({
        where: { ownerUserId: owner.id, commanderLeagueDeck: null },
        select: { id: true, cards: { select: {
          cardId: true, oracleId: true, cardName: true, quantity: true,
          card: { select: { ...cardSelect, typeLine: true } },
        } } },
      });
      const inventory = owner.playerId ? await tx.inventoryItem.findMany({
        where: { currentOwnerId: owner.playerId, quantity: { gt: 0 }, location: { deckId: { in: decks.map(deck => deck.id) } } },
        select: { quantity: true, card: { select: { id: true, name: true, oracleId: true } },
          location: { select: { deckId: true } } },
      }) : [];
      for (const deck of decks) for (const row of deck.cards) {
        if (!row.card || isBasicLandCard(row.card)) continue;
        // Match the private Deck needs rule: subtract copies committed to this
        // ordinary deck, without substituting another deck or League inventory.
        const committed = inventory.reduce((total, item) =>
          item.location?.deckId === deck.id && matchesDeckCardPrinting(row, { cardId: item.card.id, quantity: item.quantity, card: item.card })
            ? total + item.quantity : total, 0);
        const quantity = Math.max(0, row.quantity - committed);
        if (quantity) wishes.push(reference({ name: row.card.name, quantity,
          printing: `${printing(row.card)} preferred`, finish: "Any finish", category: "decks" }, row.card, null));
      }
    }
    if (categories.includes("members")) {
      const rows = await tx.tradeWishlistItem.findMany({
        where: { ownerUserId: owner.id, status: "OPEN", quantity: { gt: 0 } },
        select: { quantity: true, card: { select: cardSelect } },
      });
      for (const row of rows) wishes.push(reference({ name: row.card.name, quantity: row.quantity,
        printing: printing(row.card), finish: "Any finish", category: "members" }, row.card, null));
    }
    if (categories.includes("sets")) {
      const rows = await tx.collectorWishlistItem.findMany({
        where: { ownerUserId: owner.id },
        select: { cardName: true, setCode: true, collectorNumber: true, preferredFinish: true,
          allowOtherSets: true, allowOtherFinishes: true },
      });
      for (const row of rows) wishes.push(reference({ name: row.cardName, quantity: 1,
        printing: `${printing(row)} preferred${row.allowOtherSets ? "; other sets accepted" : ""}`,
        finish: `${finish(row.preferredFinish)} preferred${row.allowOtherFinishes ? "; other finishes accepted" : ""}`,
        category: "sets" }, row, row.preferredFinish));
    }
    // Combine identical public preferences within a category. Private source IDs
    // and the number/names of decks or trade partners never enter the response.
    const grouped = new Map<string, PublicWishReference>();
    for (const wish of wishes) {
      const key = JSON.stringify([wish.category, wish.name, wish.printing, wish.finish]);
      const prior = grouped.get(key);
      if (prior) prior.quantity += wish.quantity;
      else grouped.set(key, { ...wish });
    }
    return { username: owner.username, categories, hidePricing: owner.publicInventoryHidePricing === true,
      wishes: [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name) || a.printing.localeCompare(b.printing)) };
  });
}

// Keep the original five-field projection stable for other consumers.
export async function getPublicWishlist(db: PrismaClient, username: string) {
  const view = await getPublicWishlistReferences(db, username);
  if (!view) return null;
  return { username: view.username, categories: view.categories,
    wishes: view.wishes.map(({ name, quantity, printing, finish, category }) => ({ name, quantity, printing, finish, category })) };
}
