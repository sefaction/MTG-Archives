import { type InventoryItem, type Prisma } from "@prisma/client";
import {
  recordInventoryAudit,
  type RecordInventoryAuditInput,
} from "./inventory-audit";

/** Explicit stock/lot facts. Neither owner nor input method implies an opener. */
export type InventoryReceiptLot = Pick<
  InventoryItem,
  | "currentOwnerId"
  | "originalOpenerId"
  | "cardId"
  | "quantity"
  | "foilStatus"
  | "sourceType"
  | "condition"
  | "language"
  | "locationId"
  | "locationSection"
  | "acquiredFromPullId"
  | "roundId"
  | "notes"
>;
export type InventoryReceiptResult = {
  inventory: InventoryItem;
  previous: InventoryItem | null;
  created: boolean;
  beforeQuantity: number;
};
type Audit = Omit<
  RecordInventoryAuditInput,
  "tx" | "inventoryItemId" | "before" | "after"
>;
type Merge = {
  where: Prisma.InventoryItemWhereInput;
  update: Pick<
    Prisma.InventoryItemUncheckedUpdateInput,
    "condition" | "notes" | "sourceType"
  >;
};

/**
 * Caller owns authorization, idempotency and destination coordination, and MUST
 * pass its transaction. This writes stock and its audit together. It cannot
 * commit independently or contact an external service.
 *
 * CSV/manual policies may pass their matching rule, further restricted here to
 * the same provenance lot. Their duplicate/condition rules remain caller-owned.
 * Acquisition uses merge:null: each receipt lot preserves source, notes,
 * opener, pull and round; it must never absorb an unrelated existing lot.
 */
export async function writeInventoryReceipt(
  tx: Prisma.TransactionClient,
  input: {
    lot: InventoryReceiptLot;
    merge: Merge | null;
    audit: Audit | ((result: InventoryReceiptResult) => Audit);
    emptyBefore?: Prisma.InputJsonObject;
  },
): Promise<InventoryReceiptResult> {
  const { lot } = input;
  if (
    !Number.isSafeInteger(lot.quantity) ||
    lot.quantity <= 0 ||
    lot.quantity > 2147483647
  )
    throw new Error("Receipt quantity must be a positive database integer.");
  // Nullable opener is deliberate; undefined would accidentally omit a fact.
  if (
    lot.originalOpenerId === undefined ||
    !lot.currentOwnerId ||
    !lot.cardId ||
    !lot.condition ||
    !lot.language
  )
    throw new Error(
      "Receipt owner, opener, printing and attributes must be explicit.",
    );
  if (lot.sourceType === "ACQUISITION" && input.merge)
    throw new Error(
      "Acquisition receipts must preserve a separate provenance lot.",
    );
  const matching: Prisma.InventoryItemWhereInput = {
    AND: [
      input.merge?.where ?? {},
      {
        currentOwnerId: lot.currentOwnerId,
        originalOpenerId: lot.originalOpenerId,
        cardId: lot.cardId,
        foilStatus: lot.foilStatus,
        language: lot.language,
        locationId: lot.locationId,
        locationSection: lot.locationSection,
        sourceType: lot.sourceType,
        notes: lot.notes,
        acquiredFromPullId: lot.acquiredFromPullId,
        roundId: lot.roundId,
      },
    ],
  };
  let previous = input.merge
    ? await tx.inventoryItem.findFirst({
        where: matching,
        orderBy: { id: "asc" },
      })
    : null;
  if (previous) {
    // A read-committed manual add can wait behind another add. Re-read under the
    // lock so its audit records the actual before quantity, not an old snapshot.
    await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${previous.id} FOR UPDATE`;
    previous = await tx.inventoryItem.findFirst({
      where: { AND: [matching, { id: previous.id }] },
    });
  }
  const beforeQuantity = previous?.quantity ?? 0;
  if (beforeQuantity + lot.quantity > 2147483647)
    throw new Error("Receipt quantity exceeds the database integer range.");
  const inventory = previous
    ? await tx.inventoryItem.update({
        where: { id: previous.id },
        data: {
          ...input.merge!.update,
          quantity: { increment: lot.quantity },
        },
      })
    : await tx.inventoryItem.create({
        data: { ...lot, foil: lot.foilStatus !== "NONFOIL" },
      });
  const result = { inventory, previous, created: !previous, beforeQuantity };
  const audit =
    typeof input.audit === "function" ? input.audit(result) : input.audit;
  await recordInventoryAudit({
    ...audit,
    tx,
    inventoryItemId: inventory.id,
    before: previous
      ? JSON.parse(JSON.stringify(previous))
      : (input.emptyBefore ?? { quantity: 0 }),
    after: JSON.parse(JSON.stringify(inventory)),
  });
  return result;
}
