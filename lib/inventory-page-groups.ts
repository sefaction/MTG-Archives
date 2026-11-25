import { groupInventoryPageGroupsByCardName } from "./inventory-locations";
import { compareInventoryGroups } from "./inventory-sort";
import type { FoilStatus, Prisma } from "@prisma/client";

type PrintingGroup = {
  cardId: string;
  _sum?: { quantity?: number | null };
  _count?: { _all?: number };
};

/** Grouped mode needs ordered representatives; exact mode only needs its final sort. */
export function prepareInventoryPageGroups<T extends PrintingGroup>(
  printingGroups: T[],
  cardById: Map<string, any>,
  displayMode: "exact" | "grouped",
  sortField: string,
  sortDirection: "asc" | "desc",
  preferredProvider?: string | null,
) {
  const compare = (left: T, right: T) =>
    compareInventoryGroups(left, right, cardById, sortField, sortDirection, preferredProvider);
  const filteredGroups =
    displayMode === "grouped"
      ? groupInventoryPageGroupsByCardName(
          [...printingGroups].sort(compare),
          cardById,
        )
      : printingGroups;
  return { filteredGroups, sortedGroups: [...filteredGroups].sort(compare) };
}

/** Restrict hydration to selected finish groups without replacing any filters. */
export function inventoryPageScopeWhere(groups: Array<PrintingGroup & {
  cardIds?: string[]; foilStatus?: string; currentOwnerId?: string; condition?: string; language?: string;
}>, displayMode: "exact" | "grouped", rollupPrinting = false): Prisma.InventoryItemWhereInput {
  return { OR: groups.flatMap(group => (displayMode === "grouped" ? group.cardIds ?? [group.cardId] : [group.cardId]).map(cardId => ({
    cardId, foilStatus: group.foilStatus as FoilStatus,
    ...(displayMode === "exact" && !rollupPrinting ? { currentOwnerId: group.currentOwnerId, condition: group.condition, language: group.language } : {}),
  }))) };
}
