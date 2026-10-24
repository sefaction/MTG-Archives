import {test,expect,type Route} from "@playwright/test";
import {execFileSync,spawn,spawnSync} from "node:child_process";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {writeFileSync} from "node:fs";
import sharp from "sharp";
import {reviewDatabase,reviewFingerprint,reviewSourceState,cleanupReviewFixture} from "./review-acceptance-fixture";
import {requireDatabaseLossOwnership,type DatabaseLossIdentity} from "./acquisition-database-loss-ownership";

test.skip(process.env.MTG_DATABASE_LOSS_TEST!=="1","Requires a newly owned disposable PostgreSQL/web fixture");
const docker=(...args:string[])=>execFileSync("docker",args,{encoding:"utf8",windowsHide:true,timeout:30000}).trim();
const inspect=(id:string)=>JSON.parse(docker("inspect",id))[0];
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
async function deadline<T>(promise:Promise<T>,milliseconds:number,label:string){
  let timer:ReturnType<typeof setTimeout>|undefined;
  return Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),milliseconds);})])
    .finally(()=>clearTimeout(timer));
}

for(const width of [1366,320])test(`Inventory rollback and durability across owned database loss at ${width}px`,async({page,baseURL,request})=>{
  test.setTimeout(180000);expect(baseURL).toBe("http://127.0.0.1:3000");
  await page.setViewportSize({width,height:width===1366?768:844});page.setDefaultTimeout(15000);
  const web=process.env.MTG_INVENTORY_TEST_CONTAINER??"";
  const identity:DatabaseLossIdentity={id:process.env.MTG_DATABASE_LOSS_POSTGRES??"",
    image:process.env.MTG_DATABASE_LOSS_IMAGE??"",run:process.env.MTG_DATABASE_LOSS_RUN??"",
    nonce:process.env.MTG_DATABASE_LOSS_NONCE??"",network:process.env.MTG_DATABASE_LOSS_NETWORK??"",
    volume:process.env.MTG_DATABASE_LOSS_VOLUME??"",database:process.env.MTG_INVENTORY_TEST_DATABASE??""};
  const owned=(phase:"running"|"terminal")=>requireDatabaseLossOwnership(inspect(identity.id),identity,phase);
  owned("running");
  if(!/^[a-f0-9]{64}$/.test(web))throw Error("Immutable web target required");
  const webBefore=inspect(web);
  if(webBefore.Config.Labels["mtg.run"]!==identity.run||webBefore.Config.Labels["mtg.database-loss.nonce"]!==identity.nonce||
    webBefore.Config.Labels["mtg.fixture.role"]!=="database-loss-web"||!webBefore.State.Running||webBefore.Mounts.length)
    throw Error("Expected isolated owned web");
  const sql=(value:string)=>{owned("running");return docker("exec",identity.id,"psql","-U","review","-d",identity.database,"-Atq","-v","ON_ERROR_STOP=1","-c",value);};
  const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
  const settings=JSON.parse(sql("SELECT json_build_object('fsync',current_setting('fsync'),'full_page_writes',current_setting('full_page_writes'),'synchronous_commit',current_setting('synchronous_commit'))"));
  expect(settings).toEqual({fsync:"on",full_page_writes:"on",synchronous_commit:"on"});
  const before=reviewFingerprint();expect(Object.keys(before as object)).toHaveLength(85);
  writeFileSync(test.info().outputPath("before.json"),JSON.stringify(before));
  const tag="ui-review-acceptance-"+randomUUID(),card=tag+"-card",foreign=tag+"-foreign";
  const token=randomBytes(32).toString("base64url"),foreignToken=randomBytes(32).toString("base64url"),headers={origin:baseURL!};
  const lifecycle:unknown[]=[],sent:string[]=[],cleanup:unknown[]=[];
  let batch="",failed=false,primary:unknown,heldRoute:Route|undefined,holdReply=false;
  let blockerDone:Promise<{code:number|null;signal:string|null;error?:string}>|undefined,blockerClosed=true;
  let blockerPid=0,blockerOutput="";
  const saveLife=()=>writeFileSync(test.info().outputPath("database-lifecycle.json"),JSON.stringify(lifecycle,null,2));
  const ledger=()=>reviewDatabase<{lots:{quantity:number}[];audits:unknown[];receipts:unknown[];members:unknown[]}>(
    `const n=${JSON.stringify(tag)},w={run:{sessionId:${JSON.stringify(batch)}}};return {lots:await p.inventoryItem.findMany({where:{currentOwnerId:n},orderBy:{id:'asc'}}),audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:n,changeType:'acquisition_committed'},orderBy:{id:'asc'}}),receipts:await p.acquisitionCommit.findMany({where:w,orderBy:{id:'asc'}}),members:await p.acquisitionCommitMember.findMany({where:{candidate:w},orderBy:{candidateId:'asc'}})};`);
  const originals=()=> (reviewSourceState(batch).photos as Record<string,unknown>[]).map(row=>Object.fromEntries(
    ["id","digest","actualDigest","bytes","width","height","inputKind","generation","slotId","sourceMetadata"].map(key=>[key,row[key]])));
  const dropBarrier=()=>sql('DROP TRIGGER IF EXISTS "DatabaseLossBarrier" ON "AcquisitionCommitMember"; DROP FUNCTION IF EXISTS "DatabaseLossBarrier"();');
  function resourcesOwned(){
    const network=JSON.parse(docker("network","inspect",identity.network))[0];
    const volume=JSON.parse(docker("volume","inspect",identity.volume))[0];
    const users=docker("ps","-aq","--no-trunc","--filter",`volume=${identity.volume}`).split(/\s+/).filter(Boolean);
    if(network.Id!==identity.network||network.Internal!==true||network.Labels?.["mtg.run"]!==identity.run||
      network.Labels?.["mtg.database-loss.nonce"]!==identity.nonce||
      Object.keys(network.Containers??{}).some(id=>![identity.id,web].includes(id))||
      volume.Name!==identity.volume||volume.Labels?.["mtg.run"]!==identity.run||
      volume.Labels?.["mtg.database-loss.nonce"]!==identity.nonce||users.length!==1||users[0]!==identity.id)
      throw Error("Private network/volume ownership or references changed; preserve without interruption");
  }
  async function crashAndRecover(phase:string){
    const live=owned("running"),since=new Date().toISOString();resourcesOwned();
    lifecycle.push({event:phase+"-before-SIGKILL",state:live.State});saveLife();
    docker("kill","--signal","KILL",identity.id);
    await expect.poll(()=>inspect(identity.id).State.Running).toBe(false);
    const killed=owned("terminal");expect(killed.State.ExitCode).toBe(137);
    lifecycle.push({event:phase+"-terminal137",state:killed.State});saveLife();
    if(phase==="uncommitted"){
      const stopped=await deadline(blockerDone!,10000,"Owned SQL blocker did not terminate with its database");
      expect(blockerClosed).toBe(true);expect(stopped.error).toBeUndefined();expect(stopped.code).not.toBe(0);
      writeFileSync(test.info().outputPath("blocker-terminal.json"),JSON.stringify({...stopped,output:blockerOutput}));
    }
    owned("terminal");resourcesOwned();docker("start",identity.id);
    expect(Date.parse(owned("running").State.StartedAt)).toBeGreaterThan(Date.parse(live.State.StartedAt));
    await expect.poll(()=>{try{return sql("SELECT 1");}catch{return "not ready";}},{timeout:15000}).toBe("1");
    const logged=spawnSync("docker",["logs","--since",since,identity.id],{encoding:"utf8",windowsHide:true,timeout:30000});
    if(logged.status!==0||logged.error)throw Error("PostgreSQL recovery log unavailable");
    const log=logged.stdout+logged.stderr;
    writeFileSync(test.info().outputPath(phase+"-postgres.log"),log);
    expect(log).toContain("automatic recovery in progress");
    expect(JSON.parse(sql("SELECT json_build_object('fsync',current_setting('fsync'),'full_page_writes',current_setting('full_page_writes'),'synchronous_commit',current_setting('synchronous_commit'))"))).toEqual(settings);
    lifecycle.push({event:phase+"-recovered",state:owned("running").State});saveLife();
  }
  const panel=page.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true});
  async function preview(position:number){
    await page.getByTestId(`capture-card-${position}`).scrollIntoViewIfNeeded();
    await page.getByRole("checkbox",{name:`Select card ${position} for Inventory`,exact:true}).check();
    await page.getByRole("link",{name:"Go to Inventory confirmation",exact:true}).click();
    await panel.getByRole("button",{name:"Preview selected cards",exact:true}).click();
    const confirmation=panel.getByLabel("Confirm Inventory addition",{exact:true});
    await expect(confirmation).toContainText("Add 1 copy");await confirmation.locator("summary").click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await confirmation.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    return confirmation;
  }
  let heldResolve!:(value:{body:string;receipt:unknown})=>void,heldReject!:(error:unknown)=>void;
  const held=new Promise<{body:string;receipt:unknown}>((resolve,reject)=>{heldResolve=resolve;heldReject=reject;});
  // Handlers for this declared branch are observed immediately; suppress only
  // an unused promise rejection when an earlier setup assertion already failed.
  void held.catch(()=>{});
  try{
    reviewDatabase(`const n=${JSON.stringify(tag)},other=${JSON.stringify(foreign)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{for(const [id,tokenHash] of [[n,${JSON.stringify(hash(token))}],[other,${JSON.stringify(hash(foreignToken))}]]){await tx.player.create({data:{id,name:id,displayName:id}});await tx.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash}});await tx.authSession.create({data:{tokenHash,userId:id,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+900000)}});}await tx.inventoryLocation.create({data:{id:n,name:'Database recovery box',normalizedName:n,ownerPlayerId:n,type:'Box',visibility:'PRIVATE',storageLayout:{capacity:10,sections:[]}}});await tx.card.create({data:{id:${JSON.stringify(card)},scryfallId:require('crypto').randomUUID(),name:'Database recovery fixture',setCode:'dbl',collectorNumber:'1',lang:'en',finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});});return true;`);
    await page.context().addCookies([{name:"mtg_inventory_session",value:token,url:baseURL!,httpOnly:true,sameSite:"Lax"}]);
    const created=await page.request.post("/api/acquisition",{headers,data:{requestKey:randomUUID(),locationId:tag,section:"",quantity:4}});
    expect(created.ok(),await created.text()).toBe(true);batch=(await created.json()).id;
    const bytes=await sharp({create:{width:80,height:120,channels:3,background:"#335577"}}).jpeg().toBuffer(),photos:string[]=[];
    for(let index=0;index<4;index++){
      const reservation=await page.request.post(`/api/acquisition/${batch}`,{headers,data:{action:"reserve",requestKey:randomUUID()}});expect(reservation.ok()).toBe(true);
      const {slot}=await reservation.json(),upload=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`,
        {headers:{...headers,"content-type":"image/jpeg"},data:bytes});expect(upload.ok(),await upload.text()).toBe(true);photos.push((await upload.json()).id);
    }
    reviewDatabase(`const w={run:{sessionId:${JSON.stringify(batch)}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Unexpected fixture worker');await p.acquisitionProcessingJob.updateMany({where:{...w,status:'PENDING'},data:{status:'FAILED',errorCode:'CONTROLLED_DATABASE_LOSS_FIXTURE'}});return true;`);
    for(let index=0;index<4;index++){
      const endpoint=`/api/acquisition/${batch}/review`,record=await (await page.request.get(`${endpoint}?photoId=${photos[index]}`)).json();
      const result=await page.request.post(endpoint,{headers,data:{action:index===3?"pending":"accept",photoId:photos[index],revision:record.revision,
        ...(index===3?{}:{decision:{cardId:card,finish:"NONFOIL",condition:"NM",language:"en"},evidenceTokens:{current:record.evidenceToken}})}});
      expect(result.ok(),await result.text()).toBe(true);
    }
    const initial=await (await page.request.get(`/api/acquisition/${batch}`)).json();
    expect((await page.request.post(`/api/acquisition/${batch}`,{headers,data:{action:"control",requestKey:randomUUID(),revision:initial.revision,command:"STOP"}})).ok()).toBe(true);
    const source=originals(),reviews=reviewSourceState(batch).candidates.map(row=>row.review),jobs=reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`);
    const runId=reviewDatabase<string>(`return (await p.acquisitionRun.findFirstOrThrow({where:{sessionId:${JSON.stringify(batch)}}})).id;`);
    sql(`CREATE FUNCTION "DatabaseLossBarrier"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."runId"=${quote(runId)} THEN
      IF (SELECT quantity FROM "InventoryItem" WHERE id=NEW."inventoryItemId")<>1 OR
         (SELECT count(*) FROM "InventoryAuditLog" WHERE "changedByUserId"=${quote(tag)} AND "changeType"='acquisition_committed')<>1 OR
         (SELECT count(*) FROM "AcquisitionCommit" WHERE "runId"=NEW."runId")<>1 OR
         (SELECT count(*) FROM "AcquisitionCommitMember" WHERE "runId"=NEW."runId")<>1 THEN RAISE EXCEPTION 'Staged write precondition failed'; END IF;
      PERFORM pg_advisory_xact_lock(731,24); END IF; RETURN NEW; END $$;
      CREATE TRIGGER "DatabaseLossBarrier" AFTER INSERT ON "AcquisitionCommitMember" FOR EACH ROW EXECUTE FUNCTION "DatabaseLossBarrier"();`);
    await page.route("**/api/acquisition/*/commit",async route=>{
      if(route.request().postDataJSON().action!=="commit")return route.continue();
      const body=route.request().postData()!;sent.push(body);
      if(!holdReply)return route.continue();holdReply=false;
      try{const response=await route.fetch();expect(response.status()).toBe(200);heldRoute=route;heldResolve({body,receipt:await response.json()});}
      catch(error){heldReject(error);}
    });
    const url=`/imports/scan?input=photos&batch=${batch}`;await page.goto(url);
    const first=await preview(1);await first.screenshot({path:test.info().outputPath("before-uncommitted-crash.png")});
    const appName="database-loss-barrier-"+identity.nonce.slice(0,12);
    owned("running");const child=spawn("docker",["exec","-e",`PGAPPNAME=${appName}`,identity.id,"psql","-U","review","-d",identity.database,"-v","ON_ERROR_STOP=1","-c","SELECT pg_advisory_lock(731,24); SELECT pg_sleep(30);"],{windowsHide:true});
    blockerClosed=false;blockerDone=new Promise(resolve=>{child.once("error",error=>{blockerClosed=true;resolve({code:null,signal:null,error:error.message});});child.once("close",(code,signal)=>{blockerClosed=true;resolve({code,signal});});});
    child.stdin.end();for(const stream of [child.stdout,child.stderr])stream.on("data",value=>{blockerOutput=(blockerOutput+value.toString()).slice(-8192);});
    await expect.poll(()=>{const rows=JSON.parse(sql(`SELECT coalesce(json_agg(a.pid),'[]') FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=${quote(appName)} AND l.locktype='advisory' AND l.classid=731 AND l.objid=24 AND l.granted`));return rows.length===1?rows[0]:0;}).toBeGreaterThan(0);
    blockerPid=Number(sql(`SELECT pid FROM pg_stat_activity WHERE application_name=${quote(appName)}`));
    const firstResponse=page.waitForResponse(response=>response.url().endsWith(`/api/acquisition/${batch}/commit`)&&response.request().postDataJSON().action==="commit");
    void firstResponse.catch(()=>{});await first.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();
    let staged:unknown;
    await expect.poll(()=>{const rows=JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('pid',pid,'backendStart',backend_start,'transactionStart',xact_start,'xid',backend_xid,'query',query)),'[]') FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%AcquisitionCommitMember%'`));staged=rows;return rows.length;},{timeout:10000}).toBe(1);
    writeFileSync(test.info().outputPath("staged-barrier.json"),JSON.stringify({blockerPid,staged,stage:"AFTER member INSERT with in-transaction stock/audit/receipt/member preconditions"}));
    await crashAndRecover("uncommitted");const failedReply=await deadline(firstResponse,15000,"Interrupted commit response missing");
    expect(failedReply.ok()).toBe(false);const failureBody=await failedReply.text();
    expect(failureBody).not.toMatch(/postgresql:\/\/|PrismaClient|isolated-local-fixture|INSERT INTO/);
    dropBarrier();const rolledBack=ledger();expect(rolledBack).toEqual({lots:[],audits:[],receipts:[],members:[]});
    expect(originals()).toEqual(source);expect(reviewSourceState(batch).candidates.map(row=>row.review)).toEqual(reviews);
    await page.goto(url);
    const recoveryScreen=page.getByRole("heading",{name:"This page couldn’t load",exact:true});
    await expect(page.getByTestId("capture-card-1").or(recoveryScreen)).toBeVisible();
    let recoveryReloads=0;
    if(await recoveryScreen.count()){
      await expect(recoveryScreen).toBeVisible();
      await expect(page.locator("body")).not.toContainText("PrismaClient");
      await expect(page.locator("body")).not.toContainText("postgresql://");
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:test.info().outputPath("page-recovery-control.png")});
      await page.getByRole("button",{name:"Reload page",exact:true}).click();recoveryReloads++;
    }
    const recovery=await preview(1);await recovery.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();
    await expect(panel).toContainText("Added 1 copy to Inventory.");const firstCommitted=ledger();
    expect(firstCommitted.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(1);expect(firstCommitted.receipts).toHaveLength(1);expect(firstCommitted.members).toHaveLength(1);expect(firstCommitted.audits).toHaveLength(1);
    const firstBody=sent.at(-1)!;const replay=await page.request.post(`/api/acquisition/${batch}/commit`,{headers:{...headers,"content-type":"application/json"},data:firstBody});
    expect(replay.ok()).toBe(true);expect((await replay.json()).replay).toBe(true);expect(ledger()).toEqual(firstCommitted);
    const second=await preview(2);holdReply=true;await second.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();
    const completed=await deadline(held,20000,"Successful second commit was not held");const durable=ledger();
    expect(durable.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(2);expect(durable.receipts).toHaveLength(2);expect(durable.members).toHaveLength(2);expect(durable.audits).toHaveLength(2);
    await crashAndRecover("committed");expect(ledger()).toEqual(durable);
    await heldRoute!.abort("failed");heldRoute=undefined;
    await expect(panel.getByRole("button",{name:"Retry Inventory addition",exact:true})).toBeEnabled();
    await panel.screenshot({path:test.info().outputPath("durable-recovery-retry.png")});
    await panel.getByRole("button",{name:"Retry Inventory addition",exact:true}).click();
    await expect(panel).toContainText("Added 1 copy to Inventory.");expect(sent.at(-1)).toBe(completed.body);expect(ledger()).toEqual(durable);
    expect(recoveryReloads).toBeGreaterThan(0);
    const third=await preview(3);await third.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();await expect(panel).toContainText("Added 1 copy to Inventory.");
    const final=ledger();expect(final.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(3);expect(final.receipts).toHaveLength(3);expect(final.members).toHaveLength(3);expect(final.audits).toHaveLength(3);
    expect(originals()).toEqual(source);expect(reviewSourceState(batch).candidates.map(row=>row.review)).toEqual(reviews);
    expect(reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`)).toEqual(jobs);
    const last=await (await page.request.get(`/api/acquisition/${batch}`)).json();expect(last.slots.filter((row:any)=>row.committed)).toHaveLength(3);expect(last.slots[3].review).toBe(null);expect(last.slots[3].committed).toBe(false);
    const original=await page.request.get(`/api/acquisition/${batch}/photos/${photos[0]}`);expect(original.status()).toBe(200);expect(hash(await original.body())).toBe(hash(bytes));
    const denied=await request.get(`/api/acquisition/${batch}/photos/${photos[0]}`,{headers:{cookie:`mtg_inventory_session=${foreignToken}`}});expect(denied.status()).toBe(403);
    const webAfter=inspect(web);expect(webAfter.Id).toBe(webBefore.Id);expect(webAfter.Image).toBe(webBefore.Image);expect(webAfter.State.StartedAt).toBe(webBefore.State.StartedAt);
    writeFileSync(test.info().outputPath("result.json"),JSON.stringify({width,settings,rolledBack,firstCommitted,durable,final,replay:true,pending:1,webUnchanged:true,crashes:2,recoveryReloads}));
  }catch(error){failed=true;primary=error;}
  if(heldRoute)try{await heldRoute.abort("failed");}catch(error){cleanup.push(error);}
  if(failed)try{await page.screenshot({path:test.info().outputPath("failed-state.png")});}catch(error){cleanup.push(error);}
  try{await page.close();}catch(error){cleanup.push(error);}
  if(!blockerClosed&&blockerDone)try{await deadline(blockerDone,35000,"Owned blocker remains live; preserve recovery graph");}catch(error){cleanup.push(error);}
  let safe=blockerClosed;
  try{owned("running");expect(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND xact_start IS NOT NULL")).toBe("0");}catch(error){safe=false;cleanup.push(error);}
  if(safe){
    try{dropBarrier();expect(sql("SELECT count(*) FROM pg_trigger WHERE tgname='DatabaseLossBarrier'")).toBe("0");}catch(error){safe=false;cleanup.push(error);}
  }
  if(safe){
    try{cleanupReviewFixture(tag,card);}catch(error){cleanup.push(error);}
    try{reviewDatabase(`const id=${JSON.stringify(foreign)};await p.authSession.deleteMany({where:{userId:id}});await p.user.deleteMany({where:{id}});await p.player.deleteMany({where:{id}});return true;`);}catch(error){cleanup.push(error);}
    try{const after=reviewFingerprint();writeFileSync(test.info().outputPath("after.json"),JSON.stringify(after));expect(after).toEqual(before);}catch(error){cleanup.push(error);}
  }else cleanup.push(Error("Uncertain database/request/helper state preserves fixture recovery records"));
  if(failed||cleanup.length)throw new AggregateError([...(failed?[primary]:[]),...cleanup],"Database-loss qualification or cleanup failed",{cause:failed?primary:cleanup[0]});
});
