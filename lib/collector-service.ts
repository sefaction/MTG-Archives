import type { Prisma } from "@prisma/client";
import { collectorProgress, type CollectorCard } from "./collector";
export async function readCollectorProgress(db: Pick<Prisma.TransactionClient, "inventoryItem">,
  ownerId: string, set: string, cards: CollectorCard[]) {
  if (!ownerId || !/^[a-z0-9]{2,8}$/.test(set)) throw Error("An owner and valid set are required");
  const owned = await db.inventoryItem.findMany({
    where: {currentOwnerId: ownerId, quantity: {gt: 0}, card: {setCode: set}},
    select: {currentOwnerId: true, quantity: true, language: true, foilStatus: true,
      card: {select: {scryfallId: true}}},
  });
  return collectorProgress(cards, owned, ownerId);
}
