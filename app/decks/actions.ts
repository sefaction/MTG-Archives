"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  DeckFormat,
  DeckSection,
  FoilStatus,
  InventoryLocationKind,
  Visibility,
} from "@prisma/client";
import { getAccessScope, requireLogin } from "@/lib/auth";
import { findOrImportCard, normalizeCardName } from "@/lib/card-import";
import {
  addInventoryCardToLocation,
  normalizeManualInventoryQuantity,
} from "@/lib/inventory-manual";
import { moveInventoryQuantityWithinTransaction } from "@/lib/inventory-move";
import { ensureDefaultLocation } from "@/lib/inventory-locations";
import { prisma } from "@/lib/prisma";
import {
  inventoryAuditAction,
  recordInventoryAudit,
  recordInventoryAuditMany,
  type InventoryAuditCreateManyEntry,
} from "@/lib/inventory-audit";
import {
  DEFAULT_DECK_CARD_SECTION,
  canManageDeck,
  normalizePositiveQuantity,
} from "@/lib/decks";
import { parseDeckBracket } from "@/lib/deck-brackets";
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
import { DECK_FOLDER_ROOT_VALUE, canMoveFolder } from "@/lib/deck-folders";
import { parseDeckTags, replaceDeckTags } from "@/lib/deck-tags";

function formString(fd: FormData, name: string) {
  return String(fd.get(name) || "").trim();
}

