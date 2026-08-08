import crypto from "node:crypto";

import { prisma } from "./prisma";
import { effectiveCardColors } from "./card-colors";
import {
  formatScryfallError,
  getCardByScryfallIdResult,
  getCardBySetAndCollectorResult,
  getExactCardByNameResult,
  hasScryfallSearchSyntax,
  searchCardPrintsResult,
  searchCardsResult,
  ScryfallCard,
} from "./scryfall";

export function normalizeCardName(name: string) {
  return name
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s*\/\/\s*/g, " // ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeSetCode(setCode?: string) {
  return setCode?.trim().toLowerCase() || undefined;
}

export function normalizeCollectorNumber(collectorNumber?: string) {
  return collectorNumber?.trim() || undefined;
}

export function cardImageSmall(card: ScryfallCard) {
  return (
    card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? null
  );
}

export function cardImageNormal(card: ScryfallCard) {
  return (
    card.image_uris?.normal ??
    card.card_faces?.[0]?.image_uris?.normal ??
    cardImageSmall(card)
  );
}

export function cardTypeLine(card: ScryfallCard) {
  if (card.type_line?.trim()) return card.type_line;
  const faceTypeLines = (card.card_faces ?? [])
    .map((face) => face.type_line?.trim())
    .filter((typeLine): typeLine is string => Boolean(typeLine));
  return faceTypeLines.join(" // ") || "Unknown";
}

