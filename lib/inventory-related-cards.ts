import { prisma } from "./prisma";

type RelatedPart = {
  id?: string | null;
  component?: string | null;
  name?: string | null;
  type_line?: string | null;
  uri?: string | null;
};

function allPartsFromItems(items: any[]) {
  const parts: RelatedPart[] = [];
  for (const item of items) {
    const card = item.card ?? item.representative?.card;
    if (Array.isArray(card?.allParts)) parts.push(...card.allParts);
    if (Array.isArray(item.printings)) {
      for (const printing of item.printings) {
        if (Array.isArray(printing.card?.allParts)) {
          parts.push(...printing.card.allParts);
        }
      }
    }
  }
  return parts;
}

export async function buildRelatedCardMetadataByScryfallId(items: any[]) {
  const scryfallIds = Array.from(
    new Set(
      allPartsFromItems(items)
        .map((part) => part.id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (!scryfallIds.length) return new Map<string, any>();

  const cards = await prisma.card.findMany({
    where: { scryfallId: { in: scryfallIds } },
    select: {
      scryfallId: true,
      scryfallUri: true,
      imageUri: true,
      imageUris: true,
      setCode: true,
      collectorNumber: true,
    },
  });
  return new Map(cards.map((card) => [card.scryfallId, card]));
}

export function enrichAllPartsWithLocalCardMetadata(
  allParts: unknown,
  relatedCardsByScryfallId: Map<string, any>,
) {
  if (!Array.isArray(allParts)) return [];
  return allParts.map((part: RelatedPart) => {
    const related = part.id ? relatedCardsByScryfallId.get(part.id) : null;
    if (!related) return part;
    return {
      ...part,
      scryfallUri: related.scryfallUri ?? undefined,
      scryfall_uri: related.scryfallUri ?? undefined,
      imageUri:
        (related.imageUris as any)?.normal ??
        (related.imageUris as any)?.large ??
        (related.imageUris as any)?.small ??
        related.imageUri ??
        undefined,
      imageUris: related.imageUris ?? undefined,
      image_uris: related.imageUris ?? undefined,
      setCode: related.setCode?.toUpperCase?.() ?? related.setCode,
      collectorNumber: related.collectorNumber,
    };
  });
}
