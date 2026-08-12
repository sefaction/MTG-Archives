import {
  FoilStatus,
  InventoryItem,
  InventoryLocationKind,
  InventorySourceType,
  Visibility,
  Prisma,
  PrismaClient,
  TradeStatus,
} from "@prisma/client";
import {
  equivalentInventoryConditions,
  normalizeInventoryCondition,
} from "./inventory-condition";

export function normalizeLocationName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export type LocationPathNode = {
  id: string;
  name: string;
  parentLocationId?: string | null;
};

export function buildLocationPathMap(locations: LocationPathNode[]) {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const paths = new Map<string, string>();
  const resolving = new Set<string>();

  function resolve(location: LocationPathNode): string {
    const cached = paths.get(location.id);
    if (cached) return cached;
    if (resolving.has(location.id)) return location.name;
    resolving.add(location.id);
    const parent = location.parentLocationId
      ? byId.get(location.parentLocationId)
      : undefined;
    const path = parent
      ? `${resolve(parent)} / ${location.name}`
      : location.name;
    resolving.delete(location.id);
    paths.set(location.id, path);
    return path;
  }

  locations.forEach(resolve);
  return paths;
}

export function withLocationPaths<T extends LocationPathNode>(locations: T[]) {
  const paths = buildLocationPathMap(locations);
  return locations
    .map((location) => ({
      ...location,
      path: paths.get(location.id) ?? location.name,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export type LocationTreeNode<T extends LocationPathNode> = T & {
  children: LocationTreeNode<T>[];
};

export function buildLocationTree<T extends LocationPathNode>(locations: T[]) {
  const nodes = new Map<string, LocationTreeNode<T>>(
    locations.map((location) => [location.id, { ...location, children: [] }]),
  );
  const roots: LocationTreeNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentLocationId
      ? nodes.get(node.parentLocationId)
      : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (values: LocationTreeNode<T>[]) => {
    values.sort((left, right) => left.name.localeCompare(right.name));
    values.forEach((value) => sortNodes(value.children));
  };
  sortNodes(roots);
  return roots;
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
  prisma: PrismaClient | Prisma.TransactionClient,
  ownerPlayerId: string,
) {
  const existing = await prisma.inventoryLocation.findFirst({
    where: {
      ownerPlayerId,
      parentLocationId: null,
      normalizedName: "unassigned",
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
      visibility: Visibility.INHERIT,
    },
  });
}

export async function getLocationsForOwner(
  prisma: PrismaClient,
  ownerPlayerId: string,
) {
  await ensureDefaultLocation(prisma, ownerPlayerId);
  const locations = await prisma.inventoryLocation.findMany({
    where: { ownerPlayerId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return withLocationPaths(locations);
}

async function assertValidLocationParent(
  prisma: PrismaClient,
  input: {
    ownerPlayerId: string;
    parentLocationId?: string | null;
    locationId?: string;
  },
) {
  const parentLocationId = input.parentLocationId || null;
  if (!parentLocationId) return null;
  if (parentLocationId === input.locationId)
    throw new Error("A location cannot be its own parent.");

  const ownerLocations = await prisma.inventoryLocation.findMany({
    where: { ownerPlayerId: input.ownerPlayerId },
    select: {
      id: true,
      parentLocationId: true,
      normalizedName: true,
      kind: true,
      systemManaged: true,
      active: true,
    },
  });
  const byId = new Map(
    ownerLocations.map((location) => [location.id, location]),
  );
  const parent = byId.get(parentLocationId);
  if (!parent) throw new Error("Parent location not found for this owner.");
  if (
    parent.kind !== InventoryLocationKind.NORMAL ||
    parent.systemManaged ||
    parent.normalizedName === "unassigned"
  ) {
    throw new Error("Choose an ordinary inventory location as the parent.");
  }
  if (!parent.active)
    throw new Error("An inactive location cannot be a parent.");

  const visited = new Set<string>();
  let current: typeof parent | undefined = parent;
  while (current) {
    if (current.id === input.locationId)
      throw new Error(
        "A location cannot be moved beneath one of its descendants.",
      );
    if (visited.has(current.id))
      throw new Error("The location hierarchy contains a cycle.");
    visited.add(current.id);
    current = current.parentLocationId
      ? byId.get(current.parentLocationId)
      : undefined;
  }
  return parentLocationId;
}

export async function createLocation(
  prisma: PrismaClient,
  input: {
    ownerPlayerId: string;
    name: string;
    parentLocationId?: string | null;
    description?: string | null;
    type?: string | null;
    visibility?: Visibility;
  },
) {
  const name = assertValidLocationName(input.name);
  if (name.toLowerCase().startsWith("deck:")) {
    throw new Error(
      "Deck locations are system-managed. Commit cards from a deck page instead.",
    );
  }
  const parentLocationId = await assertValidLocationParent(prisma, input);
  const normalizedName = normalizeLocationName(name);
  const duplicate = await prisma.inventoryLocation.findFirst({
    where: {
      ownerPlayerId: input.ownerPlayerId,
      parentLocationId,
      normalizedName,
    },
  });
  if (duplicate)
    throw new Error(`Location “${name}” already exists at this level.`);
  return prisma.inventoryLocation.create({
    data: {
      ownerPlayerId: input.ownerPlayerId,
      parentLocationId,
      name,
      normalizedName,
      description: input.description?.trim() || null,
      type: input.type?.trim() || null,
      active: true,
      visibility: input.visibility ?? Visibility.INHERIT,
    },
  });
}

export async function updateLocation(
  prisma: PrismaClient,
  input: {
    id: string;
    ownerPlayerId: string;
    name: string;
    parentLocationId?: string | null;
    description?: string | null;
    type?: string | null;
    active?: boolean;
    visibility?: Visibility;
  },
) {
  const name = assertValidLocationName(input.name);
  const normalizedName = normalizeLocationName(name);
  const existing = await prisma.inventoryLocation.findFirst({
    where: { id: input.id, ownerPlayerId: input.ownerPlayerId },
  });
  if (!existing) throw new Error("Location not found.");
  if (existing.systemManaged || existing.kind === InventoryLocationKind.DECK) {
    throw new Error(
      "Deck locations are system-managed and cannot be edited here.",
    );
  }
  if (input.active === false) {
    const activeChildCount = await prisma.inventoryLocation.count({
      where: { parentLocationId: input.id, active: true },
    });
    if (activeChildCount > 0)
      throw new Error(
        "Move or deactivate this location's active sub-locations first.",
      );
  }
  const parentLocationId =
    existing.normalizedName === "unassigned"
      ? null
      : await assertValidLocationParent(prisma, {
          ...input,
          locationId: input.id,
        });
  const duplicate = await prisma.inventoryLocation.findFirst({
    where: {
      ownerPlayerId: input.ownerPlayerId,
      parentLocationId,
      normalizedName,
      id: { not: input.id },
    },
  });
  if (duplicate)
    throw new Error(`Location “${name}” already exists at this level.`);
  return prisma.inventoryLocation.update({
    where: { id: input.id },
    data: {
      name,
      normalizedName,
      parentLocationId,
      description: input.description?.trim() || null,
      type: input.type?.trim() || null,
      active: input.active ?? true,
      visibility: input.visibility ?? Visibility.INHERIT,
    },
  });
}

export async function deleteUnusedLocation(
  prisma: PrismaClient,
  locationId: string,
) {
  const location = await prisma.inventoryLocation.findUnique({
    where: { id: locationId },
  });
  if (
    location?.systemManaged ||
    location?.kind === InventoryLocationKind.DECK
  ) {
    throw new Error(
      "Deck locations are system-managed and cannot be deleted here.",
    );
  }
  const count = await prisma.inventoryItem.count({
    where: { locationId, quantity: { gt: 0 } },
  });
  if (count > 0)
    throw new Error(
      "This location still contains inventory. Move or remove those cards before deleting it.",
    );
  const childCount = await prisma.inventoryLocation.count({
    where: { parentLocationId: locationId },
  });
  if (childCount > 0)
    throw new Error(
      "This location still contains sub-locations. Move or delete them before deleting it.",
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

export type InventoryLocationBreakdownEntry = {
  inventoryItemId?: string;
  locationId: string | null;
  name: string;
  section?: string | null;
  quantity: number;
  foilStatus?: string | null;
  condition?: string | null;
  language?: string | null;
  sourceType?: string | null;
  locationKind?: InventoryLocationKind | null;
  locationActive?: boolean | null;
  locationSystemManaged?: boolean | null;
};

export function locationSummary(
  parts: Array<{ name: string; section?: string | null; quantity: number }>,
) {
  if (!parts.length) return "Unassigned";
  if (parts.length <= 2)
    return parts
      .map(
        (p) => `${p.name}${p.section ? ` / ${p.section}` : ""}: ${p.quantity}`,
      )
      .join(" · ");
  const total = parts.reduce((sum, p) => sum + p.quantity, 0);
  return `${total} copies in ${parts.length} locations`;
}

export function normalizeLocationSection(value: unknown) {
  const section = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (section.length > 100) {
    throw new Error("Section must be 100 characters or fewer.");
  }
  return section || null;
}

type InventoryPageGroupLike = {
  currentOwnerId?: string | null;
  cardId: string;
  cardIds?: string[];
  foilStatus?: string | null;
  condition?: string | null;
  language?: string | null;
};

type InventoryPageItemLike = InventoryPageGroupLike & {
  id?: string;
  createdAt?: Date | string;
};

export function inventoryPageGroupKey(
  value: InventoryPageGroupLike,
  displayMode: "exact" | "grouped",
  includeOwner = true,
) {
  if (displayMode === "grouped") return value.cardId;
  return [
    ...(includeOwner ? [value.currentOwnerId ?? ""] : []),
    value.cardId,
    value.foilStatus ?? "",
    normalizeInventoryCondition(value.condition),
    value.language ?? "",
  ].join("|");
}

export function orderInventoryItemsByPageGroups<
  T extends InventoryPageItemLike,
>(
  items: T[],
  pageGroups: InventoryPageGroupLike[],
  displayMode: "exact" | "grouped",
) {
  const includeOwner = pageGroups.some((group) => group.currentOwnerId);
  const groupOrder = new Map<string, number>();
  pageGroups.forEach((group, index) => {
    if (displayMode === "grouped" && group.cardIds?.length) {
      group.cardIds.forEach((cardId) => groupOrder.set(cardId, index));
      return;
    }
    groupOrder.set(
      inventoryPageGroupKey(group, displayMode, includeOwner),
      index,
    );
  });
  return [...items].sort((left, right) => {
    const leftOrder =
      groupOrder.get(inventoryPageGroupKey(left, displayMode, includeOwner)) ??
      Number.MAX_SAFE_INTEGER;
    const rightOrder =
      groupOrder.get(inventoryPageGroupKey(right, displayMode, includeOwner)) ??
      Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreated = right.createdAt
      ? new Date(right.createdAt).getTime()
      : 0;
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;
    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

export function getInventoryExactPrintings<T extends InventoryWithCardLocation>(
  items: T[],
) {
  const groups = new Map<
    string,
    T & {
      sourceItemIds: string[];
      locationBreakdown: InventoryLocationBreakdownEntry[];
      locationSummary: string;
    }
  >();
  for (const item of items) {
    const normalizedCondition = normalizeInventoryCondition(item.condition);
    const key = [
      item.currentOwnerId,
      item.cardId,
      item.foilStatus,
      normalizedCondition,
      item.language,
    ].join("|");
    const loc = {
      inventoryItemId: item.id,
      locationId: item.locationId ?? null,
      name: item.location?.name ?? "Unassigned",
      section: item.locationSection ?? null,
      quantity: item.quantity,
      foilStatus: item.foilStatus,
      condition: normalizedCondition,
      language: item.language,
      sourceType: item.sourceType,
      locationKind: (item.location as any)?.kind ?? null,
      locationActive: (item.location as any)?.active ?? null,
      locationSystemManaged: (item.location as any)?.systemManaged ?? null,
    };
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...item,
        condition: normalizedCondition,
        sourceItemIds: [item.id],
        quantity: item.quantity,
        locationBreakdown: [loc],
        locationSummary: loc.name + ": " + loc.quantity,
      });
    } else {
      existing.quantity += item.quantity;
      existing.sourceItemIds.push(item.id);
      existing.locationBreakdown.push(loc);
      existing.locationSummary = locationSummary(
        aggregateLocationBreakdown(existing.locationBreakdown),
      );
    }
  }
  return Array.from(groups.values()).map((row) => ({
    ...row,
    locationSummary: locationSummary(
      aggregateLocationBreakdown(row.locationBreakdown),
    ),
  }));
}

function aggregateLocationBreakdown(
  parts: Array<{
    locationId: string | null;
    name: string;
    section?: string | null;
    quantity: number;
  }>,
) {
  const byLocation = new Map<
    string,
    { name: string; section?: string | null; quantity: number }
  >();
  for (const part of parts) {
    const key = `${part.locationId ?? `name:${part.name}`}\u001f${part.section ?? ""}`;
    const existing = byLocation.get(key);
    if (existing) existing.quantity += part.quantity;
    else
      byLocation.set(key, {
        name: part.name,
        section: part.section,
        quantity: part.quantity,
      });
  }
  return Array.from(byLocation.values());
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

export function groupInventoryPageGroupsByCardName<
  T extends {
    cardId: string;
    _sum?: { quantity?: number | null };
    _count?: { _all?: number };
  },
>(
  groups: T[],
  cardById: Map<string, { oracleId?: string | null; name: string }>,
) {
  const grouped = new Map<
    string,
    T & {
      cardIds: string[];
      _sum: { quantity: number };
      _count: { _all: number };
    }
  >();
  for (const group of groups) {
    const card = cardById.get(group.cardId);
    if (!card) continue;
    const key = normalizedCardGroupKey(card);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...group,
        cardIds: [group.cardId],
        _sum: { quantity: group._sum?.quantity ?? 0 },
        _count: { _all: group._count?._all ?? 0 },
      });
      continue;
    }
    if (!existing.cardIds.includes(group.cardId)) {
      existing.cardIds.push(group.cardId);
    }
    existing._sum.quantity += group._sum?.quantity ?? 0;
    existing._count._all += group._count?._all ?? 0;
  }
  return Array.from(grouped.values());
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
    toLocationSection?: string | null;
    quantity: number;
  },
) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0)
    throw new Error("Quantity must be positive.");
  return prisma.$transaction(async (tx) => {
    const toLocationSection = normalizeLocationSection(input.toLocationSection);
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
        cardId: source.cardId,
        foil: source.foil,
        foilStatus: source.foilStatus,
        condition: {
          in: equivalentInventoryConditions(source.condition),
        },
        language: source.language,
        locationId: input.toLocationId,
        locationSection: toLocationSection,
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
        data: {
          locationId: input.toLocationId,
          locationSection: toLocationSection,
        },
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
        locationSection: toLocationSection,
      },
    });
    return created.id;
  });
}

export type MoveInventoryQuantityBetweenLocationsResult = {
  inventoryItemId: string;
  destinationInventoryItemId: string;
  auditInventoryItemId: string;
  cardName: string;
  sourceLocationName: string;
  destinationLocationName: string;
  quantityMoved: number;
  sourceBeforeQuantity: number;
  sourceAfterQuantity: number;
  destinationBeforeQuantity: number;
  destinationAfterQuantity: number;
  merged: boolean;
  sourceDeleted: boolean;
};

type InventoryStackMutationTarget = {
  cardId: string;
  locationId: string;
  locationSection?: string | null;
  quantity: number;
  foilStatus: string;
  condition: string;
  language: string;
  sourceType?: InventorySourceType;
  notes?: string | null;
};

function stackMergeWhere(
  source: InventoryItem,
  target: InventoryStackMutationTarget,
  exceptId: string,
) {
  return {
    id: { not: exceptId },
    currentOwnerId: source.currentOwnerId,
    cardId: target.cardId,
    foil: target.foilStatus !== FoilStatus.NONFOIL,
    foilStatus: target.foilStatus as FoilStatus,
    condition: {
      in: equivalentInventoryConditions(target.condition),
    },
    language: target.language,
    locationId: target.locationId,
    locationSection: normalizeLocationSection(target.locationSection),
    quantity: { gt: 0 },
  };
}

async function validateStackMutationTarget(
  tx: Prisma.TransactionClient,
  source: InventoryItem & {
    location: {
      id: string;
      name: string;
      ownerPlayerId: string;
      active: boolean;
      kind: InventoryLocationKind;
      systemManaged: boolean;
    } | null;
  },
  input: {
    allowedOwnerId?: string;
    targetOwnerId?: string;
    targetLocationId: string;
    quantity: number;
  },
) {
  if (input.allowedOwnerId && source.currentOwnerId !== input.allowedOwnerId) {
    throw new Error("You cannot manage this inventory item.");
  }
  if (
    source.location &&
    (source.location.kind === InventoryLocationKind.DECK ||
      source.location.systemManaged)
  ) {
    throw new Error(
      "Committed deck inventory must be changed with the deck return workflow.",
    );
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be a positive integer.");
  }

  const targetOwnerId = input.targetOwnerId || source.currentOwnerId;
  const targetLocation = await tx.inventoryLocation.findUnique({
    where: { id: input.targetLocationId },
    select: {
      id: true,
      ownerPlayerId: true,
      name: true,
      active: true,
      kind: true,
      systemManaged: true,
    },
  });
  if (!targetLocation) throw new Error("Selected location not found.");
  if (!targetLocation.active) throw new Error("Selected location is inactive.");
  if (
    targetLocation.kind !== InventoryLocationKind.NORMAL ||
    targetLocation.systemManaged
  ) {
    throw new Error(
      "Deck locations are system-managed. Use deck workflows for committed cards.",
    );
  }
  if (targetLocation.ownerPlayerId !== targetOwnerId) {
    throw new Error("Selected location does not belong to the current owner.");
  }
  if (targetLocation.ownerPlayerId !== source.currentOwnerId) {
    throw new Error("Stack edits must stay within the same inventory owner.");
  }
  return targetLocation;
}

export async function updateInventoryStack(
  prisma: PrismaClient,
  input: {
    inventoryItemId: string;
    actorUserId: string;
    allowedOwnerId?: string;
    target: InventoryStackMutationTarget;
    reason?: string | null;
  },
) {
  if (!input.inventoryItemId) throw new Error("Inventory item not found.");
  return prisma.$transaction(async (tx) => {
    const source = await tx.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            ownerPlayerId: true,
            active: true,
            kind: true,
            systemManaged: true,
          },
        },
      },
    });
    if (!source) throw new Error("Inventory item not found.");
    await validateStackMutationTarget(tx, source, {
      allowedOwnerId: input.allowedOwnerId,
      targetOwnerId: source.currentOwnerId,
      targetLocationId: input.target.locationId,
      quantity: input.target.quantity,
    });

    const matching = await tx.inventoryItem.findFirst({
      where: stackMergeWhere(source, input.target, source.id),
    });
    const normalizedCondition = normalizeInventoryCondition(
      input.target.condition,
    );
    const locationSection = normalizeLocationSection(
      input.target.locationSection,
    );
    const beforeJson = source as unknown as Prisma.InputJsonObject;
    if (matching) {
      const updatedDestination = await tx.inventoryItem.update({
        where: { id: matching.id },
        data: { quantity: { increment: input.target.quantity } },
      });
      await tx.inventoryAuditLog.create({
        data: {
          inventoryItemId: updatedDestination.id,
          changedByUserId: input.actorUserId,
          changeType: "inventory_stack_merged",
          beforeJson,
          afterJson: {
            ...(updatedDestination as unknown as Prisma.InputJsonObject),
            mergedSourceInventoryItemId: source.id,
            mergedQuantity: input.target.quantity,
          },
          reason: input.reason || "Inventory stack edited and merged.",
        },
      });
      await tx.inventoryItem.delete({ where: { id: source.id } });
      return {
        inventoryItemId: updatedDestination.id,
        merged: true,
        deletedSourceId: source.id,
      };
    }

    const updated = await tx.inventoryItem.update({
      where: { id: source.id },
      data: {
        cardId: input.target.cardId,
        quantity: input.target.quantity,
        foilStatus: input.target.foilStatus as FoilStatus,
        foil: input.target.foilStatus !== FoilStatus.NONFOIL,
        condition: normalizedCondition,
        language: input.target.language,
        locationId: input.target.locationId,
        locationSection,
        sourceType: input.target.sourceType ?? source.sourceType,
        notes: input.target.notes ?? null,
      },
    });
    await tx.inventoryAuditLog.create({
      data: {
        inventoryItemId: updated.id,
        changedByUserId: input.actorUserId,
        changeType: "inventory_stack_edited",
        beforeJson,
        afterJson: updated as unknown as Prisma.InputJsonObject,
        reason: input.reason || "Inventory stack edited.",
      },
    });
    return { inventoryItemId: updated.id, merged: false };
  });
}

