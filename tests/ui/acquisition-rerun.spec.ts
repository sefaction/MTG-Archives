import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

function database(body: string) {
  const info = JSON.parse(execFileSync("docker",["inspect","mtg-rerun-review"],{encoding:"utf8",windowsHide:true}))[0];
  expect(info.Config.Labels["mtg.archive.owner"]).toBe("batch-recognition-rerun-20261120");
  return JSON.parse(execFileSync("docker",["exec","-i","-w","/app","mtg-rerun-review","node","--import","tsx"],{
    windowsHide:true,encoding:"utf8",timeout:30000,input:
      `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
test("own and admin reruns preserve ownership, confirmations and lost-response replay on desktop and phone",async({page,browser,baseURL})=>{
  test.skip(process.env.MTG_RERUN_REVIEW_TEST!=="1","Dedicated disposable rerun review only");
  expect(baseURL).toBe("http://127.0.0.1:13325"); test.setTimeout(120000);
  const tag=`ui-rerun-${randomUUID()}`,password=randomUUID();
  const cardId=database(`const tag=${JSON.stringify(tag)},hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
    for(const suffix of ['owner','other','admin']){const id=tag+'-'+suffix;await p.player.create({data:{id,name:id,displayName:id}});
      await p.user.create({data:{id,username:id,displayName:id,passwordHash:hash,playerId:id,role:suffix==='admin'?'ADMIN':'PLAYER'}});
      await p.inventoryLocation.create({data:{id,name:id,normalizedName:id,ownerPlayerId:id,type:'Box',storageLayout:{capacity:10,sections:[{name:'A',capacity:10}]}}});}
    const card=await p.card.create({data:{scryfallId:require('crypto').randomUUID(),name:tag,typeLine:'Creature',setCode:'tst',collectorNumber:'1',rarity:'common',lang:'en',finishes:['nonfoil']}});return card.id;`);
  async function login(target:Page,suffix:string){
    await target.goto('/login');await target.getByLabel(/username or email/i).fill(`${tag}-${suffix}`);
    await target.getByLabel(/^password$/i).fill(password);await target.getByRole('button',{name:/^log in$/i}).click();
    await target.waitForURL(/\/dashboard/);
  }
  const bytes=await sharp({create:{width:600,height:840,channels:3,background:'#456789'}}).png().toBuffer();
  async function capture(target:Page,suffix:string){
    const response=await target.request.post('/api/acquisition',{headers:{origin:baseURL!},data:{requestKey:randomUUID(),locationId:`${tag}-${suffix}`,section:'A',quantity:1}});
    expect(response.ok()).toBe(true);const batch=(await response.json()).id;
    const reserved=await target.request.post(`/api/acquisition/${batch}`,{headers:{origin:baseURL!},data:{action:'reserve',requestKey:randomUUID()}});
    expect(reserved.ok()).toBe(true);const {slot}=await reserved.json();
    const upload=await target.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`,{headers:{origin:baseURL!,'content-type':'image/png'},data:bytes});
    expect(upload.ok()).toBe(true);const photo=(await upload.json()).id;
    // Only source preparation is controlled. Real API admission, revisions,
    // background expansion and review saves run against the actual database.
    database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},stage:'photo-canonical-v1'},data:{status:'COMPLETE',output:{photoId:${JSON.stringify(photo)}}}});return true;`);
    return{batch,photo};
  }
  const otherContext=await browser.newContext(),adminContext=await browser.newContext();
  const otherPage=await otherContext.newPage(),adminPage=await adminContext.newPage();
  const batches:string[]=[];
  try{
    await login(page,'owner'); const first=await capture(page,'owner'),second=await capture(page,'owner');batches.push(first.batch,second.batch);
    await login(otherPage,'other'); const third=await capture(otherPage,'other');batches.push(third.batch);
    const otherBefore=database(`return await p.acquisitionCandidate.findFirstOrThrow({where:{run:{sessionId:${JSON.stringify(third.batch)}}}});`);
    expect((await page.request.post('/api/acquisition/rerun',{headers:{origin:baseURL!},data:{scope:'ALL',requestKey:randomUUID()}})).status()).toBe(403);
    expect((await page.request.post('/api/acquisition/rerun',{headers:{origin:'https://foreign.invalid'},data:{scope:'MINE',requestKey:randomUUID()}})).ok()).toBe(false);
    await page.goto('/imports/batches?q=no-matching-batch');
    await expect(page.getByRole('button',{name:'Re-run my pending batches'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Re-run all users’ pending batches'})).toHaveCount(0);
    const requests:unknown[]=[];let lose=true;
    await page.route('**/api/acquisition/rerun',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      requests.push(route.request().postDataJSON());
      if(lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(202);return route.abort('failed');}
      return route.continue();
    });
    await page.getByRole('button',{name:'Re-run my pending batches'}).click();
    await page.getByRole('button',{name:'Confirm rerun'}).click();
    await expect(page.getByRole('button',{name:'Retry same request'})).toBeVisible();
    await page.getByRole('button',{name:'Retry same request'}).click();expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);
    expect(database(`return await p.acquisitionRecognitionRerun.count({where:{actorUserId:${JSON.stringify(tag+'-owner')}}});`)).toBe(1);
    await page.reload();await expect(page.getByRole('status').filter({hasText:'Preparing rerun'})).toBeVisible();
    expect(database(`return await require('./lib/acquisition-rerun').runAcquisitionRerunOnce(p);`).queued).toBe(2);
    await expect(page.getByRole('status').filter({hasText:'2 cards queued for recognition'})).toBeVisible();
    expect(database(`return await p.acquisitionCandidate.findUniqueOrThrow({where:{id:${JSON.stringify(otherBefore.id)}}});`)).toEqual(otherBefore);
    await page.screenshot({path:'test-results/rerun-desktop.png',fullPage:true});
    const review=await(await page.request.get(`/api/acquisition/${first.batch}/review?photoId=${first.photo}`)).json();
    expect((await page.request.post(`/api/acquisition/${first.batch}/review`,{headers:{origin:baseURL!},data:{action:'accept',photoId:first.photo,revision:review.revision,decision:{cardId,finish:'NONFOIL',condition:'NM',language:'en'}}})).ok()).toBe(true);
    const saved=database(`return await p.acquisitionCandidate.findFirstOrThrow({where:{run:{sessionId:${JSON.stringify(first.batch)}}}});`);
    await login(adminPage,'admin');
    expect((await adminPage.request.post('/api/acquisition/rerun',{headers:{origin:baseURL!},data:{scope:'ALL',requestKey:randomUUID()}})).status()).toBe(403);
    await adminContext.addCookies([{name:'mtg_admin_mode',value:'1',url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
    await adminPage.goto('/admin');await adminPage.getByRole('button',{name:'Re-run all users’ pending batches'}).click();
    await adminPage.getByRole('button',{name:'Confirm rerun'}).click();
    expect(database(`return await require('./lib/acquisition-rerun').runAcquisitionRerunOnce(p);`).queued).toBe(2);
    await expect(adminPage.getByRole('status').filter({hasText:'2 cards queued for recognition'})).toBeVisible();
    const after=database(`return {candidate:await p.acquisitionCandidate.findUniqueOrThrow({where:{id:${JSON.stringify(saved.id)}}}),inventory:await p.inventoryItem.count(),other:await p.acquisitionCandidate.findFirstOrThrow({where:{run:{sessionId:${JSON.stringify(third.batch)}}}})};`);
    expect(after.candidate).toEqual(saved);expect(after.inventory).toBe(0);expect(after.other.revision).toBe(otherBefore.revision+1);
    await adminPage.screenshot({path:'test-results/rerun-admin-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.goto('/imports/batches');
    await expect(page.getByRole('button',{name:'Re-run my pending batches'})).toBeVisible();
    await expect(page.getByRole('status').filter({hasText:'2 cards queued for recognition'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/rerun-phone.png',fullPage:true});
  }finally{
    database(`await p.acquisitionSession.updateMany({where:{id:{in:${JSON.stringify(batches)}}},data:{phase:'CANCELLED',cancelledAt:new Date()}});return true;`);
    await otherContext.close();await adminContext.close();
  }
});
