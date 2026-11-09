import type { Prisma } from "@prisma/client";
import { collectorDetail, collectorProgress, type CollectorCard } from "./collector";

async function readCollectorInventory(db: Pick<Prisma.TransactionClient, "inventoryItem">,
  ownerId: string, set: string) {
  if (!ownerId || !/^[a-z0-9]{2,8}$/.test(set)) throw Error("An owner and valid set are required");
  return db.inventoryItem.findMany({
    where: {currentOwnerId: ownerId, quantity: {gt: 0}, card: {setCode: set}},
    select: {currentOwnerId: true, quantity: true, language: true, foilStatus: true,
      card: {select: {scryfallId: true}}},
  });
}

export async function readCollectorProgress(db: Pick<Prisma.TransactionClient, "inventoryItem">,
  ownerId: string, set: string, cards: CollectorCard[]) {
  return collectorProgress(cards, await readCollectorInventory(db, ownerId, set), ownerId);
}

export async function readCollectorDetail(db: Pick<Prisma.TransactionClient, "inventoryItem">,
  ownerId: string, set: string, cards: CollectorCard[], options: Parameters<typeof collectorDetail>[3]) {
  return collectorDetail(cards, await readCollectorInventory(db, ownerId, set), ownerId, options);
}
