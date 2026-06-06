import { InventoryItem, PrismaClient } from "@prisma/client";

export function normalizeLocationName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function assertValidLocationName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Location name is required.");
  if (!/^[\p{L}\p{N} _-]+$/u.test(trimmed))
    throw new Error(
      "Location names may contain letters, numbers, spaces, hyphens, and underscores.",
    );
  return trimmed.replace(/\s+/g, " ");
}

export async function ensureDefaultLocation(
  prisma: PrismaClient,
  ownerPlayerId: string,
) {
  const existing = await prisma.inventoryLocation.findUnique({
    where: {
      ownerPlayerId_normalizedName: {
        ownerPlayerId,
        normalizedName: "unassigned",
      },
    },
  });
  if (existing) return existing;
  return prisma.inventoryLocation.create({
    data: {
      ownerPlayerId,
      name: "Unassigned",
      normalizedName: "unassigned",
      description:
        "Default location for inventory without a known physical location.",
      type: "Unassigned",
      active: true,
    },
  });
}

export async function getLocationsForOwner(
  prisma: PrismaClient,
  ownerPlayerId: string,
) {
  await ensureDefaultLocation(prisma, ownerPlayerId);
  return prisma.inventoryLocation.findMany({
    where: { ownerPlayerId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function createLocation(
  prisma: PrismaClient,
  input: {
    ownerPlayerId: string;
    name: string;
    description?: string | null;
    type?: string | null;
  },
) {
  const name = assertValidLocationName(input.name);
  const normalizedName = normalizeLocationName(name);
  const duplicate = await prisma.inventoryLocation.findUnique({
    where: {
      ownerPlayerId_normalizedName: {
        ownerPlayerId: input.ownerPlayerId,
        normalizedName,
      },
    },
  });
  if (duplicate)
    throw new Error(`Location “${name}” already exists for this owner.`);
  return prisma.inventoryLocation.create({
    data: {
      ownerPlayerId: input.ownerPlayerId,
      name,
      normalizedName,
      description: input.description?.trim() || null,
      type: input.type?.trim() || null,
      active: true,
    },
  });
}

export async function updateLocation(
  prisma: PrismaClient,
  input: {
    id: string;
    ownerPlayerId: string;
    name: string;
    description?: string | null;
    type?: string | null;
    active?: boolean;
  },
) {
  const name = assertValidLocationName(input.name);
  const normalizedName = normalizeLocationName(name);
  const duplicate = await prisma.inventoryLocation.findFirst({
    where: {
      ownerPlayerId: input.ownerPlayerId,
      normalizedName,
      id: { not: input.id },
    },
  });
  if (duplicate)
    throw new Error(`Location “${name}” already exists for this owner.`);
  return prisma.inventoryLocation.update({
    where: { id: input.id },
    data: {
      name,
      normalizedName,
      description: input.description?.trim() || null,
      type: input.type?.trim() || null,
      active: input.active ?? true,
    },
  });
}

export async function deleteUnusedLocation(
  prisma: PrismaClient,
  locationId: string,
) {
  const count = await prisma.inventoryItem.count({
    where: { locationId, quantity: { gt: 0 } },
  });
  if (count > 0)
    throw new Error(
      "This location still contains inventory. Move or remove those cards before deleting it.",
    );
  return prisma.inventoryLocation.delete({ where: { id: locationId } });
}

type InventoryWithCardLocation = InventoryItem & {
  card: {
    id: string;
    name: string;
    oracleId: string | null;
    setCode: string;
    setName: string | null;
    collectorNumber: string;
    rarity: string;
    imageUri: string | null;
    imageUris: unknown;
    typeLine: string;
  };
  location: { id: string; name: string; type: string | null } | null;
  currentOwner?: { displayName: string; color: string };
};

export function locationSummary(
  parts: Array<{ name: string; quantity: number }>,
) {
  if (!parts.length) return "Unassigned";
  if (parts.length <= 2)
    return parts.map((p) => `${p.name}: ${p.quantity}`).join(" · ");
  const total = parts.reduce((sum, p) => sum + p.quantity, 0);
  return `${total} copies in ${parts.length} locations`;
}

export function getInventoryExactPrintings<T extends InventoryWithCardLocation>(
  items: T[],
) {
  const groups = new Map<
    string,
    T & {
      sourceItemIds: string[];
      locationBreakdown: Array<{
        locationId: string | null;
        name: string;
        quantity: number;
      }>;
      locationSummary: string;
    }
  >();
  for (const item of items) {
    const key = [
      item.currentOwnerId,
      item.cardId,
      item.foilStatus,
      item.condition,
      item.language,
    ].join("|");
    const loc = {
      locationId: item.locationId ?? null,
      name: item.location?.name ?? "Unassigned",
      quantity: item.quantity,
    };
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...item,
        sourceItemIds: [item.id],
        quantity: item.quantity,
        locationBreakdown: [loc],
        locationSummary: loc.name + ": " + loc.quantity,
      });
    } else {
      existing.quantity += item.quantity;
      existing.sourceItemIds.push(item.id);
      const prev = existing.locationBreakdown.find(
        (p) => p.locationId === loc.locationId,
      );
      if (prev) prev.quantity += loc.quantity;
      else existing.locationBreakdown.push(loc);
      existing.locationSummary = locationSummary(existing.locationBreakdown);
    }
  }
  return Array.from(groups.values()).map((row) => ({
    ...row,
    locationSummary: locationSummary(row.locationBreakdown),
  }));
}

export function normalizedCardGroupKey(card: {
  oracleId?: string | null;
  name: string;
}) {
  return (
    card.oracleId ||
    `name:${card.name.trim().toLowerCase().replace(/\s+/g, " ")}`
  );
}

export function getInventoryGroupedByCard<
  T extends ReturnType<typeof getInventoryExactPrintings>[number],
>(exactRows: T[]) {
  const groups = new Map<
    string,
    {
      id: string;
      cardName: string;
      representative: T;
      quantity: number;
      printingCount: number;
      locationCount: number;
      printings: T[];
    }
  >();
  for (const row of exactRows) {
    const key = normalizedCardGroupKey(row.card);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        id: `group:${key}`,
        cardName: row.card.name,
        representative: row,
        quantity: row.quantity,
        printingCount: 1,
        locationCount: new Set(
          row.locationBreakdown.map((l) => l.locationId ?? l.name),
        ).size,
        printings: [row],
      });
    } else {
      existing.quantity += row.quantity;
      existing.printings.push(row);
      existing.printingCount = existing.printings.length;
      existing.locationCount = new Set(
        existing.printings.flatMap((p) =>
          p.locationBreakdown.map((l) => l.locationId ?? l.name),
        ),
      ).size;
    }
  }
  return Array.from(groups.values());
}

