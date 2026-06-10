import {
  InventoryLocationKind,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { normalizeLocationName } from "./inventory-locations";

export const DECK_LOCATION_TYPE = "Deck";
export const DECK_LOCATION_NAME_PREFIX = "Deck";

type InventoryTx = Prisma.TransactionClient | PrismaClient;

type DeckInventoryRow = {
  id: string;
  currentOwnerId: string;
  originalOpenerId: string;
  cardId: string;
  foil: boolean;
  foilStatus: string;
  condition: string;
  language: string;
  roundId: string | null;
  locationId: string | null;
  quantity: number;
  sourceType: string;
  acquiredFromPullId: string | null;
  notes: string | null;
  card?: { name: string } | null;
};

export type DeckCommittedSummary = {
  deckLocation: { id: string; name: string } | null;
  committedEntries: number;
  committedQuantity: number;
  byCardId: Record<string, number>;
};

export type ReturnCommittedMode =
  | "returned_from_deck"
  | "bulk_returned_from_deck"
  | "returned_from_deck_for_delete"
  | "returned_from_deck_for_maybeboard"
  | "returned_from_deck_for_remove";

export type ReturnCommittedResult = {
  movedEntries: number;
  movedCards: number;
  skippedEntries: number;
  sourceLocationId: string | null;
  sourceLocationName: string | null;
  destinationLocationId: string;
  destinationLocationName: string;
  affectedCardIds: string[];
};

export function deckLocationNormalizedName(deckId: string) {
  return normalizeLocationName(`${DECK_LOCATION_NAME_PREFIX}-${deckId}`);
}

export function isSystemDeckLocation(location: {
  type?: string | null;
  normalizedName?: string | null;
  kind?: InventoryLocationKind | string | null;
  deckId?: string | null;
  systemManaged?: boolean | null;
}) {
  return (
    location.kind === InventoryLocationKind.DECK ||
    Boolean(location.deckId) ||
    location.type === DECK_LOCATION_TYPE ||
    Boolean(location.normalizedName?.startsWith("deck-")) ||
    Boolean(location.systemManaged)
  );
}

export function isNormalInventoryLocation(location: {
  type?: string | null;
  normalizedName?: string | null;
  kind?: InventoryLocationKind | string | null;
  deckId?: string | null;
  systemManaged?: boolean | null;
  active?: boolean | null;
}) {
  return location.active !== false && !isSystemDeckLocation(location);
}

function moveKey(
  item: Pick<
    DeckInventoryRow,
    | "currentOwnerId"
    | "cardId"
    | "foil"
    | "foilStatus"
    | "condition"
    | "language"
  >,
) {
  return [
    item.currentOwnerId,
    item.cardId,
    String(item.foil),
    item.foilStatus,
    item.condition,
    item.language,
  ].join("\u001f");
}

function itemSnapshot(
  item: DeckInventoryRow,
  extra: Record<string, unknown> = {},
): Prisma.InputJsonObject {
  return {
    inventoryItemId: item.id,
    currentOwnerId: item.currentOwnerId,
    originalOpenerId: item.originalOpenerId,
    cardId: item.cardId,
    cardName: item.card?.name ?? null,
    foil: item.foil,
    foilStatus: item.foilStatus,
    condition: item.condition,
    language: item.language,
    roundId: item.roundId,
    locationId: item.locationId,
    quantity: item.quantity,
    sourceType: item.sourceType,
    acquiredFromPullId: item.acquiredFromPullId,
    notes: item.notes,
    ...extra,
  };
}

export async function findSystemDeckLocation(
  tx: InventoryTx,
  input: { deckId: string; ownerPlayerId: string },
) {
  return tx.inventoryLocation.findFirst({
    where: {
      ownerPlayerId: input.ownerPlayerId,
      OR: [
        { deckId: input.deckId },
        { normalizedName: deckLocationNormalizedName(input.deckId) },
        { type: DECK_LOCATION_TYPE, description: { contains: input.deckId } },
      ],
    },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      type: true,
      kind: true,
      deckId: true,
      systemManaged: true,
    },
  });
}

