import {
  FoilStatus,
  InventoryLocationKind,
  InventorySourceType,
  Prisma,
} from "@prisma/client";
import { inventoryAuditAction } from "./inventory-audit";
import { writeInventoryReceipt } from "./inventory-receipt";
import {
  equivalentInventoryConditions,
  normalizeInventoryCondition,
} from "./inventory-condition";
import { normalizeLocationSection } from "./inventory-locations";

export type ManualInventoryAddInput = {
  ownerPlayerId: string;
  cardId: string;
  locationId: string;
  locationSection?: string | null;
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
  const condition = normalizeInventoryCondition(input.condition);
  const language = (input.language || "EN").trim().toUpperCase() || "EN";
  const notes = input.notes?.trim() || null;
  const locationSection = normalizeLocationSection(input.locationSection);
  const matchingWhere = {
    currentOwnerId: input.ownerPlayerId,
    originalOpenerId: input.ownerPlayerId,
    cardId: card.id,
    foil: foilStatus !== FoilStatus.NONFOIL,
    foilStatus,
    condition: { in: equivalentInventoryConditions(condition) },
    language,
    locationId: location.id,
    locationSection,
    quantity: { gt: 0 },
  };
  const receipt = await writeInventoryReceipt(tx, {
    lot: {
      currentOwnerId: input.ownerPlayerId,
      originalOpenerId: input.ownerPlayerId,
      cardId: card.id,
      quantity,
      foilStatus,
      condition,
      acquiredFromPullId: null,
      roundId: null,
      notes,
      sourceType: InventorySourceType.MANUAL,
      language,
      locationId: location.id,
      locationSection,
    },
    merge: {
      where: matchingWhere,
      update: {
        condition,
        notes: notes ?? undefined,
        sourceType: InventorySourceType.MANUAL,
      },
    },
    emptyBefore: {},
    audit: ({ inventory, previous, beforeQuantity, created }) => ({
      actingUserId: input.actingUserId,
      action: inventoryAuditAction.inventoryAdded,
      metadata: {
        cardId: card.id,
        cardName: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        locationId: location.id,
        locationName: location.name,
        locationSection,
        quantityAdded: quantity,
        beforeQuantity,
        afterQuantity: inventory.quantity,
        foilStatus,
        condition,
        language,
        createdNewInventoryItem: created,
        updatedExistingInventoryItem: Boolean(previous),
      },
      reason: input.reason ?? `Manually added ${quantity} ${card.name}.`,
    }),
  });
  const { inventory, previous: existing } = receipt;

  return { inventory, card, location, quantity, created: !existing };
}
