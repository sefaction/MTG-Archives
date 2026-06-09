"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DeckFormat, DeckSection, Visibility } from "@prisma/client";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { findOrImportCard } from "@/lib/card-import";
import { prisma } from "@/lib/prisma";
import { canManageDeck, normalizePositiveQuantity } from "@/lib/decks";
import {
  findSystemDeckLocation,
  getDeckCommittedSummary,
  returnCommittedInventoryFromDeckTx,
} from "@/lib/deck-inventory";

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
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: { ownerUser: { select: { playerId: true } } },
  });
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
  const destinationLocationId = formString(fd, "destinationLocationId");
  const strongConfirmation = formString(fd, "strongConfirmation");
  const ownerPlayerId = deck.ownerUser.playerId;
  if (!ownerPlayerId)
    throw new Error("Deck owner does not have an inventory owner profile.");
  const committed = await getDeckCommittedSummary(prisma, {
    deckId,
    ownerPlayerId,
  });
  if (committed.committedQuantity > 0 && !destinationLocationId) {
    throw new Error(
      `This deck has ${committed.committedQuantity} committed physical cards. Choose a destination location before deleting it.`,
    );
  }
  if (committed.committedQuantity >= 20 && strongConfirmation !== "DELETE") {
    throw new Error(
      "Type DELETE to confirm returning committed inventory and deleting this deck.",
    );
  }
  if (adminMode && deck.ownerUserId !== user.id) {
    console.info("admin_delete_deck", { deckId, changedByUserId: user.id });
  }
  await prisma.$transaction(async (tx) => {
    if (committed.committedQuantity > 0) {
      await returnCommittedInventoryFromDeckTx(tx, {
        actorUserId: user.id,
        ownerPlayerId,
        deckId,
        deckName: deck.name,
        destinationLocationId,
        mode: "returned_from_deck_for_delete",
        reason: `Returned committed inventory before deleting deck “${deck.name}”.`,
      });
    }
    const deckLocation = await findSystemDeckLocation(tx, {
      deckId,
      ownerPlayerId,
    });
    if (deckLocation) {
      const remaining = await tx.inventoryItem.count({
        where: { locationId: deckLocation.id, quantity: { gt: 0 } },
      });
      if (remaining > 0) {
        throw new Error(
          "Cannot delete deck while committed inventory remains in its deck location.",
        );
      }
      await tx.inventoryLocation.delete({ where: { id: deckLocation.id } });
    }
    await tx.deck.delete({ where: { id: deckId } });
  });
  revalidatePath("/decks");
  redirect("/decks");
}

export async function returnAllCommittedDeckInventory(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const destinationLocationId = formString(fd, "destinationLocationId");
  const { user, deck } = await requireManagedDeck(deckId);
  const ownerPlayerId = deck.ownerUser.playerId;
  if (!ownerPlayerId)
    throw new Error("Deck owner does not have an inventory owner profile.");
  await prisma.$transaction((tx) =>
    returnCommittedInventoryFromDeckTx(tx, {
      actorUserId: user.id,
      ownerPlayerId,
      deckId,
      deckName: deck.name,
      destinationLocationId,
      mode: "bulk_returned_from_deck",
    }),
  );
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/inventory");
  revalidatePath("/locations");
}

export async function addDeckCard(fd: FormData) {
  const deckId = formString(fd, "deckId");
  await requireManagedDeck(deckId);
  const cardId = formString(fd, "cardId");
  const scryfallId = formString(fd, "scryfallId");
  const cardName = formString(fd, "cardName");
  const section = enumValue(
    DeckSection,
    formString(fd, "section"),
    DeckSection.MAINBOARD,
  );
  const quantity = normalizePositiveQuantity(fd.get("quantity"));
  const notes = formString(fd, "notes") || null;

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
      "Select a specific card printing before adding it to the deck.",
    );

  const existing = await prisma.deckCard.findFirst({
    where: { deckId, cardId: card.id, section },
  });
  if (existing) {
    await prisma.deckCard.update({
      where: { id: existing.id },
      data: {
        quantity: existing.quantity + quantity,
        notes: notes || existing.notes,
      },
    });
  } else {
    await prisma.deckCard.create({
      data: {
        deckId,
        cardId: card.id,
        scryfallId: card.scryfallId,
        oracleId: card.oracleId,
        cardName: card.name,
        section,
        quantity,
        isCommander: section === DeckSection.COMMANDER,
        notes,
      },
    });
  }
  revalidatePath(`/decks/${deckId}`);
}