export async function getDeckCommittedSummary(
  tx: InventoryTx,
  input: { deckId: string; ownerPlayerId: string },
): Promise<DeckCommittedSummary> {
  const deckLocation = await findSystemDeckLocation(tx, input);
  if (!deckLocation) {
    return {
      deckLocation: null,
      committedEntries: 0,
      committedQuantity: 0,
      byCardId: {},
    };
  }
  const rows = await tx.inventoryItem.findMany({
    where: {
      currentOwnerId: input.ownerPlayerId,
      locationId: deckLocation.id,
      quantity: { gt: 0 },
    },
    select: { cardId: true, quantity: true },
  });
  const byCardId: Record<string, number> = {};
  for (const row of rows)
    byCardId[row.cardId] = (byCardId[row.cardId] ?? 0) + row.quantity;
  return {
    deckLocation: { id: deckLocation.id, name: deckLocation.name },
    committedEntries: rows.length,
    committedQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    byCardId,
  };
}

async function validateDestinationLocation(
  tx: InventoryTx,
  input: { destinationLocationId: string; ownerPlayerId: string },
) {
  if (!input.destinationLocationId)
    throw new Error("Destination location is required.");
  const destination = await tx.inventoryLocation.findUnique({
    where: { id: input.destinationLocationId },
    select: {
      id: true,
      ownerPlayerId: true,
      name: true,
      normalizedName: true,
      type: true,
      active: true,
      kind: true,
      deckId: true,
      systemManaged: true,
    },
  });
  if (!destination) throw new Error("Destination location not found.");
  if (destination.ownerPlayerId !== input.ownerPlayerId) {
    throw new Error("Destination location does not belong to this deck owner.");
  }
  if (!isNormalInventoryLocation(destination)) {
    throw new Error("Choose a normal inventory location, not a deck location.");
  }
  return destination;
}

