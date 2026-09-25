import { Prisma, PrismaClient } from "@prisma/client";
import { importTransaction } from "./import-commit";
import { recordInventoryAudit } from "./inventory-audit";

/** Called only by the admin-only undo action. Keep zero rows to retain lineage. */
export async function undoInventoryImport(
  db: PrismaClient,
  batchId: string,
  actingUserId: string,
) {
  return importTransaction(db, async (tx) => {
    const batch = await tx.importBatch.findUnique({
      where: { id: batchId },
      include: { items: { orderBy: { rowNumber: "desc" } } },
    });
    if (!batch) throw new Error("Import batch not found.");
    // Rows can be resolved and committed in separate passes. Undo newest
    // receipts first, with reverse CSV order within a single commit.
    const receipts = await tx.inventoryAuditLog.findMany({
      where: {
        changeType: "import_committed",
        inventoryItemId: {
          in: batch.items.flatMap((item) =>
            item.inventoryItemId ? [item.inventoryItemId] : [],
          ),
        },
      },
      select: { afterJson: true, createdAt: true },
    });
    const committedAt = new Map(
      receipts.map((receipt) => [
        (receipt.afterJson as Prisma.JsonObject)?.importBatchItemId,
        receipt.createdAt.getTime(),
      ]),
    );
    batch.items.sort(
      (a, b) =>
        (committedAt.get(b.id) ?? 0) - (committedAt.get(a.id) ?? 0) ||
        b.rowNumber - a.rowNumber,
    );
    let blocked = 0;
    for (const item of batch.items) {
      if (item.status === "cannot_undo") {
        blocked++;
        continue;
      }
      if (item.status !== "imported") continue;
      const inventory = item.inventoryItemId
        ? await tx.inventoryItem.findUnique({
            where: { id: item.inventoryItemId },
            include: { auditLogs: true },
          })
        : null;
      const ownReceipt = inventory?.auditLogs.find(
        (log) =>
          log.changeType === "import_committed" &&
          (log.afterJson as Prisma.JsonObject)?.importBatchItemId === item.id,
      );
      // Older audits on an existing stack are fine. Any later unrelated change
      // (even one that restores the same quantity) requires manual review.
      const changed = inventory?.auditLogs.some((log) => {
        const metadata = log.afterJson as Prisma.JsonObject;
        if (
          ["import_committed", "import_undo"].includes(log.changeType) &&
          metadata?.importBatchId === batchId
        )
          return false;
        return !ownReceipt || log.createdAt >= ownReceipt.createdAt;
      });
      const receiptAfter = ownReceipt?.afterJson as
        Prisma.JsonObject | undefined;
      const attributesChanged =
        inventory &&
        receiptAfter &&
        (
          [
            "currentOwnerId",
            "originalOpenerId",
            "cardId",
            "foil",
            "foilStatus",
            "condition",
            "language",
            "locationId",
            "locationSection",
            "acquiredFromPullId",
            "roundId",
            "notes",
            "sourceType",
          ] as const
        ).some((key) => inventory[key] !== receiptAfter[key]);
      if (
        !inventory ||
        item.pullId ||
        !item.quantityImported ||
        item.beforeQuantity == null ||
        item.afterQuantity == null ||
        inventory.quantity !== item.afterQuantity ||
        changed ||
        attributesChanged ||
        inventory.currentOwnerId !== batch.selectedPlayerId
      ) {
        blocked++;
        await tx.importBatchItem.update({
          where: { id: item.id },
          data: {
            status: "cannot_undo",
            message:
              "Cannot undo safely: inventory changed, is missing, or requires legacy source review. No inventory effects were reversed for this row.",
          },
        });
        continue;
      }
      const before = ownReceipt?.beforeJson as Prisma.JsonObject | undefined;
      const { auditLogs: _logs, ...snapshot } = inventory;
      const updated = await tx.inventoryItem.update({
        where: { id: inventory.id },
        data: {
          quantity: item.beforeQuantity,
          ...(before && !item.createdNewInventoryItem
            ? {
                notes: typeof before.notes === "string" ? before.notes : null,
                sourceType: before.sourceType as typeof inventory.sourceType,
              }
            : {}),
        },
      });
      await recordInventoryAudit({
        tx,
        action: "import_undo",
        actingUserId,
        inventoryItemId: inventory.id,
        before: JSON.parse(JSON.stringify(snapshot)),
        after: JSON.parse(JSON.stringify(updated)),
        metadata: { importBatchId: batchId, importBatchItemId: item.id },
        reason: `Undo CSV import ${batch.filename}, row ${item.rowNumber}`,
      });
      await tx.importBatchItem.update({
        where: { id: item.id },
        data: {
          status: "undone",
          message:
            "Import quantity reversed; inventory and audit history retained.",
        },
      });
    }
    await tx.importBatch.update({
      where: { id: batchId },
      data: { status: blocked ? "PARTIALLY_UNDONE" : "UNDONE" },
    });
    return { blocked };
  });
}