export async function moveInventoryQuantity(
  prisma: PrismaClient,
  input: {
    inventoryItemId: string;
    fromLocationId: string | null;
    toLocationId: string;
    quantity: number;
  },
) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0)
    throw new Error("Quantity must be positive.");
  return prisma.$transaction(async (tx) => {
    const source = await tx.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
    });
    if (!source) throw new Error("Inventory item not found.");
    if (source.locationId !== input.fromLocationId)
      throw new Error("Source location no longer matches.");
    if (source.quantity < input.quantity)
      throw new Error("Cannot move more cards than this location contains.");
    const matching = await tx.inventoryItem.findFirst({
      where: {
        id: { not: source.id },
        currentOwnerId: source.currentOwnerId,
        originalOpenerId: source.originalOpenerId,
        cardId: source.cardId,
        foil: source.foil,
        foilStatus: source.foilStatus,
        condition: source.condition,
        language: source.language,
        roundId: source.roundId,
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
        return matching.id;
      }
      await tx.inventoryItem.update({
        where: { id: source.id },
        data: { locationId: input.toLocationId },
      });
      return source.id;
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
      return matching.id;
    }
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...copy
    } = source;
    const created = await tx.inventoryItem.create({
      data: {
        ...copy,
        quantity: input.quantity,
        locationId: input.toLocationId,
      },
    });
    return created.id;
  });
}

export type BulkMoveInventoryResult = {
  movedEntries: number;
  movedCards: number;
  skippedEntries: number;
  destinationLocationName: string;
  sourceLocationName?: string;
};

