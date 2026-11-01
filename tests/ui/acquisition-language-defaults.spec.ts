import {expect,test,type Route} from "@playwright/test";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {writeFileSync} from "node:fs";
import sharp from "sharp";
import {cleanupReviewFixture,reviewDatabase,reviewFingerprint,reviewSourceState} from "./review-acceptance-fixture";

test.skip(process.env.MTG_ACQUISITION_LANGUAGE_TEST!=="1","Requires an isolated language-policy fixture; no recognition accuracy claim");
test.use({trace:"retain-on-failure",screenshot:"only-on-failure",video:"off"});
for(const width of [1366,320])test(`confirmed batch language, readable conflict, frozen retry and Inventory at ${width}px`,async({page,baseURL})=>{
  test.setTimeout(150_000);expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  await page.setViewportSize({width,height:width===1366?768:844});
  const tag="ui-review-acceptance-"+randomUUID(),english=tag+"-card",french=tag+"-fr";
  const token=randomBytes(32).toString("base64url"),tokenHash=createHash("sha256").update(token).digest("hex");
  const before=reviewFingerprint() as Record<string,unknown>;expect(Object.keys(before)).toHaveLength(85);
  writeFileSync(test.info().outputPath("before.json"),JSON.stringify(before));
  let failed=false,primary:unknown,batch="";
  try{
    reviewDatabase(`const n=${JSON.stringify(tag)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{
      await tx.player.create({data:{id:n,name:n,displayName:n}});await tx.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash}});
      await tx.authSession.create({data:{tokenHash:${JSON.stringify(tokenHash)},userId:n,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+900000)}});
      await tx.inventoryLocation.create({data:{id:n,name:'Language fixture box',normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:10,sections:[]}}});
      for(const [id,lang] of ${JSON.stringify([[english,"en"],[french,"fr"]])})await tx.card.create({data:{id,scryfallId:require('crypto').randomUUID(),name:'Language fixture card',setCode:'lgt',collectorNumber:'1',lang,finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});
    });return true;`);
    await page.context().addCookies([{name:"mtg_inventory_session",value:token,url:baseURL!,httpOnly:true,sameSite:"Lax"}]);
    await page.goto("/imports/scan?input=photos");
    await expect(page.getByRole("combobox",{name:"Batch language",exact:true})).toHaveValue("");
    await page.getByPlaceholder("Search boxes, vaults, or storage paths…").fill("Language fixture box");
    await page.getByRole("option").filter({hasText:"Language fixture box"}).click();
    await page.getByRole("checkbox",{name:"Set a batch limit (optional)",exact:true}).check();
    await page.getByRole("spinbutton",{name:"Cards in this batch",exact:true}).fill("8");
    await page.getByRole("combobox",{name:"Batch language",exact:true}).selectOption("en");
    await expect(page.getByRole("combobox",{name:"Batch original opener",exact:true})).toHaveValue("");
    await page.getByRole("combobox",{name:"Batch original opener",exact:true}).selectOption(tag);
    await page.getByRole("button",{name:"Start batch",exact:true}).click();await expect(page).toHaveURL(/batch=/);
    batch=new URL(page.url()).searchParams.get("batch")!;const headers={origin:baseURL!},endpoint=`/api/acquisition/${batch}/review`;
    const state=await (await page.request.get(`/api/acquisition/${batch}`)).json();expect(state.defaults.language).toBe("en");expect(state.defaults.openerPlayerId).toBe(tag);
    const bytes=await sharp({create:{width:80,height:120,channels:3,background:"#335577"}}).jpeg().toBuffer(),photos:string[]=[];
    for(let index=0;index<8;index++){
      const reserved=await page.request.post(`/api/acquisition/${batch}`,{headers,data:{action:"reserve",requestKey:randomUUID()}});expect(reserved.ok()).toBe(true);
      const {slot}=await reserved.json();const upload=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`,
        {headers:{...headers,"content-type":"image/jpeg"},data:bytes});expect(upload.ok(),await upload.text()).toBe(true);photos.push((await upload.json()).id);
    }
    const originals=()=> (reviewSourceState(batch).photos as Record<string,unknown>[]).map(row=>Object.fromEntries(
      ["id","digest","actualDigest","bytes","width","height","inputKind","generation","slotId","sourceMetadata"].map(key=>[key,row[key]])));
    const source=originals();writeFileSync(test.info().outputPath("originals-before.json"),JSON.stringify(source));
    // Use actual built catalog and auto-confirm services with controlled saved
    // OCR/finite local catalog responses. No native model or provider network.
    function publish(position:number,kind:"unreadable"|"readable-fr"|"orientation"|"split-fr"|"word-fr"|"word-opposite"){
      return reviewDatabase(`require('tsx/cjs/api').register();const {createCatalogReconciliationHandler}=require('./lib/acquisition-catalog-reconciliation.ts');
        const {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings}=require('./lib/acquisition-recognition.ts');
        const {CATALOG_RECONCILIATION_STAGE,CATALOG_RESOLVER_VERSION}=require('./lib/acquisition-catalog-status.ts');const {completeAcquisitionJob}=require('./lib/acquisition-jobs.ts');
        const canonical=await p.acquisitionProcessingJob.findFirstOrThrow({where:{artifact:{sourceId:${JSON.stringify(photos[position])}},stage:'photo-canonical-v1'},include:{candidate:true}});
        if(canonical.status==='RUNNING')throw Error('Unexpected native worker');await p.acquisitionProcessingJob.update({where:{id:canonical.id},data:{status:'FAILED',errorCode:'CONTROLLED_LANGUAGE_FIXTURE'}});
        const cards=await p.card.findMany({where:{id:{in:${JSON.stringify([english,french])}}}}),kind=${JSON.stringify(kind)};
        const text={title:['Language fixture card'],footer:kind==='split-fr'?['C 1','LGT','FR']:['C 1',kind==='unreadable'?'LGT':'LGT '+(kind==='readable-fr'?'FR':'EN')]};
        const orientations=[{rotationDegrees:0,text,lines:[]},{rotationDegrees:180,text:kind==='orientation'?text:{title:[],footer:[]},lines:[]}];
        if(kind==='word-fr')text.footer=['C 1','LGT','FR Alice'];
        if(kind==='word-opposite'){text.footer=['C 1','LGT EN'];orientations[1].text.footer=['FR Alice'];}
        const native={version:1,descriptor:'a'.repeat(64),descriptorDetails:{},photoDigest:canonical.input.digest,text,orientations,geometry:{status:'ACCEPTED'},lines:[],milliseconds:1,automaticAcceptance:false};
        const common={runId:canonical.runId,artifactId:canonical.artifactId,candidateId:canonical.candidateId,candidateRevision:canonical.candidate.revision,input:canonical.input};
        const index=createAcquisitionRecognitionIndex(cards.map(({id,name,setCode,collectorNumber,lang,digital})=>({id,name,setCode,collectorNumber,lang,digital})));
        const raw=await p.acquisitionProcessingJob.create({data:{...common,stage:'photo-recognition-v1',versionKey:require('crypto').randomUUID(),status:'COMPLETE',output:{version:1,photoId:${JSON.stringify(photos[position])},native,versions:{catalog:'b'.repeat(64),model:'a'.repeat(64)},proposals:proposeOrientedAcquisitionPrintings(index,orientations)}}});
        const leaseToken=require('crypto').randomUUID(),job=await p.acquisitionProcessingJob.create({data:{...common,stage:CATALOG_RECONCILIATION_STAGE,versionKey:require('crypto').randomUUID(),status:'RUNNING',attempts:1,leaseToken,leaseExpiresAt:new Date(Date.now()+60000),input:{...common.input,recognitionJobId:raw.id,resolverVersion:CATALOG_RESOLVER_VERSION}}});
        const records=cards.map(c=>({object:'card',id:c.scryfallId,name:c.name,set:c.setCode,set_name:'Fixture',collector_number:c.collectorNumber,lang:c.lang,digital:false,finishes:['nonfoil'],type_line:'Artifact',rarity:'common',cmc:1,color_identity:[]}));
        const handler=createCatalogReconciliationHandler(p,async()=>({status:'FOUND',cards:records,requestsMade:0,printingCoverage:'CHECKED',cacheHit:true,lookupKey:'controlled-language'}));
        const output=await handler({...job,leaseToken},AbortSignal.timeout(30000));if(await completeAcquisitionJob(p,{...job,leaseToken},output)!=='COMPLETE')throw Error('Publication lost');return true;`);
    }
    const auto=()=>reviewDatabase<number>(`require('tsx/cjs/api').register();return require('./lib/acquisition-auto-confirm.ts').confirmStrongAcquisitionMatches(p);`);
    publish(0,"unreadable");publish(1,"readable-fr");publish(3,"orientation");publish(4,"orientation");publish(5,"split-fr");publish(6,"word-fr");publish(7,"word-opposite");const automatic=auto();
    const reviewed=async(position:number)=>(await (await page.request.get(`${endpoint}?photoId=${photos[position]}`)).json()).review;
    const initialReviews=await Promise.all(photos.map((_,position)=>reviewed(position)));
    writeFileSync(test.info().outputPath("initial-language-reviews.json"),JSON.stringify({automatic,reviews:initialReviews}));
    expect(initialReviews[5],"split readable FR cannot automatically save an English printing").toBe(null);expect(automatic).toBe(1);
    expect((await reviewed(0)).language).toBe("en");expect(await reviewed(1)).toBe(null);
    expect(await reviewed(5)).toBe(null);
    for(const position of [6,7])expect(await reviewed(position),"readable word-code conflict cannot automatically save the batch language").toBe(null);
    expect((await (await page.request.get(`/api/acquisition/${batch}`)).json()).slots[1].reviewProblems).toContain("conflict");
    expect((await (await page.request.get(`/api/acquisition/${batch}`)).json()).slots[5].reviewProblems).toContain("conflict");
    for(const position of [6,7])expect((await (await page.request.get(`/api/acquisition/${batch}`)).json()).slots[position].reviewProblems).toContain("conflict");
    await page.reload();await page.getByRole("button",{name:"Stop capture",exact:true}).click();
    await expect.poll(async()=>(await (await page.request.get(`/api/acquisition/${batch}`)).json()).phase).toMatch(/^(STOPPING|COMPLETE)$/);
    await page.getByRole("button",{name:"Advanced",exact:true}).click();
    const bulk=page.getByRole("region",{name:"Bulk match review",exact:true});await bulk.getByRole("button",{name:"Bulk Confirm Match",exact:true}).click();
    await expect(bulk.getByRole("checkbox",{name:/Card 2:/})).toBeDisabled();
    await expect(bulk.getByRole("checkbox",{name:/Card 6:/})).toBeDisabled();
    for(const cardNumber of [7,8])await expect(bulk.getByRole("checkbox",{name:new RegExp(`Card ${cardNumber}:`)})).toBeDisabled();
    await expect(bulk).toContainText("Readable language conflicts with the batch language");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await bulk.getByText("Readable language conflicts with the batch language. Inspect or correct this card individually.",{exact:true}).last()
      .screenshot({path:test.info().outputPath("split-language-explanation.png")});
    await bulk.getByRole("button",{name:"Back to card list",exact:true}).click();
    const card=page.getByTestId("capture-card-2");await expect(async()=>{await card.scrollIntoViewIfNeeded();await expect(card.getByRole("combobox",{name:"Card condition",exact:true})).toBeVisible({timeout:1000});}).toPass({timeout:15000});
    await expect(card).toContainText("Readable language conflicts");await card.getByRole("combobox",{name:"Card condition",exact:true}).selectOption("LP");await page.reload();
    await expect(async()=>{await card.scrollIntoViewIfNeeded();await expect(card.getByRole("combobox",{name:"Card condition",exact:true})).toHaveValue("LP",{timeout:1000});}).toPass({timeout:15000});
    await card.getByRole("combobox",{name:"Card condition",exact:true}).selectOption("NM");await card.getByRole("button",{name:"Save card review",exact:true}).click();
    await expect.poll(async()=>(await reviewed(1))?.language).toBe("fr");
    await bulk.getByRole("button",{name:"Bulk Confirm Match",exact:true}).click();await expect(bulk.getByRole("button",{name:"Confirm 2 selected matches",exact:true})).toBeEnabled();
    let attempts=0;const sent:string[]=[];const interrupt=async(route:Route)=>{const body=route.request().postDataJSON();
      if(body.action==='accept'&&body.photoId===photos[3]&&attempts<2){attempts++;sent.push(route.request().postData()!);if(attempts===1)expect((await route.fetch()).status()).toBe(200);await route.abort('failed');}else await route.continue();};
    await page.route('**/api/acquisition/*/review',interrupt);await bulk.getByRole('button',{name:'Confirm 2 selected matches',exact:true}).click();
    await expect(bulk).toContainText('A confirmation is uncertain');expect(sent).toHaveLength(2);expect(sent[0]).toBe(sent[1]);expect(JSON.parse(sent[0]).decision.language).toBe('en');expect(JSON.parse(sent[0]).decision.openerPlayerId).toBe(tag);
    const defaults=page.getByRole('region',{name:'Batch review defaults',exact:true});
    await defaults.getByRole('combobox',{name:'Batch original opener',exact:true}).selectOption('');
    await defaults.getByRole('button',{name:'Save batch defaults',exact:true}).click();
    await expect.poll(async()=>{const d=(await (await page.request.get(`/api/acquisition/${batch}`)).json()).defaults;return [d.language,d.openerPlayerId];}).toEqual(['en',null]);
    expect((await reviewed(0)).openerPlayerId).toBe(tag);
    await defaults.getByRole('combobox',{name:'Batch original opener',exact:true}).selectOption(tag);
    await defaults.getByRole('combobox',{name:'Batch language',exact:true}).selectOption('fr');
    await defaults.getByRole('button',{name:'Save batch defaults',exact:true}).click();
    await expect.poll(async()=>{const d=(await (await page.request.get(`/api/acquisition/${batch}`)).json()).defaults;return [d.language,d.openerPlayerId];}).toEqual(['fr',tag]);
    await page.unroute('**/api/acquisition/*/review',interrupt);await bulk.getByRole('button',{name:'Continue original confirmations',exact:true}).click();
    await expect.poll(async()=>Promise.all([3,4].map(async position=>(await reviewed(position))?.language))).toEqual(['en','en']);
    publish(2,'unreadable');const jobs=reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`);expect(auto()).toBe(1);
    expect((await reviewed(0)).language).toBe('en');expect((await reviewed(1)).language).toBe('fr');expect((await reviewed(2)).language).toBe('fr');
    for(const position of [0,1,2,3,4])expect((await reviewed(position)).openerPlayerId).toBe(tag);
    expect(await reviewed(5),"split readable language stays pending after defaults change").toBe(null);
    for(const position of [6,7])expect(await reviewed(position),"word-code uncertainty stays pending after defaults change").toBe(null);
    expect(reviewDatabase<number>(`return p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}});`)).toBe(0);
    await page.reload();for(let index=0;index<5;index++)await page.getByRole('checkbox',{name:`Select card ${index+1} for Inventory`,exact:true}).check();
    await page.getByRole('link',{name:'Add 5 confirmed cards to Inventory',exact:true}).click();
    const panel=page.getByRole('region',{name:'Add reviewed cards to Inventory',exact:true});await panel.getByRole('button',{name:'Preview selected cards',exact:true}).click();
    const confirm=panel.getByLabel('Confirm Inventory addition',{exact:true});await expect(confirm).toContainText('Add 5 copies');await confirm.locator('summary').click();
    await expect(confirm).toContainText('en');await expect(confirm).toContainText('fr');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await confirm.screenshot({path:test.info().outputPath('language-preview.png')});let commit:unknown;
    await page.route('**/api/acquisition/*/commit',async route=>{const body=route.request().postDataJSON();if(body.action==='commit')commit=body;await route.continue();});
    await confirm.getByRole('button',{name:'Add 5 copies to Inventory',exact:true}).click();await expect(panel).toContainText('Added 5 copies to Inventory.');expect(commit).toBeTruthy();
    const ledger=()=>reviewDatabase(`return {lots:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}},orderBy:{id:'asc'}}),audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:${JSON.stringify(tag)},changeType:'acquisition_committed'},orderBy:{id:'asc'}}),members:await p.acquisitionCommitMember.findMany({where:{candidate:{run:{sessionId:${JSON.stringify(batch)}}}},orderBy:{candidateId:'asc'}})};`);
    const saved=ledger() as {lots:{language:string;quantity:number;originalOpenerId:string|null}[];audits:unknown[];members:unknown[]};expect(saved.lots.map(row=>[row.language.toLowerCase(),row.quantity]).sort()).toEqual([['en',3],['fr',2]]);expect(saved.lots.every(row=>row.originalOpenerId===tag)).toBe(true);expect(saved.audits).toHaveLength(2);expect(saved.members).toHaveLength(5);
    const replay=await page.request.post(`/api/acquisition/${batch}/commit`,{headers,data:commit});expect(replay.ok()).toBe(true);expect((await replay.json()).replay).toBe(true);expect(ledger()).toEqual(saved);
    expect(originals()).toEqual(source);expect(reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`)).toEqual(jobs);
    writeFileSync(test.info().outputPath('ledger.json'),JSON.stringify(saved));writeFileSync(test.info().outputPath('jobs-before.json'),JSON.stringify(jobs));
  }catch(error){failed=true;primary=error;}
  const cleanup:unknown[]=[];try{cleanupReviewFixture(tag,english);}catch(error){cleanup.push(error);}
  try{reviewDatabase(`await p.card.deleteMany({where:{id:${JSON.stringify(french)}}});return true;`);}catch(error){cleanup.push(error);}
  try{const after=reviewFingerprint();writeFileSync(test.info().outputPath('after.json'),JSON.stringify(after));expect(after).toEqual(before);}catch(error){cleanup.push(error);}
  if(failed||cleanup.length)throw new AggregateError([...(failed?[primary]:[]),...cleanup],"Language browser qualification or cleanup failed",{cause:failed?primary:cleanup[0]});
});
