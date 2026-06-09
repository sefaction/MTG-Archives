import {
  FoilStatus,
  InventoryLocationKind,
  InventorySourceType,
} from "@prisma/client";

export const INVENTORY_FILTER_PARAM_KEYS = [
  "cardName",
  "name",
  "oracleText",
  "typeLine",
  "type",
  "set",
  "rarity",
  "finish",
  "foil",
  "colors",
  "colorMode",
  "colorIdentity",
  "colorIdentityMode",
  "mvOp",
  "mv",
  "mvMin",
  "mvMax",
  "manaValueMin",
  "manaValueMax",
  "keyword",
  "priceMin",
  "priceMax",
  "locationId",
  "location",
  "hasLocation",
  "visibility",
  "source",
  "language",
  "ownerId",
  "commitment",
] as const;

export type ColorMode = "any" | "include" | "exact" | "atMost" | "atLeast";
export type NumericOp = "eq" | "lt" | "lte" | "gt" | "gte" | "between";

export type InventoryFilters = {
  cardName?: string;
  oracleText?: string;
  typeLine?: string;
  types: string[];
  sets: string[];
  rarities: string[];
  finishes: FoilStatus[];
  colors: string[];
  colorMode: ColorMode;
  colorIdentity: string[];
  colorIdentityMode: ColorMode;
  mvOp?: NumericOp;
  mv?: number;
  mvMin?: number;
  mvMax?: number;
  keyword?: string;
  priceMin?: number;
  priceMax?: number;
  locationIds: string[];
  includeUnassignedLocation: boolean;
  visibility?:
    | "public"
    | "private"
    | "inherit"
    | "explicitPublic"
    | "explicitPrivate";
  sources: InventorySourceType[];
  languages: string[];
  ownerId?: string;
  commitment?: "available" | "committed";
};

type ParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

const WUBRG = ["W", "U", "B", "R", "G"];
const ALL_COLORS = [...WUBRG, "C"];
const RARITIES = new Set([
  "common",
  "uncommon",
  "rare",
  "mythic",
  "special",
  "bonus",
]);
const FINISH_MAP: Record<string, FoilStatus> = {
  nonfoil: FoilStatus.NONFOIL,
  foil: FoilStatus.FOIL,
  etched: FoilStatus.ETCHED,
  NONFOIL: FoilStatus.NONFOIL,
  FOIL: FoilStatus.FOIL,
  ETCHED: FoilStatus.ETCHED,
};
const SOURCE_MAP: Record<string, InventorySourceType> = {
  import: InventorySourceType.CSV_PULL_IMPORT,
  manual: InventorySourceType.MANUAL,
  trade: InventorySourceType.TRADE,
  correction: InventorySourceType.CORRECTION,
  legacy: InventorySourceType.PULL,
  prize: InventorySourceType.PRIZE,
  other: InventorySourceType.OTHER,
  CSV_PULL_IMPORT: InventorySourceType.CSV_PULL_IMPORT,
  MANUAL: InventorySourceType.MANUAL,
  TRADE: InventorySourceType.TRADE,
  CORRECTION: InventorySourceType.CORRECTION,
  PULL: InventorySourceType.PULL,
  PRIZE: InventorySourceType.PRIZE,
  OTHER: InventorySourceType.OTHER,
};