export async function splitInventoryStack(
  prisma: PrismaClient,
  input: {
    inventoryItemId: string;
    actorUserId: string;
    allowedOwnerId?: string;
    target: InventoryStackMutationTarget;
    reason?: string | null;
  },
) {
  if (!input.inventoryItemId) throw new Error("Inventory item not found.");
  return prisma.$transaction(async (tx) => {
    const source = await tx.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            ownerPlayerId: true,
            active: true,
            kind: true,
            systemManaged: true,
          },
        },
      },
    });
    if (!source) throw new Error("Inventory item not found.");
    await validateStackMutationTarget(tx, source, {
      allowedOwnerId: input.allowedOwnerId,
      targetOwnerId: source.currentOwnerId,
      targetLocationId: input.target.locationId,
      quantity: input.target.quantity,
    });
    if (input.target.quantity >= source.quantity) {
      throw new Error("Split quantity must be less than the source stack.");
    }

    const matching = await tx.inventoryItem.findFirst({
      where: stackMergeWhere(source, input.target, source.id),
    });
    const normalizedCondition = normalizeInventoryCondition(
      input.target.condition,
    );
    const locationSection = normalizeLocationSection(
      input.target.locationSection,
    );
    const sourceAfterQuantity = source.quantity - input.target.quantity;
    const sourceAfter = await tx.inventoryItem.update({
      where: { id: source.id },
      data: { quantity: sourceAfterQuantity },
    });
    const destination = matching
      ? await tx.inventoryItem.update({
          where: { id: matching.id },
          data: { quantity: { increment: input.target.quantity } },
        })
      : await tx.inventoryItem.create({
          data: {
            currentOwnerId: source.currentOwnerId,
            originalOpenerId: source.originalOpenerId,
            cardId: input.target.cardId,
            quantity: input.target.quantity,
            foilStatus: input.target.foilStatus as FoilStatus,
            foil: input.target.foilStatus !== FoilStatus.NONFOIL,
            condition: normalizedCondition,
            language: input.target.language,
            locationId: input.target.locationId,
            locationSection,
            sourceType: input.target.sourceType ?? source.sourceType,
            acquiredFromPullId: source.acquiredFromPullId,
            roundId: source.roundId,
            notes: input.target.notes ?? null,
          },
        });

    const metadata = {
      splitSourceInventoryItemId: source.id,
      splitDestinationInventoryItemId: destination.id,
      splitQuantity: input.target.quantity,
      sourceBeforeQuantity: source.quantity,
      sourceAfterQuantity,
      destinationBeforeQuantity: matching?.quantity ?? 0,
      destinationAfterQuantity: destination.quantity,
      mergedIntoExistingDestination: Boolean(matching),
    };
    await tx.inventoryAuditLog.createMany({
      data: [
        {
          inventoryItemId: sourceAfter.id,
          changedByUserId: input.actorUserId,
          changeType: "inventory_stack_split_source",
          beforeJson: source as unknown as Prisma.InputJsonObject,
          afterJson: {
            ...(sourceAfter as unknown as Prisma.InputJsonObject),
            ...metadata,
          },
          reason: input.reason || "Inventory stack split.",
        },
        {
          inventoryItemId: destination.id,
          changedByUserId: input.actorUserId,
          changeType: matching
            ? "inventory_stack_split_merged_destination"
            : "inventory_stack_split_destination",
          beforeJson: {
            ...(matching as unknown as Prisma.InputJsonObject),
            ...metadata,
          },
          afterJson: {
            ...(destination as unknown as Prisma.InputJsonObject),
            ...metadata,
          },
          reason: input.reason || "Inventory stack split.",
        },
      ],
    });
    return {
      sourceInventoryItemId: sourceAfter.id,
      destinationInventoryItemId: destination.id,
      splitQuantity: input.target.quantity,
      merged: Boolean(matching),
    };
  });
}

