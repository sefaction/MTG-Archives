import { DeckSection } from "@prisma/client";
import type { DeckSnapshotEntry } from "./deck-snapshot";

const PERMANENT_TYPES = [
  "artifact",
  "battle",
  "creature",
  "enchantment",
  "planeswalker",
];
const MAX_EXACT_MANA_BUCKET = 12;

export type ManaCurveCard = {
  id: string;
  cardName: string;
  quantity: number;
  manaValue: number;
  typeLine: string;
  category: "permanent" | "spell";
  section: DeckSection;
};

export type ManaCurveBucket = {
  key: number;
  label: string;
  permanentQuantity: number;
  spellQuantity: number;
  totalQuantity: number;
  cards: ManaCurveCard[];
};

export type ManaCurveAnalysis = {
  buckets: ManaCurveBucket[];
  includedQuantity: number;
  countedQuantity: number;
  spellQuantity: number;
  landQuantity: number;
  unresolvedQuantity: number;
  totalManaValue: number;
  averageWithLands: number | null;
  averageWithoutLands: number | null;
  medianManaValue: number | null;
};

function normalizedTypeLines(entry: DeckSnapshotEntry) {
  const faces = entry.card?.cardFaces
    .map((face) => face.typeLine.trim().toLowerCase())
    .filter(Boolean);
  if (faces?.length) return faces;
  return (entry.card?.typeLine ?? "")
    .split("//")
    .map((typeLine) => typeLine.trim().toLowerCase())
    .filter(Boolean);
}

export function hasCastableNonlandFace(entry: DeckSnapshotEntry) {
  const typeLines = normalizedTypeLines(entry);
  return (
    typeLines.length > 0 &&
    typeLines.some((typeLine) => !typeLine.includes("land"))
  );
}

export function isLandOnlyDeckEntry(entry: DeckSnapshotEntry) {
  const typeLines = normalizedTypeLines(entry);
  return (
    typeLines.length > 0 &&
    typeLines.some((typeLine) => typeLine.includes("land")) &&
    !typeLines.some((typeLine) => !typeLine.includes("land"))
  );
}

export function isPermanentDeckEntry(entry: DeckSnapshotEntry) {
  return normalizedTypeLines(entry)
    .filter((typeLine) => !typeLine.includes("land"))
    .some((typeLine) =>
      PERMANENT_TYPES.some((permanentType) => typeLine.includes(permanentType)),
    );
}

function includedEntry(entry: DeckSnapshotEntry, includeCommanders: boolean) {
  if (entry.section === DeckSection.MAINBOARD) return true;
  return (
    includeCommanders &&
    (entry.section === DeckSection.COMMANDER || entry.isCommander)
  );
}

function weightedMedian(values: Array<{ value: number; quantity: number }>) {
  const total = values.reduce((sum, entry) => sum + entry.quantity, 0);
  if (!total) return null;
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const lowerIndex = Math.floor((total - 1) / 2);
  const upperIndex = Math.floor(total / 2);
  let cursor = 0;
  let lower = 0;
  let upper = 0;
  for (const entry of sorted) {
    const end = cursor + entry.quantity;
    if (lowerIndex >= cursor && lowerIndex < end) lower = entry.value;
    if (upperIndex >= cursor && upperIndex < end) upper = entry.value;
    cursor = end;
  }
  return (lower + upper) / 2;
}

export function analyzeManaCurve(
  entries: DeckSnapshotEntry[],
  includeCommanders = true,
): ManaCurveAnalysis {
  const included = entries.filter((entry) =>
    includedEntry(entry, includeCommanders),
  );
  const unresolvedQuantity = included.reduce((total, entry) => {
    const manaValue = entry.card?.manaValue;
    return (
      total +
      (!entry.card ||
      typeof manaValue !== "number" ||
      !Number.isFinite(manaValue)
        ? Math.max(0, entry.quantity)
        : 0)
    );
  }, 0);
  const resolved = included.filter(
    (entry) =>
      entry.card &&
      typeof entry.card.manaValue === "number" &&
      Number.isFinite(entry.card.manaValue),
  );
  const curveCards = resolved
    .filter(hasCastableNonlandFace)
    .map((entry): ManaCurveCard => {
      const manaValue = Math.max(0, entry.card?.manaValue ?? 0);
      return {
        id: entry.id,
        cardName: entry.cardName,
        quantity: Math.max(0, entry.quantity),
        manaValue,
        typeLine: entry.card?.typeLine ?? "",
        category: isPermanentDeckEntry(entry) ? "permanent" : "spell",
        section: entry.section,
      };
    });
  const maximumManaValue = curveCards.reduce(
    (maximum, card) => Math.max(maximum, Math.floor(card.manaValue)),
    0,
  );
  const lastBucket = Math.min(MAX_EXACT_MANA_BUCKET, maximumManaValue);
  const hasOverflow = maximumManaValue > MAX_EXACT_MANA_BUCKET;
  const buckets: ManaCurveBucket[] = Array.from(
    { length: Math.max(1, lastBucket + 1) },
    (_, key) => ({
      key,
      label:
        hasOverflow && key === MAX_EXACT_MANA_BUCKET
          ? `${MAX_EXACT_MANA_BUCKET}+`
          : String(key),
      permanentQuantity: 0,
      spellQuantity: 0,
      totalQuantity: 0,
      cards: [],
    }),
  );
  for (const card of curveCards) {
    const key = Math.min(MAX_EXACT_MANA_BUCKET, Math.floor(card.manaValue));
    const bucket = buckets[key]!;
    bucket.cards.push(card);
    bucket.totalQuantity += card.quantity;
    if (card.category === "permanent") {
      bucket.permanentQuantity += card.quantity;
    } else {
      bucket.spellQuantity += card.quantity;
    }
  }

  const countedQuantity = resolved.reduce(
    (total, entry) => total + Math.max(0, entry.quantity),
    0,
  );
  const spellQuantity = curveCards.reduce(
    (total, card) => total + card.quantity,
    0,
  );
  const landQuantity = resolved
    .filter(isLandOnlyDeckEntry)
    .reduce((total, entry) => total + Math.max(0, entry.quantity), 0);
  const totalManaValue = resolved.reduce(
    (total, entry) =>
      total + (entry.card?.manaValue ?? 0) * Math.max(0, entry.quantity),
    0,
  );
  const nonlandManaValue = curveCards.reduce(
    (total, card) => total + card.manaValue * card.quantity,
    0,
  );

  return {
    buckets,
    includedQuantity: included.reduce(
      (total, entry) => total + Math.max(0, entry.quantity),
      0,
    ),
    countedQuantity,
    spellQuantity,
    landQuantity,
    unresolvedQuantity,
    totalManaValue,
    averageWithLands: countedQuantity ? totalManaValue / countedQuantity : null,
    averageWithoutLands: spellQuantity
      ? nonlandManaValue / spellQuantity
      : null,
    medianManaValue: weightedMedian(
      curveCards.map((card) => ({
        value: card.manaValue,
        quantity: card.quantity,
      })),
    ),
  };
}
