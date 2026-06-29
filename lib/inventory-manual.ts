import {
  FoilStatus,
  InventoryLocationKind,
  InventorySourceType,
  Prisma,
} from "@prisma/client";
import { inventoryAuditAction, recordInventoryAudit } from "./inventory-audit";

export type ManualInventoryAddInput = {
  ownerPlayerId: string;
  cardId: string;
  locationId: string;
  quantity: number;
  foilStatus?: FoilStatus | string | null;
  condition?: string | null;
  language?: string | null;
  notes?: string | null;
  actingUserId?: string | null;
  reason?: string | null;
  allowDeckLocation?: boolean;
};

function normalizeFoilStatus(value: string | null | undefined) {
  return Object.values(FoilStatus).includes(value as FoilStatus)
    ? (value as FoilStatus)
    : FoilStatus.NONFOIL;
}

export function normalizeManualInventoryQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive integer.");
  }
  return Math.min(quantity, 999);
}

export async function addInventoryCardToLocation(
  tx: Prisma.TransactionClient,
  input: ManualInventoryAddInput,
) {
  const quantity = normalizeManualInventoryQuantity(input.quantity);
  const card = await tx.card.findUnique({ where: { id: input.cardId } });
  if (!card) throw new Error("Select a card printing before adding.");
  const location = await tx.inventoryLocation.findFirst({
    where: {
      id: input.locationId,
      ownerPlayerId: input.ownerPlayerId,
      active: true,
    },
  });
  if (!location) throw new Error("Choose a destination location.");
  if (
    !input.allowDeckLocation &&
    (location.kind === InventoryLocationKind.DECK ||
      location.systemManaged ||
      location.type === "Deck")
  ) {
    throw new Error("Choose a normal inventory location.");
  }
  const foilStatus = normalizeFoilStatus(input.foilStatus);
  const condition = (input.condition || "NM").trim() || "NM";
  const language = (input.language || "EN").trim().toUpperCase() || "EN";
  const notes = input.notes?.trim() || null;
  const matchingWhere = {
    currentOwnerId: input.ownerPlayerId,
    originalOpenerId: input.ownerPlayerId,
    cardId: card.id,
    foil: foilStatus !== FoilStatus.NONFOIL,
    foilStatus,
    condition,
    language,
    locationId: location.id,
    quantity: { gt: 0 },
  };
  const existing = await tx.inventoryItem.findFirst({ where: matchingWhere });
  const beforeQuantity = existing?.quantity ?? 0;
  const inventory = existing
    ? await tx.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantity: { increment: quantity },
          notes: notes ?? undefined,
          sourceType: InventorySourceType.MANUAL,
        },
      })
    : await tx.inventoryItem.create({
        data: {
          currentOwnerId: input.ownerPlayerId,
          originalOpenerId: input.ownerPlayerId,
          cardId: card.id,
          quantity,
          foil: foilStatus !== FoilStatus.NONFOIL,
          foilStatus,
          condition,
          acquiredFromPullId: null,
          notes,
          sourceType: InventorySourceType.MANUAL,
          language,
          locationId: location.id,
        },
      });

  const metadata = {
    cardId: card.id,
    cardName: card.name,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    locationId: location.id,
    locationName: location.name,
    quantityAdded: quantity,
    beforeQuantity,
    afterQuantity: inventory.quantity,
    foilStatus,
    condition,
    language,
    createdNewInventoryItem: !existing,
    updatedExistingInventoryItem: Boolean(existing),
  };
  await recordInventoryAudit({
    tx,
    inventoryItemId: inventory.id,
    actingUserId: input.actingUserId,
    action: inventoryAuditAction.inventoryAdded,
    before: existing ?? {},
    after: inventory,
    metadata,
    reason: input.reason ?? `Manually added ${quantity} ${card.name}.`,
  });

  return { inventory, card, location, quantity, created: !existing };
}
