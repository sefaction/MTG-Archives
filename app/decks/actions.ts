"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  DeckFormat,
  DeckSection,
  InventoryLocationKind,
  Visibility,
} from "@prisma/client";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { findOrImportCard } from "@/lib/card-import";
import { prisma } from "@/lib/prisma";
import {
  inventoryAuditAction,
  recordInventoryAudit,
  recordInventoryAuditMany,
  type InventoryAuditCreateManyEntry,
} from "@/lib/inventory-audit";
import { canManageDeck, normalizePositiveQuantity } from "@/lib/decks";
import {
  auditDeckMoveSnapshot,
  ensureDeckLocation,
  matchesDeckCardPrinting,
  summarizeDeckCommitmentOwnership,
} from "@/lib/deck-commitments";
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
  const visibility = enumValue(
    Visibility,
    formString(fd, "visibility"),
    Visibility.INHERIT,
  );
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
      visibility,
    },
  });
  const existingDeckLocation = await prisma.inventoryLocation.findUnique({
    where: { deckId },
  });
  if (existingDeckLocation) {
    await ensureDeckLocation(prisma, {
      id: deckId,
      name,
      visibility,
      ownerUser: { playerId: deck.ownerUser.playerId },
    });
  }
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

export async function commitDeckCardToDeck(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  const inventoryItemId = formString(fd, "inventoryItemId");
  const quantity = normalizePositiveQuantity(fd.get("quantity"));
  const { user, deck } = await requireManagedDeck(deckId);
  if (!deck.ownerUser.playerId) {
    throw new Error("Deck owner is not linked to an inventory owner.");
  }

  await prisma.$transaction(async (tx) => {
    const [deckCard, source] = await Promise.all([
      tx.deckCard.findFirst({ where: { id: deckCardId, deckId } }),
      tx.inventoryItem.findFirst({
        where: {
          id: inventoryItemId,
          currentOwnerId: deck.ownerUser.playerId!,
          quantity: { gt: 0 },
        },
        include: { card: true, location: true },
      }),
    ]);
    if (!deckCard) throw new Error("Deck card not found.");
    if (!source) throw new Error("Available inventory copy not found.");
    if (source.location?.kind === InventoryLocationKind.DECK) {
      throw new Error(
        "Choose available inventory, not a card already committed to a deck.",
      );
    }
    const matchType = matchesDeckCardPrinting(deckCard, {
      id: source.id,
      cardId: source.cardId,
      quantity: source.quantity,
      card: source.card,
      location: source.location,
    });
    if (!matchType)
      throw new Error("Selected inventory does not match this deck card.");

    const deckLocation = await ensureDeckLocation(tx, deck);
    const committedItems = await tx.inventoryItem.findMany({
      where: {
        currentOwnerId: deck.ownerUser.playerId!,
        quantity: { gt: 0 },
        locationId: deckLocation.id,
      },
      include: { card: true, location: true },
    });
    const committed = summarizeDeckCommitmentOwnership(
      deckCard,
      committedItems,
      deck.id,
    );
    const remainingNeeded = Math.max(
      0,
      deckCard.quantity - committed.committedToThisDeck,
    );
    if (quantity > remainingNeeded) {
      throw new Error(
        `Only ${remainingNeeded} more cards can be committed for this deck row.`,
      );
    }

    if (matchType === "other") {
      await tx.deckCard.update({
        where: { id: deckCard.id },
        data: {
          cardId: source.card.id,
          scryfallId: source.card.scryfallId,
          oracleId: source.card.oracleId,
          cardName: source.card.name,
        },
      });
    }

    const beforeSource = source;
    const move = await moveInventoryQuantityWithinTransaction(tx, {
      inventoryItemId: source.id,
      toLocationId: deckLocation.id,
      quantity,
    });
    const metadata = deckMoveAuditMetadata({
      deckId: deck.id,
      deckName: deck.name,
      cardName: source.card.name,
      sourceLocationId: beforeSource.locationId,
      sourceLocationName: source.location?.name ?? "Unassigned",
      destinationLocationId: deckLocation.id,
      destinationLocationName: deckLocation.name,
      quantityMoved: quantity,
      beforeSourceQuantity: beforeSource.quantity,
      afterSourceQuantity: move.sourceAfterQuantity,
      beforeDestinationQuantity: move.destinationBeforeQuantity,
      afterDestinationQuantity: move.destinationAfterQuantity,
    });
    await recordInventoryAudit({
      tx,
      inventoryItemId: move.auditInventoryItemId,
      actingUserId: user.id,
      action: inventoryAuditAction.committedToDeck,
      before: auditDeckMoveSnapshot(beforeSource, metadata),
      after: auditDeckMoveSnapshot(
        { ...beforeSource, locationId: deckLocation.id, quantity },
        metadata,
      ),
      reason: `Committed ${quantity} ${source.card.name} to ${deck.name}.`,
    });
  });
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/inventory");
  revalidatePath("/locations");
}

