import { Prisma, type Card } from "@prisma/client";

// Filter a narrow projection before ordering. With a full bulk catalog,
// PostgreSQL's incremental-sort plan can otherwise walk tens of thousands of
// wide Card rows through the name index just to return twenty common lands.
// This is public card metadata only; ownership/League filtering remains with
// its existing scoped query, and Scryfall syntax bypasses this helper.
export async function searchLocalCardCatalog(
  db: Pick<Prisma.TransactionClient, "$queryRaw" | "card">,
  input: {
    query: string;
    setCode: string;
    limit: number;
    includeTypeLine?: boolean;
  },
): Promise<Card[]> {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 175
  )
    throw new Error("Invalid local card search limit");
  const pattern = `%${input.query}%`;
  // Broad types (e.g. Creature) can match most of the catalog. Keep that
  // ordered, bounded branch separate so it can stop early. Its first N rows
  // suffice for the first N of the union, using the same deterministic order.
  const typeMatch = input.includeTypeLine
    ? Prisma.sql`UNION (
        SELECT id, name, "releasedAt" FROM "Card"
        WHERE "typeLine" ILIKE ${pattern}
        ORDER BY name ASC, "releasedAt" DESC, id ASC
        LIMIT ${input.limit}
      )`
    : Prisma.empty;
  const matches = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH matched AS MATERIALIZED (
      SELECT id, name, "releasedAt" FROM "Card"
      WHERE name ILIKE ${pattern}
        OR "setCode" ILIKE ${input.setCode}
        OR "collectorNumber" = ${input.query}
    )
    SELECT id FROM (SELECT * FROM matched ${typeMatch}) candidates
    ORDER BY name ASC, "releasedAt" DESC, id ASC
    LIMIT ${input.limit}
  `);
  if (!matches.length) return [];
  // Hydrate through Prisma so ignored legacy columns (e.g. cmc) and future
  // database-only fields cannot leak into application response objects.
  const cards = await db.card.findMany({
    where: { id: { in: matches.map((m) => m.id) } },
  });
  const byId = new Map(cards.map((card) => [card.id, card]));
  return matches.flatMap(({ id }) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}
