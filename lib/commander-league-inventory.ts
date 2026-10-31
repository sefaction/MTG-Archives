import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type LeaguePoolStatus = "IN_POOL" | "OTHER_PRINTING" | "OUTSIDE_POOL";

type PoolCard = { id: string; name: string; oracleId: string | null };

/** Read current linked stock once for the entire deck, across printings. */
export async function getLeaguePoolAvailability(
  leagueId: string,
  cards: PoolCard[],
  client: Pick<Prisma.TransactionClient, "inventoryItem"> = prisma,
) {
  const result = new Map<string, { status: LeaguePoolStatus; exactQuantity: number }>();
  if (!cards.length) return result;
  const oracleIds = [...new Set(cards.flatMap((card) => card.oracleId ? [card.oracleId] : []))];
  const names = [...new Set(cards.filter((card) => !card.oracleId).map((card) => card.name))];
  const items = await client.inventoryItem.findMany({
    where: {
      ...leagueInventoryItemWhere(leagueId),
      OR: [
        { cardId: { in: cards.map((card) => card.id) } },
        ...(oracleIds.length ? [{ card: { oracleId: { in: oracleIds } } }] : []),
        ...(names.length ? [{ card: { name: { in: names, mode: "insensitive" as const } } }] : []),
      ],
    },
    select: { cardId: true, quantity: true, card: { select: { name: true, oracleId: true } } },
  });
  for (const card of cards) {
    const exactQuantity = items.filter((item) => item.cardId === card.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    const sameCard = items.some((item) => card.oracleId
      ? item.card.oracleId === card.oracleId
      : item.card.name.toLowerCase() === card.name.toLowerCase());
    result.set(card.id, {
      exactQuantity,
      status: exactQuantity > 0 ? "IN_POOL" : sameCard ? "OTHER_PRINTING" : "OUTSIDE_POOL",
    });
  }
  return result;
}

export const leagueInventoryItemWhere = (
  leagueId: string,
): Prisma.InventoryItemWhereInput => ({
  quantity: { gt: 0 },
  location: {
    commanderLeagueLinks: { some: { leagueId } },
  },
});

export async function isPrintingInLeague(
  leagueId: string,
  cardId: string,
  client: Pick<Prisma.TransactionClient, "inventoryItem"> = prisma,
) {
  const item = await client.inventoryItem.findFirst({
    where: { ...leagueInventoryItemWhere(leagueId), cardId },
    select: { id: true },
  });
  return Boolean(item);
}

export async function areAllPrintingsInLeague(
  leagueId: string,
  cardIds: string[],
  client: Pick<Prisma.TransactionClient, "inventoryItem"> = prisma,
) {
  const requested = [...new Set(cardIds)];
  if (requested.length === 0) return true;
  // Check the complete list with one database request. Parallel per-card reads
  // can exhaust shared PostgreSQL connections before the import starts.
  const groups = await client.inventoryItem.groupBy({
    by: ["cardId"],
    where: {
      ...leagueInventoryItemWhere(leagueId),
      cardId: { in: requested },
    },
  });
  const available = new Set(groups.map((group) => group.cardId));
  return requested.every((cardId) => available.has(cardId));
}

export async function requireLeaguePrinting(
  leagueId: string,
  cardId: string,
  client: Pick<Prisma.TransactionClient, "inventoryItem"> = prisma,
) {
  if (!(await isPrintingInLeague(leagueId, cardId, client))) {
    throw new Error(
      "The selected printing is not present in an inventory location linked to this League.",
    );
  }
}
