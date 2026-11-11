import type { Prisma } from "@prisma/client";
import {
  collectorDetail,
  collectorProgress,
  collectorWishlistTargets,
  type CollectorCard,
  type CollectorMode,
} from "./collector";

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

type CollectorWishlistSelection = {scope: "all"} | {scope: "one"; targetId: string};

export async function saveCollectorWishes(
  db: Pick<Prisma.TransactionClient, "inventoryItem" | "collectorWishlistItem">,
  owner: {userId: string; playerId: string},
  set: string,
  cards: CollectorCard[],
  mode: CollectorMode,
  selection: CollectorWishlistSelection,
) {
  const inventory = await readCollectorInventory(db, owner.playerId, set);
  const targets = collectorWishlistTargets(cards, inventory, owner.playerId, mode);
  const selected = selection.scope === "one"
    ? targets.filter(target => target.id === selection.targetId)
    : targets;
  if (selection.scope === "one" && !selected.length) return {valid: false} as const;

  const missing = selected.filter(target => target.quantity === 0)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!missing.length) return {valid: true, added: 0, alreadySaved: 0} as const;

  // The unique target key makes individual and bulk adds safe to repeat,
  // including concurrent submissions. Existing preferences are kept.
  const result = await db.collectorWishlistItem.createMany({
    data: missing.map(target => ({
      ownerUserId: owner.userId,
      setCode: set,
      mode,
      targetKey: target.id,
      cardName: target.name,
      collectorNumber: target.collectorNumber,
      preferredFinish: target.preferredFinish,
    })),
    skipDuplicates: true,
  });
  return {valid: true, added: result.count, alreadySaved: missing.length - result.count} as const;
}
