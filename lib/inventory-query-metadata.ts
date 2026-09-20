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

export type QueryMetadataProjection = {
  columns: readonly (typeof QUERY_METADATA_FIELDS)[number][];
  raw: readonly (typeof QUERY_RAW_METADATA_FIELDS)[number][];
};

const fullProjection: QueryMetadataProjection = {
  columns: QUERY_METADATA_FIELDS,
  raw: QUERY_RAW_METADATA_FIELDS,
};

// Common expressions avoid even loading unrelated evaluator metadata. More
// complex fields deliberately fall back to the complete evaluator projection.
export function queryMetadataForFields(
  fields: string[],
): QueryMetadataProjection {
  const simple: Record<string, QueryMetadataProjection> = {
    name: {
      columns: ["name", "printedName", "cardFaces"],
      raw: ["card_faces"],
    },
    type: {
      columns: ["typeLine", "printedTypeLine", "cardFaces"],
      raw: ["card_faces"],
    },
    oracle: {
      columns: ["oracleText", "printedText", "cardFaces"],
      raw: ["oracle_text", "card_faces"],
    },
    mana: { columns: ["manaCost", "cardFaces"], raw: ["card_faces"] },
    mv: { columns: ["manaValue"], raw: [] },
    color: { columns: ["colors"], raw: [] },
    identity: { columns: ["colorIdentity"], raw: [] },
    set: { columns: ["setCode"], raw: [] },
    setname: { columns: ["setName"], raw: [] },
    settype: { columns: ["setType"], raw: [] },
    rarity: { columns: ["rarity"], raw: [] },
    number: { columns: ["collectorNumber"], raw: [] },
    artist: { columns: ["artist"], raw: [] },
    language: { columns: ["lang"], raw: [] },
    year: { columns: ["releasedAt"], raw: [] },
    date: { columns: ["releasedAt"], raw: [] },
    usd: { columns: ["prices"], raw: [] },
    eur: { columns: ["prices"], raw: [] },
    tix: { columns: ["prices"], raw: [] },
  };
  simple.fulloracle = simple.oracle;
  simple.devotion = simple.mana;
  const columns = new Set<QueryMetadataProjection["columns"][number]>(["id"]);
  const raw = new Set<QueryMetadataProjection["raw"][number]>();
  for (const field of fields) {
    const projection = simple[field];
    if (!projection) return fullProjection;
    projection.columns.forEach((column) => columns.add(column));
    projection.raw.forEach((key) => raw.add(key));
  }
  return { columns: [...columns], raw: [...raw] };
}

export function inventoryQueryMetadataSql(
  ids: string[],
  projection = fullProjection,
) {
  if (!ids.length || ids.length > QUERY_METADATA_BATCH_SIZE)
    throw new Error("Query metadata requires a bounded, nonempty ID batch.");
  // Identifiers and JSON keys below are static source constants, never user input.
  // IDs are Prisma-bound values. Authorization happens in the candidate query.
  const columns = Prisma.join(
    projection.columns.map((name) => Prisma.raw(`"${name}"`)),
  );
  const fallback = projection.raw.length
    ? Prisma.join(projection.raw.map((key) => Prisma.sql`${key}`))
    : Prisma.empty;
  // Iterate the raw document once instead of repeatedly decompressing the same
  // PostgreSQL TOAST value for each fallback key.
  const raw = projection.raw.length
    ? Prisma.sql`(SELECT jsonb_object_agg(key, value)
    FROM jsonb_each(CASE WHEN jsonb_typeof("rawScryfallJson") = 'object'
      THEN "rawScryfallJson" ELSE '{}'::jsonb END)
    WHERE key IN (${fallback}))`
    : Prisma.sql`NULL::jsonb`;
  return Prisma.sql`SELECT ${columns},
    ${raw} AS "rawScryfallJson"
    FROM "Card" WHERE "id" IN (${Prisma.join(ids)})`;
}

export async function matchingInventoryQueryCardIds(
  prisma: { $queryRaw: (query: Prisma.Sql) => Promise<unknown> },
  ids: string[],
  matches: (card: any) => boolean,
  projection = fullProjection,
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
        projection,
      ),
    )) as Array<{ id: string }>;
    for (const card of cards) if (matches(card)) result.push(card.id);
  }
  return result;
}
