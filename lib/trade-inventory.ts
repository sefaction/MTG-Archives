import { InventorySourceType, type InventoryItem } from "@prisma/client";

type TradedCopy = Pick<
  InventoryItem,
  | "cardId"
  | "originalOpenerId"
  | "foil"
  | "foilStatus"
  | "condition"
  | "language"
  | "roundId"
  | "acquiredFromPullId"
  | "notes"
>;

/** A received trade lot is distinct from existing copies, even of the same printing. */
export function receivedTradeInventoryData(
  item: TradedCopy,
  quantity: number,
  ownerId: string,
  locationId: string,
) {
  return {
    // Explicit fields prevent caller objects from carrying IDs, relations or source location.
    cardId: item.cardId,
    originalOpenerId: item.originalOpenerId,
    foil: item.foil,
    foilStatus: item.foilStatus,
    condition: item.condition,
    language: item.language,
    roundId: item.roundId,
    acquiredFromPullId: item.acquiredFromPullId,
    notes: item.notes,
    currentOwnerId: ownerId,
    quantity,
    sourceType: InventorySourceType.TRADE,
    locationId,
    locationSection: null,
  };
}