function formPercent(fd: FormData, name: string, fallback: number) {
  const value = Number(fd.get(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formRange(
  fd: FormData,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(fd.get(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
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

async function requireManagedFolder(folderId: string) {
  const user = await requireLogin();
  const scope = await getAccessScope(user);
  const folder = await prisma.deckFolder.findUnique({
    where: { id: folderId },
  });
  if (!folder) throw new Error("Folder not found.");
  if (scope?.mode !== "admin" && folder.ownerUserId !== user.id) {
    throw new Error("You can only manage your own folders.");
  }
  return { user, folder, adminMode: scope?.mode === "admin" };
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

async function ensureUniqueFolderName(
  ownerUserId: string,
  parentId: string | null,
  name: string,
  exceptId?: string,
) {
  const existing = await prisma.deckFolder.findFirst({
    where: {
      ownerUserId,
      parentId,
      name,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (existing)
    throw new Error(
      "Folder names must be unique within the same parent folder.",
    );
}

async function validatedFolderId(ownerUserId: string, folderId: string) {
  if (!folderId || folderId === DECK_FOLDER_ROOT_VALUE) return null;
  const folder = await prisma.deckFolder.findFirst({
    where: { id: folderId, ownerUserId },
    select: { id: true },
  });
  if (!folder) throw new Error("Choose a folder owned by the deck owner.");
  return folder.id;
}

export async function createDeckFolder(fd: FormData) {
  const user = await requireLogin();
  const name = formString(fd, "name");
  if (!name) throw new Error("Folder name is required.");
  const parentId = await validatedFolderId(user.id, formString(fd, "parentId"));
  await ensureUniqueFolderName(user.id, parentId, name);
  await prisma.deckFolder.create({
    data: { ownerUserId: user.id, parentId, name },
  });
  revalidatePath("/decks");
}

export async function renameDeckFolder(fd: FormData) {
  const folderId = formString(fd, "folderId");
  const name = formString(fd, "name");
  if (!name) throw new Error("Folder name is required.");
  const { folder } = await requireManagedFolder(folderId);
  await ensureUniqueFolderName(
    folder.ownerUserId,
    folder.parentId,
    name,
    folderId,
  );
  await prisma.deckFolder.update({ where: { id: folderId }, data: { name } });
  revalidatePath("/decks");
}

export async function moveDeckFolder(fd: FormData) {
  const folderId = formString(fd, "folderId");
  const { folder } = await requireManagedFolder(folderId);
  const parentId = await validatedFolderId(
    folder.ownerUserId,
    formString(fd, "parentId"),
  );
  const folders = await prisma.deckFolder.findMany({
    where: { ownerUserId: folder.ownerUserId },
    select: { id: true, parentId: true },
  });
  if (!canMoveFolder(folderId, parentId, folders)) {
    throw new Error(
      "A folder cannot be moved under itself or one of its descendants.",
    );
  }
  await prisma.deckFolder.update({
    where: { id: folderId },
    data: { parentId },
  });
  revalidatePath("/decks");
}

export async function deleteDeckFolder(fd: FormData) {
  const folderId = formString(fd, "folderId");
  const { folder } = await requireManagedFolder(folderId);
  await prisma.$transaction(async (tx) => {
    await tx.deck.updateMany({
      where: { folderId },
      data: { folderId: folder.parentId },
    });
    await tx.deckFolder.updateMany({
      where: { parentId: folderId },
      data: { parentId: folder.parentId },
    });
    await tx.deckFolder.delete({ where: { id: folderId } });
  });
  revalidatePath("/decks");
}

export async function moveDeckToFolder(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const { deck } = await requireManagedDeck(deckId);
  const folderId = await validatedFolderId(
    deck.ownerUserId,
    formString(fd, "folderId"),
  );
  await prisma.deck.update({ where: { id: deckId }, data: { folderId } });
  revalidatePath("/decks");
  revalidatePath(`/decks/${deckId}`);
}

export async function createDeck(fd: FormData) {
  const user = await requireLogin();
  const name = formString(fd, "name");
  if (!name) throw new Error("Deck name is required.");
  const tags = parseDeckTags(fd.get("tags"));
  const folderId = await validatedFolderId(user.id, formString(fd, "folderId"));
  const deck = await prisma.$transaction(async (tx) => {
    const created = await tx.deck.create({
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
        bracket: parseDeckBracket(fd.get("bracket")),
        bracketUpdatedAt: fd.get("bracket") ? new Date() : null,
        folderId,
      },
    });
    await replaceDeckTags(tx, {
      deckId: created.id,
      ownerUserId: user.id,
      tags,
    });
    return created;
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
  const bracket = parseDeckBracket(fd.get("bracket"));
  const tags = parseDeckTags(fd.get("tags"));
  const folderId = await validatedFolderId(
    deck.ownerUserId,
    formString(fd, "folderId"),
  );
  await prisma.$transaction(async (tx) => {
    await tx.deck.update({
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
        bracket,
        bracketUpdatedAt:
          bracket !== deck.bracket ? new Date() : deck.bracketUpdatedAt,
        bannerPositionX: formPercent(fd, "bannerPositionX", 50),
        bannerPositionY: formPercent(fd, "bannerPositionY", 50),
        bannerZoom: formRange(fd, "bannerZoom", 100, 60, 500),
        folderId,
      },
    });
    await replaceDeckTags(tx, {
      deckId,
      ownerUserId: deck.ownerUserId,
      tags,
    });
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
  if (committed.committedQuantity > 0 && strongConfirmation !== "DELETE") {
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
    DEFAULT_DECK_CARD_SECTION,
  );
  const quantity = normalizePositiveQuantity(fd.get("quantity"));
  const commitImmediately = formString(fd, "commitImmediately") === "on";
  const inventoryItemId = formString(fd, "inventoryItemId");
  const addInventoryCopy = formString(fd, "addInventoryCopy") === "on";
  const commitNewInventoryCopy =
    addInventoryCopy && formString(fd, "commitNewInventoryCopy") === "on";
  const inventoryLocationId = formString(fd, "inventoryLocationId");
  const inventoryQuantity = addInventoryCopy
    ? normalizeManualInventoryQuantity(fd.get("inventoryQuantity"))
    : 0;
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

  const { user, deck } = await requireManagedDeck(deckId);
  if (commitImmediately && !deck.ownerUser.playerId) {
    throw new Error("Deck owner is not linked to an inventory owner.");
  }
  if (commitImmediately && !inventoryItemId) {
    throw new Error("Choose an owned inventory location to commit from.");
  }
  if (addInventoryCopy && !deck.ownerUser.playerId) {
    throw new Error("Deck owner is not linked to an inventory owner.");
  }
  if (addInventoryCopy && !inventoryLocationId) {
    throw new Error(
      "Choose a destination location for the new inventory copy.",
    );
  }
  if (commitImmediately && addInventoryCopy) {
    throw new Error(
      "Choose either an existing inventory copy or a newly added physical copy.",
    );
  }
  if (commitNewInventoryCopy && inventoryQuantity > quantity) {
    throw new Error(
      "Newly committed physical copies cannot exceed the deck quantity being added.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.deckCard.findFirst({
      where: { deckId, cardId: card.id, section },
    });
    if (existing) {
      await tx.deckCard.update({
        where: { id: existing.id },
        data: {
          quantity: existing.quantity + quantity,
          notes: notes || existing.notes,
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
          section,
          quantity,
          isCommander: section === DeckSection.COMMANDER,
          notes,
        },
      });
    }

    if (addInventoryCopy) {
      const added = await addInventoryCardToLocation(tx, {
        ownerPlayerId: deck.ownerUser.playerId!,
        cardId: card.id,
        locationId: inventoryLocationId,
        quantity: inventoryQuantity,
        foilStatus: formString(fd, "inventoryFoilStatus") || FoilStatus.NONFOIL,
        condition: formString(fd, "inventoryCondition") || "NM",
        language: formString(fd, "inventoryLanguage") || "EN",
        notes,
        actingUserId: user.id,
        reason: `Added physical copy while adding ${card.name} to ${deck.name}.`,
      });

      if (commitNewInventoryCopy) {
        const deckLocation = await ensureDeckLocation(tx, deck);
        const move = await moveInventoryQuantityWithinTransaction(tx, {
          inventoryItemId: added.inventory.id,
          toLocationId: deckLocation.id,
          quantity: inventoryQuantity,
        });
        const metadata = deckMoveAuditMetadata({
          deckId: deck.id,
          deckName: deck.name,
          cardName: card.name,
          sourceLocationId: added.location.id,
          sourceLocationName: added.location.name,
          destinationLocationId: deckLocation.id,
          destinationLocationName: deckLocation.name,
          quantityMoved: inventoryQuantity,
          beforeSourceQuantity: move.source.quantity,
          afterSourceQuantity: move.sourceAfterQuantity,
          beforeDestinationQuantity: move.destinationBeforeQuantity,
          afterDestinationQuantity: move.destinationAfterQuantity,
        });
        await recordInventoryAudit({
          tx,
          inventoryItemId: move.auditInventoryItemId,
          actingUserId: user.id,
          action: inventoryAuditAction.committedToDeck,
          before: auditDeckMoveSnapshot(move.source, metadata),
          after: auditDeckMoveSnapshot(
            {
              ...move.source,
              locationId: deckLocation.id,
              quantity: inventoryQuantity,
            },
            metadata,
          ),
          reason: `Added and committed ${inventoryQuantity} new ${card.name} to ${deck.name}.`,
        });
      }
    }

    if (!commitImmediately) return;

    const source = await tx.inventoryItem.findFirst({
      where: {
        id: inventoryItemId,
        currentOwnerId: deck.ownerUser.playerId!,
        cardId: card.id,
        quantity: { gte: quantity },
      },
      include: { card: true, location: true },
    });
    if (!source || source.location?.kind === InventoryLocationKind.DECK) {
      throw new Error("Available matching inventory copy not found.");
    }
    const deckLocation = await ensureDeckLocation(tx, deck);
    const move = await moveInventoryQuantityWithinTransaction(tx, {
      inventoryItemId: source.id,
      toLocationId: deckLocation.id,
      quantity,
    });
    const metadata = deckMoveAuditMetadata({
      deckId: deck.id,
      deckName: deck.name,
      cardName: card.name,
      sourceLocationId: source.locationId,
      sourceLocationName: source.location?.name ?? "Unassigned",
      destinationLocationId: deckLocation.id,
      destinationLocationName: deckLocation.name,
      quantityMoved: quantity,
      beforeSourceQuantity: source.quantity,
      afterSourceQuantity: move.sourceAfterQuantity,
      beforeDestinationQuantity: move.destinationBeforeQuantity,
      afterDestinationQuantity: move.destinationAfterQuantity,
    });
    await recordInventoryAudit({
      tx,
      inventoryItemId: move.auditInventoryItemId,
      actingUserId: user.id,
      action: inventoryAuditAction.committedToDeck,
      before: auditDeckMoveSnapshot(source, metadata),
      after: auditDeckMoveSnapshot(
        { ...source, locationId: deckLocation.id, quantity },
        metadata,
      ),
      reason: `Added and committed ${quantity} ${card.name} to ${deck.name}.`,
    });
  });
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/inventory");
  revalidatePath("/locations");
}

export async function updateDeckCard(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  const section = enumValue(
    DeckSection,
    formString(fd, "section"),
    DEFAULT_DECK_CARD_SECTION,
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

export async function addRealCopyToDeck(fd: FormData) {
  const deckId = formString(fd, "deckId");
  const deckCardId = formString(fd, "deckCardId");
  const cardId = formString(fd, "cardId");
  const quantity = normalizeManualInventoryQuantity(fd.get("quantity"));
  const { user, deck } = await requireManagedDeck(deckId);
  if (!deck.ownerUser.playerId) {
    throw new Error("Deck owner is not linked to an inventory owner.");
  }
  if (!cardId) throw new Error("Select a printing before adding inventory.");

  await prisma.$transaction(async (tx) => {
    const [deckCard, selectedCard] = await Promise.all([
      tx.deckCard.findFirst({ where: { id: deckCardId, deckId } }),
      tx.card.findUnique({ where: { id: cardId } }),
    ]);
    if (!deckCard) throw new Error("Deck card not found.");
    if (!selectedCard)
      throw new Error("Selected card printing no longer exists.");
    const selectedCardMatchesRow =
      deckCard.oracleId && selectedCard.oracleId
        ? deckCard.oracleId === selectedCard.oracleId
        : normalizeCardName(deckCard.cardName) ===
          normalizeCardName(selectedCard.name);
    if (!selectedCardMatchesRow) {
      throw new Error("Choose a printing of this deck card.");
    }

    const [defaultLocation, deckLocation] = await Promise.all([
      ensureDefaultLocation(tx, deck.ownerUser.playerId!),
      ensureDeckLocation(tx, deck),
    ]);
    const remainingNeeded = Math.max(
      0,
      deckCard.quantity -
        summarizeDeckCommitmentOwnership(
          deckCard,
          await tx.inventoryItem.findMany({
            where: {
              currentOwnerId: deck.ownerUser.playerId!,
              quantity: { gt: 0 },
              locationId: deckLocation.id,
            },
            include: { card: true, location: true },
          }),
          deck.id,
        ).committedToThisDeck,
    );
    if (quantity > remainingNeeded) {
      throw new Error(
        `Only ${remainingNeeded} more cards can be committed for this deck row.`,
      );
    }

    const added = await addInventoryCardToLocation(tx, {
      ownerPlayerId: deck.ownerUser.playerId!,
      cardId: selectedCard.id,
      locationId: defaultLocation.id,
      quantity,
      foilStatus: formString(fd, "foilStatus") || FoilStatus.NONFOIL,
      condition: formString(fd, "condition") || "NM",
      language: formString(fd, "language") || "EN",
      notes: formString(fd, "notes") || null,
      actingUserId: user.id,
      reason: `Added real copy to commit to ${deck.name}.`,
    });

    if (deckCard.cardId !== selectedCard.id) {
      await tx.deckCard.update({
        where: { id: deckCard.id },
        data: {
          cardId: selectedCard.id,
          scryfallId: selectedCard.scryfallId,
          oracleId: selectedCard.oracleId,
          cardName: selectedCard.name,
        },
      });
    }

    const move = await moveInventoryQuantityWithinTransaction(tx, {
      inventoryItemId: added.inventory.id,
      toLocationId: deckLocation.id,
      quantity,
    });
    const metadata = deckMoveAuditMetadata({
      deckId: deck.id,
      deckName: deck.name,
      cardName: selectedCard.name,
      sourceLocationId: added.location.id,
      sourceLocationName: added.location.name,
      destinationLocationId: deckLocation.id,
      destinationLocationName: deckLocation.name,
      quantityMoved: quantity,
      beforeSourceQuantity: move.source.quantity,
      afterSourceQuantity: move.sourceAfterQuantity,
      beforeDestinationQuantity: move.destinationBeforeQuantity,
      afterDestinationQuantity: move.destinationAfterQuantity,
    });
    await recordInventoryAudit({
      tx,
      inventoryItemId: move.auditInventoryItemId,
      actingUserId: user.id,
      action: inventoryAuditAction.committedToDeck,
      before: auditDeckMoveSnapshot(move.source, metadata),
      after: auditDeckMoveSnapshot(
        { ...move.source, locationId: deckLocation.id, quantity },
        metadata,
      ),
      reason: `Added and committed ${quantity} ${selectedCard.name} to ${deck.name}.`,
    });
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