export async function returnCommittedInventoryFromDeckTx(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    ownerPlayerId: string;
    deckId: string;
    deckName: string;
    destinationLocationId: string;
    mode: ReturnCommittedMode;
    cardIds?: string[];
    maxQuantity?: number;
    reason?: string;
  },
): Promise<ReturnCommittedResult> {
  const destination = await validateDestinationLocation(tx, input);
  const source = await findSystemDeckLocation(tx, input);
  if (!source) {
    return {
      movedEntries: 0,
      movedCards: 0,
      skippedEntries: 0,
      sourceLocationId: null,
      sourceLocationName: null,
      destinationLocationId: destination.id,
      destinationLocationName: destination.name,
      affectedCardIds: [],
    };
  }
  if (source.id === destination.id) {
    throw new Error(
      "Source deck location and destination location must be different.",
    );
  }

  const distinctCardIds = input.cardIds?.length
    ? [...new Set(input.cardIds)]
    : undefined;
  let remaining =
    input.maxQuantity && input.maxQuantity > 0
      ? input.maxQuantity
      : Number.POSITIVE_INFINITY;
  const sourceRows = await tx.inventoryItem.findMany({
    where: {
      currentOwnerId: input.ownerPlayerId,
      locationId: source.id,
      quantity: { gt: 0 },
      ...(distinctCardIds?.length ? { cardId: { in: distinctCardIds } } : {}),
    },
    include: { card: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const destinationRows = await tx.inventoryItem.findMany({
    where: {
      currentOwnerId: input.ownerPlayerId,
      locationId: destination.id,
      quantity: { gt: 0 },
    },
  });
  const destinationByKey = new Map<string, DeckInventoryRow>(
    destinationRows.map((row) => [moveKey(row), row as DeckInventoryRow]),
  );
  const reason =
    input.reason ??
    `Returned committed inventory from deck “${input.deckName}” to ${destination.name}.`;
  let movedEntries = 0;
  let movedCards = 0;
  const affectedCardIds = new Set<string>();

  for (const item of sourceRows) {
    if (remaining <= 0) break;
    const quantityToMove = Math.min(item.quantity, remaining);
    if (quantityToMove <= 0) continue;
    remaining -= quantityToMove;
    movedEntries += 1;
    movedCards += quantityToMove;
    affectedCardIds.add(item.cardId);

    const sourceBefore = itemSnapshot(item, {
      deckId: input.deckId,
      deckName: input.deckName,
      sourceDeckLocationId: source.id,
      sourceDeckLocationName: source.name,
      destinationLocationId: destination.id,
      destinationLocationName: destination.name,
      quantityMoved: quantityToMove,
      context: input.mode,
    });
    const matching = destinationByKey.get(moveKey(item));
    if (matching) {
      await tx.inventoryItem.update({
        where: { id: matching.id },
        data: { quantity: { increment: quantityToMove } },
      });
      if (quantityToMove === item.quantity) {
        await tx.inventoryItem.delete({ where: { id: item.id } });
      } else {
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { quantity: { decrement: quantityToMove } },
        });
      }
      await tx.inventoryAuditLog.createMany({
        data: [
          {
            inventoryItemId: item.id,
            changedByUserId: input.actorUserId,
            changeType: input.mode,
            beforeJson: sourceBefore,
            afterJson: {
              ...sourceBefore,
              quantity: item.quantity - quantityToMove,
              deleted: quantityToMove === item.quantity,
            },
            reason,
          },
          {
            inventoryItemId: matching.id,
            changedByUserId: input.actorUserId,
            changeType: input.mode,
            beforeJson: itemSnapshot(matching as DeckInventoryRow, {
              deckId: input.deckId,
              deckName: input.deckName,
              sourceDeckLocationId: source.id,
              sourceDeckLocationName: source.name,
              destinationLocationId: destination.id,
              destinationLocationName: destination.name,
              quantityMoved: quantityToMove,
              mergedSourceInventoryItemId: item.id,
              context: input.mode,
            }),
            afterJson: itemSnapshot(
              {
                ...(matching as DeckInventoryRow),
                quantity: matching.quantity + quantityToMove,
              },
              {
                deckId: input.deckId,
                deckName: input.deckName,
                sourceDeckLocationId: source.id,
                sourceDeckLocationName: source.name,
                destinationLocationId: destination.id,
                destinationLocationName: destination.name,
                quantityMoved: quantityToMove,
                mergedSourceInventoryItemId: item.id,
                context: input.mode,
              },
            ),
            reason,
          },
        ],
      });
    } else if (quantityToMove === item.quantity) {
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { locationId: destination.id },
      });
      await tx.inventoryAuditLog.create({
        data: {
          inventoryItemId: item.id,
          changedByUserId: input.actorUserId,
          changeType: input.mode,
          beforeJson: sourceBefore,
          afterJson: {
            ...sourceBefore,
            locationId: destination.id,
            sourceDeckLocationId: source.id,
            sourceDeckLocationName: source.name,
            destinationLocationId: destination.id,
            destinationLocationName: destination.name,
          },
          reason,
        },
      });
      destinationByKey.set(moveKey(item), {
        ...item,
        locationId: destination.id,
      });
    } else {
      const created = await tx.inventoryItem.create({
        data: {
          currentOwnerId: item.currentOwnerId,
          originalOpenerId: item.originalOpenerId,
          cardId: item.cardId,
          quantity: quantityToMove,
          foil: item.foil,
          foilStatus: item.foilStatus as any,
          sourceType: item.sourceType as any,
          condition: item.condition,
          locationId: destination.id,
          language: item.language,
          acquiredFromPullId: item.acquiredFromPullId,
          roundId: item.roundId,
          notes: item.notes,
        },
      });
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { decrement: quantityToMove } },
      });
      await tx.inventoryAuditLog.createMany({
        data: [
          {
            inventoryItemId: item.id,
            changedByUserId: input.actorUserId,
            changeType: input.mode,
            beforeJson: sourceBefore,
            afterJson: {
              ...sourceBefore,
              quantity: item.quantity - quantityToMove,
            },
            reason,
          },
          {
            inventoryItemId: created.id,
            changedByUserId: input.actorUserId,
            changeType: input.mode,
            beforeJson: {
              createdFromDeckInventoryItemId: item.id,
              quantity: 0,
            },
            afterJson: itemSnapshot(created as DeckInventoryRow, {
              deckId: input.deckId,
              deckName: input.deckName,
              sourceDeckLocationId: source.id,
              sourceDeckLocationName: source.name,
              destinationLocationId: destination.id,
              destinationLocationName: destination.name,
              quantityMoved: quantityToMove,
              context: input.mode,
            }),
            reason,
          },
        ],
      });
      destinationByKey.set(moveKey(item), created as DeckInventoryRow);
    }
  }

  return {
    movedEntries,
    movedCards,
    skippedEntries: Math.max(0, sourceRows.length - movedEntries),
    sourceLocationId: source.id,
    sourceLocationName: source.name,
    destinationLocationId: destination.id,
    destinationLocationName: destination.name,
    affectedCardIds: [...affectedCardIds],
  };
}

export async function returnCommittedInventoryFromDeck(
  prisma: PrismaClient,
  input: Parameters<typeof returnCommittedInventoryFromDeckTx>[1],
) {
  return prisma.$transaction((tx) =>
    returnCommittedInventoryFromDeckTx(tx, input),
  );
}
