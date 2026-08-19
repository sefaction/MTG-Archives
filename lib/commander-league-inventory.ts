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
