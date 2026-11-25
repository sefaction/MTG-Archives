import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getGlobalPublicInventory } from "../lib/public-collection";
import { enrichInventoryGroupsForFactSort } from "../lib/inventory-sort-enrichment";
import { constrainInventoryWhereToPostFilters, parseInventoryFilters } from "../lib/inventory-filters";
import { getInventoryExactPrintings } from "../lib/inventory-locations";
import { prepareInventoryPageGroups, inventoryPageScopeWhere } from "../lib/inventory-page-groups";

async function main() {
 const url=new URL(process.env.DATABASE_URL!);
 if(process.env.MTG_INVENTORY_SORT_TEST!=="1"||!["mtg-inventory-sort-db","mtg-inventory-quality-db"].includes(url.hostname)||url.pathname!=="/inventory_sort_fixture")throw Error("Use the dedicated disposable inventory-sort fixture.");
 const tag=`inventory-sort-${randomUUID()}`,owner=tag+"-owner",other=tag+"-other";
 try {
  for(const id of [owner,other]){await prisma.player.create({data:{id,name:id,displayName:id}});await prisma.user.create({data:{id,username:id,displayName:id,passwordHash:"non-authenticatable-synthetic-fixture",playerId:id,inventoryDefaultVisibility:"PUBLIC"}});}
  const box=await prisma.inventoryLocation.create({data:{ownerPlayerId:owner,name:"Public",normalizedName:"public"}}),secret=await prisma.inventoryLocation.create({data:{ownerPlayerId:owner,name:"Private",normalizedName:"private",visibility:"PRIVATE"}});
  const card=await prisma.card.create({data:{scryfallId:randomUUID(),oracleId:randomUUID(),name:tag,setCode:"tst",collectorNumber:"1",typeLine:"Artifact",rarity:"common",prices:{usd:"1",usd_foil:"9",usd_etched:"4"}}});
  const normal=await prisma.inventoryItem.create({data:{currentOwnerId:owner,cardId:card.id,quantity:2,condition:"NM",locationId:box.id}});
  const foil=await prisma.inventoryItem.create({data:{currentOwnerId:owner,cardId:card.id,quantity:1,condition:"NM",foilStatus:"FOIL",locationId:box.id}});
  const hidden=await prisma.inventoryItem.create({data:{currentOwnerId:owner,cardId:card.id,quantity:17,condition:"NM",foilStatus:"FOIL",locationId:secret.id,sourceType:"ACQUISITION"}});
  await prisma.inventoryItem.create({data:{currentOwnerId:other,cardId:card.id,quantity:40,condition:"NM",foilStatus:"FOIL"}});
  const before=await prisma.inventoryItem.findMany({orderBy:{id:"asc"}});
  const where={currentOwnerId:owner,quantity:{gt:0}};
  const constrained=await constrainInventoryWhereToPostFilters(prisma,where,parseInventoryFilters({priceMin:"9",priceMax:"9"}));
  const matched=await prisma.inventoryItem.findMany({where:constrained});assert.deepEqual(matched.map(r=>r.id).sort(),[foil.id,hidden.id].sort());
  const groups=await prisma.inventoryItem.groupBy({by:["cardId","foilStatus"],where,_sum:{quantity:true},_count:{_all:true}});
  const cards=new Map([[card.id,card]]);
  const sorted=prepareInventoryPageGroups(groups,cards,"exact","preferredPriceLabel","desc");assert.equal(sorted.sortedGroups[0].foilStatus,"FOIL");
  const hydrated=await prisma.inventoryItem.findMany({where:{AND:[where,inventoryPageScopeWhere(sorted.sortedGroups.slice(0,1),"exact",true)]},include:{card:true,location:true,currentOwner:true}});
  const rows=getInventoryExactPrintings(hydrated as any,true);assert.equal(rows.length,1);assert.equal(rows[0].quantity,18);assert.ok(rows[0].sourceItemIds.every(id=>id!==normal.id));
  const source=await enrichInventoryGroupsForFactSort(prisma,groups,where,["cardId","foilStatus"],"sourceType");assert.equal(source.find(g=>g.foilStatus==="FOIL").sourceTypeLabel,"Mixed");
  const visibility=await enrichInventoryGroupsForFactSort(prisma,groups,where,["cardId","foilStatus"],"effectiveVisibility");assert.equal(visibility.find(g=>g.foilStatus==="FOIL").effectiveVisibility,"MIXED");
  const personalized=await getGlobalPublicInventory({owner:other,sort:"preferredPriceLabel",sortDir:"desc",pageSize:"10"},{ownerPlayerId:owner});
  assert.ok(personalized.inventory.every(r=>r.currentOwnerId===owner&&r.locationId!==secret.id));assert.equal(personalized.inventory.filter(r=>r.foilStatus==="FOIL").reduce((n,r)=>n+r.quantity,0),1);
  assert.deepEqual(await prisma.inventoryItem.findMany({orderBy:{id:"asc"}}),before);
  const scale=tag+"-scale";await prisma.player.create({data:{id:scale,name:scale,displayName:scale}});await prisma.user.create({data:{username:scale,displayName:scale,passwordHash:"synthetic",playerId:scale,inventoryDefaultVisibility:"PUBLIC"}});
  for(let offset=0;offset<25000;offset+=500){const ids=Array.from({length:500},(_,i)=>`${tag}-card-${offset+i}`);await prisma.card.createMany({data:ids.map((id,i)=>({id,scryfallId:randomUUID(),name:`Scale ${offset+i}`,setCode:"tst",collectorNumber:String(offset+i),typeLine:"Artifact",rarity:"common",prices:{usd:((offset+i)%1000/100).toFixed(2)}}))});await prisma.inventoryItem.createMany({data:ids.map(cardId=>({currentOwnerId:scale,cardId,quantity:6,condition:"NM"}))});}
  const started=performance.now();const result=await getGlobalPublicInventory({pageSize:"100",sort:"preferredPriceLabel",sortDir:"desc"},{ownerPlayerId:scale});
  assert.equal(result.totalMatchingCount,25000);assert.equal(new Set(result.inventory.map(r=>r.cardId+":"+r.foilStatus)).size,100);
  assert.equal((await prisma.inventoryItem.aggregate({where:{currentOwnerId:scale},_sum:{quantity:true}}))._sum.quantity,150000);
  console.log(JSON.stringify({scale:{printings:25000,copies:150000,pageSize:100,elapsedMs:Math.round(performance.now()-started)}}));
  console.log("PASS inventory finish price boundaries: precise all-matching predicate, selected-page hydration, source/visibility labels, personalized owner/private scope, quantity/provenance conservation and 150000-copy paged query.");
 }finally{await prisma.$disconnect();}
}
if(process.argv.includes("--run"))main().catch(error=>{console.error(error);process.exitCode=1});
