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
export const MANA_PRODUCTION_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

export type ManaProductionColor = (typeof MANA_PRODUCTION_COLORS)[number];

export type ManaProductionContributor = {
  id: string;
  cardName: string;
  quantity: number;
  detail: string;
  section: DeckSection;
};

export type ManaProductionColorAnalysis = {
  color: ManaProductionColor;
  fixedDemand: number;
  flexibleDemand: number;
  demandPercent: number;
  sourceCount: number;
  sourcePercent: number;
  warning: string | null;
  spells: ManaProductionContributor[];
  lands: ManaProductionContributor[];
};

export type ManaProductionAnalysis = {
  colors: ManaProductionColorAnalysis[];
  includedQuantity: number;
  landQuantity: number;
  totalDemandSymbols: number;
  snowDemand: number;
  missingProductionQuantity: number;
  incomplete: boolean;
};

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

export function hasLandFace(entry: DeckSnapshotEntry) {
  return normalizedTypeLines(entry).some((typeLine) =>
    typeLine.includes("land"),
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

function spellManaCosts(entry: DeckSnapshotEntry) {
  const faceCosts =
    entry.card?.cardFaces
      .filter((face) => !face.typeLine.trim().toLowerCase().includes("land"))
      .map((face) => face.manaCost?.trim())
      .filter((cost): cost is string => Boolean(cost)) ?? [];
  if (faceCosts.length) return Array.from(new Set(faceCosts));
  return (entry.card?.manaCost ?? "")
    .split(/\s*\/\/\s*/)
    .map((cost) => cost.trim())
    .filter(Boolean);
}

function manaSymbols(cost: string) {
  return Array.from(cost.matchAll(/\{([^}]+)\}/g), (match) =>
    match[1]!.toUpperCase(),
  );
}

function zeroColorCounts() {
  return Object.fromEntries(
    MANA_PRODUCTION_COLORS.map((color) => [color, { fixed: 0, flexible: 0 }]),
  ) as Record<ManaProductionColor, { fixed: number; flexible: number }>;
}

function contributorBuckets(): Record<
  ManaProductionColor,
  ManaProductionContributor[]
> {
  return { W: [], U: [], B: [], R: [], G: [], C: [] };
}

export function analyzeManaProduction(
  entries: DeckSnapshotEntry[],
  includeCommanders = true,
): ManaProductionAnalysis {
  const included = entries.filter((entry) =>
    includedEntry(entry, includeCommanders),
  );
  const demand = zeroColorCounts();
  const spellContributors = contributorBuckets();
  const landContributors = contributorBuckets();
  const sources = Object.fromEntries(
    MANA_PRODUCTION_COLORS.map((color) => [color, 0]),
  ) as Record<ManaProductionColor, number>;
  let totalDemandSymbols = 0;
  let snowDemand = 0;
  let landQuantity = 0;
  let missingProductionQuantity = 0;

  for (const entry of included) {
    const quantity = Math.max(0, entry.quantity);
    if (!entry.card || !quantity) continue;

    const costs = hasCastableNonlandFace(entry) ? spellManaCosts(entry) : [];
    const entryDemand = zeroColorCounts();
    const faceAlternative = costs.length > 1;
    for (const cost of costs) {
      for (const symbol of manaSymbols(cost)) {
        if (symbol === "S") {
          snowDemand += quantity;
          continue;
        }
        const parts = symbol.split("/");
        const colors = Array.from(
          new Set(
            parts.filter((part): part is ManaProductionColor =>
              MANA_PRODUCTION_COLORS.includes(part as ManaProductionColor),
            ),
          ),
        );
        if (!colors.length) continue;
        totalDemandSymbols += quantity;
        const flexible = faceAlternative || parts.length > 1;
        for (const color of colors) {
          const bucket = demand[color];
          const entryBucket = entryDemand[color];
          if (flexible) {
            bucket.flexible += quantity;
            entryBucket.flexible += quantity;
          } else {
            bucket.fixed += quantity;
            entryBucket.fixed += quantity;
          }
        }
      }
    }
    for (const color of MANA_PRODUCTION_COLORS) {
      const colorDemand = entryDemand[color];
      if (!colorDemand.fixed && !colorDemand.flexible) continue;
      spellContributors[color].push({
        id: entry.id,
        cardName: entry.cardName,
        quantity,
        detail: costs.join(" // "),
        section: entry.section,
      });
    }

    if (!hasLandFace(entry)) continue;
    landQuantity += quantity;
    if (entry.card.producedMana == null) {
      missingProductionQuantity += quantity;
      continue;
    }
    const produced = new Set(
      entry.card.producedMana.filter((color): color is ManaProductionColor =>
        MANA_PRODUCTION_COLORS.includes(color as ManaProductionColor),
      ),
    );
    for (const color of produced) {
      sources[color] += quantity;
      landContributors[color].push({
        id: entry.id,
        cardName: entry.cardName,
        quantity,
        detail: entry.card.typeLine,
        section: entry.section,
      });
    }
  }

  return {
    colors: MANA_PRODUCTION_COLORS.map((color) => {
      const representedDemand = demand[color].fixed + demand[color].flexible;
      const demandPercent = totalDemandSymbols
        ? (representedDemand / totalDemandSymbols) * 100
        : 0;
      const sourcePercent = landQuantity
        ? (sources[color] / landQuantity) * 100
        : 0;
      const gap = demandPercent - sourcePercent;
      return {
        color,
        fixedDemand: demand[color].fixed,
        flexibleDemand: demand[color].flexible,
        demandPercent,
        sourceCount: sources[color],
        sourcePercent,
        warning:
          demand[color].fixed > 0 && sources[color] === 0
            ? `No lands are known to produce ${color}.`
            : demand[color].fixed >= 2 && gap >= 12
              ? `Potential ${color} sources trail represented demand by ${Math.round(gap)} percentage points.`
              : null,
        spells: spellContributors[color],
        lands: landContributors[color],
      };
    }),
    includedQuantity: included.reduce(
      (total, entry) => total + Math.max(0, entry.quantity),
      0,
    ),
    landQuantity,
    totalDemandSymbols,
    snowDemand,
    missingProductionQuantity,
    incomplete: missingProductionQuantity > 0,
  };
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
