import {test,expect,chromium,type Browser,type BrowserContext,type Page} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {reviewDatabase,reviewFingerprint,reviewSourceState,cleanupReviewFixture} from "./review-acceptance-fixture";
import {requireBrowserLossOwnership,type BrowserLossIdentity} from "./acquisition-browser-loss-ownership";

test.skip(process.env.MTG_BROWSER_LOSS_TEST!=="1","Requires an isolated owned web/database/browser fixture");
const docker=(...args:string[])=>execFileSync("docker",args,{encoding:"utf8",windowsHide:true,timeout:30_000}).trim();
const inspect=(id:string)=>JSON.parse(docker("inspect",id))[0];
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(){
  let last:unknown;
  for(let attempt=0;attempt<30;attempt++)try{return await chromium.connectOverCDP("http://127.0.0.1:9222",{timeout:1000});}
  catch(error){last=error;await pause(200);}
  throw last;
}

for(const width of [1366,320])test(`committed addition survives an owned browser process loss at ${width}px`,async({baseURL,request})=>{
  test.setTimeout(180_000);
  expect(baseURL).toBe("http://127.0.0.1:3000");
  const at=(value:string)=>new URL(value,baseURL!).href;
  const web=process.env.MTG_INVENTORY_TEST_CONTAINER??"",run=process.env.MTG_BROWSER_LOSS_RUN??"",
    image=process.env.MTG_BROWSER_LOSS_IMAGE??"",nonce=process.env.MTG_BROWSER_LOSS_NONCE??"";
  if(!/^[a-f0-9]{64}$/.test(web)||!/^acquisition-browser-loss-310-[a-z0-9-]+$/.test(run)||
    !/^sha256:[a-f0-9]{64}$/.test(image)||!/^[a-f0-9]{32}$/.test(nonce))throw Error("Missing immutable fixture identities");
  const webBefore=inspect(web);
  if(webBefore.Config.Labels["mtg.run"]!==run||webBefore.Config.Labels["mtg.browser-loss.nonce"]!==nonce||
    webBefore.Config.Labels["mtg.fixture.role"]!=="browser-loss-web"||!webBefore.State.Running)
    throw Error("Expected owned web fixture");
  const before=reviewFingerprint();expect(Object.keys(before as object)).toHaveLength(85);
  writeFileSync(test.info().outputPath("before.json"),JSON.stringify(before));
  const tag="ui-review-acceptance-"+randomUUID(),card=tag+"-card",foreign=tag+"-foreign",
    token=randomBytes(32).toString("base64url"),foreignToken=randomBytes(32).toString("base64url");
  let identity:BrowserLossIdentity|undefined,browser:Browser|undefined,context:BrowserContext|undefined,page:Page|undefined;
  let primary:unknown,failed=false,batch="";const cleanup:unknown[]=[],lifecycle:unknown[]=[];
  const saveLifecycle=()=>writeFileSync(test.info().outputPath("browser-lifecycle.json"),JSON.stringify(lifecycle,null,2));
  const owned=(phase:"running"|"terminal")=>{if(!identity)throw Error("Browser not created");const value=inspect(identity.id);requireBrowserLossOwnership(value,identity,phase);return value;};
  const terminal=async()=>{await expect.poll(()=>inspect(identity!.id).State.Running,{timeout:15000}).toBe(false);return owned("terminal");};
  const start=async()=>{
    owned("terminal");docker("start",identity!.id);owned("running");browser=await connect();context=browser.contexts()[0];
    if(!context)throw Error("Persistent browser context missing");page=context.pages()[0]??await context.newPage();
    await page.setViewportSize({width,height:width===1366?768:844});page.setDefaultTimeout(15000);
    lifecycle.push({event:"started",state:owned("running").State});saveLifecycle();
  };
  const ledger=()=>reviewDatabase<{lots:{quantity:number}[];audits:unknown[];receipts:unknown[];members:unknown[]}>(
    `const n=${JSON.stringify(tag)},w={run:{sessionId:${JSON.stringify(batch)}}};return {lots:await p.inventoryItem.findMany({where:{currentOwnerId:n},orderBy:{id:'asc'}}),audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:n,changeType:'acquisition_committed'},orderBy:{id:'asc'}}),receipts:await p.acquisitionCommit.findMany({where:w,orderBy:{id:'asc'}}),members:await p.acquisitionCommitMember.findMany({where:{candidate:w},orderBy:{candidateId:'asc'}})};`);
  const originals=()=> (reviewSourceState(batch).photos as Record<string,unknown>[]).map(row=>Object.fromEntries(
    ["id","digest","actualDigest","bytes","width","height","inputKind","generation","slotId","sourceMetadata"].map(key=>[key,row[key]])));
  async function prepareAddition(position:number){
    await page!.getByTestId(`capture-card-${position}`).scrollIntoViewIfNeeded();
    await page!.getByRole("checkbox",{name:`Select card ${position} for Inventory`,exact:true}).check();
    await page!.getByRole("link",{name:"Go to Inventory confirmation",exact:true}).click();
    const panel=page!.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true});
    await panel.getByRole("button",{name:"Preview selected cards",exact:true}).click();
    const confirmation=panel.getByLabel("Confirm Inventory addition",{exact:true});
    await expect(confirmation).toContainText("Add 1 copy");await confirmation.locator("summary").click();
    expect(await page!.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await confirmation.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    return {panel,confirmation};
  }
  try{
    reviewDatabase(`const n=${JSON.stringify(tag)},other=${JSON.stringify(foreign)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{for(const [id,tokenHash] of [[n,${JSON.stringify(hash(token))}],[other,${JSON.stringify(hash(foreignToken))}]]){await tx.player.create({data:{id,name:id,displayName:id}});await tx.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash}});await tx.authSession.create({data:{tokenHash,userId:id,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+900000)}});}await tx.inventoryLocation.create({data:{id:n,name:'Browser recovery box',normalizedName:n,ownerPlayerId:n,type:'Box',visibility:'PRIVATE',storageLayout:{capacity:10,sections:[]}}});await tx.card.create({data:{id:${JSON.stringify(card)},scryfallId:require('crypto').randomUUID(),name:'Browser recovery fixture',setCode:'brl',collectorNumber:'1',lang:'en',finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});});return true;`);
    const id=docker("create","--label",`mtg.run=${run}`,"--label",`mtg.browser-loss.nonce=${nonce}`,"--label","mtg.fixture.role=browser-loss-browser",
      "--network",`container:${web}`,"--memory","768m","--memory-swap","768m","--cpus","1","--shm-size","256m",
      "-e","NODE_OPTIONS=--max-old-space-size=128","-e","MTG_BROWSER_LOSS_CHILD=1","--workdir","/runner","--entrypoint","node",image,"/runner/browser-loss-launcher.mjs");
    identity={id,web,image,run,nonce};owned("terminal");lifecycle.push({event:"created",identity});saveLifecycle();
    const launcher=path.join(path.dirname(test.info().file),"acquisition-browser-loss-browser.mjs");
    docker("cp",launcher,`${id}:/runner/browser-loss-launcher.mjs`);await start();
    expect(docker("exec",id,"sha256sum","/runner/browser-loss-launcher.mjs").split(/\s+/)[0]).toBe(hash(readFileSync(launcher)));
    await context!.addCookies([{name:"mtg_inventory_session",value:token,url:baseURL!,httpOnly:true,sameSite:"Lax",expires:Math.floor(Date.now()/1000)+900}]);
    // Checkpoint only the synthetic authentication profile before the declared
    // interruption. This is a graceful setup close, not the failure control.
    const session=await browser!.newBrowserCDPSession();await session.send("Browser.close").catch(()=>{});
    const checkpoint=await terminal();expect(checkpoint.State.ExitCode).toBe(0);lifecycle.push({event:"authentication-profile-checkpoint",state:checkpoint.State});saveLifecycle();
    await start();await page!.goto(at("/imports/scan?input=photos"));await expect(page!).not.toHaveURL(/\/login/);
    expect((await context!.cookies()).some(cookie=>cookie.name==="mtg_inventory_session"&&cookie.value===token)).toBe(true);
    const headers={origin:baseURL!},created=await page!.request.post(at("/api/acquisition"),{headers,data:{requestKey:randomUUID(),locationId:tag,section:"",quantity:3}});
    expect(created.ok(),await created.text()).toBe(true);batch=(await created.json()).id;
    const bytes=await sharp({create:{width:80,height:120,channels:3,background:"#335577"}}).jpeg().toBuffer(),photos:string[]=[];
    for(let index=0;index<3;index++){
      const reservation=await page!.request.post(at(`/api/acquisition/${batch}`),{headers,data:{action:"reserve",requestKey:randomUUID()}});expect(reservation.ok()).toBe(true);
      const {slot}=await reservation.json(),upload=await page!.request.post(at(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`),
        {headers:{...headers,"content-type":"image/jpeg"},data:bytes});expect(upload.ok(),await upload.text()).toBe(true);photos.push((await upload.json()).id);
    }
    reviewDatabase(`const w={run:{sessionId:${JSON.stringify(batch)}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Unexpected fixture worker');await p.acquisitionProcessingJob.updateMany({where:{...w,status:'PENDING'},data:{status:'FAILED',errorCode:'CONTROLLED_BROWSER_LOSS_FIXTURE'}});return true;`);
    for(let index=0;index<3;index++){
      const endpoint=at(`/api/acquisition/${batch}/review`),record=await (await page!.request.get(`${endpoint}?photoId=${photos[index]}`)).json();
      const reply=await page!.request.post(endpoint,{headers,data:{action:index===2?"pending":"accept",photoId:photos[index],revision:record.revision,
        ...(index===2?{}:{decision:{cardId:card,finish:"NONFOIL",condition:"NM",language:"en"},evidenceTokens:{current:record.evidenceToken}})}});
      expect(reply.ok(),await reply.text()).toBe(true);
    }
    const initial=await (await page!.request.get(at(`/api/acquisition/${batch}`))).json();
    expect((await page!.request.post(at(`/api/acquisition/${batch}`),{headers,data:{action:"control",requestKey:randomUUID(),revision:initial.revision,command:"STOP"}})).ok()).toBe(true);
    const source=originals(),reviews=reviewSourceState(batch).candidates.map(row=>row.review),jobs=reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`);
    const url=at(`/imports/scan?input=photos&batch=${batch}`);await page!.goto(url);
    const first=await prepareAddition(1);await first.confirmation.screenshot({path:test.info().outputPath("before-interruption.png")});
    let resolveHeld!:(value:{body:string;receipt:unknown})=>void,rejectHeld!:(error:unknown)=>void;
    const held=new Promise<{body:string;receipt:unknown}>((resolve,reject)=>{resolveHeld=resolve;rejectHeld=reject;});
    await context!.route("**/api/acquisition/*/commit",async route=>{
      if(route.request().postDataJSON().action!=="commit")return route.continue();
      try{const response=await route.fetch();expect(response.status()).toBe(200);resolveHeld({body:route.request().postData()!,receipt:await response.json()});}
      catch(error){rejectHeld(error);}
      // Deliberately neither fulfill nor abort: the real server completed but
      // the browser has not received an acknowledgement when it is killed.
    });
    const click=first.confirmation.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click().catch(()=>{});
    let timer:ReturnType<typeof setTimeout>|undefined;
    const completed=await Promise.race([held,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Held commit deadline exceeded")),20000);})]).finally(()=>clearTimeout(timer));
    await click;const committed=ledger();expect(committed.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(1);
    expect(committed.receipts).toHaveLength(1);expect(committed.members).toHaveLength(1);expect(committed.audits).toHaveLength(1);
    const live=owned("running");lifecycle.push({event:"before-declared-SIGKILL",state:live.State});saveLifecycle();
    docker("kill","--signal","KILL",id);const killed=await terminal();expect(killed.State.ExitCode).toBe(137);
    lifecycle.push({event:"declared-SIGKILL-terminal",state:killed.State});saveLifecycle();
    await start();expect(Date.parse(owned("running").State.StartedAt)).toBeGreaterThan(Date.parse(live.State.StartedAt));
    await page!.goto(url);await expect(page!).not.toHaveURL(/\/login/);
    const state=await (await page!.request.get(at(`/api/acquisition/${batch}`))).json();
    expect(state.slots.filter((slot:any)=>slot.committed)).toHaveLength(1);expect(state.slots.filter((slot:any)=>!slot.committed)).toHaveLength(2);
    expect(state.slots[2].review).toBe(null);expect(ledger()).toEqual(committed);
    await page!.getByTestId("capture-card-1").scrollIntoViewIfNeeded();
    await expect(page!.getByTestId("capture-card-1")).toContainText("Added to Inventory");
    const ownerImage=await page!.request.get(at(`/api/acquisition/${batch}/photos/${photos[0]}`));expect(ownerImage.status()).toBe(200);expect(hash(await ownerImage.body())).toBe(hash(bytes));
    const denied=await request.get(at(`/api/acquisition/${batch}/photos/${photos[0]}`),{headers:{cookie:`mtg_inventory_session=${foreignToken}`}});expect(denied.status()).toBe(403);
    const replay=await page!.request.post(at(`/api/acquisition/${batch}/commit`),{headers:{...headers,"content-type":"application/json"},data:completed.body});
    expect(replay.ok(),await replay.text()).toBe(true);expect((await replay.json()).replay).toBe(true);expect(ledger()).toEqual(committed);
    await page!.screenshot({path:test.info().outputPath("reopened-browser.png")});
    const second=await prepareAddition(2);await second.confirmation.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();await expect(second.panel).toContainText("Added 1 copy to Inventory.");
    const final=ledger();expect(final.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(2);expect(final.receipts).toHaveLength(2);expect(final.members).toHaveLength(2);expect(final.audits).toHaveLength(2);
    expect(originals()).toEqual(source);expect(reviewSourceState(batch).candidates.map(row=>row.review)).toEqual(reviews);
    expect(reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`)).toEqual(jobs);
    const last=await (await page!.request.get(at(`/api/acquisition/${batch}`))).json();expect(last.slots[2].committed).toBe(false);expect(last.slots[2].review).toBe(null);
    const webAfter=inspect(web);expect(webAfter.Id).toBe(webBefore.Id);expect(webAfter.Image).toBe(webBefore.Image);expect(webAfter.State.StartedAt).toBe(webBefore.State.StartedAt);
    writeFileSync(test.info().outputPath("result.json"),JSON.stringify({width,batch,originals:source,firstReceipt:completed.receipt,committed,final,observedTerminalExit:137,replay:true,pending:1,webUnchanged:true}));
  }catch(error){failed=true;primary=error;}
  let browserTerminal=!identity;
  if(identity)try{
    const info=inspect(identity.id);requireBrowserLossOwnership(info,identity,info.State.Running?"running":"terminal");
    if(info.State.Running)docker("stop","--time","10",identity.id);
    const stopped=await terminal();browserTerminal=true;lifecycle.push({event:"cleanup-terminal",state:stopped.State});saveLifecycle();
    let failureEvidenceSaved=!failed;
    if(failed)try{docker("cp",`${identity.id}:/profile`,test.info().outputPath("failed-profile"));failureEvidenceSaved=true;}catch(error){cleanup.push(error);}
    writeFileSync(test.info().outputPath("browser.log"),docker("logs",identity.id));
    if(failureEvidenceSaved)docker("rm",identity.id);
    else lifecycle.push({event:"terminal-browser-retained-for-failure-evidence",id:identity.id});
    saveLifecycle();
  }catch(error){cleanup.push(error);}
  if(browserTerminal){
    try{cleanupReviewFixture(tag,card);}catch(error){cleanup.push(error);}
    try{reviewDatabase(`const id=${JSON.stringify(foreign)};await p.authSession.deleteMany({where:{userId:id}});await p.user.deleteMany({where:{id}});await p.player.deleteMany({where:{id}});return true;`);}catch(error){cleanup.push(error);}
  }else cleanup.push(Error("Uncertain browser terminal state preserves fixture recovery records"));
  try{const after=reviewFingerprint();writeFileSync(test.info().outputPath("after.json"),JSON.stringify(after));expect(after).toEqual(before);}catch(error){cleanup.push(error);}
  if(failed||cleanup.length)throw new AggregateError([...(failed?[primary]:[]),...cleanup],"Browser-loss qualification or cleanup failed",{cause:failed?primary:cleanup[0]});
});