export async function bulkMoveInventoryToLocation(
  prisma: PrismaClient,
  input: {
    actorUserId: string;
    destinationLocationId: string;
    itemIds?: string[];
    where?: Record<string, unknown>;
    allowedOwnerId?: string;
    sourceLocationId?: string;
    reason?: string;
  },
): Promise<BulkMoveInventoryResult> {
  if (!input.destinationLocationId)
    throw new Error("Destination location is required.");
  if (!input.itemIds?.length && !input.where)
    throw new Error("Select inventory to move first.");

  return prisma.$transaction(async (tx) => {
    const destination = await tx.inventoryLocation.findUnique({
      where: { id: input.destinationLocationId },
    });
    if (!destination) throw new Error("Destination location not found.");
    if (
      input.allowedOwnerId &&
      destination.ownerPlayerId !== input.allowedOwnerId
    ) {
      throw new Error(
        "Destination location does not belong to your inventory.",
      );
    }
    if (input.sourceLocationId && input.sourceLocationId === destination.id) {
      throw new Error("Source and destination locations must be different.");
    }

    const sourceLocation = input.sourceLocationId
      ? await tx.inventoryLocation.findUnique({
          where: { id: input.sourceLocationId },
        })
      : null;
    if (input.sourceLocationId && !sourceLocation)
      throw new Error("Source location not found.");
    if (
      sourceLocation &&
      sourceLocation.ownerPlayerId !== destination.ownerPlayerId
    ) {
      throw new Error(
        "Source and destination locations must belong to the same owner.",
      );
    }

    const itemWhere: any = input.itemIds?.length
      ? { id: { in: input.itemIds } }
      : { ...(input.where ?? {}) };
    itemWhere.quantity = { gt: 0 };
    if (input.sourceLocationId) itemWhere.locationId = input.sourceLocationId;
    if (input.allowedOwnerId) itemWhere.currentOwnerId = input.allowedOwnerId;

    const items = await tx.inventoryItem.findMany({
      where: itemWhere,
      include: { location: true, card: true },
      orderBy: { createdAt: "asc" },
    });
    if (input.itemIds?.length && items.length !== new Set(input.itemIds).size) {
      throw new Error(
        "Some selected inventory entries are no longer available or are not authorized.",
      );
    }
    if (!items.length)
      throw new Error("No matching inventory entries were found to move.");

    let movedEntries = 0;
    let movedCards = 0;
    let skippedEntries = 0;
    const reason = input.reason || `Bulk move to ${destination.name}.`;

    for (const item of items) {
      if (item.currentOwnerId !== destination.ownerPlayerId) {
        throw new Error(
          "All moved inventory must belong to the destination location owner.",
        );
      }
      if (item.locationId === destination.id) {
        skippedEntries += 1;
        continue;
      }
      const quantityToMove = item.quantity;
      if (quantityToMove <= 0)
        throw new Error("Inventory quantity must be positive.");

      const matching = await tx.inventoryItem.findFirst({
        where: {
          id: { not: item.id },
          currentOwnerId: item.currentOwnerId,
          originalOpenerId: item.originalOpenerId,
          cardId: item.cardId,
          foil: item.foil,
          foilStatus: item.foilStatus,
          condition: item.condition,
          language: item.language,
          roundId: item.roundId,
          locationId: destination.id,
          quantity: { gt: 0 },
        },
      });

      const beforeJson = {
        ...item,
        sourceLocationId: item.locationId,
        sourceLocationName: item.location?.name ?? "Unassigned",
        destinationLocationId: destination.id,
        destinationLocationName: destination.name,
        quantityMoved: quantityToMove,
      } as any;

      if (matching) {
        const matchingBefore = {
          ...matching,
          destinationLocationId: destination.id,
          destinationLocationName: destination.name,
          quantityMoved: quantityToMove,
        } as any;
        const updatedDestination = await tx.inventoryItem.update({
          where: { id: matching.id },
          data: { quantity: { increment: quantityToMove } },
        });
        await tx.inventoryAuditLog.create({
          data: {
            inventoryItemId: updatedDestination.id,
            changedByUserId: input.actorUserId,
            changeType: "bulk_location_move_received",
            beforeJson: matchingBefore,
            afterJson: {
              ...updatedDestination,
              destinationLocationId: destination.id,
              destinationLocationName: destination.name,
              quantityMoved: quantityToMove,
            } as any,
            reason,
          },
        });
        await tx.inventoryAuditLog.create({
          data: {
            inventoryItemId: item.id,
            changedByUserId: input.actorUserId,
            changeType: "bulk_location_move_merged_source",
            beforeJson,
            afterJson: { ...beforeJson, quantity: 0, deleted: true },
            reason,
          },
        });
        await tx.inventoryItem.delete({ where: { id: item.id } });
      } else {
        const updated = await tx.inventoryItem.update({
          where: { id: item.id },
          data: { locationId: destination.id },
        });
        await tx.inventoryAuditLog.create({
          data: {
            inventoryItemId: updated.id,
            changedByUserId: input.actorUserId,
            changeType: "bulk_location_move",
            beforeJson,
            afterJson: {
              ...updated,
              sourceLocationId: item.locationId,
              sourceLocationName: item.location?.name ?? "Unassigned",
              destinationLocationId: destination.id,
              destinationLocationName: destination.name,
              quantityMoved: quantityToMove,
            } as any,
            reason,
          },
        });
      }
      movedEntries += 1;
      movedCards += quantityToMove;
    }

    return {
      movedEntries,
      movedCards,
      skippedEntries,
      destinationLocationName: destination.name,
      sourceLocationName: sourceLocation?.name,
    };
  });
}
