"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { findOrImportCard } from "@/lib/card-import";
import { canManageDeck } from "@/lib/decks";
import {
  buildDeckOptimizationPreview,
  type DeckOptimizationMode,
} from "@/lib/deck-optimization";
import { prisma } from "@/lib/prisma";

function formString(fd: FormData, name: string) {
  return String(fd.get(name) || "").trim();
}

function positiveQuantity(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 999) : 1;
}

export async function addManualWishlistItem(fd: FormData) {
  const user = await requireLogin();
  const cardId = formString(fd, "cardId");
  const scryfallId = formString(fd, "scryfallId");
  const cardName = formString(fd, "cardName");
  let card = cardId
    ? await prisma.card.findUnique({ where: { id: cardId } })
    : null;
  if (!card && scryfallId) {
    const match = await findOrImportCard({
      scryfallId,
      name: cardName || scryfallId,
    });
    card = match.card;
  }
  if (!card)
    throw new Error(
      "Select a specific card printing before adding it to your wishlist.",
    );
  const quantity = positiveQuantity(fd.get("quantity"));
  const priority = formString(fd, "priority") || null;
  const notes = formString(fd, "notes") || null;
  const desiredFinish = formString(fd, "desiredFinish") || null;
  const desiredCondition = formString(fd, "desiredCondition") || null;
  const desiredLanguage = formString(fd, "desiredLanguage") || null;
  await prisma.wishlistItem.upsert({
    where: { ownerUserId_cardId: { ownerUserId: user.id, cardId: card.id } },
    create: {
      ownerUserId: user.id,
      cardId: card.id,
      quantity,
      priority,
      notes,
      desiredFinish,
      desiredCondition,
      desiredLanguage,
    },
    update: {
      quantity: { increment: quantity },
      priority,
      notes,
      desiredFinish,
      desiredCondition,
      desiredLanguage,
    },
  });
  console.info("wishlist_item_added", {
    ownerUserId: user.id,
    cardId: card.id,
    quantity,
  });
  revalidatePath("/wishlist");
  redirect("/wishlist");
}

export async function updateManualWishlistItem(fd: FormData) {
  const user = await requireLogin();
  const id = formString(fd, "wishlistItemId");
  const quantity = positiveQuantity(fd.get("quantity"));
  await prisma.wishlistItem.updateMany({
    where: { id, ownerUserId: user.id },
    data: {
      quantity,
      priority: formString(fd, "priority") || null,
      notes: formString(fd, "notes") || null,
      desiredFinish: formString(fd, "desiredFinish") || null,
      desiredCondition: formString(fd, "desiredCondition") || null,
      desiredLanguage: formString(fd, "desiredLanguage") || null,
    },
  });
  console.info("wishlist_item_updated", {
    ownerUserId: user.id,
    wishlistItemId: id,
    quantity,
  });
  revalidatePath("/wishlist");
}

export async function removeManualWishlistItem(fd: FormData) {
  const user = await requireLogin();
  const id = formString(fd, "wishlistItemId");
  await prisma.wishlistItem.deleteMany({ where: { id, ownerUserId: user.id } });
  console.info("wishlist_item_removed", {
    ownerUserId: user.id,
    wishlistItemId: id,
  });
  revalidatePath("/wishlist");
}

async function switchDeckCardFromWishlist(
  fd: FormData,
  mode: DeckOptimizationMode,
) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck || !canManageDeck(user, deck, scope?.mode === "admin")) {
    throw new Error("You can only edit your own decks.");
  }
  if (!user.playerId)
    throw new Error("Your account is not linked to an inventory owner.");
  const preview = await buildDeckOptimizationPreview({
    deckId,
    ownerPlayerId: user.playerId,
    mode,
    rowIds: [deckCardId],
  });
  const change = preview.rows.find(
    (row) =>
      row.deckCardId === deckCardId && row.willChange && row.proposed?.cardId,
  );
  if (!change?.proposed?.cardId)
    throw new Error(
      "No eligible printing change was found for this deck card.",
    );

  await prisma.$transaction(async (tx) => {
    const deckCard = await tx.deckCard.findFirst({
      where: { id: deckCardId, deckId },
    });
    if (!deckCard) throw new Error("Deck card not found.");
    const proposed = await tx.card.findUnique({
      where: { id: change.proposed!.cardId },
    });
    if (!proposed) throw new Error("Selected printing was not found.");
    const duplicate = await tx.deckCard.findFirst({
      where: {
        deckId,
        cardId: proposed.id,
        section: deckCard.section,
        id: { not: deckCard.id },
      },
    });
    if (duplicate) {
      await tx.deckCard.update({
        where: { id: duplicate.id },
        data: {
          quantity: duplicate.quantity + deckCard.quantity,
          notes: duplicate.notes || deckCard.notes,
          isCommander: duplicate.isCommander || deckCard.isCommander,
        },
      });
      await tx.deckCard.delete({ where: { id: deckCard.id } });
    } else {
      await tx.deckCard.update({
        where: { id: deckCard.id },
        data: {
          cardId: proposed.id,
          scryfallId: proposed.scryfallId,
          oracleId: proposed.oracleId,
          cardName: proposed.name,
        },
      });
    }
  });
  console.info("wishlist_deck_card_printing_switched", {
    deckId,
    deckCardId,
    mode,
    changedByUserId: user.id,
  });
  revalidatePath("/wishlist");
  revalidatePath(`/decks/${deckId}`);
}

export async function switchWishlistDeckCardToOwnedPrinting(fd: FormData) {
  await switchDeckCardFromWishlist(fd, "owned");
}

export async function switchWishlistDeckCardToCheapestPrinting(fd: FormData) {
  await switchDeckCardFromWishlist(fd, "cheapest");
}
