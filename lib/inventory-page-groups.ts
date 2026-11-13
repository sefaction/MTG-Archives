import { groupInventoryPageGroupsByCardName } from "./inventory-locations";
import { compareInventoryGroups } from "./inventory-sort";

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
) {
  const compare = (left: T, right: T) =>
    compareInventoryGroups(left, right, cardById, sortField, sortDirection);
  const filteredGroups =
    displayMode === "grouped"
      ? groupInventoryPageGroupsByCardName(
          [...printingGroups].sort(compare),
          cardById,
        )
      : printingGroups;
  return { filteredGroups, sortedGroups: [...filteredGroups].sort(compare) };
}