function cardFaceText(card: ScryfallCard, field: "mana_cost" | "oracle_text") {
  const values = (card.card_faces ?? [])
    .map((face) => face[field]?.trim())
    .filter((value): value is string => Boolean(value));
  return values.join(" // ") || null;
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function scryfallFingerprint(cardData: ScryfallCard) {
  return crypto.createHash("sha256").update(stableJson(cardData)).digest("hex");
}

function cardWriteData(cardData: ScryfallCard) {
  const now = new Date();
  const fingerprint = scryfallFingerprint(cardData);
  const priceTouched = Boolean(cardData.prices);
  return {
    oracleId: cardData.oracle_id ?? null,
    multiverseIds: cardData.multiverse_ids ?? [],
    mtgoId: cardData.mtgo_id ?? null,
    arenaId: cardData.arena_id ?? null,
    name: cardData.name,
    printedName: cardData.printed_name ?? null,
    lang: cardData.lang ?? null,
    releasedAt: parseDate(cardData.released_at),
    layout: cardData.layout ?? null,
    highresImage: cardData.highres_image ?? null,
    imageStatus: cardData.image_status ?? null,
    manaCost: cardData.mana_cost ?? cardFaceText(cardData, "mana_cost"),
    manaValue: cardData.cmc,
    colors: effectiveCardColors(cardData),
    colorIdentity: cardData.color_identity ?? [],
    colorIndicator: cardData.color_indicator ?? [],
    producedMana: cardData.produced_mana ?? [],
    typeLine: cardTypeLine(cardData),
    printedTypeLine: cardData.printed_type_line ?? null,
    oracleText: cardData.oracle_text ?? cardFaceText(cardData, "oracle_text"),
    printedText: cardData.printed_text ?? null,
    power: cardData.power ?? null,
    toughness: cardData.toughness ?? null,
    loyalty: cardData.loyalty ?? null,
    defense: cardData.defense ?? null,
    keywords: cardData.keywords ?? [],
    legalities: cardData.legalities ?? {},
    games: cardData.games ?? [],
    reserved: cardData.reserved ?? null,
    foil: cardData.foil ?? null,
    nonfoil: cardData.nonfoil ?? null,
    finishes: cardData.finishes ?? [],
    oversized: cardData.oversized ?? null,
    promo: cardData.promo ?? null,
    reprint: cardData.reprint ?? null,
    variation: cardData.variation ?? null,
    digital: cardData.digital ?? null,
    fullArt: cardData.full_art ?? null,
    textless: cardData.textless ?? null,
    booster: cardData.booster ?? null,
    storySpotlight: cardData.story_spotlight ?? null,
    setCode: normalizeSetCode(cardData.set) ?? cardData.set,
    setId: cardData.set_id ?? null,
    setName: cardData.set_name,
    setType: cardData.set_type ?? null,
    collectorNumber:
      normalizeCollectorNumber(cardData.collector_number) ??
      cardData.collector_number,
    rarity: cardData.rarity,
    artist: cardData.artist ?? null,
    artistIds: cardData.artist_ids ?? [],
    illustrationId: cardData.illustration_id ?? null,
    borderColor: cardData.border_color ?? null,
    frame: cardData.frame ?? null,
    frameEffects: cardData.frame_effects ?? [],
    securityStamp: cardData.security_stamp ?? null,
    preview: cardData.preview ?? {},
    imageUri: cardImageNormal(cardData),
    imageUris:
      cardData.image_uris ?? cardData.card_faces?.[0]?.image_uris ?? {},
    cardFaces: cardData.card_faces ?? [],
    prices: cardData.prices ?? {},
    allParts: cardData.all_parts ?? [],
    relatedUris: cardData.related_uris ?? {},
    purchaseUris: cardData.purchase_uris ?? {},
    scryfallUri: cardData.scryfall_uri ?? null,
    apiUri: cardData.uri ?? null,
    rawScryfallJson: cardData as unknown as object,
    scryfallFingerprint: fingerprint,
    lastSyncedAt: now,
    lastFetchedAt: now,
    lastCheckedAt: now,
    lastChangedAt: now,
    priceLastFetchedAt: priceTouched ? now : null,
  };
}

export async function upsertScryfallCard(cardData: ScryfallCard) {
  const data = cardWriteData(cardData) as any;
  const existing = await prisma.card.findUnique({
    where: { scryfallId: cardData.id },
    select: { scryfallFingerprint: true, firstCachedAt: true },
  });
  const changed = existing?.scryfallFingerprint !== data.scryfallFingerprint;
  return prisma.card.upsert({
    where: { scryfallId: cardData.id },
    update: {
      ...data,
      lastChangedAt: changed ? data.lastChangedAt : undefined,
      priceLastFetchedAt: data.priceLastFetchedAt ?? undefined,
    },
    create: {
      scryfallId: cardData.id,
      ...data,
      firstCachedAt: new Date(),
    },
  });
}

type MatchMethod =
  | "SCRYFALL_ID"
  | "SET_COLLECTOR"
  | "EXACT_NAME_SET"
  | "EXACT_NAME"
  | "FUZZY_CANDIDATE";

export type CardImportMatch = {
  status: "matched" | "new" | "ambiguous" | "unmatched";
  card: Awaited<ReturnType<typeof prisma.card.findFirst>>;
  message: string;
  method?: MatchMethod;
  confidence?: number;
  requestsMade?: number;
  cacheHit?: boolean;
  retryable?: boolean;
};

function withMatchDetails(
  match: Omit<CardImportMatch, "requestsMade" | "cacheHit">,
  details: Pick<CardImportMatch, "requestsMade" | "cacheHit"> = {},
): CardImportMatch {
  return { requestsMade: 0, cacheHit: false, ...details, ...match };
}

async function importFromResult(
  result: Awaited<ReturnType<typeof getCardByScryfallIdResult>>,
  method: MatchMethod,
  successMessage: string,
  notFoundMessage: string,
): Promise<CardImportMatch> {
  if (result.ok) {
    return withMatchDetails(
      {
        status: "new",
        card: await upsertScryfallCard(result.data),
        message: successMessage,
        method,
        confidence: method === "FUZZY_CANDIDATE" ? 0.5 : 1,
      },
      { requestsMade: result.requestsMade },
    );
  }
  return withMatchDetails(
    {
      status: "unmatched",
      card: null,
      message:
        result.error.kind === "NOT_FOUND"
          ? notFoundMessage
          : formatScryfallError(result.error),
      method,
      confidence: 0,
      retryable: result.error.retryable,
    },
    { requestsMade: result.requestsMade },
  );
}

export async function findOrImportCard(input: {
  scryfallId?: string;
  name: string;
  setCode?: string;
  collectorNumber?: string;
}): Promise<CardImportMatch> {
  const scryfallId = input.scryfallId?.trim();
  const normalizedName = normalizeCardName(input.name || "");
  const setCode = normalizeSetCode(input.setCode);
  const collectorNumber = normalizeCollectorNumber(input.collectorNumber);

  if (scryfallId) {
    const local = await prisma.card.findUnique({ where: { scryfallId } });
    if (local)
      return withMatchDetails(
        {
          status: "matched",
          card: local,
          message: "Matched local card catalog by Scryfall ID",
          method: "SCRYFALL_ID",
          confidence: 1,
        },
        { cacheHit: true },
      );
    return importFromResult(
      await getCardByScryfallIdResult(scryfallId),
      "SCRYFALL_ID",
      "Imported from Scryfall by Scryfall ID",
      `No card found with Scryfall ID “${scryfallId}”`,
    );
  }

  if (setCode && collectorNumber) {
    const localCandidates = await prisma.card.findMany({
      where: {
        setCode: { equals: setCode, mode: "insensitive" },
        collectorNumber,
      },
    });
    const nameFiltered = localCandidates.filter(
      (card) =>
        !normalizedName || normalizeCardName(card.name) === normalizedName,
    );
    if (nameFiltered.length === 1)
      return withMatchDetails(
        {
          status: "matched",
          card: nameFiltered[0],
          message: "Matched local card catalog by set and collector number",
          method: "SET_COLLECTOR",
          confidence: 1,
        },
        { cacheHit: true },
      );
    if (localCandidates.length > 1)
      return withMatchDetails({
        status: "ambiguous",
        card: null,
        message:
          "Multiple local printings match this set and collector number; manual selection is required.",
        method: "SET_COLLECTOR",
        confidence: 0.6,
      });

    return importFromResult(
      await getCardBySetAndCollectorResult(setCode, collectorNumber),
      "SET_COLLECTOR",
      "Imported from Scryfall by set and collector number",
      `No card found with set “${setCode}” and collector number “${collectorNumber}”`,
    );
  }

  if (setCode && normalizedName) {
    const localExact = (
      await prisma.card.findMany({
        where: { setCode: { equals: setCode, mode: "insensitive" } },
      })
    ).filter((card) => normalizeCardName(card.name) === normalizedName);
    if (localExact.length === 1)
      return withMatchDetails(
        {
          status: "matched",
          card: localExact[0],
          message: "Matched local card catalog by exact name and set",
          method: "EXACT_NAME_SET",
          confidence: 0.95,
        },
        { cacheHit: true },
      );
    if (localExact.length > 1)
      return withMatchDetails({
        status: "ambiguous",
        card: null,
        message:
          "Multiple local printings match this card name and set; manual selection is required.",
        method: "EXACT_NAME_SET",
        confidence: 0.75,
      });

    const query = `!"${input.name.trim().replace(/"/g, '\\"')}" set:${setCode}`;
    const result = await searchCardsResult(query);
    if (result.ok && result.data.data.length === 1) {
      return withMatchDetails(
        {
          status: "new",
          card: await upsertScryfallCard(result.data.data[0]),
          message: "Imported from Scryfall by exact name and set",
          method: "EXACT_NAME_SET",
          confidence: 0.95,
        },
        { requestsMade: result.requestsMade },
      );
    }
    if (result.ok && result.data.data.length > 1) {
      return withMatchDetails(
        {
          status: "ambiguous",
          card: null,
          message:
            "Multiple Scryfall printings match this card name and set; manual selection is required.",
          method: "EXACT_NAME_SET",
          confidence: 0.7,
        },
        { requestsMade: result.requestsMade },
      );
    }
    if (!result.ok && result.error.retryable) {
      return withMatchDetails(
        {
          status: "unmatched",
          card: null,
          message: formatScryfallError(result.error),
          method: "EXACT_NAME_SET",
          confidence: 0,
          retryable: true,
        },
        { requestsMade: result.requestsMade },
      );
    }
  }

  if (normalizedName) {
    const localExact = (
      await prisma.card.findMany({
        where: { name: { equals: input.name.trim(), mode: "insensitive" } },
      })
    ).filter((card) => normalizeCardName(card.name) === normalizedName);
    if (localExact.length === 1)
      return withMatchDetails(
        {
          status: "matched",
          card: localExact[0],
          message: "Matched local card catalog by exact card name",
          method: "EXACT_NAME",
          confidence: 0.8,
        },
        { cacheHit: true },
      );
    if (localExact.length > 1)
      return withMatchDetails({
        status: "ambiguous",
        card: null,
        message:
          "Multiple local printings match this card name; choose the printing manually.",
        method: "EXACT_NAME",
        confidence: 0.5,
      });

    const exact = await getExactCardByNameResult(input.name.trim());
    if (exact.ok) {
      await upsertScryfallCard(exact.data);
      return withMatchDetails(
        {
          status: "ambiguous",
          card: null,
          message:
            "Card name exists, but the import did not identify a specific printing. Choose a printing manually.",
          method: "EXACT_NAME",
          confidence: 0.5,
        },
        { requestsMade: exact.requestsMade },
      );
    }
    if (exact.error.retryable) {
      return withMatchDetails(
        {
          status: "unmatched",
          card: null,
          message: formatScryfallError(exact.error),
          method: "EXACT_NAME",
          confidence: 0,
          retryable: true,
        },
        { requestsMade: exact.requestsMade },
      );
    }
  }

  return withMatchDetails({
    status: "unmatched",
    card: null,
    message: "No card found. Try selecting a printing manually.",
  });
}

export async function searchLocalThenScryfallCards(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2)
    return {
      cards: [] as ScryfallCard[],
      message: "Enter at least 2 characters.",
    };
  const useScryfallSyntax = hasScryfallSearchSyntax(trimmed);
  const local = useScryfallSyntax
    ? []
    : await prisma.card.findMany({
        where: {
          OR: [
            { name: { contains: trimmed, mode: "insensitive" } },
            {
              setCode: {
                equals: normalizeSetCode(trimmed) ?? trimmed,
                mode: "insensitive",
              },
            },
            { collectorNumber: trimmed },
          ],
        },
        orderBy: [{ name: "asc" }, { releasedAt: "desc" }],
        take: 20,
      });
  if (local.length > 0) {
    return {
      cards: local.map((card) => ({
        id: card.scryfallId,
        oracle_id: card.oracleId ?? undefined,
        name: card.name,
        printed_name: card.printedName ?? undefined,
        lang: card.lang ?? undefined,
        released_at: card.releasedAt?.toISOString().slice(0, 10),
        layout: card.layout ?? undefined,
        cmc: card.manaValue ?? 0,
        color_identity: Array.isArray(card.colorIdentity)
          ? (card.colorIdentity as string[])
          : [],
        produced_mana: Array.isArray(card.producedMana)
          ? (card.producedMana as string[])
          : [],
        type_line: card.typeLine,
        set: card.setCode,
        set_name: card.setName ?? card.setCode,
        collector_number: card.collectorNumber,
        rarity: card.rarity,
        artist: card.artist ?? undefined,
        image_uris:
          (card.imageUris as Record<string, string> | null) ?? undefined,
        card_faces:
          (card.cardFaces as ScryfallCard["card_faces"] | null) ?? undefined,
        prices:
          (card.prices as Record<string, string | null> | null) ?? undefined,
        purchase_uris:
          (card.purchaseUris as Record<string, string> | null) ?? undefined,
        scryfall_uri: card.scryfallUri ?? undefined,
        uri: card.apiUri ?? undefined,
      })),
      message: "Showing locally cached card printings.",
    };
  }
  const result = await searchCardPrintsResult(trimmed);
  if (!result.ok)
    return {
      cards: [] as ScryfallCard[],
      message: formatScryfallError(result.error),
    };
  await Promise.all(
    result.data.data.slice(0, 20).map((card) => upsertScryfallCard(card)),
  );
  return {
    cards: result.data.data,
    message: `${result.data.data.length} Scryfall printings found.`,
  };
}
