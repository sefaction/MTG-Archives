import { normalizedListQuery } from "./list-browse";

export const deckCardTypes = [
  "Creature",
  "Planeswalker",
  "Artifact",
  "Enchantment",
  "Instant",
  "Sorcery",
  "Land",
  "Battle",
  "Other",
] as const;
export type DeckCardStatus =
  | "all"
  | "missing"
  | "exact"
  | "other"
  | "committed"
  | "pool-exact"
  | "pool-other"
  | "pool-outside";
export type DeckCardFilters = {
  query: string;
  section: string;
  type: string;
  status: DeckCardStatus;
};
export type DeckFilterCapabilities = { ownership: boolean; pool: boolean };
type SearchParams = Pick<URLSearchParams, "get">;
export const deckCardBrowseKeys = [
  "cardQ",
  "cardSection",
  "cardType",
  "cardStatus",
  "deckView",
  "deckGroup",
  "deckSort",
] as const;
export function deckToolContextHref(href: string, params: SearchParams) {
  const url = new URL(href, "http://local.invalid");
  for (const key of deckCardBrowseKeys) {
    const value = params.get(key);
    if (value) url.searchParams.set(key, value.slice(0, 200));
  }
  return url.pathname + url.search + url.hash;
}
export const privateDeckStatuses = [
  "missing",
  "exact",
  "other",
  "committed",
] as const;
export const poolDeckStatuses = [
  "pool-exact",
  "pool-other",
  "pool-outside",
] as const;

export function readDeckCardFilters(
  params: SearchParams,
  capabilities: DeckFilterCapabilities,
  sections: readonly string[] = [
    "COMMANDER",
    "MAINBOARD",
    "SIDEBOARD",
    "MAYBEBOARD",
  ],
): DeckCardFilters {
  const section = params.get("cardSection") || "";
  const type = params.get("cardType") || "";
  const status = params.get("cardStatus") || "all";
  const allowedStatuses: readonly string[] = [
    "all",
    ...(capabilities.ownership ? privateDeckStatuses : []),
    ...(capabilities.pool ? poolDeckStatuses : []),
  ];
  return {
    query: (params.get("cardQ") || "").slice(0, 200),
    section: sections.includes(section) ? section : "",
    type: (deckCardTypes as readonly string[]).includes(type) ? type : "",
    status: allowedStatuses.includes(status)
      ? (status as DeckCardStatus)
      : "all",
  };
}

type FilterableRow = {
  id: string;
  cardName: string;
  section: string;
  quantity: number;
  exactOwned: number;
  otherOwned: number;
  missing: number;
  committedQuantity?: number;
  leaguePoolStatus?: "IN_POOL" | "OTHER_PRINTING" | "OUTSIDE_POOL";
  card: { name: string; typeLine: string } | null;
};
function hasType(typeLine: string, type: string) {
  // A subtype such as Island must not turn a creature into a Land match.
  return new RegExp(`\\b${type}\\b`, "i").test(typeLine.split("—")[0]);
}
export function filterDeckCards<T extends FilterableRow>(
  rows: readonly T[],
  filters: DeckCardFilters,
  capabilities: DeckFilterCapabilities,
): T[] {
  const needle = normalizedListQuery(filters.query);
  return rows.filter((row) => {
    if (
      needle &&
      ![row.cardName, row.card?.name || ""].some((name) =>
        normalizedListQuery(name).includes(needle),
      )
    )
      return false;
    if (filters.section && row.section !== filters.section) return false;
    if (filters.type) {
      const typeLine = row.card?.typeLine || "";
      if (
        filters.type === "Other"
          ? deckCardTypes.some(
              (type) => type !== "Other" && hasType(typeLine, type),
            )
          : !hasType(typeLine, filters.type)
      )
        return false;
    }
    if (capabilities.ownership) {
      if (filters.status === "missing" && row.missing <= 0) return false;
      if (filters.status === "exact" && row.exactOwned < row.quantity)
        return false;
      if (
        filters.status === "other" &&
        (row.otherOwned <= 0 || row.exactOwned >= row.quantity)
      )
        return false;
      if (filters.status === "committed" && (row.committedQuantity || 0) <= 0)
        return false;
    }
    if (capabilities.pool) {
      if (filters.status === "pool-exact" && row.leaguePoolStatus !== "IN_POOL")
        return false;
      if (
        filters.status === "pool-other" &&
        row.leaguePoolStatus !== "OTHER_PRINTING"
      )
        return false;
      if (
        filters.status === "pool-outside" &&
        row.leaguePoolStatus !== "OUTSIDE_POOL"
      )
        return false;
    }
    return true;
  });
}
