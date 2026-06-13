import { Prisma } from "@prisma/client";

export async function moveInventoryQuantityWithinTransaction(
  tx: Prisma.TransactionClient,
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
    auditInventoryItemId: created.id,
    merged: false,
    sourceAfterQuantity: source.quantity - input.quantity,
    destinationBeforeQuantity: 0,
    destinationAfterQuantity: input.quantity,
  };
}
