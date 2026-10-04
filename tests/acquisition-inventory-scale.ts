// Local qualification metadata only. All records belong to generated fixture
// players; cached printings and existing user records are never modified.
export const inventoryScaleOwners = [
  {rows:15000,copies:144000,roots:200,children:2000},
  {rows:1000,copies:5000,roots:20,children:200},
  {rows:300,copies:900,roots:5,children:50},
  {rows:100,copies:100,roots:2,children:20},
];

export function seedInventoryScaleBody(tags:string[]) {
  if(tags.length!==4 || tags.some(tag=>!/^ui-large-[a-f0-9-]{36}-[0-3]$/.test(tag)))
    throw Error('Scale qualification requires four owned fixture players');
  return `
    const tags=${JSON.stringify(tags)}, specs=${JSON.stringify(inventoryScaleOwners)};
    const cards=await p.card.findMany({take:5000,select:{id:true},orderBy:{id:'asc'}});
    if(cards.length!==5000)throw Error('Scale qualification needs 5,000 cached printings');
    for(const [owner,n] of tags.entries()){
      const spec=specs[owner];
      const layout={capacity:600,sections:Array.from({length:6},(_,i)=>({name:String(i),capacity:100}))};
      const roots=Array.from({length:spec.roots},(_,i)=>({id:n+'-scale-root-'+i,
        ownerPlayerId:n,name:'Scale Vault '+String(i).padStart(3,'0'),normalizedName:'scale vault '+i,
        type:'Vault',visibility:'PRIVATE',storageLayout:layout}));
      const children=Array.from({length:spec.children},(_,i)=>({id:n+'-scale-child-'+i,
        ownerPlayerId:n,parentLocationId:roots[i%roots.length].id,
        name:'Scale Box '+String(i).padStart(4,'0'),normalizedName:'scale box '+i,
        type:'Box',visibility:'PRIVATE',storageLayout:layout}));
      await p.inventoryLocation.createMany({data:roots});
      for(let i=0;i<children.length;i+=500)await p.inventoryLocation.createMany({data:children.slice(i,i+500)});
      const locations=[...roots,...children];
      const items=Array.from({length:spec.rows},(_,i)=>({id:n+'-scale-item-'+i,
        cardId:cards[i%cards.length].id,currentOwnerId:n,originalOpenerId:n,
        locationId:locations[i%locations.length].id,locationSection:String(i%6),
        quantity:owner===0?9+(i<9000?1:0):owner===1?5:owner===2?3:1,
        condition:['NM','LP','MP'][i%3],sourceType:'MANUAL',language:'EN'}));
      for(let i=0;i<items.length;i+=500)await p.inventoryItem.createMany({data:items.slice(i,i+500)});
    }
    const inventory=await p.inventoryItem.aggregate({where:{currentOwnerId:{in:tags}},_count:{_all:true},_sum:{quantity:true}});
    console.log(JSON.stringify({printingCount:cards.length,owners:specs,
      rows:inventory._count._all,copies:inventory._sum.quantity,
      locations:await p.inventoryLocation.count({where:{ownerPlayerId:{in:tags}}})}));
  `;
}

export function inventoryFingerprintBody(owner?:string) {
  const filter=owner?` WHERE "currentOwnerId" = $1`:'';
  const args=owner?`,${JSON.stringify(owner)}`:'';
  const sql=`SELECT count(*)::int AS rows,COALESCE(sum(quantity),0)::int AS copies,
    md5(COALESCE(string_agg(row_to_json(i)::text,'' ORDER BY id),'')) AS hash
    FROM "InventoryItem" i${filter}`;
  return `const rows=await p.$queryRawUnsafe(${JSON.stringify(sql)}${args});console.log(JSON.stringify(rows[0]));`;
}

export function cleanupInventoryScalePageBody(owner:string) {
  if(!/^ui-large-[a-f0-9-]{36}-[0-3]$/.test(owner))
    throw Error('Cleanup requires an owned large-batch fixture player');
  return `const owner=${JSON.stringify(owner)};
    const items=await p.inventoryItem.findMany({where:{currentOwnerId:owner},
      select:{id:true},orderBy:{id:'asc'},take:500});
    const removed=items.length?await p.inventoryItem.deleteMany({where:{currentOwnerId:owner,
      id:{in:items.map(item=>item.id)}}}):{count:0};
    console.log(JSON.stringify(removed.count));`;
}
