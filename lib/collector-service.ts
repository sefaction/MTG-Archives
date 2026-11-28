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
  const items=await db.inventoryItem.findMany({
    where:{currentOwnerId:ownerId,quantity:{gt:0},OR:[{card:{setCode:set}},{card:{applicationFaces:{some:{sourceCard:{setCode:set}}}}}]},
    select:{currentOwnerId:true,quantity:true,language:true,foilStatus:true,card:{select:{scryfallId:true,
      applicationFaces:{select:{sourceFace:true,sourceCard:{select:{scryfallId:true,setCode:true}}}}}}},
  });
  return items.map(item=>{
    const faces=item.card.applicationFaces;
    const ids=[...new Set(faces.map(face=>face.sourceCard.scryfallId))];
    // A real art/catalog-pair printing is counted once. Independent token faces
    // are not invented as ownership of some other complete catalog pairing.
    const catalogId=item.card.scryfallId ?? (ids.length===1 && ids[0] &&
      new Set(faces.map(face=>face.sourceFace)).size===2 ? ids[0] : null);
    return {...item,card:{scryfallId:catalogId}};
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
