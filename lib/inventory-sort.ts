export const INVENTORY_SORT_FIELDS = [
  "cardName",
  "quantity",
  "setCode",
  "collectorNumber",
  "releasedAt",
  "rarity",
  "manaCost",
  "manaValue",
  "typeLine",
  "colorIdentity",
  "priceUsd",
  "preferredPriceLabel",
  "foilStatus",
  "locationName",
  "locationSummary",
  "currentOwner",
  "sourceType",
  "effectiveVisibility",
] as const;

const RARITY_RANK: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  mythic: 4,
  mythic_rare: 4,
  special: 5,
  bonus: 6,
};

const FINISH_RANK: Record<string, number> = {
  NONFOIL: 1,
  NORMAL: 1,
  FOIL: 2,
  ETCHED: 3,
};

const COLOR_RANK: Record<string, number> = { W: 1, U: 2, B: 3, R: 4, G: 5 };

export function parseCollectorNumber(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d+)(.*)$/);
  return {
    number: match ? Number(match[1]) : Number.POSITIVE_INFINITY,
    suffix: (match?.[2] ?? raw).toLowerCase(),
    raw,
  };
}

export function colorIdentitySortKey(value: unknown) {
  const tokens = Array.isArray(value)
    ? value
    : String(value ?? "")
        .replace(/[\[\]"]/g, "")
        .split(/[\s,]+/)
        .filter(Boolean);
  const unique = Array.from(
    new Set(tokens.map((token) => token.toUpperCase())),
  );
  if (!unique.length) return "0";
  if (unique.length > 1) {
    return `9-${unique.map((token) => COLOR_RANK[token] ?? 8).join("-")}`;
  }
  return String(COLOR_RANK[unique[0]] ?? 8);
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(
    typeof value === "object" && "toString" in value ? value.toString() : value,
  );
  return Number.isFinite(numeric) ? numeric : null;
}

function scryfallUsdPrice(card: any) {
  return numberOrNull(
    card?.prices?.usd ?? card?.prices?.usd_foil ?? card?.prices?.usd_etched,
  );
}

export function inventorySortValue(
  group: any,
  card: any,
  sortField: string,
  preferredProvider?: string | null,
) {
  const field = sortField === "preferredPriceLabel" ? "priceUsd" : sortField;
  switch (field) {
    case "quantity":
      return {
        kind: "number",
        value: group?._sum?.quantity ?? group?.quantity ?? 0,
      };
    case "setCode":
      return { kind: "string", value: card?.setCode ?? "" };
    case "collectorNumber":
      return {
        kind: "collector",
        value: parseCollectorNumber(card?.collectorNumber),
      };
    case "releasedAt":
      return {
        kind: "number",
        value: card?.releasedAt ? new Date(card.releasedAt).getTime() : null,
        nullsLast: true,
      };
    case "rarity":
      return {
        kind: "number",
        value: RARITY_RANK[String(card?.rarity ?? "").toLowerCase()] ?? 99,
      };
    case "manaValue":
      return {
        kind: "number",
        value: numberOrNull(card?.manaValue),
        nullsLast: true,
      };
    case "manaCost":
      return {
        kind: "number",
        value: numberOrNull(card?.manaValue),
        nullsLast: true,
        fallback: card?.manaCost ?? "",
      };
    case "typeLine":
      return { kind: "string", value: card?.typeLine ?? "" };
    case "colorIdentity":
      return {
        kind: "string",
        value: colorIdentitySortKey(card?.colorIdentity),
      };
    case "priceUsd": {
      return {
        kind: "number",
        value: scryfallUsdPrice(card),
        nullsLast: true,
      };
    }
    case "foilStatus":
      return {
        kind: "number",
        value: FINISH_RANK[String(group?.foilStatus ?? "NONFOIL")] ?? 99,
      };
    case "locationName":
    case "locationSummary":
      return {
        kind: "string",
        value: group?.locationName ?? group?.locationSummary ?? "",
      };
    case "currentOwner":
      return {
        kind: "string",
        value: group?.currentOwner ?? group?.currentOwnerId ?? "",
      };
    default:
      return { kind: "string", value: card?.name ?? group?.cardName ?? "" };
  }
}

export function compareInventorySortValues(
  left: any,
  right: any,
  direction: "asc" | "desc" = "asc",
) {
  const multiplier = direction === "desc" ? -1 : 1;
  if (left?.kind === "collector" || right?.kind === "collector") {
    const l = left.value;
    const r = right.value;
    const numberCompare = (l.number - r.number) * multiplier;
    if (numberCompare) return numberCompare;
    return (
      String(l.suffix).localeCompare(String(r.suffix), undefined, {
        numeric: true,
      }) * multiplier
    );
  }
  const leftNull =
    left?.value === null ||
    left?.value === undefined ||
    Number.isNaN(left?.value);
  const rightNull =
    right?.value === null ||
    right?.value === undefined ||
    Number.isNaN(right?.value);
  if (leftNull || rightNull) {
    if (leftNull && rightNull) return 0;
    return leftNull ? 1 : -1;
  }
  if (left?.kind === "number" || right?.kind === "number") {
    const diff = Number(left.value) - Number(right.value);
    if (diff) return diff * multiplier;
    if (left.fallback || right.fallback) {
      return (
        String(left.fallback ?? "").localeCompare(
          String(right.fallback ?? ""),
          undefined,
          {
            sensitivity: "base",
            numeric: true,
          },
        ) * multiplier
      );
    }
    return 0;
  }
  return (
    String(left?.value ?? "").localeCompare(
      String(right?.value ?? ""),
      undefined,
      {
        sensitivity: "base",
        numeric: true,
      },
    ) * multiplier
  );
}

export function compareInventoryGroups(
  left: any,
  right: any,
  cardById: Map<string, any>,
  sortField: string,
  sortDirection: "asc" | "desc",
  preferredProvider?: string | null,
) {
  const primary = compareInventorySortValues(
    inventorySortValue(
      left,
      cardById.get(left.cardId),
      sortField,
      preferredProvider,
    ),
    inventorySortValue(
      right,
      cardById.get(right.cardId),
      sortField,
      preferredProvider,
    ),
    sortDirection,
  );
  if (primary) return primary;
  return String(left.cardId ?? "").localeCompare(
    String(right.cardId ?? ""),
    undefined,
    {
      sensitivity: "base",
      numeric: true,
    },
  );
}
