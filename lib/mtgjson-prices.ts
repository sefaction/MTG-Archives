import { Prisma } from "@prisma/client";

export const DEFAULT_MTGJSON_BASE_URL = "https://mtgjson.com/api/v5";
export const MTGJSON_PRICE_FILES = {
  today: "AllPricesToday.json",
  history: "AllPrices.json",
} as const;
export const MTGJSON_IDENTIFIER_FILE = "AllIdentifiers.json";

export type MtgjsonPriceImportKind = keyof typeof MTGJSON_PRICE_FILES;
export type MtgjsonPriceSnapshotInput = {
  mtgjsonUuid: string;
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  price: string;
  observedDate: Date;
};
export type MtgjsonPriceImportReport = {
  source: MtgjsonPriceImportKind;
  totalMtgjsonCards: number;
  localCards: number;
  localCardsWithMtgjsonUuidBefore: number;
  localCardsWithoutMtgjsonUuidBefore: number;
  localCardsMappedThisRun: number;
  ambiguousLocalCards: number;
  unmatchedLocalCards: number;
  matchedLocalCards: number;
  unmatchedUuids: number;
  snapshotsSkippedForUnmappedUuid: number;
  snapshotsParsed: number;
  snapshotsInserted: number;
  duplicatesSkipped: number;
  providersImported: string[];
  errors: string[];
  memorySafeImporter?: string;
};
export type MtgjsonCardMappingReport = {
  scanned: number;
  localCards: number;
  localCardsWithMtgjsonUuidBefore: number;
  localCardsWithoutMtgjsonUuidBefore: number;
  mapped: number;
  alreadyMapped: number;
  ambiguous: number;
  unmatched: number;
};
export type MtgjsonImportProgress = Partial<MtgjsonPriceImportReport> & {
  phase: string;
  scannedMtgjsonCards?: number;
  mtgjsonCardsScanned?: number;
  alreadyMapped?: number;
  mappedThisRun?: number;
  ambiguousSkipped?: number;
};
export type MtgjsonProgressCallback = (
  progress: MtgjsonImportProgress,
) => Promise<void> | void;

type PricePoints = Record<string, Record<string, unknown> | undefined>;
type PriceList = {
  currency?: unknown;
  buylist?: PricePoints;
  retail?: PricePoints;
};
type PriceFormats = Record<
  string,
  Record<string, PriceList | undefined> | undefined
>;

function cleanKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function mtgjsonBaseUrl() {
  return (process.env.MTGJSON_BASE_URL || DEFAULT_MTGJSON_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

export function mtgjsonPriceFileUrl(kind: MtgjsonPriceImportKind) {
  return `${mtgjsonBaseUrl()}/${MTGJSON_PRICE_FILES[kind]}`;
}

export function mtgjsonIdentifierFileUrl() {
  return `${mtgjsonBaseUrl()}/${MTGJSON_IDENTIFIER_FILE}`;
}

export function normalizeMtgjsonObservedDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseMtgjsonPriceSnapshotsForCard(
  mtgjsonUuid: string,
  formats: unknown,
): MtgjsonPriceSnapshotInput[] {
  if (!formats || typeof formats !== "object") return [];
  const snapshots: MtgjsonPriceSnapshotInput[] = [];
  for (const [_medium, providers] of Object.entries(formats as PriceFormats)) {
    if (!providers || typeof providers !== "object") continue;
    for (const [providerRaw, list] of Object.entries(providers)) {
      if (!list || typeof list !== "object") continue;
      const currency = String(list.currency || "")
        .trim()
        .toUpperCase();
      if (!currency) continue;
      for (const priceTypeRaw of ["retail", "buylist"] as const) {
        const points = list[priceTypeRaw];
        if (!points || typeof points !== "object") continue;
        for (const [finishRaw, datedPrices] of Object.entries(points)) {
          if (!datedPrices || typeof datedPrices !== "object") continue;
          for (const [dateRaw, priceRaw] of Object.entries(datedPrices)) {
            const observedDate = normalizeMtgjsonObservedDate(dateRaw);
            const priceNumber = Number(priceRaw);
            if (
              !observedDate ||
              !Number.isFinite(priceNumber) ||
              priceNumber <= 0
            )
              continue;
            snapshots.push({
              mtgjsonUuid,
              provider: cleanKey(providerRaw),
              finish: cleanKey(finishRaw),
              priceType: cleanKey(priceTypeRaw),
              currency,
              price: priceNumber.toFixed(4),
              observedDate,
            });
          }
        }
      }
    }
  }
  return snapshots;
}

export function parseMtgjsonPricePayload(payload: unknown) {
  const data = (payload as any)?.data;
  if (!data || typeof data !== "object") {
    throw new Error(
      "Invalid MTGJSON price payload: expected data object keyed by card UUID.",
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  return entries.flatMap(([uuid, formats]) =>
    parseMtgjsonPriceSnapshotsForCard(uuid, formats),
  );
}

export async function fetchMtgjsonPriceResponse(kind: MtgjsonPriceImportKind) {
  const url = mtgjsonPriceFileUrl(kind);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`MTGJSON download failed (${response.status}) for ${url}`);
  }
  return response;
}

export async function fetchMtgjsonIdentifierPayload() {
  const response = await fetchMtgjsonIdentifierResponse();
  return response.json();
}

export async function fetchMtgjsonIdentifierResponse() {
  const url = mtgjsonIdentifierFileUrl();
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`MTGJSON download failed (${response.status}) for ${url}`);
  }
  return response;
}

