import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

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
