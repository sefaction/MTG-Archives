import { Prisma, PrismaClient, TradeStatus } from "@prisma/client";
import { normalizeLocationSection } from "./inventory-locations";
import { buildReservedInventoryQuantities } from "./trade-lines";

export type ExpectedStorageStack = {
  id: string;
  quantity: number;
  locationId: string | null;
  locationSection: string | null;
};
const activeStatuses = [
  TradeStatus.PROPOSED,
  TradeStatus.ACCEPTED_PENDING_EXCHANGE,
  TradeStatus.PARTIALLY_COMMITTED,
];

export function planStorageMove<T extends ExpectedStorageStack>(
  rows: T[],
  destinationId: string,
  section: string | null,
  limit?: number,
  selectedQuantities?: Record<string, number>,
) {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("Maximum copies must be a positive whole number.");
  let remaining = limit ?? Infinity;
  return rows.flatMap((row) => {
    const requested = selectedQuantities ? selectedQuantities[row.id] : row.quantity;
    if (!Number.isSafeInteger(requested) || requested < 0 || requested > row.quantity)
      throw new Error("Selected copy amounts changed or are invalid. Refresh and select again.");
    if (
      row.locationId === destinationId &&
      normalizeLocationSection(row.locationSection) === section
    )
      return [];
    if (requested === 0) return [];
    const quantity = Math.min(remaining, requested);
    remaining -= quantity;
    return quantity > 0 ? [{ row, quantity }] : [];
  });
}

