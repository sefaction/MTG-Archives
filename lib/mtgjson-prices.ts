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

export async function fetchMtgjsonPricePayload(kind: MtgjsonPriceImportKind) {
  const url = mtgjsonPriceFileUrl(kind);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`MTGJSON download failed (${response.status}) for ${url}`);
  }
  return response.json();
}

export async function fetchMtgjsonIdentifierPayload() {
  const url = mtgjsonIdentifierFileUrl();
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`MTGJSON download failed (${response.status}) for ${url}`);
  }
  return response.json();
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
  };
}

export async function importMtgjsonPrices(
  db: Pick<Prisma.TransactionClient, "card" | "cardPriceSnapshot">,
  kind: MtgjsonPriceImportKind,
) {
  if (process.env.MTGJSON_PRICE_IMPORT_ENABLED === "false") {
    throw new Error(
      "MTGJSON price imports are disabled by MTGJSON_PRICE_IMPORT_ENABLED=false.",
    );
  }
  const [mappingPayload, payload] = await Promise.all([
    fetchMtgjsonIdentifierPayload(),
    fetchMtgjsonPricePayload(kind),
  ]);
  const mappingReport = await mapMtgjsonIdentifiersToLocalCards(
    db,
    mappingPayload,
  );
  return importMtgjsonPricePayload(db, payload, kind, mappingReport);
}

export async function mapMtgjsonIdentifiersToLocalCards(
  db: Pick<Prisma.TransactionClient, "card">,
  identifiersPayload: unknown,
): Promise<MtgjsonCardMappingReport> {
  const data = (identifiersPayload as any)?.data;
  if (!data || typeof data !== "object") {
    throw new Error(
      "Invalid MTGJSON identifiers payload: expected data object keyed by card UUID.",
    );
  }
  const localCards = await db.card.findMany({
    select: {
      id: true,
      scryfallId: true,
      mtgjsonUuid: true,
      setCode: true,
      collectorNumber: true,
      name: true,
      lang: true,
    },
  });
  const byScryfallId = new Map<string, string[]>();
  const byExactTuple = new Map<string, string[]>();
  const byFallbackTuple = new Map<string, string[]>();
  const existingUuidToCard = new Map<string, string>();
  for (const card of localCards) {
    addCandidate(byScryfallId, normalizeIdentifierText(card.scryfallId), card.id);
    addCandidate(
      byExactTuple,
      tupleKey([
        card.setCode,
        normalizeCollectorNumber(card.collectorNumber),
        card.name,
        card.lang || "en",
      ]),
      card.id,
    );
    addCandidate(
      byFallbackTuple,
      tupleKey([
        card.setCode,
        normalizeCollectorNumber(card.collectorNumber),
        card.name,
      ]),
      card.id,
    );
    if (card.mtgjsonUuid) existingUuidToCard.set(card.mtgjsonUuid, card.id);
  }
  const localCardsWithMtgjsonUuidBefore = localCards.filter(
    (card) => card.mtgjsonUuid,
  ).length;
  let mapped = 0;
  let alreadyMapped = 0;
  let ambiguous = 0;
  let unmatched = 0;
  for (const [mtgjsonUuid, cardData] of Object.entries(
    data as Record<string, any>,
  )) {
    const identifiers = cardData?.identifiers || {};
    const alreadyAssignedCardId = existingUuidToCard.get(mtgjsonUuid);
    const scryfallId = firstString(identifiers.scryfallId, cardData?.scryfallId);
    const exactTuple = tupleKey([
      firstString(cardData?.setCode, cardData?.set, cardData?.setCodeV3),
      normalizeCollectorNumber(
        firstString(cardData?.number, cardData?.collectorNumber),
      ),
      firstString(cardData?.name, cardData?.faceName),
      firstString(cardData?.language, cardData?.lang, "en"),
    ]);
    const fallbackTuple = tupleKey([
      firstString(cardData?.setCode, cardData?.set, cardData?.setCodeV3),
      normalizeCollectorNumber(
        firstString(cardData?.number, cardData?.collectorNumber),
      ),
      firstString(cardData?.name, cardData?.faceName),
    ]);
    const candidates =
      (scryfallId && byScryfallId.get(normalizeIdentifierText(scryfallId))) ||
      byExactTuple.get(exactTuple) ||
      byFallbackTuple.get(fallbackTuple) ||
      [];
    const uniqueCandidates = Array.from(new Set(candidates));
    if (uniqueCandidates.length !== 1) {
      if (uniqueCandidates.length > 1) ambiguous += 1;
      else unmatched += 1;
      continue;
    }
    const cardId = uniqueCandidates[0];
    if (alreadyAssignedCardId && alreadyAssignedCardId !== cardId) {
      ambiguous += 1;
      continue;
    }
    if (alreadyAssignedCardId === cardId) {
      alreadyMapped += 1;
      continue;
    }
    await db.card.update({
      where: { id: cardId },
      data: { mtgjsonUuid },
    });
    existingUuidToCard.set(mtgjsonUuid, cardId);
    mapped += 1;
  }
  return {
    scanned: Object.keys(data).length,
    localCards: localCards.length,
    localCardsWithMtgjsonUuidBefore,
    localCardsWithoutMtgjsonUuidBefore:
      localCards.length - localCardsWithMtgjsonUuidBefore,
    mapped,
    alreadyMapped,
    ambiguous,
    unmatched,
  };
}

export async function mapMtgjsonCards(
  db: Pick<Prisma.TransactionClient, "card">,
) {
  const payload = await fetchMtgjsonIdentifierPayload();
  return mapMtgjsonIdentifiersToLocalCards(db, payload);
}
