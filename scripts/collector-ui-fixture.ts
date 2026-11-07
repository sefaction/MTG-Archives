import {PrismaClient} from "@prisma/client";
import {hash} from "bcryptjs";
import {writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
async function main() {
  if (process.env.DATABASE_URL !== "postgresql://collector:collector@mtg-collector-1010-db:5432/collector_1010") throw Error("Disposable DB only");
  const db = new PrismaClient();
  try {
    const p = await db.player.create({data: {name: "collector-ui", displayName: "Collector UI"}});
    const user = await db.user.create({data: {username: "collector-ui", displayName: "Collector UI", playerId: p.id, passwordHash: await hash("collector-fixture-only", 10)}});
    const peer = await db.player.create({data: {name: "collector-peer", displayName: "Peer"}});
    await db.user.create({data: {username: "collector-peer", displayName: "Peer", playerId: peer.id, passwordHash: await hash("collector-fixture-only", 10)}});
    await db.user.create({data: {username: "collector-unlinked", displayName: "Unlinked", passwordHash: await hash("collector-fixture-only", 10)}});
    const deck = await db.deck.create({data: {ownerUserId: user.id, name: "Committed collection"}});
    const location = await db.inventoryLocation.create({data: {ownerPlayerId: p.id, name: "Deck", normalizedName: "collector-deck", kind: "DECK", systemManaged: true, deckId: deck.id}});
    const oracle = randomUUID();
    const cards = [];
    for (let i=0;i<4;i++) {
      const id=randomUUID(); const token=i===3;
      const card=await db.card.create({data: {scryfallId:id, oracleId: i<2?oracle:randomUUID(), name: i<2?"Variant wizard":token?"Token":"Deck creature", setCode:"tst", setName:"Collector test set", collectorNumber:String(i+1), typeLine:token?"Token Creature":"Creature",rarity:"common"}});
      cards.push({id,oracle_id:card.oracleId,name:card.name,set:"tst",lang:"en",digital:false,games:["paper"],layout:token?"token":"normal",type_line:card.typeLine,oversized:false,finishes:["nonfoil","foil"]});
      if(i!==1) await db.inventoryItem.create({data:{cardId:card.id,currentOwnerId:p.id,quantity:token?1000:20,language:"EN",condition:"NM",foilStatus:"NONFOIL",locationId: i===2?location.id:null}});
      await db.inventoryItem.create({data:{cardId:card.id,currentOwnerId:peer.id,quantity:99,language:"EN",condition:"NM",foilStatus:"FOIL"}});
    }
    writeFileSync("/review/.local-data/collector-fixture.json",JSON.stringify({cards}));
  } finally {await db.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