// Preserve row IDs on whole-stack moves. Do not merge away provenance, audit
// references, import links, or active trade reservations when reorganizing storage.
export async function moveInventoryStorageBatch(
  prisma: PrismaClient,
  input: {
    actorUserId: string;
    destinationLocationId: string;
    destinationLocationSection?: string | null;
    itemIds?: string[];
    where?: Prisma.InventoryItemWhereInput;
    allowedOwnerId?: string;
    sourceLocationId?: string;
    quantityLimit?: number;
    selectedQuantities?: Record<string, number>;
    selectedGroups?: Array<{ itemIds: string[]; quantity: number }>;
    expectedStacks?: ExpectedStorageStack[];
    reason?: string;
  },
) {
  if (!input.itemIds?.length && !input.where)
    throw new Error("Select inventory to move first.");
  const section = normalizeLocationSection(input.destinationLocationSection);
  try {
    return await prisma.$transaction(
      async (tx) => {
        const destination = await tx.inventoryLocation.findUnique({
          where: { id: input.destinationLocationId },
        });
        if (!destination || !destination.active)
          throw new Error("Destination location is missing or inactive.");
        if (destination.kind !== "NORMAL" || destination.systemManaged)
          throw new Error("Use the deck workflow for committed inventory.");
        if (
          input.allowedOwnerId &&
          destination.ownerPlayerId !== input.allowedOwnerId
        )
          throw new Error("Destination does not belong to your inventory.");
        const ids = input.itemIds?.length
          ? [...new Set(input.itemIds)]
          : undefined;
        const rows = await tx.inventoryItem.findMany({
          where: {
            AND: [
              ids ? { id: { in: ids } } : (input.where ?? {}),
              {
                quantity: { gt: 0 },
                currentOwnerId: destination.ownerPlayerId,
              },
              ...(input.sourceLocationId
                ? [{ locationId: input.sourceLocationId }]
                : []),
            ],
          },
          include: {
            location: { select: { kind: true, systemManaged: true } },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (ids && rows.length !== ids.length)
          throw new Error(
            "Some selected inventory is no longer available or is not authorized. Refresh and select again.",
          );
        if (!rows.length) throw new Error("No matching inventory was found.");
        if (input.selectedQuantities) {
          if (input.quantityLimit !== undefined || !ids ||
              Object.keys(input.selectedQuantities).length !== rows.length ||
              rows.some((row) => !Object.hasOwn(input.selectedQuantities!, row.id)))
            throw new Error("Selected copy amounts do not match the selected inventory.");
        }
        if (input.selectedGroups && (input.selectedQuantities || input.quantityLimit !== undefined || !ids))
          throw new Error("Selected copy amounts do not match the selected inventory.");
        const expected = new Map(
          (input.expectedStacks ?? []).map((row) => [row.id, row]),
        );
        for (const row of rows) {
          if (row.location?.kind === "DECK" || row.location?.systemManaged)
            throw new Error(
              "Use the deck return workflow for committed inventory.",
            );
          const before = expected.get(row.id);
          if (
            expected.size &&
            (!before ||
              before.quantity !== row.quantity ||
              before.locationId !== row.locationId ||
              normalizeLocationSection(before.locationSection) !==
                normalizeLocationSection(row.locationSection))
          ) {
            throw new Error(
              "Selected inventory changed since it was loaded. Refresh and select again.",
            );
          }
        }
        let selectedQuantities = input.selectedQuantities;
        if (input.selectedGroups) {
          const rowsById = new Map(rows.map((row) => [row.id, row]));
          const assigned = new Set<string>();
          selectedQuantities = {};
          for (const group of input.selectedGroups) {
            if (!Array.isArray(group.itemIds) || !group.itemIds.length ||
                !Number.isSafeInteger(group.quantity) || group.quantity < 1)
              throw new Error("Selected copy amounts are invalid. Refresh and select again.");
            const groupIds = new Set(group.itemIds);
            if (groupIds.size !== group.itemIds.length ||
                group.itemIds.some((id) => !rowsById.has(id) || assigned.has(id)))
              throw new Error("Selected copy amounts do not match the selected inventory.");
            group.itemIds.forEach((id) => assigned.add(id));
            const groupRows = rows.filter((row) => groupIds.has(row.id));
            const groupTotal = groupRows.reduce((sum, row) => sum + row.quantity, 0);
            if (group.quantity > groupTotal)
              throw new Error("Selected copy amount exceeds the available stack.");
            let remaining = group.quantity;
            for (const row of groupRows) {
              const atDestination = row.locationId === destination.id &&
                normalizeLocationSection(row.locationSection) === section;
              selectedQuantities[row.id] = atDestination ? 0 :
                Math.min(remaining, row.quantity);
              if (!atDestination) remaining -= selectedQuantities[row.id];
            }
          }
          if (assigned.size !== rows.length)
            throw new Error("Selected copy amounts do not match the selected inventory.");
        }
        const plan = planStorageMove(
          rows,
          destination.id,
          section,
          input.quantityLimit,
          selectedQuantities,
        );
        const partials = plan.filter((entry) => entry.quantity < entry.row.quantity);
        if (partials.length) {
          const partialIds = partials.map(({ row }) => row.id);
          const [lines, legacy] = await Promise.all([
            tx.tradeLine.findMany({
              where: {
                inventoryItemId: { in: partialIds },
                trade: { status: { in: activeStatuses } },
              },
              select: { inventoryItemId: true, quantity: true },
            }),
            tx.trade.findMany({
              where: {
                status: { in: activeStatuses },
                lines: { none: {} },
                OR: [
                  { offeredInventoryItemId: { in: partialIds } },
                  { requestedInventoryItemId: { in: partialIds } },
                ],
              },
              select: {
                offeredInventoryItemId: true,
                requestedInventoryItemId: true,
              },
            }),
          ]);
          const reservedById = buildReservedInventoryQuantities(lines, legacy);
          for (const partial of partials) {
            const reserved = reservedById.get(partial.row.id) ?? 0;
            if (partial.row.quantity - partial.quantity < reserved)
              throw new Error(
                "This partial move would split reserved trade copies. Move the whole stack or choose fewer copies.",
              );
          }
        }
        const wholeIds = plan
          .filter((entry) => entry.quantity === entry.row.quantity)
          .map((entry) => entry.row.id);
        for (let offset = 0; offset < wholeIds.length; offset += 500) {
          await tx.inventoryItem.updateMany({
            where: { id: { in: wholeIds.slice(offset, offset + 500) } },
            data: { locationId: destination.id, locationSection: section },
          });
        }
        const partialDestinationIds = new Map<string, string>();
        for (const partial of partials) {
          const { id, createdAt, updatedAt, location, ...data } = partial.row;
          await tx.inventoryItem.update({
            where: { id },
            data: { quantity: { decrement: partial.quantity } },
          });
          const created = await tx.inventoryItem.create({
            data: {
              ...data,
              quantity: partial.quantity,
              locationId: destination.id,
              locationSection: section,
            },
          });
          partialDestinationIds.set(id, created.id);
        }
        const audits: Prisma.InventoryAuditLogCreateManyInput[] = plan.map(
          ({ row, quantity }) => ({
            inventoryItemId: row.id,
            changedByUserId: input.actorUserId,
            changeType: "storage_batch_move",
            beforeJson: {
              ...row,
              location: undefined,
            } as unknown as Prisma.InputJsonObject,
            afterJson: {
              sourceInventoryItemId: row.id,
              destinationInventoryItemId:
                quantity === row.quantity ? row.id : partialDestinationIds.get(row.id)!,
              locationId: destination.id,
              locationSection: section,
              quantityMoved: quantity,
              sourceRemaining:
                quantity === row.quantity ? 0 : row.quantity - quantity,
            },
            reason: input.reason || "Organize physical storage.",
          }),
        );
        for (const [sourceId, destinationId] of partialDestinationIds)
          audits.push({
            ...audits.find((a) => a.inventoryItemId === sourceId)!,
            inventoryItemId: destinationId,
            changeType: "storage_batch_move_received",
          });
        for (let offset = 0; offset < audits.length; offset += 500)
          await tx.inventoryAuditLog.createMany({
            data: audits.slice(offset, offset + 500),
          });
        return {
          movedEntries: plan.length,
          movedCards: plan.reduce((sum, entry) => sum + entry.quantity, 0),
          skippedEntries: rows.length - plan.length,
          destinationLocationName: destination.name,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
        maxWait: 10_000,
      },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    )
      throw new Error(
        "Inventory changed during this move. Nothing was moved; refresh and try again.",
      );
    throw error;
  }
}
