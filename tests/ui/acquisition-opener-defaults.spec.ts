import {expect, test, type Route} from "@playwright/test";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {writeFileSync} from "node:fs";
import sharp from "sharp";
import {cleanupReviewFixture, reviewDatabase, reviewFingerprint, reviewSourceState} from "./review-acceptance-fixture";
import {acquisitionDraftKey} from "../../lib/acquisition-browser-review-draft";

test.skip(process.env.MTG_ACQUISITION_OPENER_TEST !== "1", "Explicit isolated opener fixture; no recognition or hardware claim");
test.use({trace:"retain-on-failure",screenshot:"only-on-failure",video:"off"});

for (const width of [1366,320]) test(`batch opener, per-card override, frozen bulk retry and actual receipt at ${width}px`,async({page,baseURL})=>{
  test.setTimeout(150_000);page.setDefaultTimeout(15_000);
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  await page.setViewportSize({width,height:width===1366?768:844});
  const tag="ui-review-acceptance-"+randomUUID(),cardId=tag+"-card",openerA=tag+"-opener-a",openerB=tag+"-opener-b";
  const token=randomBytes(32).toString("base64url"),tokenHash=createHash("sha256").update(token).digest("hex");
  const before=reviewFingerprint() as Record<string,{count:number;hash:string}>;expect(Object.keys(before)).toHaveLength(85);
  writeFileSync(test.info().outputPath("before.json"),JSON.stringify(before));
  let batch="",primary:unknown,failed=false;
  try{
    reviewDatabase(`const n=${JSON.stringify(tag)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{
      await tx.player.create({data:{id:n,name:n,displayName:n}});
      await tx.player.create({data:{id:${JSON.stringify(openerA)},name:n+'-opener-a',displayName:'Original opener A'}});
      await tx.player.create({data:{id:${JSON.stringify(openerB)},name:n+'-opener-b',displayName:'Original opener B',active:false}});
      await tx.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash}});
      await tx.authSession.create({data:{tokenHash:${JSON.stringify(tokenHash)},userId:n,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+900000)}});
      await tx.inventoryLocation.create({data:{id:n,name:'Opener fixture box',normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:10,sections:[]}}});
      await tx.card.create({data:{id:${JSON.stringify(cardId)},scryfallId:require('crypto').randomUUID(),name:'Opener fixture card',setCode:'tst',collectorNumber:'1',lang:'en',finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});
    });return true;`);
    await page.context().addCookies([{name:"mtg_inventory_session",value:token,url:baseURL!,httpOnly:true,sameSite:"Lax"}]);
    await page.goto("/imports/scan?input=photos");
    await page.getByPlaceholder("Search boxes, vaults, or storage paths…").fill("Opener fixture box");
    await page.getByRole("option").filter({hasText:"Opener fixture box"}).click();
    await page.getByRole("checkbox",{name:"Set a batch limit (optional)",exact:true}).check();
    await page.getByRole("spinbutton",{name:"Cards in this batch",exact:true}).fill("5");
    await page.getByRole("combobox",{name:"Batch original opener",exact:true}).selectOption(openerA);
    await page.getByRole("button",{name:"Start batch",exact:true}).click();
    await expect(page).toHaveURL(/batch=/);batch=new URL(page.url()).searchParams.get("batch")!;
    const headers={origin:baseURL!},endpoint=`/api/acquisition/${batch}/review`;
    const state=await (await page.request.get(`/api/acquisition/${batch}`)).json();
    expect(state.defaults.openerPlayerId).toBe(openerA);
    const bytes=await sharp({create:{width:80,height:120,channels:3,background:"#335577"}}).jpeg().toBuffer();
    const photos:string[]=[];
    for(let index=0;index<5;index++){
      const reserved=await page.request.post(`/api/acquisition/${batch}`,{headers,data:{action:"reserve",requestKey:randomUUID()}});
      expect(reserved.ok(),await reserved.text()).toBe(true);const {slot}=await reserved.json();
      const upload=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`,
        {headers:{...headers,"content-type":"image/jpeg"},data:bytes});
      expect(upload.ok(),await upload.text()).toBe(true);photos.push((await upload.json()).id);
    }
    // Controlled presentation evidence, not native recognition: all five actual
    // uploads use one known local printing and retain their distinct identities.
    reviewDatabase(`const jobs=await p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}},stage:'photo-canonical-v1'}});
      if(jobs.length!==5||jobs.some(j=>j.status==='RUNNING'))throw Error('Unexpected fixture jobs');
      const card=await p.card.findUniqueOrThrow({where:{id:${JSON.stringify(cardId)}}});
      for(const job of jobs){await p.acquisitionProcessingJob.update({where:{id:job.id},data:{status:'FAILED',errorCode:'CONTROLLED_UI_FIXTURE'}});
        await p.acquisitionProcessingJob.create({data:{runId:job.runId,artifactId:job.artifactId,candidateId:job.candidateId,candidateRevision:job.candidateRevision,
          stage:'photo-catalog-reconciliation-v1',versionKey:require('crypto').randomUUID(),input:job.input,status:'COMPLETE',
          output:{catalog:{status:'RESOLVED',printingCoverage:'CHECKED'},proposals:{version:4,status:'REVIEW_REQUIRED',automaticAcceptance:false,totalProposals:1,truncated:false,
            proposals:[{card:{id:card.id,name:card.name,setCode:card.setCode,collectorNumber:card.collectorNumber,lang:card.lang},reasons:['CONTROLLED_UI_FIXTURE'],nameDistance:null}]}}}});}
      return true;`);
    const source=()=>({photos:(reviewSourceState(batch).photos as Record<string,unknown>[]).map(photo=>Object.fromEntries(
      ["id","digest","actualDigest","bytes","width","height","inputKind","generation","slotId","sourceMetadata"].map(key=>[key,photo[key]]))),
      jobs:reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`)});
    const originals=source();writeFileSync(test.info().outputPath("originals-before.json"),JSON.stringify(originals));
    await page.reload();await page.getByRole("button",{name:"Stop capture",exact:true}).click();
    await expect.poll(async()=>(await (await page.request.get(`/api/acquisition/${batch}`)).json()).phase)
      .toMatch(/^(STOPPING|COMPLETE)$/);
    await page.getByRole("button",{name:"Advanced",exact:true}).click();
    async function revealCard(index:number){
      const card=page.getByTestId(`capture-card-${index+1}`);
      // Earlier cards expand after their lazy reviews load; keep the intended
      // card in view until its editor has actually entered the viewport.
      await expect(async()=>{
        await card.scrollIntoViewIfNeeded();
        await expect(card.getByRole("combobox",{name:"Original opener",exact:true})).toBeVisible({timeout:1000});
      }).toPass({timeout:15_000});
      return card;
    }
    for(let index=0;index<3;index++){
      const card=await revealCard(index);
      const opener=card.getByRole("combobox",{name:"Original opener",exact:true});await expect(opener).toHaveValue(openerA);
      if(index===1){await opener.selectOption("");await page.reload();await revealCard(index);await expect(opener).toHaveValue("");}
      if(index===2)await opener.selectOption(openerB);
      await card.getByRole("button",{name:"Save card review",exact:true}).click();
      await expect.poll(async()=> (await (await page.request.get(`${endpoint}?photoId=${photos[index]}`)).json()).review?.openerPlayerId)
        .toBe([openerA,null,openerB][index]);
    }
    // Version-1 drafts from older clients omit opener entirely. Reload the actual
    // editor with such an unrelated correction over both saved known and Unknown.
    // The batch still has A, so neither omission may erase/invent saved provenance.
    for(const index of [0,1]){
      const record=await (await page.request.get(`${endpoint}?photoId=${photos[index]}`)).json();
      const legacy={version:1,writeId:randomUUID(),revision:record.revision,selected:record.printing,
        finish:record.review.finish,condition:"NM",language:record.review.language,query:"",set:"",number:""};
      expect(Object.hasOwn(legacy,"openerPlayerId")).toBe(false);
      await page.evaluate(({key,draft})=>localStorage.setItem(key,JSON.stringify(draft)),
        {key:acquisitionDraftKey({userId:tag,batchId:batch,photoId:photos[index]}),draft:legacy});
      await page.reload();const card=await revealCard(index);
      await expect(card).toContainText("Unsaved correction restored");
      await expect(card.getByRole("combobox",{name:"Original opener",exact:true})).toHaveValue(index===0?openerA:"");
      await card.getByRole("button",{name:"Save card review",exact:true}).click();
      await expect.poll(async()=>(await (await page.request.get(`${endpoint}?photoId=${photos[index]}`)).json()).review?.openerPlayerId)
        .toBe(index===0?openerA:null);
      await expect(card).not.toContainText("Unsaved correction restored");
    }
    const savedReviews=await Promise.all(photos.slice(0,3).map(async id=>(await (await page.request.get(`${endpoint}?photoId=${id}`)).json()).review));
    const defaults=page.getByRole("region",{name:"Batch review defaults",exact:true});
    await defaults.getByRole("combobox",{name:"Batch original opener",exact:true}).selectOption(openerB);
    await defaults.getByRole("button",{name:"Save batch defaults",exact:true}).click();
    await expect(defaults).toContainText("Batch defaults saved.");
    expect(await Promise.all(photos.slice(0,3).map(async id=>(await (await page.request.get(`${endpoint}?photoId=${id}`)).json()).review))).toEqual(savedReviews);
    const bulk=page.getByRole("region",{name:"Bulk match review",exact:true});
    await bulk.getByRole("button",{name:"Bulk Confirm Match",exact:true}).click();
    await expect(bulk.getByRole("button",{name:"Confirm 2 selected matches",exact:true})).toBeEnabled();
    let attempts=0;const sent:string[]=[];
    const interrupt=async(route:Route)=>{const body=route.request().postDataJSON();
      if(body.action==="accept"&&body.photoId===photos[3]&&attempts<2){attempts++;sent.push(route.request().postData()!);
        if(attempts===1){const response=await route.fetch();expect(response.status()).toBe(200);}await route.abort("failed");}
      else await route.continue();};
    await page.route("**/api/acquisition/*/review",interrupt);
    await bulk.getByRole("button",{name:"Confirm 2 selected matches",exact:true}).click();
    await expect(bulk).toContainText("A confirmation is uncertain");expect(attempts).toBe(2);expect(sent[0]).toBe(sent[1]);
    expect(JSON.parse(sent[0]).decision.openerPlayerId).toBe(openerB);
    await defaults.getByRole("combobox",{name:"Batch original opener",exact:true}).selectOption(openerA);
    await defaults.getByRole("button",{name:"Save batch defaults",exact:true}).click();
    await expect.poll(async()=>(await (await page.request.get(`/api/acquisition/${batch}`)).json()).defaults.openerPlayerId)
      .toBe(openerA);
    await page.unroute("**/api/acquisition/*/review",interrupt);
    await bulk.getByRole("button",{name:"Continue original confirmations",exact:true}).click();
    await expect.poll(async()=>Promise.all(photos.slice(3).map(async id=>(await (await page.request.get(`${endpoint}?photoId=${id}`)).json()).review?.openerPlayerId)))
      .toEqual([openerB,openerB]);
    expect(reviewDatabase<number>(`return p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}});`)).toBe(0);
    for(let index=0;index<5;index++)await page.getByRole("checkbox",{name:`Select card ${index+1} for Inventory`,exact:true}).check();
    const panel=page.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true});
    await panel.getByRole("button",{name:"Preview selected cards",exact:true}).click();
    const confirm=panel.getByLabel("Confirm Inventory addition",{exact:true});await expect(confirm).toContainText("Add 5 copies");
    await confirm.locator("summary").click();await expect(confirm).toContainText("Original opener A");await expect(confirm).toContainText("Original opener B");
    await expect(confirm).toContainText("Original opener: Unknown");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await confirm.screenshot({path:test.info().outputPath("opener-preview.png")});
    await confirm.getByRole("button",{name:"Add 5 copies to Inventory",exact:true}).click();await expect(panel).toContainText("Added 5 copies to Inventory.");
    const ledger=reviewDatabase<{lots:{originalOpenerId:string|null;quantity:number}[];audits:number;members:number}>(`return {
      lots:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}},select:{originalOpenerId:true,quantity:true}}),
      audits:await p.inventoryAuditLog.count({where:{changedByUserId:${JSON.stringify(tag)},changeType:'acquisition_committed'}}),
      members:await p.acquisitionCommitMember.count({where:{candidate:{run:{sessionId:${JSON.stringify(batch)}}}}})};`);
    expect(new Map(ledger.lots.map(lot=>[lot.originalOpenerId,lot.quantity]))).toEqual(new Map([[openerA,1],[openerB,3],[null,1]]));
    expect(ledger.audits).toBe(3);expect(ledger.members).toBe(5);expect(source()).toEqual(originals);
    writeFileSync(test.info().outputPath("ledger.json"),JSON.stringify(ledger));
  }catch(error){failed=true;primary=error;}
  const cleanup:unknown[]=[];
  try{cleanupReviewFixture(tag,cardId);}catch(error){cleanup.push(error);}
  try{reviewDatabase(`await p.player.deleteMany({where:{id:{in:${JSON.stringify([openerA,openerB])}}}});return true;`);}catch(error){cleanup.push(error);}
  try{const after=reviewFingerprint();writeFileSync(test.info().outputPath("after.json"),JSON.stringify(after));expect(after).toEqual(before);}catch(error){cleanup.push(error);}
  if(failed||cleanup.length)throw new AggregateError([...(failed?[primary]:[]),...cleanup],
    "Opener browser qualification or exact cleanup failed",{cause:failed?primary:cleanup[0]});
});
