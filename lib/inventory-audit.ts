import { Prisma } from "@prisma/client";

export const INVENTORY_AUDIT_CREATE_MANY_BATCH_SIZE = 500;

export const inventoryAuditAction = {
  inventoryAdded: "inventory_added",
  inventoryEdited: "inventory_edited",
  quantityAdjusted: "quantity_adjusted",
  locationMoved: "location_moved",
  bulkLocationMoved: "bulk_location_moved",
  inventoryDeleted: "inventory_deleted",
  bulkInventoryDeleted: "bulk_inventory_deleted",
  locationContentsDeleted: "location_contents_deleted",
  importCommitted: "import_committed",
  tradeCompleted: "trade_completed",
  adminCorrected: "admin_corrected",
  visibilityChanged: "visibility_changed",
  committedToDeck: "committed_to_deck",
  bulkCommittedToDeck: "bulk_committed_to_deck",
  returnedFromDeck: "returned_from_deck",
  bulkReturnedFromDeck: "bulk_returned_from_deck",
} as const;

export type InventoryAuditAction =
  (typeof inventoryAuditAction)[keyof typeof inventoryAuditAction] | string;

type InventoryAuditDelegate = Pick<
  Prisma.TransactionClient,
  "inventoryAuditLog"
>;

export type RecordInventoryAuditInput = {
  tx: InventoryAuditDelegate;
  action: InventoryAuditAction;
  actingUserId?: string | null;
  inventoryItemId?: string | null;
  tradeId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string | null;
  metadata?: Prisma.InputJsonObject;
};

export type InventoryAuditCreateManyEntry = Omit<
  Prisma.InventoryAuditLogCreateManyInput,
  "changeType"
> & {
  action?: InventoryAuditAction;
  changeType?: InventoryAuditAction;
};

export async function recordInventoryAudit({
  tx,
  action,
  actingUserId,
  inventoryItemId,
  tradeId,
  before,
  after,
  reason,
  metadata,
}: RecordInventoryAuditInput) {
  const beforeJson = mergeAuditMetadata(before, metadata);
  const afterJson = mergeAuditMetadata(after, metadata);
  return tx.inventoryAuditLog.create({
    data: {
      inventoryItemId: inventoryItemId ?? null,
      changedByUserId: actingUserId ?? null,
      tradeId: tradeId ?? null,
      changeType: action,
      beforeJson,
      afterJson,
      reason: reason || null,
    },
  });
}

export async function recordInventoryAuditMany({
  tx,
  entries,
  batchSize = INVENTORY_AUDIT_CREATE_MANY_BATCH_SIZE,
}: {
  tx: InventoryAuditDelegate;
  entries: InventoryAuditCreateManyEntry[];
  batchSize?: number;
}) {
  const normalized = entries.map(({ action, changeType, ...entry }) => ({
    ...entry,
    changeType: changeType ?? action ?? inventoryAuditAction.inventoryEdited,
  }));
  for (let index = 0; index < normalized.length; index += batchSize) {
    const chunk = normalized.slice(index, index + batchSize);
    if (chunk.length) await tx.inventoryAuditLog.createMany({ data: chunk });
  }
}

function mergeAuditMetadata(
  value: Prisma.InputJsonValue | undefined,
  metadata: Prisma.InputJsonObject | undefined,
): Prisma.InputJsonValue {
  if (!metadata) return value ?? {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Prisma.InputJsonObject), ...metadata };
  }
  return { value: value ?? null, ...metadata };
}