export async function moveInventoryQuantityBetweenLocations(
  prisma: PrismaClient,
  input: {
    inventoryItemId: string;
    destinationLocationId: string;
    destinationLocationSection?: string | null;
    quantity: number;
    actorUserId: string;
    allowedOwnerId?: string;
    reason?: string;
  },
): Promise<MoveInventoryQuantityBetweenLocationsResult> {
  if (!input.inventoryItemId) throw new Error("Inventory item not found.");
  if (!input.destinationLocationId)
    throw new Error("Destination location is required.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be positive.");
  }

  return prisma.$transaction(async (tx) => {
    const source = await tx.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      include: {
        card: { select: { name: true } },
        location: {
          select: {
            id: true,
            name: true,
            ownerPlayerId: true,
            active: true,
            kind: true,
            systemManaged: true,
          },
        },
      },
    });
    if (!source) throw new Error("Inventory item not found.");
    if (source.quantity <= 0) throw new Error("Inventory stack is empty.");
    if (
      input.allowedOwnerId &&
      source.currentOwnerId !== input.allowedOwnerId
    ) {
      throw new Error("You cannot manage this inventory item.");
    }
    const destinationLocationSection = normalizeLocationSection(
      input.destinationLocationSection,
    );
    if (
      source.locationId === input.destinationLocationId &&
      normalizeLocationSection(source.locationSection) ===
        destinationLocationSection
    ) {
      throw new Error("Cannot move cards to the same location and section.");
    }
    if (
      source.location &&
      (source.location.kind === InventoryLocationKind.DECK ||
        source.location.systemManaged)
    ) {
      throw new Error(
        "Committed deck inventory must be moved with the deck return workflow.",
      );
    }
    if (source.quantity < input.quantity) {
      throw new Error("Cannot move more copies than this stack contains.");
    }

    const destination = await tx.inventoryLocation.findUnique({
      where: { id: input.destinationLocationId },
      select: {
        id: true,
        ownerPlayerId: true,
        name: true,
        active: true,
        kind: true,
        systemManaged: true,
      },
    });
    if (!destination) throw new Error("Destination location not found.");
    if (!destination.active)
      throw new Error("Destination location is inactive.");
    if (
      destination.kind !== InventoryLocationKind.NORMAL ||
      destination.systemManaged
    ) {
      throw new Error(
        "Deck locations are system-managed. Use deck commit actions to move cards into a deck.",
      );
    }
    if (destination.ownerPlayerId !== source.currentOwnerId) {
      throw new Error("Destination location does not belong to this owner.");
    }
    if (
      source.location &&
      source.location.ownerPlayerId !== destination.ownerPlayerId
    ) {
      throw new Error(
        "Source and destination locations must belong to the same owner.",
      );
    }

    const matching = await tx.inventoryItem.findFirst({
      where: {
        id: { not: source.id },
        currentOwnerId: source.currentOwnerId,
        cardId: source.cardId,
        foil: source.foil,
        foilStatus: source.foilStatus,
        condition: {
          in: equivalentInventoryConditions(source.condition),
        },
        language: source.language,
        locationId: destination.id,
        locationSection: destinationLocationSection,
        quantity: { gt: 0 },
      },
    });

    const sourceBeforeQuantity = source.quantity;
    const destinationBeforeQuantity = matching?.quantity ?? 0;
    const sourceLocationName = source.location?.name ?? "Unassigned";
    const metadata: Prisma.InputJsonObject = {
      action: "moved_between_locations",
      cardName: source.card.name,
      quantityMoved: input.quantity,
      sourceLocationId: source.locationId,
      sourceLocationName,
      destinationLocationId: destination.id,
      destinationLocationName: destination.name,
      sourceLocationSection: source.locationSection,
      destinationLocationSection,
      sourceBeforeQuantity,
      destinationBeforeQuantity,
    };

    let destinationInventoryItemId = source.id;
    let auditInventoryItemId = source.id;
    let sourceAfterQuantity = 0;
    let destinationAfterQuantity = input.quantity;
    let merged = false;
    let sourceDeleted = false;

    if (source.quantity === input.quantity) {
      if (matching) {
        await tx.inventoryItem.update({
          where: { id: matching.id },
          data: { quantity: { increment: input.quantity } },
        });
        destinationInventoryItemId = matching.id;
        auditInventoryItemId = matching.id;
        destinationAfterQuantity = matching.quantity + input.quantity;
        merged = true;
        sourceDeleted = true;
      } else {
        await tx.inventoryItem.update({
          where: { id: source.id },
          data: {
            locationId: destination.id,
            locationSection: destinationLocationSection,
          },
        });
        destinationAfterQuantity = source.quantity;
      }
    } else {
      await tx.inventoryItem.update({
        where: { id: source.id },
        data: { quantity: { decrement: input.quantity } },
      });
      sourceAfterQuantity = source.quantity - input.quantity;
      if (matching) {
        await tx.inventoryItem.update({
          where: { id: matching.id },
          data: { quantity: { increment: input.quantity } },
        });
        destinationInventoryItemId = matching.id;
        destinationAfterQuantity = matching.quantity + input.quantity;
        merged = true;
      } else {
        const {
          id: _id,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          card: _card,
          location: _location,
          ...copy
        } = source;
        const created = await tx.inventoryItem.create({
          data: {
            ...copy,
            quantity: input.quantity,
            locationId: destination.id,
            locationSection: destinationLocationSection,
          },
        });
        destinationInventoryItemId = created.id;
        auditInventoryItemId = created.id;
      }
    }

    const beforeJson: Prisma.InputJsonObject = {
      inventoryItemId: source.id,
      currentOwnerId: source.currentOwnerId,
      originalOpenerId: source.originalOpenerId,
      cardId: source.cardId,
      foil: source.foil,
      foilStatus: source.foilStatus,
      condition: source.condition,
      language: source.language,
      sourceType: source.sourceType,
      acquiredFromPullId: source.acquiredFromPullId,
      roundId: source.roundId,
      locationId: source.locationId,
      quantity: source.quantity,
      notes: source.notes,
      ...metadata,
      sourceAfterQuantity,
      destinationAfterQuantity,
    };
    const afterJson: Prisma.InputJsonObject = {
      ...beforeJson,
      inventoryItemId: destinationInventoryItemId,
      locationId: destination.id,
      locationSection: destinationLocationSection,
      quantity: destinationAfterQuantity,
      merged,
      sourceDeleted,
    };

    await tx.inventoryAuditLog.create({
      data: {
        inventoryItemId: auditInventoryItemId,
        changedByUserId: input.actorUserId,
        changeType: "moved_between_locations",
        beforeJson,
        afterJson,
        reason:
          input.reason ||
          `Moved ${input.quantity} ${source.card.name} to ${destination.name}.`,
      },
    });

    if (sourceDeleted) {
      await tx.inventoryItem.delete({ where: { id: source.id } });
    }

    return {
      inventoryItemId: source.id,
      destinationInventoryItemId,
      auditInventoryItemId,
      cardName: source.card.name,
      sourceLocationName,
      destinationLocationName: destination.name,
      quantityMoved: input.quantity,
      sourceBeforeQuantity,
      sourceAfterQuantity,
      destinationBeforeQuantity,
      destinationAfterQuantity,
      merged,
      sourceDeleted,
    };
  });
}

