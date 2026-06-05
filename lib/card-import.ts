import { prisma } from "./prisma";
import {
  getCardByScryfallId,
  getCardBySetAndCollector,
  getFuzzyCard,
  searchCards,
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

export async function upsertScryfallCard(cardData: ScryfallCard) {
  return prisma.card.upsert({
    where: { scryfallId: cardData.id },
    update: {
      oracleId: cardData.oracle_id ?? null,
      name: cardData.name,
      manaCost: cardData.mana_cost ?? null,
      manaValue: cardData.cmc,
      colors: cardData.colors ?? [],
      colorIdentity: cardData.color_identity ?? [],
      typeLine: cardData.type_line,
      oracleText: cardData.oracle_text ?? null,
      power: cardData.power ?? null,
      toughness: cardData.toughness ?? null,
      loyalty: cardData.loyalty ?? null,
      defense: cardData.defense ?? null,
      keywords: cardData.keywords ?? [],
      legalities: cardData.legalities ?? {},
      setCode: normalizeSetCode(cardData.set) ?? cardData.set,
      setName: cardData.set_name,
      collectorNumber:
        normalizeCollectorNumber(cardData.collector_number) ??
        cardData.collector_number,
      rarity: cardData.rarity,
      artist: cardData.artist ?? null,
      imageUri: cardImageNormal(cardData),
      imageUris:
        cardData.image_uris ?? cardData.card_faces?.[0]?.image_uris ?? {},
      prices: cardData.prices ?? {},
      purchaseUris: cardData.purchase_uris ?? {},
      scryfallUri: cardData.scryfall_uri ?? null,
      lastSyncedAt: new Date(),
    },
    create: {
      scryfallId: cardData.id,
      oracleId: cardData.oracle_id ?? null,
      name: cardData.name,
      manaCost: cardData.mana_cost ?? null,
      manaValue: cardData.cmc,
      colors: cardData.colors ?? [],
      colorIdentity: cardData.color_identity ?? [],
      typeLine: cardData.type_line,
      oracleText: cardData.oracle_text ?? null,
      power: cardData.power ?? null,
      toughness: cardData.toughness ?? null,
      loyalty: cardData.loyalty ?? null,
      defense: cardData.defense ?? null,
      keywords: cardData.keywords ?? [],
      legalities: cardData.legalities ?? {},
      setCode: normalizeSetCode(cardData.set) ?? cardData.set,
      setName: cardData.set_name,
      collectorNumber:
        normalizeCollectorNumber(cardData.collector_number) ??
        cardData.collector_number,
      rarity: cardData.rarity,
      artist: cardData.artist ?? null,
      imageUri: cardImageNormal(cardData),
      imageUris:
        cardData.image_uris ?? cardData.card_faces?.[0]?.image_uris ?? {},
      prices: cardData.prices ?? {},
      purchaseUris: cardData.purchase_uris ?? {},
      scryfallUri: cardData.scryfall_uri ?? null,
      lastSyncedAt: new Date(),
    },
  });
}

export async function findOrImportCard(input: {
  scryfallId?: string;
  name: string;
  setCode?: string;
  collectorNumber?: string;
}) {
  const scryfallId = input.scryfallId?.trim();
  const normalizedName = normalizeCardName(input.name || "");
  const setCode = normalizeSetCode(input.setCode);
  const collectorNumber = normalizeCollectorNumber(input.collectorNumber);

  if (scryfallId) {
    const local = await prisma.card.findUnique({ where: { scryfallId } });
    if (local)
      return {
        status: "matched" as const,
        card: local,
        message: "Matched locally by Scryfall ID",
      };
    const cardData = await getCardByScryfallId(scryfallId);
    if (!cardData)
      return {
        status: "unmatched" as const,
        card: null,
        message: "Unmatched: Scryfall ID was not found",
      };
    const card = await upsertScryfallCard(cardData);
    return {
      status: "new" as const,
      card,
      message: "Imported from Scryfall by Scryfall ID",
    };
  }

  if (setCode && collectorNumber) {
    const localCandidates = await prisma.card.findMany({
      where: {
        setCode: { equals: setCode, mode: "insensitive" },
        collectorNumber,
      },
    });
    if (localCandidates.length === 1)
      return {
        status: "matched" as const,
        card: localCandidates[0],
        message: "Matched locally by set and collector number",
      };
    const nameFiltered = localCandidates.filter(
      (card) => normalizeCardName(card.name) === normalizedName,
    );
    if (nameFiltered.length === 1)
      return {
        status: "matched" as const,
        card: nameFiltered[0],
        message: "Matched locally by set, collector number, and name",
      };
    if (localCandidates.length > 1)
      return {
        status: "ambiguous" as const,
        card: null,
        message:
          "Ambiguous: multiple local cards matched set and collector number",
      };

    const exactPrinting = await getCardBySetAndCollector(
      setCode,
      collectorNumber,
    );
    if (exactPrinting)
      return {
        status: "new" as const,
        card: await upsertScryfallCard(exactPrinting),
        message: "Imported from Scryfall by set and collector number",
      };
  }

  if (setCode && normalizedName) {
    const localByNameSet = await prisma.card.findMany({
      where: { setCode: { equals: setCode, mode: "insensitive" } },
    });
    const localExact = localByNameSet.filter(
      (card) => normalizeCardName(card.name) === normalizedName,
    );
    if (localExact.length === 1)
      return {
        status: "matched" as const,
        card: localExact[0],
        message: "Matched by exact name and set",
      };
    if (localExact.length > 1)
      return {
        status: "ambiguous" as const,
        card: null,
        message:
          "Ambiguous: multiple local printings matched exact name and set",
      };

    const found = await searchCards(`!"${input.name.trim()}" set:${setCode}`);
    if (found.length === 1)
      return {
        status: "new" as const,
        card: await upsertScryfallCard(found[0]),
        message: "Matched by exact name and set",
      };
    if (found.length > 1)
      return {
        status: "ambiguous" as const,
        card: null,
        message: "Ambiguous: multiple possible cards found",
      };
  }

  if (normalizedName) {
    const fuzzy = await getFuzzyCard(input.name.trim());
    if (fuzzy)
      return {
        status: "new" as const,
        card: await upsertScryfallCard(fuzzy),
        message: "Fuzzy matched by name",
      };
  }

  return {
    status: "unmatched" as const,
    card: null,
    message: "Unmatched: no card found",
  };
}
