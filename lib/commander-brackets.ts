import { prisma } from "./prisma";
import {
  formatScryfallError,
  searchCardsResult,
  type ScryfallCard,
} from "./scryfall";

const DEFAULT_SCRYFALL_GAME_CHANGER_QUERY = "is:gamechanger";

export const DEFAULT_COMMANDER_BRACKET_RULES = {
  bracketCount: 5,
  gameChangerPolicy: {
    bracket1: "No Game Changers expected.",
    bracket2: "Very limited Game Changers; precon or low-upgrade intent.",
    bracket3: "Limited Game Changers and moderate optimization.",
    bracket4: "High-power decks; Game Changers are expected.",
    bracket5: "Top-end/cEDH intent; unrestricted by bracket heuristics.",
  },
  analysisInputs: [
    "gameChangers",
    "commanderGameChangers",
    "fastMana",
    "tutors",
    "freeInteraction",
    "extraTurns",
    "stax",
    "earlyCombos",
  ],
};

export type CommanderBracketSourceEntry = {
  cardName: string;
  oracleId?: string | null;
  scryfallId?: string | null;
  reason?: string | null;
};

export type CommanderBracketRefreshResult = {
  ruleSetId: string;
  name: string;
  version: string;
  source: string;
  sourceUrl: string | null;
  gameChangerCount: number;
};

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function entryFromUnknown(value: unknown): CommanderBracketSourceEntry | null {
  if (typeof value === "string") {
    const cardName = value.trim();
    return cardName ? { cardName } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const cardName =
    stringOrNull(record.cardName) ??
    stringOrNull(record.name) ??
    stringOrNull(record.card_name);
  if (!cardName) return null;
  return {
    cardName,
    oracleId: stringOrNull(record.oracleId) ?? stringOrNull(record.oracle_id),
    scryfallId:
      stringOrNull(record.scryfallId) ??
      stringOrNull(record.scryfall_id) ??
      stringOrNull(record.id),
    reason: stringOrNull(record.reason),
  };
}

function isCommanderBracketSourceEntry(
  value: CommanderBracketSourceEntry | null,
): value is CommanderBracketSourceEntry {
  return Boolean(value);
}

function entriesFromSourceJson(json: unknown) {
  if (Array.isArray(json)) {
    return json.map(entryFromUnknown).filter(isCommanderBracketSourceEntry);
  }
  if (!json || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  const entries =
    record.gameChangers ??
    record.game_changers ??
    record.cards ??
    record.data ??
    [];
  return Array.isArray(entries)
    ? entries.map(entryFromUnknown).filter(isCommanderBracketSourceEntry)
    : [];
}

function sourceMetadataFromJson(json: unknown, sourceUrl: string) {
  const record =
    json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  return {
    name: stringOrNull(record.name) ?? "Commander Brackets Game Changers",
    version:
      stringOrNull(record.version) ??
      stringOrNull(record.updatedAt) ??
      stringOrNull(record.updated_at) ??
      new Date().toISOString().slice(0, 10),
    source: stringOrNull(record.source) ?? "json",
    sourceUrl:
      stringOrNull(record.sourceUrl) ??
      stringOrNull(record.source_url) ??
      sourceUrl,
    effectiveAt:
      stringOrNull(record.effectiveAt) ?? stringOrNull(record.effective_at),
    rulesJson:
      record.rules && typeof record.rules === "object"
        ? record.rules
        : DEFAULT_COMMANDER_BRACKET_RULES,
  };
}

function entryFromScryfallCard(
  card: ScryfallCard,
): CommanderBracketSourceEntry {
  return {
    cardName: card.name,
    oracleId: card.oracle_id ?? null,
    scryfallId: card.id,
  };
}

function dedupeGameChangers(entries: CommanderBracketSourceEntry[]) {
  const byStableKey = new Map<string, CommanderBracketSourceEntry>();
  for (const entry of entries) {
    const cardName = entry.cardName.trim();
    if (!cardName) continue;
    const key =
      entry.oracleId?.trim() ||
      entry.scryfallId?.trim() ||
      cardName.toLowerCase();
    if (!byStableKey.has(key)) {
      byStableKey.set(key, {
        ...entry,
        cardName,
        oracleId: entry.oracleId?.trim() || null,
        scryfallId: entry.scryfallId?.trim() || null,
        reason: entry.reason?.trim() || null,
      });
    }
  }
  return Array.from(byStableKey.values()).sort((left, right) =>
    left.cardName.localeCompare(right.cardName),
  );
}

async function loadFromJsonSource(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Commander bracket source failed with HTTP ${response.status}.`,
    );
  }
  const json = await response.json();
  return {
    ...sourceMetadataFromJson(json, sourceUrl),
    gameChangers: dedupeGameChangers(entriesFromSourceJson(json)),
  };
}

async function loadFromScryfallSearch() {
  const query =
    process.env.COMMANDER_BRACKET_SCRYFALL_QUERY ||
    DEFAULT_SCRYFALL_GAME_CHANGER_QUERY;
  const result = await searchCardsResult(query);
  if (!result.ok) {
    throw new Error(
      `Scryfall Game Changer search failed: ${formatScryfallError(result.error)}`,
    );
  }
  const sourceUrl = `https://scryfall.com/search?q=${encodeURIComponent(query)}`;
  return {
    name: "Commander Brackets Game Changers",
    version: new Date().toISOString().slice(0, 10),
    source: "scryfall",
    sourceUrl,
    effectiveAt: null,
    rulesJson: DEFAULT_COMMANDER_BRACKET_RULES,
    gameChangers: dedupeGameChangers(
      result.data.data.map(entryFromScryfallCard),
    ),
  };
}

export async function refreshCommanderBracketMetadata(): Promise<CommanderBracketRefreshResult> {
  const configuredSource = process.env.COMMANDER_BRACKET_RULESET_URL?.trim();
  const loaded = configuredSource
    ? await loadFromJsonSource(configuredSource)
    : await loadFromScryfallSearch();

  if (!loaded.gameChangers.length) {
    throw new Error("Commander bracket refresh found no Game Changer cards.");
  }

  const effectiveAt = loaded.effectiveAt ? new Date(loaded.effectiveAt) : null;
  const ruleSet = await prisma.$transaction(async (tx) => {
    await tx.commanderBracketRuleSet.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    return tx.commanderBracketRuleSet.create({
      data: {
        name: loaded.name,
        version: loaded.version,
        source: loaded.source,
        sourceUrl: loaded.sourceUrl,
        effectiveAt:
          effectiveAt && Number.isFinite(effectiveAt.getTime())
            ? effectiveAt
            : null,
        isActive: true,
        rulesJson: loaded.rulesJson,
        gameChangers: {
          create: loaded.gameChangers.map((entry) => ({
            cardName: entry.cardName,
            oracleId: entry.oracleId,
            scryfallId: entry.scryfallId,
            reason: entry.reason,
          })),
        },
      },
      include: { _count: { select: { gameChangers: true } } },
    });
  });

  return {
    ruleSetId: ruleSet.id,
    name: ruleSet.name,
    version: ruleSet.version,
    source: ruleSet.source,
    sourceUrl: ruleSet.sourceUrl,
    gameChangerCount: ruleSet._count.gameChangers,
  };
}

export async function getActiveCommanderBracketRuleSetSummary() {
  return prisma.commanderBracketRuleSet.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { gameChangers: true } } },
  });
}
