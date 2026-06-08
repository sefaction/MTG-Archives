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

export type DeckImportStatus =
  | "RESOLVED_EXACT_PRINTING"
  | "RESOLVED_OWNED_PRINTING"
  | "RESOLVED_CHEAPEST_PRINTING"
  | "MANUALLY_SELECTED"
  | "NEEDS_REVIEW"
  | "AMBIGUOUS"
  | "NOT_FOUND"
  | "PARSE_WARNING"
  | "PARSE_ERROR"
  | "SKIPPED"
  | "ERROR";

export type DeckImportCardSummary = {
  cardId: string;
  scryfallId: string;
  name: string;
  setCode: string;
  setName: string | null;
  collectorNumber: string;
  rarity: string;
  priceUsd: number | null;
};

export type DeckImportReviewLine = {
  id: string;
  rawLine: string;
  lineNumber: number;
  section: DeckSection | null;
  quantity: number | null;
  parsedName: string | null;
  parsedSetCode: string | null;
  parsedCollectorNumber: string | null;
  foil: boolean | null;
  selectedCardId: string | null;
  selectedCardSummary: DeckImportCardSummary | null;
  ownedQuantity: number;
  locationSummary: string | null;
  resolutionStatus: DeckImportStatus;
  resolutionMessage: string;
  warnings: string[];
  errors: string[];
  included: boolean;
};

