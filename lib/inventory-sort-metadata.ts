import type { Prisma } from "@prisma/client";
import type { InventoryFilters } from "./inventory-filters";

export function inventorySortMetadataSelect(
  sortField: string,
  filters: InventoryFilters,
): Prisma.CardSelect {
  // Grouping needs the oracle/name identity. Other display data is hydrated
  // only for the visible page; name order needs none of the JSON metadata.
  if (
    sortField === "cardName" &&
    !filters.colors.length &&
    !filters.colorIdentity.length &&
    !filters.keyword &&
    filters.priceMin === undefined &&
    filters.priceMax === undefined
  ) {
    return { id: true, oracleId: true, name: true };
  }
  return {
    id: true,
    oracleId: true,
    name: true,
    setCode: true,
    rarity: true,
    manaValue: true,
    prices: true,
    collectorNumber: true,
    releasedAt: true,
    typeLine: true,
    manaCost: true,
    colorIdentity: true,
    colors: true,
    cardFaces: true,
    keywords: true,
  };
}
