"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DeckFormat, DeckSection, Visibility } from "@prisma/client";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { findOrImportCard } from "@/lib/card-import";
import { prisma } from "@/lib/prisma";
import { canManageDeck, normalizePositiveQuantity } from "@/lib/decks";

function formString(fd: FormData, name: string) {
  return String(fd.get(name) || "").trim();
}

function enumValue<T extends Record<string, string>>(
  enumObject: T,
  value: string,
  fallback: T[keyof T],
): T[keyof T] {
  return Object.values(enumObject).includes(value)
    ? (value as T[keyof T])
    : fallback;
}

async function requireManagedDeck(deckId: string) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck) throw new Error("Deck not found.");
  if (!canManageDeck(user, deck, scope?.mode === "admin")) {
    throw new Error("You can only edit your own decks.");
  }
  return { user, deck, adminMode: scope?.mode === "admin" };
}

export async function createDeck(fd: FormData) {
  const user = await requireLogin();
  const name = formString(fd, "name");
  if (!name) throw new Error("Deck name is required.");
  const deck = await prisma.deck.create({
    data: {
      ownerUserId: user.id,
      name,
      description: formString(fd, "description") || null,
      format: enumValue(
        DeckFormat,
        formString(fd, "format"),
        DeckFormat.CASUAL,
      ),
      visibility: enumValue(
        Visibility,
        formString(fd, "visibility"),
        Visibility.INHERIT,
      ),
    },
  });
  revalidatePath("/decks");
  redirect(`/decks/${deck.id}`);
}

export async function updateDeck(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const { adminMode, user, deck } = await requireManagedDeck(deckId);
  const name = formString(fd, "name");
  if (!name) throw new Error("Deck name is required.");
  if (adminMode && deck.ownerUserId !== user.id) {
    console.info("admin_update_deck", { deckId, changedByUserId: user.id });
  }
  await prisma.deck.update({
    where: { id: deckId },
    data: {
      name,
      description: formString(fd, "description") || null,
      format: enumValue(
        DeckFormat,
        formString(fd, "format"),
        DeckFormat.CASUAL,
      ),
      visibility: enumValue(
        Visibility,
        formString(fd, "visibility"),
        Visibility.INHERIT,
      ),
    },
  });
  revalidatePath("/decks");
  revalidatePath(`/decks/${deckId}`);
}

export async function deleteDeck(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const { adminMode, user, deck } = await requireManagedDeck(deckId);
  if (adminMode && deck.ownerUserId !== user.id) {
    console.info("admin_delete_deck", { deckId, changedByUserId: user.id });
  }
  await prisma.deck.delete({ where: { id: deckId } });
  revalidatePath("/decks");
  redirect("/decks");
}

export async function addDeckCard(fd: FormData) {
  const deckId = formString(fd, "deckId");
  await requireManagedDeck(deckId);
  const scryfallId = formString(fd, "scryfallId");
  const cardName = formString(fd, "cardName");
  const section = enumValue(
    DeckSection,
    formString(fd, "section"),
    DeckSection.MAINBOARD,
  );
  const quantity = normalizePositiveQuantity(fd.get("quantity"));
  const notes = formString(fd, "notes") || null;

  if (!scryfallId && !cardName)
    throw new Error("Choose a card or enter a card name.");

  const match = scryfallId
    ? await findOrImportCard({ scryfallId, name: cardName || scryfallId })
    : await findOrImportCard({ name: cardName });

  if (match.card) {
    await prisma.deckCard.create({
      data: {
        deckId,
        cardId: match.card.id,
        scryfallId: match.card.scryfallId,
        oracleId: match.card.oracleId,
        cardName: match.card.name,
        section,
        quantity,
        isCommander: section === DeckSection.COMMANDER,
        notes,
      },
    });
  } else {
    await prisma.deckCard.create({
      data: {
        deckId,
        cardName,
        section,
        quantity,
        isCommander: section === DeckSection.COMMANDER,
        notes: notes ?? match.message,
      },
    });
  }
  revalidatePath(`/decks/${deckId}`);
}

export async function updateDeckCard(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  await requireManagedDeck(deckId);
  const section = enumValue(
    DeckSection,
    formString(fd, "section"),
    DeckSection.MAINBOARD,
  );
  await prisma.deckCard.updateMany({
    where: { id: deckCardId, deckId },
    data: {
      quantity: normalizePositiveQuantity(fd.get("quantity")),
      section,
      isCommander: section === DeckSection.COMMANDER,
      notes: formString(fd, "notes") || null,
    },
  });
  revalidatePath(`/decks/${deckId}`);
}

export async function removeDeckCard(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  await requireManagedDeck(deckId);
  await prisma.deckCard.deleteMany({ where: { id: deckCardId, deckId } });
  revalidatePath(`/decks/${deckId}`);
}
