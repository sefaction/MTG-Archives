import { DeckSection } from "@prisma/client";
import { isBasicLandCard } from "./card-types";

export type DeckViewMode = "text" | "grid" | "spoiler";
export type DeckGroupMode =
  | "type"
  | "section"
  | "mana"
  | "color"
  | "rarity"
  | "set"
  | "owned";
export type DeckSortMode =
  | "name"
  | "mana"
  | "type"
  | "color"
  | "price"
  | "owned"
  | "set"
  | "added";

export type DeckViewRow = {
  id: string;
  cardName: string;
  section: DeckSection;
  quantity: number;
  exactOwned: number;
  otherOwned: number;
  missing: number;
  isBasicLand?: boolean;
  createdAt?: string | Date | null;
  card: {
    name: string;
    manaCost: string | null;
    typeLine: string;
    setCode: string;
    collectorNumber: string;
    rarity: string;
    prices: unknown;
    manaValue?: number | null;
    colorIdentity?: unknown;
    colors?: unknown;
  } | null;
};

const sectionOrder = [
  DeckSection.COMMANDER,
  DeckSection.MAINBOARD,
  DeckSection.SIDEBOARD,
  DeckSection.MAYBEBOARD,
];

const typeGroups = [
  "Commander",
  "Creatures",
  "Planeswalkers",
  "Artifacts",
  "Enchantments",
  "Instants",
  "Sorceries",
  "Lands",
  "Sideboard",
  "Maybeboard",
  "Other",
];

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export function cardPriceNumber(prices: unknown) {
  const values = (prices ?? {}) as Record<string, string | null | undefined>;
  const value = values.usd ?? values.usd_foil ?? values.usd_etched;
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function cardManaValue(row: DeckViewRow) {
  const manaValue = row.card?.manaValue;
  return typeof manaValue === "number" && Number.isFinite(manaValue)
    ? manaValue
    : 0;
}

export function cardColorLabel(row: DeckViewRow) {
  const colors = asStringArray(
    row.card?.colorIdentity ?? row.card?.colors,
  ).sort();
  if (colors.length === 0) return "Colorless";
  if (colors.length >= 5) return "Five-color";
  return colors.join("");
}

export function ownershipStatus(row: DeckViewRow) {
  if (row.isBasicLand || isBasicLandCard(row.card)) return "Basic land";
  if (row.exactOwned >= row.quantity) return "Owned exact";
  if (row.exactOwned + row.otherOwned >= row.quantity)
    return "Owned other printing";
  if (row.exactOwned > 0 || row.otherOwned > 0) return "Partial";
  return "Missing";
}

export function typeGroup(row: DeckViewRow) {
  if (row.section === DeckSection.COMMANDER) return "Commander";
  if (row.section === DeckSection.SIDEBOARD) return "Sideboard";
  if (row.section === DeckSection.MAYBEBOARD) return "Maybeboard";
  const typeLine = row.card?.typeLine.toLowerCase() ?? "";
  if (typeLine.includes("land")) return "Lands";
  if (typeLine.includes("creature")) return "Creatures";
  if (typeLine.includes("planeswalker")) return "Planeswalkers";
  if (typeLine.includes("artifact")) return "Artifacts";
  if (typeLine.includes("enchantment")) return "Enchantments";
  if (typeLine.includes("instant")) return "Instants";
  if (typeLine.includes("sorcery")) return "Sorceries";
  return "Other";
}

export function manaValueBucket(row: DeckViewRow) {
  if (row.card?.typeLine.toLowerCase().includes("land")) return "Lands";
  const value = Math.floor(cardManaValue(row));
  return value >= 6 ? "6+" : String(Math.max(0, value));
}

export function groupLabel(row: DeckViewRow, mode: DeckGroupMode) {
  switch (mode) {
    case "type":
      return typeGroup(row);
    case "section":
      return row.section;
    case "mana":
      return manaValueBucket(row);
    case "color":
      return cardColorLabel(row);
    case "rarity":
      return row.card?.rarity || "Unknown rarity";
    case "set":
      return row.card?.setCode.toUpperCase() || "No set";
    case "owned":
      return ownershipStatus(row);
  }
}

function groupRank(label: string, mode: DeckGroupMode) {
  if (mode === "type")
    return typeGroups.indexOf(label) === -1 ? 999 : typeGroups.indexOf(label);
  if (mode === "section") return sectionOrder.indexOf(label as DeckSection);
  if (mode === "mana")
    return label === "Lands" ? 99 : label === "6+" ? 6 : Number(label);
  if (mode === "owned")
    return [
      "Owned exact",
      "Owned other printing",
      "Basic land",
      "Partial",
      "Missing",
    ].indexOf(label);
  return 0;
}

export function compareDeckRows(
  a: DeckViewRow,
  b: DeckViewRow,
  mode: DeckSortMode,
) {
  let result = 0;
  switch (mode) {
    case "name":
      result = a.cardName.localeCompare(b.cardName);
      break;
    case "mana":
      result = cardManaValue(a) - cardManaValue(b);
      break;
    case "type":
      result = typeGroup(a).localeCompare(typeGroup(b));
      break;
    case "color":
      result = cardColorLabel(a).localeCompare(cardColorLabel(b));
      break;
    case "price": {
      const ap = cardPriceNumber(a.card?.prices);
      const bp = cardPriceNumber(b.card?.prices);
      result =
        (ap ?? Number.POSITIVE_INFINITY) - (bp ?? Number.POSITIVE_INFINITY);
      break;
    }
    case "owned":
      result = ownershipStatus(a).localeCompare(ownershipStatus(b));
      break;
    case "set":
      result =
        `${a.card?.setCode ?? ""}:${a.card?.collectorNumber ?? ""}`.localeCompare(
          `${b.card?.setCode ?? ""}:${b.card?.collectorNumber ?? ""}`,
        );
      break;
    case "added":
      result =
        new Date(a.createdAt ?? 0).getTime() -
        new Date(b.createdAt ?? 0).getTime();
      break;
  }
  if (result !== 0) return result;
  const sectionResult =
    sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section);
  if (sectionResult !== 0) return sectionResult;
  const nameResult = a.cardName.localeCompare(b.cardName);
  if (nameResult !== 0) return nameResult;
  return a.id.localeCompare(b.id);
}

export function buildDeckGroups<T extends DeckViewRow>(
  rows: T[],
  groupMode: DeckGroupMode,
  sortMode: DeckSortMode,
) {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const label = groupLabel(row, groupMode);
    buckets.set(label, [...(buckets.get(label) ?? []), row]);
  }
  return [...buckets.entries()]
    .map(([label, groupRows]) => ({
      label,
      rows: [...groupRows].sort((a, b) => compareDeckRows(a, b, sortMode)),
      quantity: groupRows.reduce((total, row) => total + row.quantity, 0),
    }))
    .sort((a, b) => {
      const rank =
        groupRank(a.label, groupMode) - groupRank(b.label, groupMode);
      if (rank !== 0) return rank;
      return a.label.localeCompare(b.label);
    });
}
