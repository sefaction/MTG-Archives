import { Card, DeckSection } from "@prisma/client";
import { prisma } from "./prisma";
import {
  findOrImportCard,
  normalizeCardName,
  normalizeCollectorNumber,
  normalizeSetCode,
  upsertScryfallCard,
} from "./card-import";
import { formatScryfallError, searchCardsResult } from "./scryfall";
import {
  cardPriceUsd,
  compareCheapestPlayableCards,
  getOwnershipByCard,
} from "./deck-search";

export type ParsedDecklistLine = {
  lineNumber: number;
  rawLine: string;
  quantity: number;
  cardName: string;
  setCode?: string;
  collectorNumber?: string;
  section: DeckSection;
  foil: boolean;
  warning?: string;
};

export type DeckImportStatus =
  | "OWNED_PRINTING_SELECTED"
  | "CHEAPEST_PRINTING_SELECTED"
  | "EXACT_PRINTING_SELECTED"
  | "NEEDS_REVIEW"
  | "NOT_FOUND"
  | "ERROR";

export type ResolvedDeckImportLine = ParsedDecklistLine & {
  status: DeckImportStatus;
  resolutionMethod: string;
  cardId?: string;
  scryfallId?: string;
  matchedName?: string;
  setName?: string | null;
  matchedSetCode?: string;
  collector?: string;
  rarity?: string;
  priceUsd?: number | null;
  ownedQuantity: number;
  locationSummary: string;
  error?: string;
};

export type DeckImportResolution = {
  lines: ResolvedDeckImportLine[];
  summary: {
    parsed: number;
    ownedMatches: number;
    localCacheHits: number;
    scryfallMatches: number;
    cheapestSelections: number;
    needsReview: number;
    notFound: number;
    dedupedLookups: number;
  };
};

const sectionMap: Record<string, DeckSection> = {
  commander: DeckSection.COMMANDER,
  commanders: DeckSection.COMMANDER,
  main: DeckSection.MAINBOARD,
  maindeck: DeckSection.MAINBOARD,
  mainboard: DeckSection.MAINBOARD,
  deck: DeckSection.MAINBOARD,
  side: DeckSection.SIDEBOARD,
  sideboard: DeckSection.SIDEBOARD,
  maybe: DeckSection.MAYBEBOARD,
  maybeboard: DeckSection.MAYBEBOARD,
  considering: DeckSection.MAYBEBOARD,
};

function parseSectionHeader(line: string) {
  return sectionMap[line.trim().replace(/:$/, "").toLowerCase()];
}

export function parseDecklistText(
  text: string,
  defaultSection: DeckSection = DeckSection.MAINBOARD,
): ParsedDecklistLine[] {
  const lines: ParsedDecklistLine[] = [];
  let section = defaultSection;
  text.split(/\r?\n/).forEach((raw, index) => {
    const rawLine = raw;
    let line = raw.trim();
    if (
      !line ||
      line.startsWith("//") ||
      line.startsWith("# ") ||
      line.startsWith(";")
    )
      return;
    const header = parseSectionHeader(line);
    if (header) {
      section = header;
      return;
    }
    line = line.replace(/^\d+\s+x\s+/i, (m) => m.replace(/x/i, ""));
    const qtyMatch = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!qtyMatch) {
      lines.push({
        lineNumber: index + 1,
        rawLine,
        quantity: 1,
        cardName: line,
        section,
        foil: /foil/i.test(line),
        warning: "Missing quantity; assumed 1.",
      });
      return;
    }
    const quantity = Math.max(1, Number(qtyMatch[1]));
    let rest = qtyMatch[2].trim();
    const foil = /\*F\*|\bfoil\b/i.test(rest);
    rest = rest.replace(/\*F\*|\bfoil\b/gi, "").trim();
    let setCode: string | undefined;
    let collectorNumber: string | undefined;

    const paren = rest.match(
      /^(.*?)\s*[\(\[]([A-Za-z0-9]{2,6})[\)\]]\s*#?([A-Za-z0-9-]+)?\s*$/,
    );
    if (paren) {
      rest = paren[1].trim();
      setCode = normalizeSetCode(paren[2]);
      collectorNumber = normalizeCollectorNumber(paren[3]);
    }
    const hash = rest.match(/^(.*?)\s+#([A-Za-z0-9-]+)\s*$/);
    if (hash) {
      rest = hash[1].trim();
      collectorNumber = normalizeCollectorNumber(hash[2]);
    }
    lines.push({
      lineNumber: index + 1,
      rawLine,
      quantity,
      cardName: rest,
      setCode,
      collectorNumber,
      section,
      foil,
      warning: rest ? undefined : "Missing card name.",
    });
  });
  return lines;
}

async function ownedPrintingsForName(ownerPlayerId: string, name: string) {
  const normalized = normalizeCardName(name);
  const items = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: ownerPlayerId,
      quantity: { gt: 0 },
      card: { name: { equals: name.trim(), mode: "insensitive" } },
    },
    include: { card: true, location: true },
  });
  const grouped = new Map<
    string,
    { card: Card; quantity: number; locations: string[] }
  >();
  for (const item of items.filter(
    (item) => normalizeCardName(item.card.name) === normalized,
  )) {
    const current = grouped.get(item.cardId) ?? {
      card: item.card,
      quantity: 0,
      locations: [],
    };
    current.quantity += item.quantity;
    if (item.location?.name && !current.locations.includes(item.location.name))
      current.locations.push(item.location.name);
    grouped.set(item.cardId, current);
  }
  return [...grouped.values()].sort((a, b) => {
    if (a.quantity !== b.quantity) return b.quantity - a.quantity;
    return compareCheapestPlayableCards(a.card, b.card);
  });
}