export type BulkMoveInventoryResult = {
  movedEntries: number;
  movedCards: number;
  skippedEntries: number;
  destinationLocationName: string;
  sourceLocationName?: string;
};

export type BulkDeleteInventoryResult = {
  deletedEntries: number;
  deletedCards: number;
  inventoryEntriesTouched: number;
  locationQuantityRowsDeleted: number;
  parentInventoryRowsDeleted: number;
  physicalQuantityDeleted: number;
  scope: "selected" | "matching" | "location";
  locationName?: string;
};

const activeInventoryTradeStatuses: TradeStatus[] = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];

const AUDIT_LOG_CREATE_MANY_BATCH_SIZE = 500;
const BULK_MOVE_TRANSACTION_TIMEOUT_MS = 30_000;
const BULK_MOVE_TRANSACTION_MAX_WAIT_MS = 10_000;

type BulkMoveInventoryRow = Pick<
  InventoryItem,
  | "id"
  | "currentOwnerId"
  | "originalOpenerId"
  | "cardId"
  | "foil"
  | "foilStatus"
  | "condition"
  | "language"
  | "roundId"
  | "locationId"
  | "locationSection"
  | "quantity"
  | "sourceType"
  | "acquiredFromPullId"
  | "notes"
>;

type BulkMoveTiming = {
  startedAt: number;
  lastAt: number;
  marks: Record<string, number>;
};

