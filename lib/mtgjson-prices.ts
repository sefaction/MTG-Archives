import { Prisma } from "@prisma/client";

export const DEFAULT_MTGJSON_BASE_URL = "https://mtgjson.com/api/v5";
export const MTGJSON_PRICE_FILES = {
  today: "AllPricesToday.json",
  history: "AllPrices.json",
} as const;

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
  matchedLocalCards: number;
  unmatchedUuids: number;
  snapshotsParsed: number;
  snapshotsInserted: number;
  duplicatesSkipped: number;
  providersImported: string[];
  errors: string[];
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

export async function importMtgjsonPricePayload(
  db: Pick<Prisma.TransactionClient, "card" | "cardPriceSnapshot">,
  payload: unknown,
  source: MtgjsonPriceImportKind,
): Promise<MtgjsonPriceImportReport> {
  const data = (payload as any)?.data;
  if (!data || typeof data !== "object") {
    throw new Error(
      "Invalid MTGJSON price payload: expected data object keyed by card UUID.",
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  const uuids = entries.map(([uuid]) => uuid);
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
  for (const [uuid, formats] of entries) {
    const cardId = cardByUuid.get(uuid);
    if (!cardId) {
      unmatchedUuids += 1;
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
    matchedLocalCards: cardByUuid.size,
    unmatchedUuids,
    snapshotsParsed: rows.length,
    snapshotsInserted: result.count,
    duplicatesSkipped: rows.length - result.count,
    providersImported: Array.from(providers).sort(),
    errors: [],
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
  const payload = await fetchMtgjsonPricePayload(kind);
  return importMtgjsonPricePayload(db, payload, kind);
}

export async function mapMtgjsonIdentifiersToLocalCards(
  db: Pick<Prisma.TransactionClient, "card">,
  identifiersPayload: unknown,
) {
  const data = (identifiersPayload as any)?.data;
  if (!data || typeof data !== "object") {
    throw new Error(
      "Invalid MTGJSON identifiers payload: expected data object keyed by card UUID.",
    );
  }
  let mapped = 0;
  let ambiguous = 0;
  let unmatched = 0;
  for (const [mtgjsonUuid, cardData] of Object.entries(
    data as Record<string, any>,
  )) {
    const identifiers = cardData?.identifiers || {};
    const scryfallId = identifiers.scryfallId || cardData?.scryfallId;
    if (!scryfallId) {
      unmatched += 1;
      continue;
    }
    const candidates = await db.card.findMany({
      where: { scryfallId },
      select: { id: true, mtgjsonUuid: true },
    });
    if (candidates.length !== 1) {
      if (candidates.length > 1) ambiguous += 1;
      else unmatched += 1;
      continue;
    }
    await db.card.update({
      where: { id: candidates[0].id },
      data: { mtgjsonUuid },
    });
    mapped += 1;
  }
  return { scanned: Object.keys(data).length, mapped, ambiguous, unmatched };
}