async function cheapestPrintingForName(
  name: string,
  cache: Map<string, Card[]>,
) {
  const key = normalizeCardName(name);
  if (cache.has(key)) return cache.get(key) ?? [];
  const local = (
    await prisma.card.findMany({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
    })
  ).filter((card) => normalizeCardName(card.name) === key);
  let candidates = local;
  if (candidates.length < 4) {
    const result = await searchCardsResult(
      `!"${name.trim().replace(/"/g, '\\"')}" unique:prints`,
    );
    if (result.ok) {
      const imported = await Promise.all(
        result.data.data.slice(0, 75).map((card) => upsertScryfallCard(card)),
      );
      const ids = new Set(candidates.map((card) => card.id));
      candidates = [
        ...candidates,
        ...imported.filter((card) => !ids.has(card.id)),
      ];
    } else if (candidates.length === 0) {
      throw new Error(formatScryfallError(result.error));
    }
  }
  candidates = candidates.sort(compareCheapestPlayableCards);
  cache.set(key, candidates);
  return candidates;
}

async function exactPrinting(line: ParsedDecklistLine) {
  if (!line.setCode || !line.collectorNumber) return null;
  const match = await findOrImportCard({
    name: line.cardName,
    setCode: line.setCode,
    collectorNumber: line.collectorNumber,
  });
  if (match.card) return match.card as Card;
  return null;
}

export async function resolveParsedDecklist(
  lines: ParsedDecklistLine[],
  ownerPlayerId?: string | null,
): Promise<DeckImportResolution> {
  const cheapestCache = new Map<string, Card[]>();
  const resolved: ResolvedDeckImportLine[] = [];
  for (const line of lines) {
    if (line.warning && !line.cardName) {
      resolved.push({
        ...line,
        status: "NEEDS_REVIEW",
        resolutionMethod: "Parse warning",
        ownedQuantity: 0,
        locationSummary: "",
      });
      continue;
    }
    try {
      let card: Card | null = null;
      let status: DeckImportStatus = "NEEDS_REVIEW";
      let method = "Needs review";
      if (line.setCode && line.collectorNumber) {
        card = await exactPrinting(line);
        status = card ? "EXACT_PRINTING_SELECTED" : "NOT_FOUND";
        method = card
          ? "Exact set/collector selected"
          : "Exact set/collector not found";
      } else if (ownerPlayerId) {
        const owned = await ownedPrintingsForName(ownerPlayerId, line.cardName);
        if (owned.length > 0) {
          card = owned[0].card;
          status = "OWNED_PRINTING_SELECTED";
          method =
            "Owned printing selected by quantity, price, and deterministic fallback";
        }
      }
      if (!card && status !== "NOT_FOUND") {
        const candidates = await cheapestPrintingForName(
          line.cardName,
          cheapestCache,
        );
        card = candidates[0] ?? null;
        status = card ? "CHEAPEST_PRINTING_SELECTED" : "NOT_FOUND";
        method = card
          ? "Cheapest playable paper English printing selected"
          : "No printing found";
      }
      if (!card) {
        resolved.push({
          ...line,
          status,
          resolutionMethod: method,
          ownedQuantity: 0,
          locationSummary: "",
        });
        continue;
      }
      const ownership = await getOwnershipByCard(ownerPlayerId, [card.id]);
      const exact = ownership.get(card.id);
      resolved.push({
        ...line,
        status,
        resolutionMethod: method,
        cardId: card.id,
        scryfallId: card.scryfallId,
        matchedName: card.name,
        setName: card.setName,
        matchedSetCode: card.setCode,
        collector: card.collectorNumber,
        rarity: card.rarity,
        priceUsd: cardPriceUsd(card),
        ownedQuantity: exact?.quantity ?? 0,
        locationSummary: exact?.locations.slice(0, 3).join(", ") ?? "",
      });
    } catch (error) {
      resolved.push({
        ...line,
        status: "ERROR",
        resolutionMethod: "Resolution error",
        ownedQuantity: 0,
        locationSummary: "",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return {
    lines: resolved,
    summary: {
      parsed: lines.length,
      ownedMatches: resolved.filter(
        (l) => l.status === "OWNED_PRINTING_SELECTED",
      ).length,
      localCacheHits: resolved.filter((l) => l.cardId).length,
      scryfallMatches: resolved.filter(
        (l) =>
          l.status === "CHEAPEST_PRINTING_SELECTED" ||
          l.status === "EXACT_PRINTING_SELECTED",
      ).length,
      cheapestSelections: resolved.filter(
        (l) => l.status === "CHEAPEST_PRINTING_SELECTED",
      ).length,
      needsReview: resolved.filter(
        (l) => l.status === "NEEDS_REVIEW" || l.status === "ERROR",
      ).length,
      notFound: resolved.filter((l) => l.status === "NOT_FOUND").length,
      dedupedLookups: cheapestCache.size,
    },
  };
}

export function mergeImportLines(
  lines: Array<{ cardId?: string; quantity: number; section: DeckSection }>,
) {
  const merged = new Map<
    string,
    { cardId: string; quantity: number; section: DeckSection }
  >();
  for (const line of lines) {
    if (!line.cardId) continue;
    const key = `${line.cardId}:${line.section}`;
    const current = merged.get(key) ?? {
      cardId: line.cardId,
      section: line.section,
      quantity: 0,
    };
    current.quantity += line.quantity;
    merged.set(key, current);
  }
  return [...merged.values()];
}