function startBulkMoveTiming(): BulkMoveTiming {
  const now = Date.now();
  return { startedAt: now, lastAt: now, marks: {} };
}

function markBulkMoveTiming(timing: BulkMoveTiming, phase: string) {
  const now = Date.now();
  timing.marks[phase] = now - timing.lastAt;
  timing.lastAt = now;
}

function logBulkMoveTiming(
  phase: string,
  timing: BulkMoveTiming,
  context: Record<string, unknown>,
) {
  console.info("[bulk-location-move] timing", {
    phase,
    elapsedMs: Date.now() - timing.startedAt,
    marks: timing.marks,
    ...context,
  });
}

function inventoryMoveKey(item: BulkMoveInventoryRow) {
  return [
    item.currentOwnerId,
    item.cardId,
    String(item.foil),
    item.foilStatus,
    normalizeInventoryCondition(item.condition),
    item.language,
  ].join("\u001f");
}

function sourceLocationNameForAudit(
  item: BulkMoveInventoryRow,
  sourceLocation: { id: string; name: string } | null,
) {
  if (sourceLocation && item.locationId === sourceLocation.id)
    return sourceLocation.name;
  return item.locationId ? null : "Unassigned";
}

function auditSnapshot(
  item: BulkMoveInventoryRow,
  extra: Record<string, unknown> = {},
): Prisma.InputJsonObject {
  return {
    inventoryItemId: item.id,
    currentOwnerId: item.currentOwnerId,
    originalOpenerId: item.originalOpenerId,
    cardId: item.cardId,
    foil: item.foil,
    foilStatus: item.foilStatus,
    condition: item.condition,
    language: item.language,
    roundId: item.roundId,
    locationId: item.locationId,
    locationSection: item.locationSection,
    quantity: item.quantity,
    sourceType: item.sourceType,
    acquiredFromPullId: item.acquiredFromPullId,
    notes: item.notes,
    ...extra,
  };
}