function normalizeIdentifierText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
}

function normalizeCollectorNumber(value: unknown) {
  return normalizeIdentifierText(value).replace(/^0+(?=\d)/, "");
}

function tupleKey(parts: unknown[]) {
  return parts.map(normalizeIdentifierText).join("|");
}

function addCandidate(map: Map<string, string[]>, key: string, cardId: string) {
  if (!key || key.includes("||")) return;
  const values = map.get(key) || [];
  values.push(cardId);
  map.set(key, values);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

type PriceEntry = { uuid: string; formats?: unknown };
type MtgjsonIdentifierEntry = { uuid: string; card: any };
type LocalMtgjsonMappingCard = {
  id: string;
  scryfallId: string | null;
  mtgjsonUuid: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  name: string;
  lang: string | null;
};

async function localCardDiagnostics(
  db: Pick<Prisma.TransactionClient, "card">,
) {
  const [localCards, localCardsWithMtgjsonUuidBefore] = await Promise.all([
    "count" in db.card ? db.card.count() : Promise.resolve(0),
    "count" in db.card
      ? db.card.count({ where: { mtgjsonUuid: { not: null } } })
      : Promise.resolve(0),
  ]);
  return {
    localCards,
    localCardsWithMtgjsonUuidBefore,
    localCardsWithoutMtgjsonUuidBefore: Math.max(
      0,
      localCards - localCardsWithMtgjsonUuidBefore,
    ),
  };
}

async function mappedLocalCardsByUuid(
  db: Pick<Prisma.TransactionClient, "card">,
) {
  const cards = await db.card.findMany({
    where: { mtgjsonUuid: { not: null } },
    select: { id: true, mtgjsonUuid: true },
  });
  return new Map(
    cards.flatMap((card) =>
      card.mtgjsonUuid ? [[card.mtgjsonUuid, card.id] as const] : [],
    ),
  );
}

function zeroMappingReport(
  source: MtgjsonPriceImportKind,
  diagnostics: Awaited<ReturnType<typeof localCardDiagnostics>>,
  mappingReport?: MtgjsonCardMappingReport | null,
): MtgjsonPriceImportReport {
  return {
    source,
    totalMtgjsonCards: 0,
    localCards: mappingReport?.localCards ?? diagnostics.localCards,
    localCardsWithMtgjsonUuidBefore:
      mappingReport?.localCardsWithMtgjsonUuidBefore ??
      diagnostics.localCardsWithMtgjsonUuidBefore,
    localCardsWithoutMtgjsonUuidBefore:
      mappingReport?.localCardsWithoutMtgjsonUuidBefore ??
      diagnostics.localCardsWithoutMtgjsonUuidBefore,
    localCardsMappedThisRun: mappingReport?.mapped ?? 0,
    ambiguousLocalCards: mappingReport?.ambiguous ?? 0,
    unmatchedLocalCards: mappingReport?.unmatched ?? 0,
    matchedLocalCards: 0,
    unmatchedUuids: 0,
    snapshotsSkippedForUnmappedUuid: 0,
    snapshotsParsed: 0,
    snapshotsInserted: 0,
    duplicatesSkipped: 0,
    providersImported: [],
    errors: [
      "No local cards are mapped to MTGJSON UUIDs yet. Run MTGJSON card mapping before importing prices.",
    ],
    memorySafeImporter: "early-exit-no-price-download",
  };
}

async function insertPriceRows(
  db: Pick<Prisma.TransactionClient, "cardPriceSnapshot">,
  rows: Prisma.CardPriceSnapshotCreateManyInput[],
) {
  if (!rows.length) return 0;
  const result = await db.cardPriceSnapshot.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

export async function* streamMtgjsonPriceEntriesFromTextChunks(
  chunks: AsyncIterable<string>,
  wantedUuids?: Set<string>,
): AsyncGenerator<PriceEntry> {
  let buffer = "";
  let state: "findData" | "key" | "value" | "done" = "findData";
  let currentUuid = "";
  let currentWanted = false;
  for await (const chunk of chunks) {
    buffer += chunk;
    while (state !== "done") {
      if (state === "findData") {
        const match = /"data"\s*:/.exec(buffer);
        if (!match) {
          buffer = buffer.slice(Math.max(0, buffer.length - 16));
          break;
        }
        const objectStart = buffer.indexOf("{", match.index + match[0].length);
        if (objectStart === -1) break;
        buffer = buffer.slice(objectStart + 1);
        state = "key";
      }
      if (state === "key") {
        const trimmedStart = buffer.search(/\S/);
        if (trimmedStart === -1) break;
        buffer = buffer.slice(trimmedStart);
        if (buffer[0] === "}") {
          state = "done";
          break;
        }
        if (buffer[0] === ",") {
          buffer = buffer.slice(1);
          continue;
        }
        if (buffer[0] !== '"') {
          throw new Error("Invalid MTGJSON price payload while reading UUID key.");
        }
        let escaped = false;
        let keyEnd = -1;
        for (let index = 1; index < buffer.length; index += 1) {
          const char = buffer[index];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (char === "\\") {
            escaped = true;
            continue;
          }
          if (char === '"') {
            keyEnd = index;
            break;
          }
        }
        if (keyEnd === -1) break;
        currentUuid = JSON.parse(buffer.slice(0, keyEnd + 1));
        currentWanted = !wantedUuids || wantedUuids.has(currentUuid);
        const colon = buffer.indexOf(":", keyEnd + 1);
        if (colon === -1) break;
        buffer = buffer.slice(colon + 1);
        state = "value";
      }
      if (state === "value") {
        const valueStart = buffer.search(/\S/);
        if (valueStart === -1) break;
        buffer = buffer.slice(valueStart);
        let depth = 0;
        let inString = false;
        let escaped = false;
        let started = false;
        let valueEnd = -1;
        for (let index = 0; index < buffer.length; index += 1) {
          const char = buffer[index];
          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (char === "\\") {
              escaped = true;
            } else if (char === '"') {
              inString = false;
            }
            continue;
          }
          if (char === '"') {
            inString = true;
            started = true;
            continue;
          }
          if (char === "{" || char === "[") {
            depth += 1;
            started = true;
            continue;
          }
          if (char === "}" || char === "]") {
            depth -= 1;
            if (started && depth === 0) {
              valueEnd = index + 1;
              break;
            }
          }
        }
        if (valueEnd === -1) break;
        const rawValue = buffer.slice(0, valueEnd);
        buffer = buffer.slice(valueEnd);
        yield {
          uuid: currentUuid,
          formats: currentWanted ? JSON.parse(rawValue) : undefined,
        };
        state = "key";
      }
    }
  }
  if (state !== "done") {
    throw new Error("Invalid MTGJSON price payload: data object was incomplete.");
  }
}

export async function* streamMtgjsonIdentifierEntriesFromTextChunks(
  chunks: AsyncIterable<string>,
): AsyncGenerator<MtgjsonIdentifierEntry> {
  for await (const entry of streamMtgjsonPriceEntriesFromTextChunks(chunks)) {
    yield { uuid: entry.uuid, card: entry.formats };
  }
}

async function* responseTextChunks(response: Response) {
  if (!response.body) {
    throw new Error("MTGJSON response did not include a readable stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) yield decoder.decode(value, { stream: true });
  }
  const final = decoder.decode();
  if (final) yield final;
}

export async function importMtgjsonPriceEntries(
  db: Pick<Prisma.TransactionClient, "card" | "cardPriceSnapshot">,
  entries: AsyncIterable<PriceEntry>,
  source: MtgjsonPriceImportKind,
  mappingReport?: MtgjsonCardMappingReport | null,
  options: { onProgress?: MtgjsonProgressCallback } = {},
): Promise<MtgjsonPriceImportReport> {
  const diagnostics = await localCardDiagnostics(db);
  const cardByUuid = await mappedLocalCardsByUuid(db);
  if (!cardByUuid.size) return zeroMappingReport(source, diagnostics, mappingReport);

  const rows: Prisma.CardPriceSnapshotCreateManyInput[] = [];
  const providers = new Set<string>();
  let totalMtgjsonCards = 0;
  let unmatchedUuids = 0;
  let snapshotsSkippedForUnmappedUuid = 0;
  let snapshotsParsed = 0;
  let snapshotsInserted = 0;
  const flush = async () => {
    snapshotsInserted += await insertPriceRows(db, rows.splice(0, rows.length));
    await options.onProgress?.({
      phase: "streaming_prices",
      source,
      totalMtgjsonCards,
      scannedMtgjsonCards: totalMtgjsonCards,
      matchedLocalCards: cardByUuid.size,
      unmatchedUuids,
      snapshotsParsed,
      snapshotsInserted,
      duplicatesSkipped: snapshotsParsed - snapshotsInserted,
      providersImported: Array.from(providers).sort(),
      errors: [],
    });
  };
  for await (const entry of entries) {
    totalMtgjsonCards += 1;
    const cardId = cardByUuid.get(entry.uuid);
    if (!cardId) {
      unmatchedUuids += 1;
      continue;
    }
    const snapshots = parseMtgjsonPriceSnapshotsForCard(
      entry.uuid,
      entry.formats,
    );
    snapshotsParsed += snapshots.length;
    for (const snapshot of snapshots) {
      providers.add(snapshot.provider);
      rows.push({
        cardId,
        mtgjsonUuid: entry.uuid,
        provider: snapshot.provider,
        finish: snapshot.finish,
        priceType: snapshot.priceType,
        currency: snapshot.currency,
        price: new Prisma.Decimal(snapshot.price),
        observedDate: snapshot.observedDate,
      });
    }
    if (rows.length >= 1000 || totalMtgjsonCards % 5000 === 0) await flush();
  }
  await flush();
  return {
    source,
    totalMtgjsonCards,
    localCards: mappingReport?.localCards ?? diagnostics.localCards,
    localCardsWithMtgjsonUuidBefore:
      mappingReport?.localCardsWithMtgjsonUuidBefore ??
      diagnostics.localCardsWithMtgjsonUuidBefore,
    localCardsWithoutMtgjsonUuidBefore:
      mappingReport?.localCardsWithoutMtgjsonUuidBefore ??
      diagnostics.localCardsWithoutMtgjsonUuidBefore,
    localCardsMappedThisRun: mappingReport?.mapped ?? 0,
    ambiguousLocalCards: mappingReport?.ambiguous ?? 0,
    unmatchedLocalCards: mappingReport?.unmatched ?? 0,
    matchedLocalCards: cardByUuid.size,
    unmatchedUuids,
    snapshotsSkippedForUnmappedUuid,
    snapshotsParsed,
    snapshotsInserted,
    duplicatesSkipped: snapshotsParsed - snapshotsInserted,
    providersImported: Array.from(providers).sort(),
    errors: [],
    memorySafeImporter: "streaming-json-entry-parser",
  };
}

export async function importMtgjsonPricePayload(
  db: Pick<Prisma.TransactionClient, "card" | "cardPriceSnapshot">,
  payload: unknown,
  source: MtgjsonPriceImportKind,
  mappingReport?: MtgjsonCardMappingReport | null,
): Promise<MtgjsonPriceImportReport> {
  const data = (payload as any)?.data;
  if (!data || typeof data !== "object") {
    throw new Error(
      "Invalid MTGJSON price payload: expected data object keyed by card UUID.",
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  const uuids = entries.map(([uuid]) => uuid);
  const [localCards, localCardsWithMtgjsonUuidBefore] = await Promise.all([
    "count" in db.card ? db.card.count() : Promise.resolve(0),
    "count" in db.card
      ? db.card.count({ where: { mtgjsonUuid: { not: null } } })
      : Promise.resolve(0),
  ]);
  const cards = await db.card.findMany({
    where: { mtgjsonUuid: { in: uuids } },
    select: { id: true, mtgjsonUuid: true },
  });
  const cardByUuid = new Map(
    cards.flatMap((card) =>
      card.mtgjsonUuid ? [[card.mtgjsonUuid, card.id] as const] : [],
    ),
  );
  const rows: Prisma.CardPriceSnapshotCreateManyInput[] = [];
  const providers = new Set<string>();
  let unmatchedUuids = 0;
  let snapshotsSkippedForUnmappedUuid = 0;
  for (const [uuid, formats] of entries) {
    const cardId = cardByUuid.get(uuid);
    if (!cardId) {
      unmatchedUuids += 1;
      snapshotsSkippedForUnmappedUuid += parseMtgjsonPriceSnapshotsForCard(
        uuid,
        formats,
      ).length;
      continue;
    }
    for (const snapshot of parseMtgjsonPriceSnapshotsForCard(uuid, formats)) {
      providers.add(snapshot.provider);
      rows.push({
        cardId,
        mtgjsonUuid: uuid,
        provider: snapshot.provider,
        finish: snapshot.finish,
        priceType: snapshot.priceType,
        currency: snapshot.currency,
        price: new Prisma.Decimal(snapshot.price),
        observedDate: snapshot.observedDate,
      });
    }
  }
  const result = rows.length
    ? await db.cardPriceSnapshot.createMany({
        data: rows,
        skipDuplicates: true,
      })
    : { count: 0 };
  return {
    source,
    totalMtgjsonCards: entries.length,
    localCards: mappingReport?.localCards ?? localCards,
    localCardsWithMtgjsonUuidBefore:
      mappingReport?.localCardsWithMtgjsonUuidBefore ??
      localCardsWithMtgjsonUuidBefore,
    localCardsWithoutMtgjsonUuidBefore:
      mappingReport?.localCardsWithoutMtgjsonUuidBefore ??
      Math.max(0, localCards - localCardsWithMtgjsonUuidBefore),
    localCardsMappedThisRun: mappingReport?.mapped ?? 0,
    ambiguousLocalCards: mappingReport?.ambiguous ?? 0,
    unmatchedLocalCards: mappingReport?.unmatched ?? 0,
    matchedLocalCards: cardByUuid.size,
    unmatchedUuids,
    snapshotsSkippedForUnmappedUuid,
    snapshotsParsed: rows.length,
    snapshotsInserted: result.count,
    duplicatesSkipped: rows.length - result.count,
    providersImported: Array.from(providers).sort(),
    errors:
      cardByUuid.size === 0
        ? [
            "No local cards are mapped to MTGJSON UUIDs yet. Run MTGJSON card mapping before importing prices.",
          ]
        : [],
    memorySafeImporter: "in-memory-fixture-parser",
  };
}

export async function importMtgjsonPrices(
  db: Pick<Prisma.TransactionClient, "card" | "cardPriceSnapshot">,
  kind: MtgjsonPriceImportKind,
  options: { onProgress?: MtgjsonProgressCallback } = {},
) {
  if (process.env.MTGJSON_PRICE_IMPORT_ENABLED === "false") {
    throw new Error(
      "MTGJSON price imports are disabled by MTGJSON_PRICE_IMPORT_ENABLED=false.",
    );
  }
  const diagnostics = await localCardDiagnostics(db);
  const cardByUuid = await mappedLocalCardsByUuid(db);
  if (!cardByUuid.size) return zeroMappingReport(kind, diagnostics);
  const response = await fetchMtgjsonPriceResponse(kind);
  const entries = streamMtgjsonPriceEntriesFromTextChunks(
    responseTextChunks(response),
    new Set(cardByUuid.keys()),
  );
  return importMtgjsonPriceEntries(db, entries, kind, null, options);
}

function buildLocalCardMappingIndexes(localCards: LocalMtgjsonMappingCard[]) {
  const byScryfallId = new Map<string, string[]>();
  const byExactTuple = new Map<string, string[]>();
  const bySetCollector = new Map<string, string[]>();
  const existingUuidToCard = new Map<string, string>();
  for (const card of localCards) {
    addCandidate(byScryfallId, normalizeIdentifierText(card.scryfallId), card.id);
    addCandidate(
      byExactTuple,
      tupleKey([
        card.setCode,
        normalizeCollectorNumber(card.collectorNumber),
        card.name,
      ]),
      card.id,
    );
    addCandidate(
      bySetCollector,
      tupleKey([card.setCode, normalizeCollectorNumber(card.collectorNumber)]),
      card.id,
    );
    if (card.mtgjsonUuid) existingUuidToCard.set(card.mtgjsonUuid, card.id);
  }
  return { byScryfallId, byExactTuple, bySetCollector, existingUuidToCard };
}

function mtgjsonCardMappingKeys(cardData: any) {
  const identifiers = cardData?.identifiers || {};
  const setCode = firstString(cardData?.setCode, cardData?.set, cardData?.setCodeV3);
  const collectorNumber = normalizeCollectorNumber(
    firstString(cardData?.number, cardData?.collectorNumber),
  );
  const name = firstString(cardData?.name, cardData?.faceName);
  return {
    scryfallId: normalizeIdentifierText(
      firstString(identifiers.scryfallId, cardData?.scryfallId),
    ),
    exactTuple: tupleKey([setCode, collectorNumber, name]),
    setCollectorTuple: tupleKey([setCode, collectorNumber]),
  };
}

async function loadLocalCardsForMtgjsonMapping(
  db: Pick<Prisma.TransactionClient, "card">,
) {
  return db.card.findMany({
    select: {
      id: true,
      scryfallId: true,
      mtgjsonUuid: true,
      setCode: true,
      collectorNumber: true,
      name: true,
      lang: true,
    },
  }) as Promise<LocalMtgjsonMappingCard[]>;
}

export async function mapMtgjsonIdentifierEntriesToLocalCards(
  db: Pick<Prisma.TransactionClient, "card">,
  entries: AsyncIterable<MtgjsonIdentifierEntry>,
  options: { onProgress?: MtgjsonProgressCallback } = {},
  loadedLocalCards?: LocalMtgjsonMappingCard[],
): Promise<MtgjsonCardMappingReport> {
  const localCards = loadedLocalCards ?? (await loadLocalCardsForMtgjsonMapping(db));
  const localCardsWithMtgjsonUuidBefore = localCards.filter(
    (card) => card.mtgjsonUuid,
  ).length;
  const indexes = buildLocalCardMappingIndexes(localCards);
  const mappedCardIds = new Set(
    localCards.flatMap((card) => (card.mtgjsonUuid ? [card.id] : [])),
  );
  const existingUuidByCardId = new Map(
    localCards.flatMap((card) =>
      card.mtgjsonUuid ? [[card.id, card.mtgjsonUuid] as const] : [],
    ),
  );
  let scanned = 0;
  let mapped = 0;
  let alreadyMapped = 0;
  let ambiguous = 0;
  let unmatched = 0;
  const emitProgress = async () => {
    await options.onProgress?.({
      phase: "mapping_mtgjson_cards",
      localCards: localCards.length,
      localCardsWithMtgjsonUuidBefore,
      localCardsWithoutMtgjsonUuidBefore:
        localCards.length - localCardsWithMtgjsonUuidBefore,
      localCardsMappedThisRun: mapped,
      mappedThisRun: mapped,
      mtgjsonCardsScanned: scanned,
      alreadyMapped,
      ambiguousLocalCards: ambiguous,
      ambiguousSkipped: ambiguous,
      unmatchedLocalCards: Math.max(0, localCards.length - mappedCardIds.size),
      errors: [],
    });
  };
  for await (const { uuid: mtgjsonUuid, card: cardData } of entries) {
    scanned += 1;
    const alreadyAssignedCardId = indexes.existingUuidToCard.get(mtgjsonUuid);
    const keys = mtgjsonCardMappingKeys(cardData);
    const candidates =
      (keys.scryfallId && indexes.byScryfallId.get(keys.scryfallId)) ||
      indexes.byExactTuple.get(keys.exactTuple) ||
      indexes.bySetCollector.get(keys.setCollectorTuple) ||
      [];
    const uniqueCandidates = Array.from(new Set(candidates));
    if (uniqueCandidates.length !== 1) {
      if (uniqueCandidates.length > 1) ambiguous += 1;
      else unmatched += 1;
      if (scanned % 1000 === 0) await emitProgress();
      continue;
    }
    const cardId = uniqueCandidates[0];
    if (alreadyAssignedCardId && alreadyAssignedCardId !== cardId) {
      ambiguous += 1;
      if (scanned % 1000 === 0) await emitProgress();
      continue;
    }
    const existingUuidForCard = existingUuidByCardId.get(cardId);
    if (existingUuidForCard && existingUuidForCard !== mtgjsonUuid) {
      ambiguous += 1;
      if (scanned % 1000 === 0) await emitProgress();
      continue;
    }
    if (alreadyAssignedCardId === cardId || existingUuidForCard === mtgjsonUuid) {
      alreadyMapped += 1;
      if (scanned % 1000 === 0) await emitProgress();
      continue;
    }
    await db.card.update({
      where: { id: cardId },
      data: { mtgjsonUuid },
    });
    indexes.existingUuidToCard.set(mtgjsonUuid, cardId);
    mappedCardIds.add(cardId);
    existingUuidByCardId.set(cardId, mtgjsonUuid);
    mapped += 1;
    if (scanned % 1000 === 0) await emitProgress();
  }
  const report = {
    scanned,
    localCards: localCards.length,
    localCardsWithMtgjsonUuidBefore,
    localCardsWithoutMtgjsonUuidBefore:
      localCards.length - localCardsWithMtgjsonUuidBefore,
    mapped,
    alreadyMapped,
    ambiguous,
    unmatched,
  };
  await emitProgress();
  return report;
}

export async function mapMtgjsonIdentifiersToLocalCards(
  db: Pick<Prisma.TransactionClient, "card">,
  identifiersPayload: unknown,
  options: { onProgress?: MtgjsonProgressCallback } = {},
): Promise<MtgjsonCardMappingReport> {
  const data = (identifiersPayload as any)?.data;
  if (!data || typeof data !== "object") {
    throw new Error(
      "Invalid MTGJSON identifiers payload: expected data object keyed by card UUID.",
    );
  }
  async function* entries() {
    for (const [uuid, card] of Object.entries(data as Record<string, any>)) {
      yield { uuid, card };
    }
  }
  return mapMtgjsonIdentifierEntriesToLocalCards(db, entries(), options);
}

export async function mapMtgjsonCards(
  db: Pick<Prisma.TransactionClient, "card">,
  options: { onProgress?: MtgjsonProgressCallback } = {},
) {
  const localCards = await loadLocalCardsForMtgjsonMapping(db);
  const localCardsWithMtgjsonUuidBefore = localCards.filter(
    (card) => card.mtgjsonUuid,
  ).length;
  if (!localCards.length || localCardsWithMtgjsonUuidBefore === localCards.length) {
    const report = {
      scanned: 0,
      localCards: localCards.length,
      localCardsWithMtgjsonUuidBefore,
      localCardsWithoutMtgjsonUuidBefore:
        localCards.length - localCardsWithMtgjsonUuidBefore,
      mapped: 0,
      alreadyMapped: localCardsWithMtgjsonUuidBefore,
      ambiguous: 0,
      unmatched: 0,
    };
    await options.onProgress?.({
      phase: "mapping_mtgjson_cards",
      localCards: report.localCards,
      localCardsWithMtgjsonUuidBefore:
        report.localCardsWithMtgjsonUuidBefore,
      localCardsWithoutMtgjsonUuidBefore:
        report.localCardsWithoutMtgjsonUuidBefore,
      localCardsMappedThisRun: 0,
      mtgjsonCardsScanned: 0,
      alreadyMapped: report.alreadyMapped,
      ambiguousLocalCards: 0,
      ambiguousSkipped: 0,
      unmatchedLocalCards: report.localCardsWithoutMtgjsonUuidBefore,
      errors: [],
    });
    return report;
  }
  const response = await fetchMtgjsonIdentifierResponse();
  const entries = streamMtgjsonIdentifierEntriesFromTextChunks(
    responseTextChunks(response),
  );
  return mapMtgjsonIdentifierEntriesToLocalCards(db, entries, options, localCards);
}