export async function updateDeckCard(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  const section = enumValue(
    DeckSection,
    formString(fd, "section"),
    DeckSection.MAINBOARD,
  );
  const quantity = normalizePositiveQuantity(fd.get("quantity"));
  const notes = formString(fd, "notes") || null;
  const { user, deck } = await requireManagedDeck(deckId);
  const maybeboardCommittedMode = formString(fd, "maybeboardCommittedMode");
  const destinationLocationId = formString(fd, "destinationLocationId");
  const ownerPlayerId = deck.ownerUser.playerId;
  await prisma.$transaction(async (tx) => {
    const deckCard = await tx.deckCard.findFirst({
      where: { id: deckCardId, deckId },
    });
    if (!deckCard) throw new Error("Deck card not found.");
    if (
      section === DeckSection.MAYBEBOARD &&
      deckCard.section !== DeckSection.MAYBEBOARD &&
      deckCard.cardId &&
      ownerPlayerId
    ) {
      const committed = await getDeckCommittedSummary(tx, {
        deckId,
        ownerPlayerId,
      });
      const committedForCard = committed.byCardId[deckCard.cardId] ?? 0;
      if (committedForCard > 0) {
        if (maybeboardCommittedMode === "return") {
          await returnCommittedInventoryFromDeckTx(tx, {
            actorUserId: user.id,
            ownerPlayerId,
            deckId,
            deckName: deck.name,
            destinationLocationId,
            mode: "returned_from_deck_for_maybeboard",
            cardIds: [deckCard.cardId],
            reason: `Returned committed copies before moving ${deckCard.cardName} to maybeboard.`,
          });
        } else if (maybeboardCommittedMode !== "keep") {
          throw new Error(
            "Return committed copies to inventory or explicitly keep them committed before moving this card to Maybeboard.",
          );
        }
      }
    }
    const duplicate = deckCard.cardId
      ? await tx.deckCard.findFirst({
          where: {
            deckId,
            cardId: deckCard.cardId,
            section,
            id: { not: deckCard.id },
          },
        })
      : null;
    if (duplicate) {
      await tx.deckCard.update({
        where: { id: duplicate.id },
        data: {
          quantity: duplicate.quantity + quantity,
          notes: notes || duplicate.notes,
          isCommander:
            duplicate.isCommander || section === DeckSection.COMMANDER,
        },
      });
      await tx.deckCard.delete({ where: { id: deckCard.id } });
    } else {
      await tx.deckCard.update({
        where: { id: deckCard.id },
        data: {
          quantity,
          section,
          isCommander: section === DeckSection.COMMANDER,
          notes,
        },
      });
    }
  });
  revalidatePath(`/decks/${deckId}`);
}

export async function removeDeckCard(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  const destinationLocationId = formString(fd, "destinationLocationId");
  const { user, deck } = await requireManagedDeck(deckId);
  const ownerPlayerId = deck.ownerUser.playerId;
  await prisma.$transaction(async (tx) => {
    const deckCard = await tx.deckCard.findFirst({
      where: { id: deckCardId, deckId },
    });
    if (!deckCard) return;
    if (deckCard.cardId && ownerPlayerId) {
      const committed = await getDeckCommittedSummary(tx, {
        deckId,
        ownerPlayerId,
      });
      const committedForCard = committed.byCardId[deckCard.cardId] ?? 0;
      if (committedForCard > 0) {
        if (!destinationLocationId) {
          throw new Error(
            "This card has committed copies in the deck. Return them to inventory before removing it.",
          );
        }
        await returnCommittedInventoryFromDeckTx(tx, {
          actorUserId: user.id,
          ownerPlayerId,
          deckId,
          deckName: deck.name,
          destinationLocationId,
          mode: "returned_from_deck_for_remove",
          cardIds: [deckCard.cardId],
          reason: `Returned committed copies before removing ${deckCard.cardName} from the deck list.`,
        });
      }
    }
    await tx.deckCard.deleteMany({ where: { id: deckCardId, deckId } });
  });
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/inventory");
  revalidatePath("/locations");
}

export async function commitDeckImport(fd: FormData) {
  const deckId = formString(fd, "deckId");
  await requireManagedDeck(deckId);
  const mode = formString(fd, "mode") === "replace" ? "replace" : "merge";
  if (mode === "replace") {
    const { deck } = await requireManagedDeck(deckId);
    const ownerPlayerId = deck.ownerUser.playerId;
    if (ownerPlayerId) {
      const committed = await getDeckCommittedSummary(prisma, {
        deckId,
        ownerPlayerId,
      });
      if (committed.committedQuantity > 0) {
        throw new Error(
          "Return committed physical cards to inventory before replacing this deck list.",
        );
      }
    }
  }
  const unresolvedIncludedCount = Number(
    fd.get("unresolvedIncludedCount") || 0,
  );
  if (unresolvedIncludedCount > 0) {
    throw new Error(
      `Resolve or exclude ${unresolvedIncludedCount} unresolved lines before committing.`,
    );
  }
  const raw = formString(fd, "linesJson");
  const parsed = JSON.parse(raw || "[]") as Array<{
    cardId?: string | null;
    quantity?: number | null;
    section?: DeckSection | null;
    included?: boolean;
    notes?: string;
  }>;
  const lines = parsed.filter(
    (
      line,
    ): line is {
      cardId: string;
      quantity: number;
      section: DeckSection;
      included: boolean;
      notes?: string;
    } =>
      line.included !== false &&
      Boolean(line.cardId) &&
      Number.isInteger(line.quantity) &&
      Number(line.quantity) > 0 &&
      Boolean(line.section),
  );
  if (lines.length === 0)
    throw new Error("No resolved decklist lines to commit.");
  await prisma.$transaction(async (tx) => {
    if (mode === "replace") {
      await tx.deckCard.deleteMany({ where: { deckId } });
    }
    for (const line of lines) {
      const card = await tx.card.findUnique({
        where: { id: line.cardId },
        select: { id: true, name: true, scryfallId: true, oracleId: true },
      });
      if (!card) continue;
      const existing = await tx.deckCard.findFirst({
        where: { deckId, cardId: card.id, section: line.section },
      });
      if (existing) {
        await tx.deckCard.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + line.quantity,
            notes: line.notes || existing.notes,
          },
        });
      } else {
        await tx.deckCard.create({
          data: {
            deckId,
            cardId: card.id,
            scryfallId: card.scryfallId,
            oracleId: card.oracleId,
            cardName: card.name,
            section: line.section,
            quantity: line.quantity,
            isCommander: line.section === DeckSection.COMMANDER,
            notes: line.notes || null,
          },
        });
      }
    }
  });
  revalidatePath(`/decks/${deckId}`);
}
