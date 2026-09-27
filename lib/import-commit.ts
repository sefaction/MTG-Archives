import {
  FoilStatus,
  InventoryLocationKind,
  InventorySourceType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  getImportReviewSummary,
  isImportItemReadyToCommit,
} from "./import-review";
import {
  ensureDefaultLocation,
  normalizeLocationName,
  normalizeLocationSection,
} from "./inventory-locations";
import { normalizeInventoryCondition } from "./inventory-condition";
import { recordInventoryAudit, inventoryAuditAction } from "./inventory-audit";

type ParsedRow = {
  quantity: number;
  foilStatus?: FoilStatus;
  condition?: string;
  language?: string;
  notes?: string;
  locationName?: string;
  locationSection?: string;
};
export type CommitImportInput = {
  batchId: string;
  actingUserId: string;
  playerId?: string | null;
  isAdmin: boolean;
  destinationLocationId?: string;
  destinationLocationSection?: string;
};

// A serialization conflict rolls back every effect. Re-read eligibility on retry,
// so a competing confirmation can commit each row only once.
export async function importTransaction<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt >= 7
      )
        throw error;
      // Let the competing serializable transaction finish before re-reading
      // eligibility. Immediate retries can repeatedly hit the same pivot.
      const delayMs = Math.min(250, 15 * 2 ** attempt) +
        Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Commit all currently ready rows atomically; review/unresolved rows remain untouched. */