function rawValues(params: ParamSource, key: string) {
  if (params instanceof URLSearchParams)
    return params.getAll(key).filter(Boolean);
  const value = params[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function text(params: ParamSource, ...keys: string[]) {
  for (const key of keys) {
    const value = rawValues(params, key)[0]?.trim();
    if (value) return value;
  }
  return undefined;
}

function list(params: ParamSource, key: string) {
  return rawValues(params, key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberValue(params: ParamSource, key: string) {
  const value = text(params, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function modeValue(value?: string): ColorMode {
  if (
    value === "exact" ||
    value === "atMost" ||
    value === "atLeast" ||
    value === "any"
  )
    return value;
  return "include";
}

function opValue(value?: string): NumericOp | undefined {
  if (
    value === "eq" ||
    value === "lt" ||
    value === "lte" ||
    value === "gt" ||
    value === "gte" ||
    value === "between"
  )
    return value;
  return undefined;
}

function normalizeColors(values: string[]) {
  const expanded = values.flatMap((value) =>
    value.length > 1 && !value.includes(" ") ? value.split("") : [value],
  );
  return Array.from(
    new Set(
      expanded
        .map((value) => value.toUpperCase())
        .filter((value) => ALL_COLORS.includes(value)),
    ),
  );
}

export function parseInventoryFilters(params: ParamSource): InventoryFilters {
  const legacyFoil = text(params, "foil");
  const finishes = list(params, "finish")
    .map((value) => FINISH_MAP[value])
    .filter(Boolean);
  if (!finishes.length && legacyFoil === "true")
    finishes.push(FoilStatus.FOIL, FoilStatus.ETCHED);
  if (!finishes.length && legacyFoil === "false")
    finishes.push(FoilStatus.NONFOIL);

  const legacyMvMin = numberValue(params, "manaValueMin");
  const legacyMvMax = numberValue(params, "manaValueMax");
  const mvOp =
    opValue(text(params, "mvOp")) ??
    (legacyMvMin !== undefined || legacyMvMax !== undefined
      ? "between"
      : undefined);

  return {
    cardName: text(params, "cardName", "name"),
    oracleText: text(params, "oracleText"),
    typeLine: text(params, "typeLine"),
    types: Array.from(
      new Set(list(params, "type").map((v) => v.toLowerCase())),
    ),
    sets: Array.from(new Set(list(params, "set").map((v) => v.toLowerCase()))),
    rarities: Array.from(
      new Set(
        list(params, "rarity")
          .map((v) => v.toLowerCase())
          .filter((v) => RARITIES.has(v)),
      ),
    ),
    finishes: Array.from(new Set(finishes)),
    colors: normalizeColors(list(params, "colors")),
    colorMode: modeValue(text(params, "colorMode")),
    colorIdentity: normalizeColors(list(params, "colorIdentity")),
    colorIdentityMode: modeValue(text(params, "colorIdentityMode")),
    mvOp,
    mv: numberValue(params, "mv"),
    mvMin: numberValue(params, "mvMin") ?? legacyMvMin,
    mvMax: numberValue(params, "mvMax") ?? legacyMvMax,
    keyword: text(params, "keyword"),
    priceMin: numberValue(params, "priceMin"),
    priceMax: numberValue(params, "priceMax"),
    locationIds: Array.from(
      new Set(
        [...list(params, "locationId"), ...list(params, "location")].filter(
          (v) => v !== "unassigned",
        ),
      ),
    ),
    includeUnassignedLocation:
      list(params, "locationId").includes("unassigned") ||
      list(params, "location").includes("unassigned") ||
      text(params, "hasLocation") === "unassigned",
    visibility: text(params, "visibility") as InventoryFilters["visibility"],
    sources: Array.from(
      new Set(
        list(params, "source")
          .map((value) => SOURCE_MAP[value])
          .filter(Boolean),
      ),
    ),
    languages: Array.from(
      new Set(list(params, "language").map((v) => v.toUpperCase())),
    ),
    ownerId: text(params, "ownerId"),
    commitment: text(params, "commitment") as InventoryFilters["commitment"],
  };
}

function appendAnd(where: any, condition: any) {
  where.AND = [...(where.AND || []), condition];
}

function mergeCardWhere(where: any, cardWhere: any) {
  where.card = { ...(where.card || {}), ...cardWhere };
}

function manaValueCondition(filters: InventoryFilters) {
  const op = filters.mvOp;
  if (!op) return undefined;
  if (op === "between") {
    if (filters.mvMin === undefined && filters.mvMax === undefined)
      return undefined;
    return { gte: filters.mvMin, lte: filters.mvMax };
  }
  if (filters.mv === undefined) return undefined;
  if (op === "eq") return filters.mv;
  if (op === "lt") return { lt: filters.mv };
  if (op === "lte") return { lte: filters.mv };
  if (op === "gt") return { gt: filters.mv };
  if (op === "gte") return { gte: filters.mv };
}

export function buildInventoryWhereFromFilters(
  filters: InventoryFilters,
  options: {
    adminModeActive?: boolean;
    playerId?: string | null;
    publicOnly?: boolean;
  } = {},
) {
  const where: any = { quantity: { gt: 0 } };
  if (filters.cardName) {
    const search = filters.cardName;
    where.OR = [
      { card: { name: { contains: search, mode: "insensitive" } } },
      { card: { setCode: { contains: search.toLowerCase() } } },
      { card: { setName: { contains: search, mode: "insensitive" } } },
      { card: { collectorNumber: { contains: search, mode: "insensitive" } } },
      { card: { typeLine: { contains: search, mode: "insensitive" } } },
      { location: { name: { contains: search, mode: "insensitive" } } },
    ];
  }
  if (filters.oracleText)
    mergeCardWhere(where, {
      oracleText: { contains: filters.oracleText, mode: "insensitive" },
    });
  if (filters.typeLine)
    mergeCardWhere(where, {
      typeLine: { contains: filters.typeLine, mode: "insensitive" },
    });
  if (filters.types.length)
    appendAnd(where, {
      OR: filters.types.map((type) => ({
        card: { typeLine: { contains: type, mode: "insensitive" } },
      })),
    });
  if (filters.sets.length)
    appendAnd(where, {
      OR: filters.sets.flatMap((set) => [
        { card: { setCode: { equals: set, mode: "insensitive" } } },
        { card: { setName: { contains: set, mode: "insensitive" } } },
      ]),
    });
  if (filters.rarities.length)
    mergeCardWhere(where, { rarity: { in: filters.rarities } });
  const manaValue = manaValueCondition(filters);
  if (manaValue !== undefined) mergeCardWhere(where, { manaValue });
  if (filters.finishes.length) where.foilStatus = { in: filters.finishes };
  if (filters.sources.length) where.sourceType = { in: filters.sources };
  if (filters.languages.length) where.language = { in: filters.languages };

  if (!options.adminModeActive)
    where.currentOwnerId = options.playerId || "__no_owner__";
  else if (filters.ownerId) where.currentOwnerId = filters.ownerId;

  if (filters.locationIds.length || filters.includeUnassignedLocation) {
    const locationOr: any[] = [];
    if (filters.locationIds.length)
      locationOr.push({ locationId: { in: filters.locationIds } });
    if (filters.includeUnassignedLocation)
      locationOr.push(
        { locationId: null },
        { location: { normalizedName: "unassigned" } },
      );
    appendAnd(where, { OR: locationOr });
  }
  if (filters.commitment === "available")
    appendAnd(where, {
      OR: [
        { locationId: null },
        { location: { kind: InventoryLocationKind.NORMAL } },
      ],
    });
  if (filters.commitment === "committed")
    where.location = {
      ...(where.location || {}),
      kind: InventoryLocationKind.DECK,
    };

  if (options.publicOnly || filters.visibility === "public")
    appendAnd(where, {
      OR: [
        { location: { visibility: "PUBLIC" } },
        {
          location: { visibility: "INHERIT" },
          currentOwner: {
            users: { some: { inventoryDefaultVisibility: "PUBLIC" } },
          },
        },
        {
          locationId: null,
          currentOwner: {
            users: { some: { inventoryDefaultVisibility: "PUBLIC" } },
          },
        },
      ],
    });
  if (!options.publicOnly && filters.visibility === "private")
    appendAnd(where, {
      OR: [
        { location: { visibility: "PRIVATE" } },
        {
          location: { visibility: "INHERIT" },
          currentOwner: {
            users: { some: { inventoryDefaultVisibility: "PRIVATE" } },
          },
        },
        {
          locationId: null,
          currentOwner: {
            users: { some: { inventoryDefaultVisibility: "PRIVATE" } },
          },
        },
      ],
    });
  if (!options.publicOnly && filters.visibility === "inherit")
    appendAnd(where, {
      OR: [{ location: { visibility: "INHERIT" } }, { locationId: null }],
    });
  if (!options.publicOnly && filters.visibility === "explicitPublic")
    where.location = { ...(where.location || {}), visibility: "PUBLIC" };
  if (!options.publicOnly && filters.visibility === "explicitPrivate")
    where.location = { ...(where.location || {}), visibility: "PRIVATE" };

  return where;
}

export function normalizeColorArray(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeColors(value.map(String));
  if (typeof value === "string")
    return normalizeColors(value.replace(/[\[\]"']/g, "").split(/[,\s]+/));
  return [];
}

export function matchesColors(
  actualValue: unknown,
  selected: string[],
  mode: ColorMode,
) {
  if (!selected.length) return true;
  const wantsColorless = selected.includes("C");
  const selectedWubrg = selected.filter((color) => color !== "C");
  const actual = normalizeColorArray(actualValue).filter(
    (color) => color !== "C",
  );
  const actualSet = new Set(actual);
  const selectedSet = new Set(selectedWubrg);
  if (wantsColorless && !selectedWubrg.length) return actual.length === 0;
  if (wantsColorless && actual.length === 0 && mode === "any") return true;
  if (mode === "any")
    return selectedWubrg.some((color) => actualSet.has(color));
  if (mode === "include" || mode === "atLeast")
    return selectedWubrg.every((color) => actualSet.has(color));
  if (mode === "atMost") return actual.every((color) => selectedSet.has(color));
  if (mode === "exact")
    return (
      actual.length === selectedWubrg.length &&
      actual.every((color) => selectedSet.has(color))
    );
  return true;
}

function priceUsd(card: any) {
  const prices = card?.prices as any;
  const value = prices?.usd ?? prices?.usd_foil ?? prices?.usd_etched;
  const number =
    value === undefined || value === null || value === ""
      ? undefined
      : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function inventoryCardMatchesPostFilters(
  card: any,
  filters: InventoryFilters,
) {
  if (
    filters.colorIdentity.length &&
    !matchesColors(
      card?.colorIdentity,
      filters.colorIdentity,
      filters.colorIdentityMode,
    )
  )
    return false;
  if (
    filters.colors.length &&
    !matchesColors(card?.colors, filters.colors, filters.colorMode)
  )
    return false;
  if (filters.keyword) {
    const keywords = Array.isArray(card?.keywords)
      ? card.keywords.join(" ")
      : JSON.stringify(card?.keywords ?? "");
    if (!keywords.toLowerCase().includes(filters.keyword.toLowerCase()))
      return false;
  }
  const usd = priceUsd(card);
  if (
    filters.priceMin !== undefined &&
    (usd === undefined || usd < filters.priceMin)
  )
    return false;
  if (
    filters.priceMax !== undefined &&
    (usd === undefined || usd > filters.priceMax)
  )
    return false;
  return true;
}

export function removeInventoryFilterParams(params: URLSearchParams) {
  INVENTORY_FILTER_PARAM_KEYS.forEach((key) => params.delete(key));
  params.delete("page");
  return params;
}
