import { upsertScryfallCard } from "./card-import";
import { prisma } from "./prisma";
import {
  formatScryfallError,
  submitCardCollectionResult,
  type ScryfallCollectionIdentifier,
} from "./scryfall";

const SCRYFALL_COLLECTION_BATCH_SIZE = 75;

export type CardMetadataRefreshResult = {
  totalCards: number;
  refreshed: number;
  relatedRefreshed: number;
  notFound: number;
  errors: Array<{ batchStart: number; message: string }>;
};

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function refreshAllCachedCardMetadata(): Promise<CardMetadataRefreshResult> {
  const cards = await prisma.card.findMany({
    where: { scryfallId: { not: "" } },
    select: { scryfallId: true },
    orderBy: { name: "asc" },
  });
  const identifiers: ScryfallCollectionIdentifier[] = cards
    .map((card) => card.scryfallId)
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id }));

  let refreshed = 0;
  let relatedRefreshed = 0;
  let notFound = 0;
  const errors: CardMetadataRefreshResult["errors"] = [];
  const relatedIds = new Set<string>();

  for (const [batchIndex, batch] of chunk(
    identifiers,
    SCRYFALL_COLLECTION_BATCH_SIZE,
  ).entries()) {
    const result = await submitCardCollectionResult(batch);
    const batchStart = batchIndex * SCRYFALL_COLLECTION_BATCH_SIZE;
    if (!result.ok) {
      errors.push({
        batchStart,
        message: formatScryfallError(result.error),
      });
      continue;
    }

    for (const card of result.data.data) {
      await upsertScryfallCard(card);
      refreshed += 1;
      for (const part of card.all_parts ?? []) {
        if (part.id) relatedIds.add(part.id);
      }
    }
    notFound += result.data.not_found?.length ?? 0;
  }

  for (const [batchIndex, batch] of chunk(
    Array.from(relatedIds).map((id) => ({ id })),
    SCRYFALL_COLLECTION_BATCH_SIZE,
  ).entries()) {
    const result = await submitCardCollectionResult(batch);
    const batchStart =
      identifiers.length + batchIndex * SCRYFALL_COLLECTION_BATCH_SIZE;
    if (!result.ok) {
      errors.push({
        batchStart,
        message: formatScryfallError(result.error),
      });
      continue;
    }

    for (const card of result.data.data) {
      await upsertScryfallCard(card);
      relatedRefreshed += 1;
    }
    notFound += result.data.not_found?.length ?? 0;
  }

  return {
    totalCards: identifiers.length,
    refreshed,
    relatedRefreshed,
    notFound,
    errors,
  };
}