export async function bulkCommitDeckCardsToDeck(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const raw = formString(fd, "movesJson");
  const moves = JSON.parse(raw || "[]") as Array<{
    deckCardId?: string;
    inventoryItemId?: string;
    quantity?: number;
  }>;
  const validMoves = moves.filter(
    (move) =>
      move.deckCardId &&
      move.inventoryItemId &&
      Number.isInteger(move.quantity) &&
      Number(move.quantity) > 0,
  );
  if (!validMoves.length) throw new Error("No available cards to commit.");
  const { user, deck } = await requireManagedDeck(deckId);
  if (!deck.ownerUser.playerId) {
    throw new Error("Deck owner is not linked to an inventory owner.");
  }

  await prisma.$transaction(async (tx) => {
    const deckLocation = await ensureDeckLocation(tx, deck);
    const auditLogs: InventoryAuditCreateManyEntry[] = [];
    for (const moveInput of validMoves) {
      const quantity = Math.min(999, Number(moveInput.quantity));
      const [deckCard, source] = await Promise.all([
        tx.deckCard.findFirst({
          where: { id: moveInput.deckCardId!, deckId },
        }),
        tx.inventoryItem.findFirst({
          where: {
            id: moveInput.inventoryItemId!,
            currentOwnerId: deck.ownerUser.playerId!,
            quantity: { gt: 0 },
          },
          include: { card: true, location: true },
        }),
      ]);
      if (!deckCard || !source) continue;
      if (source.location?.kind === InventoryLocationKind.DECK) continue;
      const matchType = matchesDeckCardPrinting(deckCard, {
        id: source.id,
        cardId: source.cardId,
        quantity: source.quantity,
        card: source.card,
        location: source.location,
      });
      if (!matchType) continue;
      const committedItems = await tx.inventoryItem.findMany({
        where: {
          currentOwnerId: deck.ownerUser.playerId!,
          quantity: { gt: 0 },
          locationId: deckLocation.id,
        },
        include: { card: true, location: true },
      });
      const committed = summarizeDeckCommitmentOwnership(
        deckCard,
        committedItems,
        deck.id,
      );
      const quantityToMove = Math.min(
        quantity,
        source.quantity,
        Math.max(0, deckCard.quantity - committed.committedToThisDeck),
      );
      if (quantityToMove <= 0) continue;
      if (matchType === "other") {
        await tx.deckCard.update({
          where: { id: deckCard.id },
          data: {
            cardId: source.card.id,
            scryfallId: source.card.scryfallId,
            oracleId: source.card.oracleId,
            cardName: source.card.name,
          },
        });
      }
      const move = await moveInventoryQuantityWithinTransaction(tx, {
        inventoryItemId: source.id,
        toLocationId: deckLocation.id,
        quantity: quantityToMove,
      });
      const metadata = deckMoveAuditMetadata({
        deckId: deck.id,
        deckName: deck.name,
        cardName: source.card.name,
        sourceLocationId: source.locationId,
        sourceLocationName: source.location?.name ?? "Unassigned",
        destinationLocationId: deckLocation.id,
        destinationLocationName: deckLocation.name,
        quantityMoved: quantityToMove,
        beforeSourceQuantity: source.quantity,
        afterSourceQuantity: move.sourceAfterQuantity,
        beforeDestinationQuantity: move.destinationBeforeQuantity,
        afterDestinationQuantity: move.destinationAfterQuantity,
      });
      auditLogs.push({
        inventoryItemId: move.auditInventoryItemId,
        changedByUserId: user.id,
        changeType: inventoryAuditAction.bulkCommittedToDeck,
        beforeJson: auditDeckMoveSnapshot(source, metadata),
        afterJson: auditDeckMoveSnapshot(
          {
            ...source,
            locationId: deckLocation.id,
            quantity: quantityToMove,
          },
          metadata,
        ),
        reason: `Bulk committed ${quantityToMove} ${source.card.name} to ${deck.name}.`,
      });
    }
    await recordInventoryAuditMany({ tx, entries: auditLogs });
  });
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/inventory");
  revalidatePath("/locations");
}