function chunkArray<T>(values: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function bulkMoveInventoryToLocation(
  prisma: PrismaClient,
  input: {
    actorUserId: string;
    destinationLocationId: string;
    destinationLocationSection?: string | null;
    itemIds?: string[];
    where?: Record<string, unknown>;
    allowedOwnerId?: string;
    sourceLocationId?: string;
    reason?: string;
    allowSystemManagedDestination?: boolean;
    allowSystemManagedSource?: boolean;
  },
): Promise<BulkMoveInventoryResult> {
  if (!input.destinationLocationId)
    throw new Error("Destination location is required.");
  if (!input.itemIds?.length && !input.where)
    throw new Error("Select inventory to move first.");
  const destinationLocationSection = normalizeLocationSection(
    input.destinationLocationSection,
  );
  if (
    input.sourceLocationId &&
    input.sourceLocationId === input.destinationLocationId &&
    input.destinationLocationSection === undefined
  ) {
    throw new Error("Source and destination locations must be different.");
  }

  const timing = startBulkMoveTiming();
  const distinctItemIds = input.itemIds?.length
    ? Array.from(new Set(input.itemIds))
    : undefined;

  const destination = await prisma.inventoryLocation.findUnique({
    where: { id: input.destinationLocationId },
    select: {
      id: true,
      ownerPlayerId: true,
      name: true,
      kind: true,
      systemManaged: true,
    },
  });
  if (!destination) throw new Error("Destination location not found.");
  if (
    (destination.systemManaged ||
      destination.kind === InventoryLocationKind.DECK) &&
    !input.allowSystemManagedDestination
  ) {
    throw new Error(
      "Deck locations are system-managed. Use deck commit actions to move cards into a deck.",
    );
  }
  if (
    input.allowedOwnerId &&
    destination.ownerPlayerId !== input.allowedOwnerId
  ) {
    throw new Error("Destination location does not belong to your inventory.");
  }
  markBulkMoveTiming(timing, "load destination location");

  const sourceLocation = input.sourceLocationId
    ? await prisma.inventoryLocation.findUnique({
        where: { id: input.sourceLocationId },
        select: {
          id: true,
          ownerPlayerId: true,
          name: true,
          kind: true,
          systemManaged: true,
        },
      })
    : null;
  if (input.sourceLocationId && !sourceLocation)
    throw new Error("Source location not found.");
  if (
    sourceLocation &&
    (sourceLocation.systemManaged ||
      sourceLocation.kind === InventoryLocationKind.DECK) &&
    !input.allowSystemManagedSource
  ) {
    throw new Error(
      "Deck locations are system-managed. Use Return to inventory from the deck page.",
    );
  }
  if (
    sourceLocation &&
    sourceLocation.ownerPlayerId !== destination.ownerPlayerId
  ) {
    throw new Error(
      "Source and destination locations must belong to the same owner.",
    );
  }
  markBulkMoveTiming(timing, "load source location");

  const itemWhere: any = distinctItemIds?.length
    ? { id: { in: distinctItemIds } }
    : { ...(input.where ?? {}) };
  itemWhere.quantity = { gt: 0 };
  if (input.sourceLocationId) itemWhere.locationId = input.sourceLocationId;
  if (input.allowedOwnerId) itemWhere.currentOwnerId = input.allowedOwnerId;
  markBulkMoveTiming(timing, "build selection query");

  const preview = await prisma.inventoryItem.aggregate({
    where: itemWhere,
    _count: { _all: true },
    _sum: { quantity: true },
  });
  markBulkMoveTiming(timing, "preview count");
  console.info("[bulk-location-move] optimized move preview", {
    destinationLocationId: destination.id,
    sourceLocationId: input.sourceLocationId ?? null,
    itemIdCount: distinctItemIds?.length ?? null,
    matchedInventoryRows: preview._count._all,
    matchedPhysicalCards: preview._sum.quantity ?? 0,
  });

  const result = await prisma.$transaction(
    async (tx) => {
      const transactionTiming = startBulkMoveTiming();
      const sourceRows = await tx.inventoryItem.findMany({
        where: itemWhere,
        select: {
          id: true,
          currentOwnerId: true,
          originalOpenerId: true,
          cardId: true,
          foil: true,
          foilStatus: true,
          condition: true,
          language: true,
          roundId: true,
          locationId: true,
          locationSection: true,
          quantity: true,
          sourceType: true,
          acquiredFromPullId: true,
          notes: true,
        },
        orderBy: { createdAt: "asc" },
      });
      markBulkMoveTiming(transactionTiming, "load source rows");

      if (
        distinctItemIds?.length &&
        sourceRows.length !== distinctItemIds.length
      ) {
        throw new Error(
          "Some selected inventory entries are no longer available or are not authorized.",
        );
      }
      if (!sourceRows.length)
        throw new Error("No matching inventory entries were found to move.");

      let skippedEntries = 0;
      const rowsToMove = sourceRows.filter((item) => {
        if (item.currentOwnerId !== destination.ownerPlayerId) {
          throw new Error(
            "All moved inventory must belong to the destination location owner.",
          );
        }
        if (item.quantity <= 0)
          throw new Error("Inventory quantity must be positive.");
        if (
          item.locationId === destination.id &&
          normalizeLocationSection(item.locationSection) ===
            destinationLocationSection
        ) {
          skippedEntries += 1;
          return false;
        }
        return true;
      });
      if (!rowsToMove.length) {
        return {
          movedEntries: 0,
          movedCards: 0,
          skippedEntries,
          destinationLocationName: destination.name,
          sourceLocationName: sourceLocation?.name,
        };
      }

      const destinationRows = await tx.inventoryItem.findMany({
        where: {
          currentOwnerId: destination.ownerPlayerId,
          locationId: destination.id,
          locationSection: destinationLocationSection,
          quantity: { gt: 0 },
        },
        select: {
          id: true,
          currentOwnerId: true,
          originalOpenerId: true,
          cardId: true,
          foil: true,
          foilStatus: true,
          condition: true,
          language: true,
          roundId: true,
          locationId: true,
          locationSection: true,
          quantity: true,
          sourceType: true,
          acquiredFromPullId: true,
          notes: true,
        },
      });
      markBulkMoveTiming(transactionTiming, "load destination rows");

      const destinationByKey = new Map<string, BulkMoveInventoryRow>();
      for (const row of destinationRows) {
        const key = inventoryMoveKey(row);
        if (!destinationByKey.has(key)) destinationByKey.set(key, row);
      }

      const directMoveIds: string[] = [];
      const deleteSourceIds: string[] = [];
      const destinationIncrements = new Map<
        string,
        {
          destination: BulkMoveInventoryRow;
          quantity: number;
          sourceIds: string[];
        }
      >();
      const auditLogs: Prisma.InventoryAuditLogCreateManyInput[] = [];
      let movedEntries = 0;
      let movedCards = 0;
      const reason = input.reason || `Bulk move to ${destination.name}.`;

      for (const item of rowsToMove) {
        const quantityToMove = item.quantity;
        const beforeJson = auditSnapshot(item, {
          sourceLocationId: item.locationId,
          sourceLocationName: sourceLocationNameForAudit(item, sourceLocation),
          destinationLocationId: destination.id,
          destinationLocationName: destination.name,
          quantityMoved: quantityToMove,
        });
        const matching = destinationByKey.get(inventoryMoveKey(item));
        if (matching) {
          deleteSourceIds.push(item.id);
          const existingIncrement = destinationIncrements.get(matching.id);
          if (existingIncrement) {
            existingIncrement.quantity += quantityToMove;
            existingIncrement.sourceIds.push(item.id);
          } else {
            destinationIncrements.set(matching.id, {
              destination: matching,
              quantity: quantityToMove,
              sourceIds: [item.id],
            });
          }
          auditLogs.push({
            inventoryItemId: item.id,
            changedByUserId: input.actorUserId,
            changeType: "bulk_location_move_merged_source",
            beforeJson,
            afterJson: { ...beforeJson, quantity: 0, deleted: true },
            reason,
          });
        } else {
          directMoveIds.push(item.id);
          auditLogs.push({
            inventoryItemId: item.id,
            changedByUserId: input.actorUserId,
            changeType: "bulk_location_move",
            beforeJson,
            afterJson: auditSnapshot(item, {
              sourceLocationId: item.locationId,
              sourceLocationName: sourceLocationNameForAudit(
                item,
                sourceLocation,
              ),
              destinationLocationId: destination.id,
              destinationLocationName: destination.name,
              destinationLocationSection,
              locationId: destination.id,
              locationSection: destinationLocationSection,
              quantityMoved: quantityToMove,
            }),
            reason,
          });
        }
        movedEntries += 1;
        movedCards += quantityToMove;
      }

      for (const increment of destinationIncrements.values()) {
        auditLogs.push({
          inventoryItemId: increment.destination.id,
          changedByUserId: input.actorUserId,
          changeType: "bulk_location_move_received",
          beforeJson: auditSnapshot(increment.destination, {
            destinationLocationId: destination.id,
            destinationLocationName: destination.name,
            quantityMoved: increment.quantity,
            sourceInventoryItemIds: increment.sourceIds,
          }),
          afterJson: auditSnapshot(
            {
              ...increment.destination,
              quantity: increment.destination.quantity + increment.quantity,
            },
            {
              destinationLocationId: destination.id,
              destinationLocationName: destination.name,
              quantityMoved: increment.quantity,
              sourceInventoryItemIds: increment.sourceIds,
            },
          ),
          reason,
        });
      }
      markBulkMoveTiming(transactionTiming, "build merge plan");

      for (const increment of destinationIncrements.values()) {
        await tx.inventoryItem.update({
          where: { id: increment.destination.id },
          data: { quantity: { increment: increment.quantity } },
        });
      }
      markBulkMoveTiming(transactionTiming, "update destination quantities");

      if (directMoveIds.length) {
        await tx.inventoryItem.updateMany({
          where: { id: { in: directMoveIds } },
          data: {
            locationId: destination.id,
            locationSection: destinationLocationSection,
          },
        });
      }
      markBulkMoveTiming(transactionTiming, "move source rows");

      for (const chunk of chunkArray(
        auditLogs,
        AUDIT_LOG_CREATE_MANY_BATCH_SIZE,
      )) {
        await tx.inventoryAuditLog.createMany({ data: chunk });
      }
      markBulkMoveTiming(transactionTiming, "insert audit logs");

      if (deleteSourceIds.length) {
        await tx.inventoryItem.deleteMany({
          where: { id: { in: deleteSourceIds } },
        });
      }
      markBulkMoveTiming(transactionTiming, "delete merged source rows");
      logBulkMoveTiming("transaction complete", transactionTiming, {
        movedEntries,
        movedCards,
        skippedEntries,
        directMoveRows: directMoveIds.length,
        mergedSourceRows: deleteSourceIds.length,
        destinationIncrementRows: destinationIncrements.size,
        auditLogRows: auditLogs.length,
      });

      return {
        movedEntries,
        movedCards,
        skippedEntries,
        destinationLocationName: destination.name,
        sourceLocationName: sourceLocation?.name,
      };
    },
    {
      timeout: BULK_MOVE_TRANSACTION_TIMEOUT_MS,
      maxWait: BULK_MOVE_TRANSACTION_MAX_WAIT_MS,
    },
  );
  markBulkMoveTiming(timing, "execute transaction");
  logBulkMoveTiming("bulk move complete", timing, {
    destinationLocationId: destination.id,
    sourceLocationId: input.sourceLocationId ?? null,
    movedEntries: result.movedEntries,
    movedCards: result.movedCards,
    skippedEntries: result.skippedEntries,
  });
  return result;
}

export async function bulkDeleteInventoryItems(
  prisma: PrismaClient,
  input: {
    actorUserId: string;
    itemIds?: string[];
    where?: Record<string, unknown>;
    allowedOwnerId?: string;
    sourceLocationId?: string;
    reason?: string;
    scope?: "selected" | "matching" | "location";
    allowSystemManagedSource?: boolean;
  },
): Promise<BulkDeleteInventoryResult> {
  if (!input.itemIds?.length && !input.where)
    throw new Error("Choose inventory to delete.");

  const timing = startBulkMoveTiming();
  const distinctItemIds = input.itemIds?.length
    ? Array.from(new Set(input.itemIds))
    : undefined;
  const scope =
    input.scope ?? (distinctItemIds?.length ? "selected" : "matching");

  const sourceLocation = input.sourceLocationId
    ? await prisma.inventoryLocation.findUnique({
        where: { id: input.sourceLocationId },
        select: {
          id: true,
          ownerPlayerId: true,
          name: true,
          kind: true,
          systemManaged: true,
        },
      })
    : null;
  if (input.sourceLocationId && !sourceLocation)
    throw new Error("Location not found.");
  if (
    sourceLocation &&
    (sourceLocation.systemManaged ||
      sourceLocation.kind === InventoryLocationKind.DECK) &&
    !input.allowSystemManagedSource
  ) {
    throw new Error(
      "Deck locations are system-managed. Return cards from the deck page before deleting committed inventory.",
    );
  }
  if (
    input.allowedOwnerId &&
    sourceLocation &&
    sourceLocation.ownerPlayerId !== input.allowedOwnerId
  ) {
    throw new Error("You do not have permission to delete this inventory.");
  }
  markBulkMoveTiming(timing, "delete load source location");

  const itemWhere: any = distinctItemIds?.length
    ? { id: { in: distinctItemIds } }
    : { ...(input.where ?? {}) };
  itemWhere.quantity = { gt: 0 };
  if (input.sourceLocationId) itemWhere.locationId = input.sourceLocationId;
  if (input.allowedOwnerId) itemWhere.currentOwnerId = input.allowedOwnerId;
  markBulkMoveTiming(timing, "delete build selection query");

  if (
    !input.allowSystemManagedSource &&
    typeof (prisma.inventoryItem as any).count === "function"
  ) {
    const deckCommittedMatches = await prisma.inventoryItem.count({
      where: { ...itemWhere, location: { kind: InventoryLocationKind.DECK } },
    });
    if (deckCommittedMatches > 0) {
      throw new Error(
        "Committed deck inventory cannot be deleted in bulk. Return it from the deck page first.",
      );
    }
  }

  const preview = await prisma.inventoryItem.aggregate({
    where: itemWhere,
    _count: { _all: true },
    _sum: { quantity: true },
  });
  markBulkMoveTiming(timing, "delete preview count");
  console.info("[bulk-inventory-delete] preview", {
    scope,
    sourceLocationId: input.sourceLocationId ?? null,
    itemIdCount: distinctItemIds?.length ?? null,
    matchedInventoryRows: preview._count._all,
    matchedPhysicalCards: preview._sum.quantity ?? 0,
  });

  const result = await prisma.$transaction(
    async (tx) => {
      const transactionTiming = startBulkMoveTiming();
      const rowsToDelete = await tx.inventoryItem.findMany({
        where: itemWhere,
        select: {
          id: true,
          currentOwnerId: true,
          originalOpenerId: true,
          cardId: true,
          foil: true,
          foilStatus: true,
          condition: true,
          language: true,
          roundId: true,
          locationId: true,
          locationSection: true,
          quantity: true,
          sourceType: true,
          acquiredFromPullId: true,
          notes: true,
        },
        orderBy: { createdAt: "asc" },
      });
      markBulkMoveTiming(transactionTiming, "delete load rows");

      if (
        distinctItemIds?.length &&
        rowsToDelete.length !== distinctItemIds.length
      ) {
        throw new Error(
          "Some inventory changed before deletion. Refresh and try again.",
        );
      }
      if (!rowsToDelete.length) {
        throw new Error(
          scope === "location"
            ? "This location has no inventory to delete."
            : "Choose inventory to delete.",
        );
      }
      for (const item of rowsToDelete) {
        if (
          input.allowedOwnerId &&
          item.currentOwnerId !== input.allowedOwnerId
        ) {
          throw new Error(
            "You do not have permission to delete this inventory.",
          );
        }
        if (item.quantity <= 0)
          throw new Error("Inventory quantity must be positive.");
      }

      const rowIds = rowsToDelete.map((item) => item.id);
      const activeTrades = await tx.trade.findMany({
        where: {
          status: { in: activeInventoryTradeStatuses },
          OR: [
            { offeredInventoryItemId: { in: rowIds } },
            { requestedInventoryItemId: { in: rowIds } },
          ],
        },
        select: { id: true },
      });
      if (activeTrades.length) {
        throw new Error(
          "Some selected inventory is reserved in active trades and cannot be deleted.",
        );
      }
      markBulkMoveTiming(transactionTiming, "delete validate active trades");

      const reason = input.reason || "Inventory deleted.";
      const auditLogs: Prisma.InventoryAuditLogCreateManyInput[] =
        rowsToDelete.map((item) => {
          const beforeJson = auditSnapshot(item, {
            sourceLocationId: item.locationId,
            sourceLocationName: sourceLocationNameForAudit(
              item,
              sourceLocation,
            ),
            quantityDeleted: item.quantity,
            deleteScope: scope,
          });
          return {
            inventoryItemId: item.id,
            changedByUserId: input.actorUserId,
            changeType:
              scope === "location"
                ? "location_contents_deleted"
                : scope === "matching"
                  ? "bulk_inventory_delete_matching"
                  : "bulk_inventory_delete_selected",
            beforeJson,
            afterJson: {
              ...beforeJson,
              quantity: 0,
              quantityDeleted: item.quantity,
              deleted: true,
            },
            reason,
          };
        });
      const deletedCards = rowsToDelete.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      markBulkMoveTiming(transactionTiming, "delete build audit plan");

      console.info("[bulk-inventory-delete] transaction mutation plan", {
        scope,
        inventoryRowsToDelete: rowIds.length,
        physicalQuantityToDelete: deletedCards,
        auditLogRows: auditLogs.length,
      });
      for (const chunk of chunkArray(
        auditLogs,
        AUDIT_LOG_CREATE_MANY_BATCH_SIZE,
      )) {
        await tx.inventoryAuditLog.createMany({ data: chunk });
      }
      markBulkMoveTiming(transactionTiming, "delete insert audit logs");

      const deleteResult = await tx.inventoryItem.deleteMany({
        where: { id: { in: rowIds } },
      });
      if (deleteResult.count !== rowIds.length) {
        throw new Error(
          "Some inventory changed before deletion. Refresh and try again.",
        );
      }
      markBulkMoveTiming(transactionTiming, "delete inventory rows");
      logBulkMoveTiming("delete transaction complete", transactionTiming, {
        scope,
        deletedEntries: rowsToDelete.length,
        deletedCards,
        inventoryRowsDeleted: deleteResult.count,
        auditLogRows: auditLogs.length,
      });

      return {
        deletedEntries: rowsToDelete.length,
        deletedCards,
        inventoryEntriesTouched: rowsToDelete.length,
        locationQuantityRowsDeleted: deleteResult.count,
        parentInventoryRowsDeleted: deleteResult.count,
        physicalQuantityDeleted: deletedCards,
        scope,
        locationName: sourceLocation?.name,
      };
    },
    {
      timeout: BULK_MOVE_TRANSACTION_TIMEOUT_MS,
      maxWait: BULK_MOVE_TRANSACTION_MAX_WAIT_MS,
    },
  );
  markBulkMoveTiming(timing, "delete execute transaction");
  logBulkMoveTiming("bulk delete complete", timing, {
    scope,
    sourceLocationId: input.sourceLocationId ?? null,
    deletedEntries: result.deletedEntries,
    deletedCards: result.deletedCards,
  });
  return result;
}