export async function commitImportBatch(
  db: PrismaClient,
  input: CommitImportInput,
) {
  return importTransaction(db, async (tx) => {
    const batch = await tx.importBatch.findUnique({
      where: { id: input.batchId },
      include: { items: { orderBy: { rowNumber: "asc" } } },
    });
    if (!batch) throw new Error("Import batch not found.");
    if (!input.isAdmin && batch.selectedPlayerId !== input.playerId)
      throw new Error("Not authorized for this import batch.");
    const duplicateBehavior = batch.importType.split(":")[1] || "add";
    if (duplicateBehavior === "preview")
      throw new Error(
        "This batch was created as preview only. Upload again with an import duplicate behavior to commit it.",
      );
    const readyItems = batch.items.filter(isImportItemReadyToCommit);
    if (!readyItems.length) {
      if (batch.items.some((item) => item.status === "imported"))
        return { committedRows: 0 };
      throw new Error("No resolved cards are ready to commit.");
    }

    const defaultLocationIdRaw = input.destinationLocationId || "";
    const defaultLocationSection = normalizeLocationSection(
      input.destinationLocationSection,
    );
    const defaultLocation = defaultLocationIdRaw
      ? await tx.inventoryLocation.findFirst({
          where: {
            id: defaultLocationIdRaw,
            ownerPlayerId: batch.selectedPlayerId,
            active: true,
            kind: InventoryLocationKind.NORMAL,
            systemManaged: false,
          },
        })
      : await ensureDefaultLocation(tx, batch.selectedPlayerId);
    if (
      !defaultLocation ||
      !defaultLocation.active ||
      defaultLocation.kind !== InventoryLocationKind.NORMAL ||
      defaultLocation.systemManaged
    )
      throw new Error("Choose a destination location before committing.");

    let committedRows = 0;
    for (const item of readyItems) {
      const currentItem = await tx.importBatchItem.findUnique({
        where: { id: item.id },
      });
      if (!currentItem || !isImportItemReadyToCommit(currentItem)) continue;
      const card = await tx.card.findUnique({
        where: { id: currentItem.cardPrintingId! },
      });
      if (!card) {
        await tx.importBatchItem.update({
          where: { id: currentItem.id },
          data: {
            status: "error",
            message: "Selected card printing no longer exists.",
          },
        });
        continue;
      }
      const parsedRow = currentItem.parsedRowJson as ParsedRow;
      const quantity = Number(parsedRow.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        await tx.importBatchItem.update({
          where: { id: currentItem.id },
          data: {
            status: "error",
            message: "Quantity must be a positive integer.",
          },
        });
        continue;
      }
      const foilStatus = (currentItem.parsedFoilStatus ||
        parsedRow.foilStatus ||
        "NONFOIL") as FoilStatus;
      const condition = normalizeInventoryCondition(
        currentItem.parsedCondition || parsedRow.condition,
      );
      const rowLocation = parsedRow.locationName
        ? await tx.inventoryLocation.findFirst({
            where: {
              ownerPlayerId: batch.selectedPlayerId,
              normalizedName: normalizeLocationName(parsedRow.locationName),
              active: true,
              kind: InventoryLocationKind.NORMAL,
              systemManaged: false,
            },
          })
        : null;
      const locationId = rowLocation?.id ?? defaultLocation.id;
      const locationSection = normalizeLocationSection(
        parsedRow.locationSection ?? defaultLocationSection,
      );
      const matchingWhere = {
        currentOwnerId: batch.selectedPlayerId,
        originalOpenerId: batch.selectedOriginalOpenerId,
        cardId: currentItem.cardPrintingId!,
        foil: foilStatus !== FoilStatus.NONFOIL,
        foilStatus,
        condition,
        language: parsedRow.language || "EN",
        locationId,
        locationSection,
        quantity: { gt: 0 },
      };
      const createData = {
        currentOwnerId: batch.selectedPlayerId,
        originalOpenerId: batch.selectedOriginalOpenerId,
        cardId: currentItem.cardPrintingId!,
        quantity,
        foil: foilStatus !== FoilStatus.NONFOIL,
        foilStatus,
        condition,
        acquiredFromPullId: null,
        notes: parsedRow.notes || null,
        sourceType: InventorySourceType.CSV_PULL_IMPORT,
        language: parsedRow.language || "EN",
        locationId,
        locationSection,
      };
      const existingInventory =
        duplicateBehavior === "separate"
          ? null
          : await tx.inventoryItem.findFirst({
              where: matchingWhere,
              orderBy: { id: "asc" },
            });
      const beforeQuantity = existingInventory?.quantity ?? 0;
      const inventory = existingInventory
        ? await tx.inventoryItem.update({
            where: { id: existingInventory.id },
            data: {
              quantity: { increment: quantity },
              notes: parsedRow.notes || undefined,
              sourceType: InventorySourceType.CSV_PULL_IMPORT,
            },
          })
        : await tx.inventoryItem.create({ data: createData });
      await recordInventoryAudit({
        tx,
        action: inventoryAuditAction.importCommitted,
        actingUserId: input.actingUserId,
        inventoryItemId: inventory.id,
        before: existingInventory
          ? JSON.parse(JSON.stringify(existingInventory))
          : { quantity: 0 },
        after: JSON.parse(JSON.stringify(inventory)),
        metadata: {
          importBatchId: batch.id,
          importBatchItemId: currentItem.id,
          quantityImported: quantity,
          duplicateBehavior,
        },
        reason: `CSV import ${batch.filename}, row ${currentItem.rowNumber}`,
      });
      await tx.importBatchItem.update({
        where: { id: currentItem.id },
        data: {
          status: "imported",
          inventoryItemId: inventory.id,
          pullId: null,
          quantityImported: quantity,
          duplicateBehaviorUsed: duplicateBehavior,
          createdNewInventoryItem: !existingInventory,
          updatedExistingInventoryItem: Boolean(existingInventory),
          beforeQuantity,
          afterQuantity: inventory.quantity,
          message: `Committed ${quantity} card${quantity === 1 ? "" : "s"} to inventory.`,
        },
      });
      committedRows++;
    }
    const remainingItems = await tx.importBatchItem.findMany({
      where: { importBatchId: batch.id },
    });
    const remainingSummary = getImportReviewSummary(remainingItems);
    await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        status:
          remainingSummary.failed > 0
            ? "IMPORTED_WITH_ERRORS"
            : remainingSummary.readyToCommit > 0
              ? "PARTIALLY_IMPORTED"
              : remainingSummary.needsReview + remainingSummary.unresolved > 0
                ? "IMPORTED_WITH_REVIEW"
                : "IMPORTED",
        skippedRows: remainingSummary.skipped,
        matchedRows: remainingSummary.committed,
        warningRows: remainingSummary.warnings,
        errorRows:
          remainingSummary.failed +
          remainingSummary.needsReview +
          remainingSummary.unresolved,
      },
    });
    return { committedRows };
  });
}
