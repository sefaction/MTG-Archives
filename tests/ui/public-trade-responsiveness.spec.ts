import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';

function database<T>(body:string):T {
  return JSON.parse(execFileSync('docker',['exec','-i','mtg-archives-web-1','node'],{
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Owned public trade fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding:'utf8',windowsHide:true,timeout:30000,
  }));
}

for (const width of [1366,320]) for (const workflow of ['navigation', 'navigation slow', 'navigation failure', 'wishlist', 'wishlist failure', 'wishlist lost acknowledgement', 'wishlist slow']) {
test(`Public trade ${workflow} remains responsive at ${width}px`,async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1','Owned local snapshot fixtures');
  expect(baseURL).toBe('http://127.0.0.1:13001');
  test.setTimeout(120000);
  await page.setViewportSize({width,height:900});
  const navigate=async(name:string)=>{
    const navigation=page.getByRole('navigation',{name:'Archive navigation'});
    if(width>=1100){
      await expect(navigation).toBeVisible();
      await navigation.getByRole('link',{name,exact:true}).click({timeout:10000});
    }else await expect(async()=>{
      if(!await navigation.isVisible())await page.locator('.archive-navigation > summary').click({timeout:1000});
      await navigation.getByRole('link',{name,exact:true}).click({timeout:1000});
    }).toPass({timeout:10000});
  };
  const tag=`ui-public-trade-${randomUUID()}`,password=randomUUID();
  const owner=`${tag}-owner`,viewer=`${tag}-viewer`,card=`${tag}-card`,inventory=`${tag}-inventory`;
  const errors:string[]=[];
  const uncaughtErrors:string[]=[];
  let releasePending=()=>{};
  page.on('pageerror',error=>uncaughtErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try {
    database(`const tag=${JSON.stringify(tag)},owner=${JSON.stringify(owner)},viewer=${JSON.stringify(viewer)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);for(const n of [owner,viewer]){await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,inventoryDefaultVisibility:n===owner?'PUBLIC':'PRIVATE'}});}await p.inventoryLocation.create({data:{id:owner,ownerPlayerId:owner,name:tag,normalizedName:tag,visibility:'PUBLIC'}});await p.card.create({data:{id:${JSON.stringify(card)},name:tag,scryfallId:require('crypto').randomUUID(),typeLine:'Artifact',setCode:'tst',collectorNumber:'1',rarity:'common',prices:{}}});await p.inventoryItem.create({data:{id:${JSON.stringify(inventory)},currentOwnerId:owner,originalOpenerId:owner,cardId:${JSON.stringify(card)},quantity:2,condition:'NM',locationId:owner,sourceType:'MANUAL'}});return true;`);
    await page.goto('/login');
    await page.getByLabel(/username or email/i).fill(viewer);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();
    await page.waitForURL(/dashboard/);
    const publicUrl=`/public/inventory?cardName=${encodeURIComponent(tag)}`;
    if (workflow==='navigation slow') {
      let requests=0;
      const gate=new Promise<void>(resolve=>{releasePending=resolve;});
      await page.route('**/trades*',async(route)=>{
        if(route.request().headers().rsc==='1'){requests++;await gate;}
        await route.continue();
      });
      await page.goto(publicUrl);
      await expect(page.locator('.inventory-results')).toContainText(tag);
      await navigate('Trades');
      await expect.poll(()=>requests).toBeGreaterThan(0);
      await navigate('Dashboard');
      await expect(page.getByRole('heading',{level:1,name:'My Dashboard',exact:true})).toBeVisible();
      releasePending();
      await page.unrouteAll({behavior:'wait'});
    }
    if(workflow==='navigation failure'){
      await page.route('**/trades*',async(route)=>{
        if(route.request().headers().rsc==='1')await route.fulfill({status:500,body:'Owned navigation failure'});
        else await route.continue();
      });
    }
    if (workflow.startsWith('navigation')) for(let iteration=0;iteration<2;iteration++){
      await page.goto(publicUrl);
      await expect(page.locator('.inventory-results')).toContainText(tag);
      await navigate('Trades');
      await expect(page.getByRole('heading',{level:1,name:'Trades',exact:true})).toBeVisible();
      await navigate('Public');
      await expect(page.getByRole('heading',{level:1,name:'Public inventory',exact:true})).toBeVisible();
    }
    if (workflow.startsWith('wishlist')) {
    await page.goto(publicUrl);
    await page.locator('.inventory-results').getByRole('button',{name:tag,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:tag,exact:true});
    await expect(dialog).toBeVisible();
    if(workflow==='wishlist failure'||workflow==='wishlist lost acknowledgement'){
      let failed=false;
      await page.route('**/public/inventory*',async(route)=>{
        if(route.request().method()==='POST'&&route.request().headers()['next-action']&&!failed){
          failed=true;
          if(workflow==='wishlist lost acknowledgement')await route.fetch();
          await route.abort('failed');
        }
        else await route.continue();
      });
      await dialog.getByRole('button',{name:`Wishlist from ${owner}`,exact:true}).click();
      await expect(dialog.getByRole('alert')).toContainText('Could not save your wishlist. Please try again.');
      expect(database<number>(`return p.tradeWishlistItem.count({where:{ownerUserId:${JSON.stringify(viewer)},targetInventoryItemId:${JSON.stringify(inventory)}}});`)).toBe(workflow==='wishlist lost acknowledgement'?1:0);
      await page.unrouteAll({behavior:'wait'});
    }
    let requests=0;
    if(workflow==='wishlist slow'){
      const gate=new Promise<void>(resolve=>{releasePending=resolve;});
      await page.route('**/public/inventory*',async(route)=>{
        if(route.request().method()==='POST'&&route.request().headers()['next-action']){requests++;await gate;}
        await route.continue();
      });
    }
    await dialog.getByRole('button',{name:`Wishlist from ${owner}`,exact:true}).click();
    if(workflow==='wishlist slow'){
      const pending=dialog.getByRole('button',{name:'Saving...',exact:true});
      await expect(pending).toBeDisabled();
      await pending.evaluate((button:HTMLButtonElement)=>button.click());
      await dialog.getByRole('button',{name:'Close',exact:true}).click();
      await expect(dialog).toHaveCount(0);
      releasePending();
      await expect.poll(()=>requests).toBe(1);
      await expect.poll(()=>database<number>(`return p.tradeWishlistItem.count({where:{ownerUserId:${JSON.stringify(viewer)},targetInventoryItemId:${JSON.stringify(inventory)}}});`)).toBe(1);
      await page.unrouteAll({behavior:'wait'});
      await page.locator('.inventory-results').getByRole('button',{name:tag,exact:true}).click();
    }
    await expect.poll(()=>database<number>(`return p.tradeWishlistItem.count({where:{ownerUserId:${JSON.stringify(viewer)},targetInventoryItemId:${JSON.stringify(inventory)}}});`)).toBe(1);
    await expect(dialog.getByRole('button',{name:'Saving...',exact:true})).toHaveCount(0);
    await expect(dialog.getByText('Wishlisted ×1',{exact:true})).toBeVisible();
    await dialog.getByLabel(`Wishlist quantity from ${owner}`).fill('2');
    await dialog.getByRole('button',{name:'Update',exact:true}).click();
    await expect(dialog.getByText('Wishlisted ×2',{exact:true})).toBeVisible();
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    if(workflow==='wishlist')await page.screenshot({path:`.local-data/public-wishlist-${width}.png`});
    expect(database<{count:number,quantity:number}>(`const records=await p.tradeWishlistItem.findMany({where:{ownerUserId:${JSON.stringify(viewer)},targetInventoryItemId:${JSON.stringify(inventory)}}});return {count:records.length,quantity:records[0]?.quantity};`)).toEqual({count:1,quantity:2});
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    }
    await navigate('Trades');
    await expect(page.getByRole('heading',{level:1,name:'Trades',exact:true})).toBeVisible();
    if(workflow==='navigation')await page.screenshot({path:`.local-data/public-trades-${width}.png`});
    expect(uncaughtErrors).toEqual([]);
    if(workflow==='navigation failure'){
      expect(errors.filter(message=>!message.startsWith('Failed to load resource: the server responded with a status of 500')&&!message.startsWith('Failed to fetch RSC payload for '))).toEqual([]);
    }else expect(errors).toEqual(['wishlist failure','wishlist lost acknowledgement'].includes(workflow)?['Failed to load resource: net::ERR_FAILED']:[]);
  } finally {
    releasePending();
    writeFileSync(`.local-data/public-trade-${workflow}-${width}-errors.json`,JSON.stringify({console:errors,uncaught:uncaughtErrors}));
    try {
      if(!page.isClosed())await page.unrouteAll({behavior:'wait'});
    } finally {
    database(`const tag=${JSON.stringify(tag)},ids=${JSON.stringify([owner,viewer])};if(!/^ui-public-trade-[a-f0-9-]{36}$/.test(tag))throw Error('Invalid fixture namespace');await p.tradeWishlistNotificationActivity.deleteMany({where:{actorUserId:{in:ids}}});await p.notification.deleteMany({where:{recipientUserId:{in:ids}}});await p.tradeWishlistItem.deleteMany({where:{ownerUserId:{in:ids}}});await p.inventoryItem.deleteMany({where:{id:${JSON.stringify(inventory)},currentOwnerId:${JSON.stringify(owner)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});await p.authSession.deleteMany({where:{userId:{in:ids}}});await p.user.deleteMany({where:{id:{in:ids}}});await p.player.deleteMany({where:{id:{in:ids}}});await p.card.deleteMany({where:{id:${JSON.stringify(card)}}});return true;`);
    }
  }
});
}