export type DeckImportResolution = {
  lines: DeckImportReviewLine[];
  skippedLines: DeckImportReviewLine[];
  summary: {
    totalPastedLines: number;
    parsedCardLines: number;
    resolved: number;
    ownedMatches: number;
    cheapestSelections: number;
    exactMatches: number;
    manualSelections: number;
    needsReview: number;
    ambiguous: number;
    notFound: number;
    parseWarnings: number;
    parseErrors: number;
    errors: number;
    skipped: number;
    excluded: number;
    readyToCommit: number;
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
  creatures: DeckSection.MAINBOARD,
  artifacts: DeckSection.MAINBOARD,
  enchantments: DeckSection.MAINBOARD,
  instants: DeckSection.MAINBOARD,
  sorceries: DeckSection.MAINBOARD,
  planeswalkers: DeckSection.MAINBOARD,
  lands: DeckSection.MAINBOARD,
  side: DeckSection.SIDEBOARD,
  sideboard: DeckSection.SIDEBOARD,
  maybe: DeckSection.MAYBEBOARD,
  maybeboard: DeckSection.MAYBEBOARD,
  considering: DeckSection.MAYBEBOARD,
};

function reviewId(lineNumber: number) {
  return `line-${lineNumber}`;
}

function parseSectionHeader(line: string) {
  return sectionMap[line.trim().replace(/:$/, "").toLowerCase()];
}

function emptyReviewLine(input: {
  rawLine: string;
  lineNumber: number;
  section: DeckSection | null;
  quantity?: number | null;
  parsedName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  foil?: boolean | null;
  status: DeckImportStatus;
  message: string;
  warnings?: string[];
  errors?: string[];
  included?: boolean;
}): DeckImportReviewLine {
  return {
    id: reviewId(input.lineNumber),
    rawLine: input.rawLine,
    lineNumber: input.lineNumber,
    section: input.section,
    quantity: input.quantity ?? null,
    parsedName: input.parsedName ?? null,
    parsedSetCode: input.setCode ?? null,
    parsedCollectorNumber: input.collectorNumber ?? null,
    foil: input.foil ?? null,
    selectedCardId: null,
    selectedCardSummary: null,
    ownedQuantity: 0,
    locationSummary: null,
    resolutionStatus: input.status,
    resolutionMessage: input.message,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
    included: input.included ?? true,
  };
}

export function parseDecklistText(
  text: string,
  defaultSection: DeckSection = DeckSection.MAINBOARD,
): { lines: DeckImportReviewLine[]; skippedLines: DeckImportReviewLine[] } {
  const lines: DeckImportReviewLine[] = [];
  const skippedLines: DeckImportReviewLine[] = [];
  let section = defaultSection;
  text.split(/\r?\n/).forEach((raw, index) => {
    const rawLine = raw;
    let line = raw.trim();
    const lineNumber = index + 1;
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
      skippedLines.push(
        emptyReviewLine({
          rawLine,
          lineNumber,
          section,
          status: "SKIPPED",
          message: `Section header mapped to ${section.toLowerCase()}.`,
          included: false,
        }),
      );
      return;
    }

    line = line.replace(/^\d+\s+x\s+/i, (m) => m.replace(/x/i, ""));
    const qtyMatch = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const warnings: string[] = [];
    if (!qtyMatch) {
      const parsedName = line.trim();
      warnings.push("Missing quantity; assumed 1.");
      lines.push(
        emptyReviewLine({
          rawLine,
          lineNumber,
          quantity: 1,
          parsedName,
          section,
          foil: /foil/i.test(line),
          status: parsedName ? "PARSE_WARNING" : "PARSE_ERROR",
          message: parsedName
            ? "Could not find an explicit quantity; assumed 1 and needs verification."
            : "Could not parse this line.",
          warnings,
          errors: parsedName ? [] : ["Missing card name."],
        }),
      );
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
      if (setCode && !collectorNumber) {
        warnings.push("Set code was provided without a collector number.");
      }
    }
    const hash = rest.match(/^(.*?)\s+#([A-Za-z0-9-]+)\s*$/);
    if (hash) {
      rest = hash[1].trim();
      collectorNumber = normalizeCollectorNumber(hash[2]);
      if (!setCode)
        warnings.push("Collector number was provided without a set code.");
    }

    lines.push(
      emptyReviewLine({
        rawLine,
        lineNumber,
        quantity,
        parsedName: rest,
        setCode,
        collectorNumber,
        section,
        foil,
        status: rest
          ? warnings.length
            ? "PARSE_WARNING"
            : "NEEDS_REVIEW"
          : "PARSE_ERROR",
        message: rest
          ? "Parsed and queued for resolution."
          : "Could not parse this line.",
        warnings,
        errors: rest ? [] : ["Missing card name."],
      }),
    );
  });
  return { lines, skippedLines };
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

async function exactPrinting(line: DeckImportReviewLine) {
  if (!line.parsedSetCode || !line.parsedCollectorNumber || !line.parsedName)
    return null;
  const match = await findOrImportCard({
    name: line.parsedName,
    setCode: line.parsedSetCode,
    collectorNumber: line.parsedCollectorNumber,
  });
  if (match.card) return match.card as Card;
  return null;
}

function cardSummary(card: Card): DeckImportCardSummary {
  return {
    cardId: card.id,
    scryfallId: card.scryfallId,
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    priceUsd: cardPriceUsd(card),
  };
}

async function withSelectedCard(
  line: DeckImportReviewLine,
  card: Card,
  status: DeckImportStatus,
  message: string,
  ownerPlayerId?: string | null,
) {
  const ownership = await getOwnershipByCard(ownerPlayerId, [card.id]);
  const exact = ownership.get(card.id);
  return {
    ...line,
    selectedCardId: card.id,
    selectedCardSummary: cardSummary(card),
    ownedQuantity: exact?.quantity ?? 0,
    locationSummary: exact?.locations.slice(0, 3).join(", ") ?? null,
    resolutionStatus: status,
    resolutionMessage: message,
    included: true,
  } satisfies DeckImportReviewLine;
}

export async function resolveParsedDecklist(
  parsed:
    | { lines: DeckImportReviewLine[]; skippedLines: DeckImportReviewLine[] }
    | DeckImportReviewLine[],
  ownerPlayerId?: string | null,
): Promise<DeckImportResolution> {
  const inputLines = Array.isArray(parsed) ? parsed : parsed.lines;
  const skippedLines = Array.isArray(parsed) ? [] : parsed.skippedLines;
  const cheapestCache = new Map<string, Card[]>();
  const resolved: DeckImportReviewLine[] = [];

  for (const line of inputLines) {
    if (!line.parsedName || line.resolutionStatus === "PARSE_ERROR") {
      resolved.push({
        ...line,
        resolutionStatus: "PARSE_ERROR",
        resolutionMessage:
          line.resolutionMessage || "Could not parse this line.",
        included: false,
      });
      continue;
    }
    try {
      let card: Card | null = null;
      if (line.parsedSetCode && line.parsedCollectorNumber) {
        card = await exactPrinting(line);
        if (card) {
          resolved.push(
            await withSelectedCard(
              line,
              card,
              "RESOLVED_EXACT_PRINTING",
              "Exact printing selected.",
              ownerPlayerId,
            ),
          );
        } else {
          resolved.push({
            ...line,
            resolutionStatus: "NOT_FOUND",
            resolutionMessage: "Exact set/collector number was not found.",
            errors: [
              ...line.errors,
              "Exact set/collector number was not found.",
            ],
          });
        }
        continue;
      }

      if (ownerPlayerId) {
        const owned = await ownedPrintingsForName(
          ownerPlayerId,
          line.parsedName,
        );
        if (owned.length > 0) {
          resolved.push(
            await withSelectedCard(
              line,
              owned[0].card,
              "RESOLVED_OWNED_PRINTING",
              "Owned printing selected by quantity, price, and deterministic fallback.",
              ownerPlayerId,
            ),
          );
          continue;
        }
      }

      const candidates = await cheapestPrintingForName(
        line.parsedName,
        cheapestCache,
      );
      card = candidates[0] ?? null;
      if (card) {
        resolved.push(
          await withSelectedCard(
            line,
            card,
            "RESOLVED_CHEAPEST_PRINTING",
            "Cheapest playable paper English printing selected.",
            ownerPlayerId,
          ),
        );
      } else {
        resolved.push({
          ...line,
          resolutionStatus: "NOT_FOUND",
          resolutionMessage: `No card found for "${line.parsedName}".`,
          errors: [...line.errors, `No card found for "${line.parsedName}".`],
        });
      }
    } catch (error) {
      resolved.push({
        ...line,
        resolutionStatus: "ERROR",
        resolutionMessage:
          error instanceof Error ? error.message : "Resolution error.",
        errors: [
          ...line.errors,
          error instanceof Error ? error.message : "Resolution error.",
        ],
      });
    }
  }
  return buildDeckImportResolution(resolved, skippedLines, cheapestCache.size);
}

export function buildDeckImportResolution(
  lines: DeckImportReviewLine[],
  skippedLines: DeckImportReviewLine[] = [],
  dedupedLookups = 0,
): DeckImportResolution {
  const resolvedStatuses: DeckImportStatus[] = [
    "RESOLVED_EXACT_PRINTING",
    "RESOLVED_OWNED_PRINTING",
    "RESOLVED_CHEAPEST_PRINTING",
    "MANUALLY_SELECTED",
  ];
  return {
    lines,
    skippedLines,
    summary: {
      totalPastedLines: lines.length + skippedLines.length,
      parsedCardLines: lines.length,
      resolved: lines.filter((line) =>
        resolvedStatuses.includes(line.resolutionStatus),
      ).length,
      ownedMatches: lines.filter(
        (line) => line.resolutionStatus === "RESOLVED_OWNED_PRINTING",
      ).length,
      cheapestSelections: lines.filter(
        (line) => line.resolutionStatus === "RESOLVED_CHEAPEST_PRINTING",
      ).length,
      exactMatches: lines.filter(
        (line) => line.resolutionStatus === "RESOLVED_EXACT_PRINTING",
      ).length,
      manualSelections: lines.filter(
        (line) => line.resolutionStatus === "MANUALLY_SELECTED",
      ).length,
      needsReview: lines.filter(
        (line) => line.resolutionStatus === "NEEDS_REVIEW",
      ).length,
      ambiguous: lines.filter((line) => line.resolutionStatus === "AMBIGUOUS")
        .length,
      notFound: lines.filter((line) => line.resolutionStatus === "NOT_FOUND")
        .length,
      parseWarnings: lines.filter(
        (line) =>
          line.resolutionStatus === "PARSE_WARNING" || line.warnings.length > 0,
      ).length,
      parseErrors: lines.filter(
        (line) => line.resolutionStatus === "PARSE_ERROR",
      ).length,
      errors: lines.filter(
        (line) => line.resolutionStatus === "ERROR" || line.errors.length > 0,
      ).length,
      skipped: skippedLines.length,
      excluded: lines.filter((line) => !line.included).length,
      readyToCommit: lines.filter(
        (line) => line.included && Boolean(line.selectedCardId),
      ).length,
      dedupedLookups,
    },
  };
}

export function mergeImportLines(
  lines: Array<{
    cardId?: string;
    selectedCardId?: string | null;
    quantity?: number | null;
    section?: DeckSection | null;
    included?: boolean;
  }>,
) {
  const merged = new Map<
    string,
    { cardId: string; quantity: number; section: DeckSection }
  >();
  for (const line of lines) {
    const cardId = line.cardId ?? line.selectedCardId ?? undefined;
    if (!cardId || line.included === false || !line.section || !line.quantity)
      continue;
    const key = `${cardId}:${line.section}`;
    const current = merged.get(key) ?? {
      cardId,
      section: line.section,
      quantity: 0,
    };
    current.quantity += line.quantity;
    merged.set(key, current);
  }
  return [...merged.values()];
}
