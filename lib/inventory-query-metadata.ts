import { Prisma } from "@prisma/client";

// Match the evaluator's metadata contract, not the complete cached Scryfall
// document (images, purchase links, related cards, etc.). Keep fallback fields:
// older cached printings may not have their normalized columns populated.
export const QUERY_METADATA_FIELDS = [
  "id",
  "name",
  "printedName",
  "typeLine",
  "printedTypeLine",
  "manaCost",
  "oracleText",
  "printedText",
  "cardFaces",
  "manaValue",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "colors",
  "colorIdentity",
  "colorIndicator",
  "setCode",
  "setName",
  "setType",
  "rarity",
  "artist",
  "collectorNumber",
  "lang",
  "keywords",
  "layout",
  "frame",
  "borderColor",
  "securityStamp",
  "games",
  "producedMana",
  "foil",
  "nonfoil",
  "reserved",
  "promo",
  "reprint",
  "variation",
  "digital",
  "fullArt",
  "textless",
  "booster",
  "storySpotlight",
  "oversized",
  "highresImage",
  "arenaId",
  "illustrationId",
  "legalities",
  "releasedAt",
  "prices",
  "finishes",
] as const;

export const QUERY_RAW_METADATA_FIELDS = [
  "card_faces",
  "oracle_text",
  "keywords",
  "flavor_text",
  "watermark",
  "content_warning",
  "arena_id",
  "illustration_id",
  "mana_cost",
  "legalities",
  "games",
  "finishes",
] as const;

export const QUERY_METADATA_BATCH_SIZE = 500;

export function inventoryQueryMetadataSql(ids: string[]) {
  if (!ids.length || ids.length > QUERY_METADATA_BATCH_SIZE)
    throw new Error("Query metadata requires a bounded, nonempty ID batch.");
  // Identifiers and JSON keys below are static source constants, never user input.
  // IDs are Prisma-bound values. Authorization happens in the candidate query.
  const columns = Prisma.join(
    QUERY_METADATA_FIELDS.map((name) => Prisma.raw(`"${name}"`)),
  );
  const fallback = Prisma.join(
    QUERY_RAW_METADATA_FIELDS.map((key) =>
      Prisma.raw(`'${key}', "rawScryfallJson"->'${key}'`),
    ),
  );
  return Prisma.sql`SELECT ${columns},
    jsonb_build_object(${fallback}) AS "rawScryfallJson"
    FROM "Card" WHERE "id" IN (${Prisma.join(ids)})`;
}

export async function matchingInventoryQueryCardIds(
  prisma: { $queryRaw: (query: Prisma.Sql) => Promise<unknown> },
  ids: string[],
  matches: (card: any) => boolean,
) {
  const result: string[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += QUERY_METADATA_BATCH_SIZE
  ) {
    const cards = (await prisma.$queryRaw(
      inventoryQueryMetadataSql(
        ids.slice(offset, offset + QUERY_METADATA_BATCH_SIZE),
      ),
    )) as Array<{ id: string }>;
    for (const card of cards) if (matches(card)) result.push(card.id);
  }
  return result;
}