export async function returnDeckCardToInventory(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  const inventoryItemId = formString(fd, "inventoryItemId");
  const destinationLocationId = formString(fd, "destinationLocationId");
  const quantity = normalizePositiveQuantity(fd.get("quantity"));
  const { user, deck } = await requireManagedDeck(deckId);
  if (!deck.ownerUser.playerId) {
    throw new Error("Deck owner is not linked to an inventory owner.");
  }

  await prisma.$transaction(async (tx) => {
    const [deckCard, source, destination] = await Promise.all([
      tx.deckCard.findFirst({ where: { id: deckCardId, deckId } }),
      tx.inventoryItem.findFirst({
        where: {
          id: inventoryItemId,
          currentOwnerId: deck.ownerUser.playerId!,
          quantity: { gt: 0 },
          location: { deckId: deck.id, kind: InventoryLocationKind.DECK },
        },
        include: { card: true, location: true },
      }),
      tx.inventoryLocation.findFirst({
        where: {
          id: destinationLocationId,
          ownerPlayerId: deck.ownerUser.playerId!,
          kind: InventoryLocationKind.NORMAL,
          active: true,
        },
      }),
    ]);
    if (!deckCard) throw new Error("Deck card not found.");
    if (!source) throw new Error("Committed deck inventory not found.");
    if (!destination)
      throw new Error("Choose an active normal inventory location.");
    if (
      !matchesDeckCardPrinting(deckCard, {
        id: source.id,
        cardId: source.cardId,
        quantity: source.quantity,
        card: source.card,
        location: source.location,
      })
    ) {
      throw new Error(
        "Selected committed inventory does not match this deck card.",
      );
    }

    const beforeSource = source;
    const move = await moveInventoryQuantityWithinTransaction(tx, {
      inventoryItemId: source.id,
      toLocationId: destination.id,
      quantity,
    });
    const metadata = deckMoveAuditMetadata({
      deckId: deck.id,
      deckName: deck.name,
      cardName: source.card.name,
      sourceLocationId: source.locationId,
      sourceLocationName: source.location?.name ?? "Deck location",
      destinationLocationId: destination.id,
      destinationLocationName: destination.name,
      quantityMoved: quantity,
      beforeSourceQuantity: beforeSource.quantity,
      afterSourceQuantity: move.sourceAfterQuantity,
      beforeDestinationQuantity: move.destinationBeforeQuantity,
      afterDestinationQuantity: move.destinationAfterQuantity,
    });
    await recordInventoryAudit({
      tx,
      inventoryItemId: move.auditInventoryItemId,
      actingUserId: user.id,
      action: inventoryAuditAction.returnedFromDeck,
      before: auditDeckMoveSnapshot(beforeSource, metadata),
      after: auditDeckMoveSnapshot(
        { ...beforeSource, locationId: destination.id, quantity },
        metadata,
      ),
      reason: `Returned ${quantity} ${source.card.name} from ${deck.name} to ${destination.name}.`,
    });
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

function deckMoveAuditMetadata(input: {
  deckId: string;
  deckName: string;
  cardName: string;
  sourceLocationId: string | null;
  sourceLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  quantityMoved: number;
  beforeSourceQuantity: number;
  afterSourceQuantity: number;
  beforeDestinationQuantity: number;
  afterDestinationQuantity: number;
}) {
  return {
    deckId: input.deckId,
    deckName: input.deckName,
    cardName: input.cardName,
    sourceLocationId: input.sourceLocationId,
    sourceLocationName: input.sourceLocationName,
    destinationLocationId: input.destinationLocationId,
    destinationLocationName: input.destinationLocationName,
    quantityMoved: input.quantityMoved,
    beforeSourceQuantity: input.beforeSourceQuantity,
    afterSourceQuantity: input.afterSourceQuantity,
    beforeDestinationQuantity: input.beforeDestinationQuantity,
    afterDestinationQuantity: input.afterDestinationQuantity,
  };
}

async function moveInventoryQuantityWithinTransaction(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    inventoryItemId: string;
    toLocationId: string;
    quantity: number;
  },
) {
  const source = await tx.inventoryItem.findUnique({
    where: { id: input.inventoryItemId },
  });
  if (!source) throw new Error("Inventory item not found.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be positive.");
  }
  if (source.quantity < input.quantity) {
    throw new Error(
      "Cannot move more cards than this inventory entry contains.",
    );
  }
  const matching = await tx.inventoryItem.findFirst({
    where: {
      id: { not: source.id },
      currentOwnerId: source.currentOwnerId,
      cardId: source.cardId,
      foil: source.foil,
      foilStatus: source.foilStatus,
      condition: source.condition,
      language: source.language,
      locationId: input.toLocationId,
      quantity: { gt: 0 },
    },
  });
  if (source.quantity === input.quantity) {
    if (matching) {
      await tx.inventoryItem.update({
        where: { id: matching.id },
        data: { quantity: { increment: input.quantity } },
      });
      await tx.inventoryItem.delete({ where: { id: source.id } });
      return {
        source,
        destinationInventoryItemId: matching.id,
        auditInventoryItemId: matching.id,
        merged: true,
        sourceAfterQuantity: 0,
        destinationBeforeQuantity: matching.quantity,
        destinationAfterQuantity: matching.quantity + input.quantity,
      };
    }
    await tx.inventoryItem.update({
      where: { id: source.id },
      data: { locationId: input.toLocationId },
    });
    return {
      source,
      destinationInventoryItemId: source.id,
      auditInventoryItemId: source.id,
      merged: false,
      sourceAfterQuantity: 0,
      destinationBeforeQuantity: 0,
      destinationAfterQuantity: source.quantity,
    };
  }
  await tx.inventoryItem.update({
    where: { id: source.id },
    data: { quantity: { decrement: input.quantity } },
  });
  if (matching) {
    await tx.inventoryItem.update({
      where: { id: matching.id },
      data: { quantity: { increment: input.quantity } },
    });
    return {
      source,
      destinationInventoryItemId: matching.id,
      auditInventoryItemId: source.id,
      merged: true,
      sourceAfterQuantity: source.quantity - input.quantity,
      destinationBeforeQuantity: matching.quantity,
      destinationAfterQuantity: matching.quantity + input.quantity,
    };
  }
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...copy
  } = source;
  const created = await tx.inventoryItem.create({
    data: { ...copy, quantity: input.quantity, locationId: input.toLocationId },
  });
  return {
    source,
    destinationInventoryItemId: created.id,
    auditInventoryItemId: source.id,
    merged: false,
    sourceAfterQuantity: source.quantity - input.quantity,
    destinationBeforeQuantity: 0,
    destinationAfterQuantity: input.quantity,
  };
}
