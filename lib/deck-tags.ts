import type { Prisma } from "@prisma/client";

export const MAX_DECK_TAGS = 12;
export const MAX_DECK_TAG_LENGTH = 32;

export type ParsedDeckTag = {
  name: string;
  normalizedName: string;
};

export function normalizeDeckTagName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseDeckTags(value: unknown): ParsedDeckTag[] {
  const raw = typeof value === "string" ? value : "";
  const tags: ParsedDeckTag[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const name = part.trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (name.length > MAX_DECK_TAG_LENGTH) {
      throw new Error(
        `Deck tags must be ${MAX_DECK_TAG_LENGTH} characters or fewer.`,
      );
    }
    const normalizedName = normalizeDeckTagName(name);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    tags.push({ name, normalizedName });
    if (tags.length > MAX_DECK_TAGS) {
      throw new Error(`A deck can have at most ${MAX_DECK_TAGS} tags.`);
    }
  }
  return tags;
}

export function deckTagsText(assignments: Array<{ tag: { name: string } }>) {
  return assignments
    .map((assignment) => assignment.tag.name)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

export async function replaceDeckTags(
  tx: Prisma.TransactionClient,
  input: {
    deckId: string;
    ownerUserId: string;
    tags: ParsedDeckTag[];
  },
) {
  await tx.deckTagAssignment.deleteMany({
    where: { deckId: input.deckId },
  });
  for (const parsed of input.tags) {
    const tag = await tx.deckTag.upsert({
      where: {
        ownerUserId_normalizedName: {
          ownerUserId: input.ownerUserId,
          normalizedName: parsed.normalizedName,
        },
      },
      create: {
        ownerUserId: input.ownerUserId,
        name: parsed.name,
        normalizedName: parsed.normalizedName,
      },
      update: { name: parsed.name },
    });
    await tx.deckTagAssignment.create({
      data: { deckId: input.deckId, tagId: tag.id },
    });
  }
  await tx.deckTag.deleteMany({
    where: {
      ownerUserId: input.ownerUserId,
      decks: { none: {} },
    },
  });
}
