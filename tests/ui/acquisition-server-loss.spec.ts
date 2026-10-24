import {test,expect,type Route} from "@playwright/test";
import {execFileSync,spawn} from "node:child_process";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import sharp from "sharp";
import {reviewDatabase,reviewFingerprint,reviewSourceState,cleanupReviewFixture} from "./review-acceptance-fixture";
import {requireServerLossOwnership,observeServerLossPageClosure,withServerLossCleanup,SERVER_LOSS_UPLOADS_ROOT,type ServerLossIdentity} from "./acquisition-server-loss-ownership";

test.skip(process.env.MTG_SERVER_LOSS_TEST!=="1","Requires a newly owned disposable server-restart fixture");
const docker=(...args:string[])=>execFileSync("docker",args,{encoding:"utf8",windowsHide:true,timeout:30000}).trim();
const inspect=(id:string)=>JSON.parse(docker("inspect",id))[0];
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
async function deadline<T>(promise:Promise<T>,milliseconds:number,label:string){
  let timer:ReturnType<typeof setTimeout>|undefined;
  return Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),milliseconds);})])
    .finally(()=>clearTimeout(timer));
}

for(const width of [1366,320])test(`Inventory rollback and durability across owned web-server loss at ${width}px`,async({page,baseURL,request})=>{
  test.setTimeout(180000);expect(baseURL).toBe("http://127.0.0.1:3000");
  await page.setViewportSize({width,height:width===1366?768:844});page.setDefaultTimeout(15000);
  if(process.env.DOCKER_HOST)throw Error("Only the explicitly mounted local Docker socket is supported");
  const web=process.env.MTG_SERVER_LOSS_WEB??"",client=process.env.MTG_INVENTORY_TEST_CONTAINER??"";
  const postgres=process.env.MTG_SERVER_LOSS_POSTGRES??"",postgresImage=process.env.MTG_SERVER_LOSS_POSTGRES_IMAGE??"";
  const network=process.env.MTG_SERVER_LOSS_NETWORK??"",dataVolume=process.env.MTG_SERVER_LOSS_DATA_VOLUME??"";
  const anchor=process.env.MTG_SERVER_LOSS_ANCHOR??"",browserImage=process.env.MTG_SERVER_LOSS_BROWSER_IMAGE??"";
  const identity:ServerLossIdentity={id:web,image:process.env.MTG_SERVER_LOSS_WEB_IMAGE??"",
    run:process.env.MTG_SERVER_LOSS_RUN??"",nonce:process.env.MTG_SERVER_LOSS_NONCE??"",
    anchor,uploads:process.env.MTG_SERVER_LOSS_UPLOAD_VOLUME??"",database:process.env.MTG_INVENTORY_TEST_DATABASE??""};
  const owned=(phase:"running"|"terminal")=>requireServerLossOwnership(inspect(web),identity,phase);
  const webBefore=owned("running");
  // container: networking inherits the anchor hostname; it is not this controller's ID.
  const manifest=JSON.parse(readFileSync("/proof/current.json","utf8"));
  if(manifest.runId!==identity.run||manifest.nonce!==identity.nonce||manifest.resources?.web!==web)
    throw Error("Controller manifest does not match this exact run");
  const controller=manifest.resources.controller as string;
  for(const id of [client,postgres,anchor,controller,network])if(!/^[a-f0-9]{64}$/.test(id))throw Error("Full immutable fixture identities required");
  if(new Set([web,client,postgres,anchor,controller]).size!==5||!/^sha256:[a-f0-9]{64}$/.test(postgresImage)||
    !/^sha256:[a-f0-9]{64}$/.test(browserImage)||dataVolume!=="mtg-server-loss-data-"+identity.nonce.slice(0,12))throw Error("Distinct private fixture roles required");
  function peer(id:string,role:string,image:string,mode:string){
    const value=inspect(id);
    if(value.Id!==id||value.Image!==image||value.Config.Labels?.["mtg.run"]!==identity.run||
      value.Config.Labels?.["mtg.server-loss.nonce"]!==identity.nonce||value.Config.Labels?.["mtg.fixture.role"]!==role||
      value.State.Running!==true||value.State.Paused!==false||value.State.Restarting!==false||value.State.Dead!==false||value.State.OOMKilled!==false||
      value.HostConfig.Privileged!==false||Object.keys(value.HostConfig.PortBindings??{}).length||value.HostConfig.NetworkMode!==mode)
      throw Error("Independent fixture role/state/namespace differs");
    return value;
  }
  function pgOwned(){
    const value=peer(postgres,"server-loss-postgres",postgresImage,network);
    if(value.Mounts.length!==1||value.Mounts[0].Type!=="volume"||value.Mounts[0].Name!==dataVolume||
      value.Mounts[0].Destination!=="/var/lib/postgresql/data"||value.Mounts[0].RW!==true||
      !value.Config.Env.includes("POSTGRES_DB="+identity.database))throw Error("Unexpected isolated PostgreSQL data");
    return value;
  }
  const pgBefore=pgOwned();
  const sql=(value:string)=>{pgOwned();return docker("exec",postgres,"psql","-U","review","-d",identity.database,"-Atq","-v","ON_ERROR_STOP=1","-c",value);};
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
  const saveLife=()=>writeFileSync(test.info().outputPath("server-lifecycle.json"),JSON.stringify(lifecycle,null,2));
  const ledger=()=>reviewDatabase<{lots:{quantity:number}[];audits:unknown[];receipts:unknown[];members:unknown[]}>(
    `const n=${JSON.stringify(tag)},w={run:{sessionId:${JSON.stringify(batch)}}};return {lots:await p.inventoryItem.findMany({where:{currentOwnerId:n},orderBy:{id:'asc'}}),audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:n,changeType:'acquisition_committed'},orderBy:{id:'asc'}}),receipts:await p.acquisitionCommit.findMany({where:w,orderBy:{id:'asc'}}),members:await p.acquisitionCommitMember.findMany({where:{candidate:w},orderBy:{candidateId:'asc'}})};`);
  const originals=()=> (reviewSourceState(batch).photos as Record<string,unknown>[]).map(row=>Object.fromEntries(
    ["id","digest","actualDigest","bytes","width","height","inputKind","generation","slotId","sourceMetadata"].map(key=>[key,row[key]])));
  const dropBarrier=()=>sql('DROP TRIGGER IF EXISTS "ServerLossBarrier" ON "AcquisitionCommitMember"; DROP FUNCTION IF EXISTS "ServerLossBarrier"();');
  function resourcesOwned(){
    const pg=pgOwned(),space=peer(anchor,"server-loss-network-anchor",browserImage,network);
    const fixture=peer(client,"server-loss-fixture-client",identity.image,network);
    const browser=peer(controller,"server-loss-controller",browserImage,"container:"+anchor);
    if(space.Mounts.length||fixture.Mounts.length!==1||fixture.Mounts[0].Type!=="volume"||fixture.Mounts[0].Name!==identity.uploads||
      fixture.Mounts[0].Destination!==SERVER_LOSS_UPLOADS_ROOT||fixture.Mounts[0].RW!==true||
      !fixture.Config.Env.includes("UPLOADS_DATA_PATH="+SERVER_LOSS_UPLOADS_ROOT)||
      new URL(fixture.Config.Env.find((s:string)=>s.startsWith("DATABASE_URL=")).slice(13)).pathname!=="/"+identity.database||
      browser.HostConfig.NetworkMode!=="container:"+space.Id)throw Error("Unexpected fixture storage or broker");
    const net=JSON.parse(docker("network","inspect",network))[0];
    if(net.Id!==network||net.Internal!==true||net.Labels?.["mtg.run"]!==identity.run||net.Labels?.["mtg.server-loss.nonce"]!==identity.nonce||
      JSON.stringify(Object.keys(net.Containers??{}).sort())!==JSON.stringify([pg.Id,space.Id,fixture.Id].sort()))throw Error("Private network ownership or endpoints differ");
    for(const [name,expected]of [[dataVolume,[postgres]],[identity.uploads,[web,client]]] as const){
      const volume=JSON.parse(docker("volume","inspect",name))[0];
      const users=docker("ps","-aq","--no-trunc","--filter",`volume=${name}`).split(/\s+/).filter(Boolean).sort();
      if(volume.Name!==name||volume.Labels?.["mtg.run"]!==identity.run||volume.Labels?.["mtg.server-loss.nonce"]!==identity.nonce||
        JSON.stringify(users)!==JSON.stringify([...expected].sort()))throw Error("Private volume ownership/references differ");
    }
    return [pg,space,fixture,browser].map(value=>({id:value.Id,image:value.Image,startedAt:value.State.StartedAt,
      configuration:hash(JSON.stringify({config:value.Config,host:value.HostConfig,mounts:value.Mounts}))}));
  }
  const peersBefore=resourcesOwned();
  const webConfiguration=hash(JSON.stringify({config:webBefore.Config,host:webBefore.HostConfig,mounts:webBefore.Mounts}));
  async function crashAndRecover(phase:string,onStopped?:()=>Promise<void>){
    const live=owned("running");expect(resourcesOwned()).toEqual(peersBefore);
    lifecycle.push({event:phase+"-before-SIGKILL",state:live.State});saveLife();
    docker("kill","--signal","KILL",web);
    await expect.poll(()=>inspect(web).State.Running).toBe(false);
    const killed=owned("terminal");expect(killed.State.ExitCode).toBe(137);
    lifecycle.push({event:phase+"-terminal137",state:killed.State});saveLife();
    if(onStopped)await onStopped();
    owned("terminal");expect(resourcesOwned()).toEqual(peersBefore);docker("start",web);
    await expect.poll(()=>{try{return docker("exec",web,"node","-e","fetch('http://127.0.0.1:3000/login').then(r=>{if(r.status!==200)process.exitCode=1}).catch(()=>process.exitCode=1)")||"ready";}catch{return "not ready";}},{timeout:30000}).toBe("ready");
    const restarted=owned("running");expect(Date.parse(restarted.State.StartedAt)).toBeGreaterThan(Date.parse(live.State.StartedAt));
    expect(hash(JSON.stringify({config:restarted.Config,host:restarted.HostConfig,mounts:restarted.Mounts}))).toBe(webConfiguration);
    expect(resourcesOwned()).toEqual(peersBefore);expect(pgOwned().State.StartedAt).toBe(pgBefore.State.StartedAt);
    lifecycle.push({event:phase+"-restarted",state:restarted.State});saveLife();
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
    reviewDatabase(`const n=${JSON.stringify(tag)},other=${JSON.stringify(foreign)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{for(const [id,tokenHash] of [[n,${JSON.stringify(hash(token))}],[other,${JSON.stringify(hash(foreignToken))}]]){await tx.player.create({data:{id,name:id,displayName:id}});await tx.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash}});await tx.authSession.create({data:{tokenHash,userId:id,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+900000)}});}await tx.inventoryLocation.create({data:{id:n,name:'Server recovery box',normalizedName:n,ownerPlayerId:n,type:'Box',visibility:'PRIVATE',storageLayout:{capacity:10,sections:[]}}});await tx.card.create({data:{id:${JSON.stringify(card)},scryfallId:require('crypto').randomUUID(),name:'Server recovery fixture',setCode:'svl',collectorNumber:'1',lang:'en',finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});});return true;`);
    await page.context().addCookies([{name:"mtg_inventory_session",value:token,url:baseURL!,httpOnly:true,sameSite:"Lax"}]);
    const created=await page.request.post("/api/acquisition",{headers,data:{requestKey:randomUUID(),locationId:tag,section:"",quantity:4}});
    expect(created.ok(),await created.text()).toBe(true);batch=(await created.json()).id;
    const bytes=await sharp({create:{width:80,height:120,channels:3,background:"#335577"}}).jpeg().toBuffer(),photos:string[]=[];
    for(let index=0;index<4;index++){
      const reservation=await page.request.post(`/api/acquisition/${batch}`,{headers,data:{action:"reserve",requestKey:randomUUID()}});expect(reservation.ok()).toBe(true);
      const {slot}=await reservation.json(),upload=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`,
        {headers:{...headers,"content-type":"image/jpeg"},data:bytes});expect(upload.ok(),await upload.text()).toBe(true);photos.push((await upload.json()).id);
    }
    reviewDatabase(`const w={run:{sessionId:${JSON.stringify(batch)}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Unexpected fixture worker');await p.acquisitionProcessingJob.updateMany({where:{...w,status:'PENDING'},data:{status:'FAILED',errorCode:'CONTROLLED_SERVER_LOSS_FIXTURE'}});return true;`);
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
    sql(`CREATE FUNCTION "ServerLossBarrier"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."runId"=${quote(runId)} THEN
      IF (SELECT quantity FROM "InventoryItem" WHERE id=NEW."inventoryItemId")<>1 OR
         (SELECT count(*) FROM "InventoryAuditLog" WHERE "changedByUserId"=${quote(tag)} AND "changeType"='acquisition_committed')<>1 OR
         (SELECT count(*) FROM "AcquisitionCommit" WHERE "runId"=NEW."runId")<>1 OR
         (SELECT count(*) FROM "AcquisitionCommitMember" WHERE "runId"=NEW."runId")<>1 THEN RAISE EXCEPTION 'Staged write precondition failed'; END IF;
      PERFORM pg_advisory_xact_lock(731,24); END IF; RETURN NEW; END $$;
      CREATE TRIGGER "ServerLossBarrier" AFTER INSERT ON "AcquisitionCommitMember" FOR EACH ROW EXECUTE FUNCTION "ServerLossBarrier"();`);
    await page.route("**/api/acquisition/*/commit",async route=>{
      if(route.request().postDataJSON().action!=="commit")return route.continue();
      const body=route.request().postData()!;sent.push(body);
      if(!holdReply)return route.continue();holdReply=false;
      try{const response=await route.fetch();expect(response.status()).toBe(200);heldRoute=route;heldResolve({body,receipt:await response.json()});}
      catch(error){heldReject(error);}
    });
    const url=`/imports/scan?input=photos&batch=${batch}`;await page.goto(url);
    const first=await preview(1);await first.screenshot({path:test.info().outputPath("before-uncommitted-crash.png")});
    const appName="server-loss-barrier-"+identity.nonce.slice(0,12);
    owned("running");const child=spawn("docker",["exec","-e",`PGAPPNAME=${appName}`,postgres,"psql","-U","review","-d",identity.database,"-v","ON_ERROR_STOP=1","-c","SELECT pg_advisory_lock(731,24); SELECT pg_sleep(30);"],{windowsHide:true});
    blockerClosed=false;blockerDone=new Promise(resolve=>{child.once("error",error=>{blockerClosed=true;resolve({code:null,signal:null,error:error.message});});child.once("close",(code,signal)=>{blockerClosed=true;resolve({code,signal});});});
    child.stdin.end();for(const stream of [child.stdout,child.stderr])stream.on("data",value=>{blockerOutput=(blockerOutput+value.toString()).slice(-8192);});
    await expect.poll(()=>{const rows=JSON.parse(sql(`SELECT coalesce(json_agg(a.pid),'[]') FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=${quote(appName)} AND l.locktype='advisory' AND l.classid=731 AND l.objid=24 AND l.granted`));return rows.length===1?rows[0]:0;}).toBeGreaterThan(0);
    blockerPid=Number(sql(`SELECT pid FROM pg_stat_activity WHERE application_name=${quote(appName)}`));
    const firstFailure=page.waitForEvent("requestfailed",{predicate:r=>r.url().endsWith(`/api/acquisition/${batch}/commit`)&&r.postDataJSON().action==="commit"});
    void firstFailure.catch(()=>{});await first.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();
    let staged:any[]=[];
    await expect.poll(()=>{staged=JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('pid',pid,'backendStart',backend_start,'transactionStart',xact_start,'xid',backend_xid,'query',query)),'[]') FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%AcquisitionCommitMember%'`));return staged.length;},{timeout:10000}).toBe(1);
    const originalBody=sent.at(-1)!;
    writeFileSync(test.info().outputPath("staged-barrier.json"),JSON.stringify({blockerPid,staged,stage:"AFTER member INSERT with in-transaction stock/audit/receipt/member preconditions"}));
    await crashAndRecover("uncommitted",async()=>{
      const request=await deadline(firstFailure,15000,"Killed web did not fail its pending browser request");
      expect(request.failure()).not.toBeNull();expect(await request.response()).toBeNull();
      writeFileSync(test.info().outputPath("interrupted-browser-request.json"),JSON.stringify({method:request.method(),failure:request.failure()}));
      await expect(panel.getByRole("button",{name:"Retry Inventory addition",exact:true})).toBeEnabled();
      const finished=await deadline(blockerDone!,35000,"Owned SQL barrier did not finish naturally");
      expect(blockerClosed).toBe(true);expect(finished).toEqual({code:0,signal:null});
      writeFileSync(test.info().outputPath("blocker-terminal.json"),JSON.stringify({...finished,output:blockerOutput}));
      await expect.poll(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE pid=${staged[0].pid}`)).toBe("0");
      dropBarrier();expect(ledger()).toEqual({lots:[],audits:[],receipts:[],members:[]});
    });
    const rolledBack=ledger();expect(rolledBack).toEqual({lots:[],audits:[],receipts:[],members:[]});
    writeFileSync(test.info().outputPath("rolled-back.json"),JSON.stringify(rolledBack));
    expect(originals()).toEqual(source);expect(reviewSourceState(batch).candidates.map(row=>row.review)).toEqual(reviews);
    await panel.screenshot({path:test.info().outputPath("uncommitted-recovery-retry.png")});
    await panel.getByRole("button",{name:"Retry Inventory addition",exact:true}).click();
    await expect(panel).toContainText("Added 1 copy to Inventory.");expect(sent.at(-1)).toBe(originalBody);
    const firstCommitted=ledger();expect(firstCommitted.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(1);
    expect(firstCommitted.receipts).toHaveLength(1);expect(firstCommitted.members).toHaveLength(1);expect(firstCommitted.audits).toHaveLength(1);
    const firstBody=sent.at(-1)!;const replay=await page.request.post(`/api/acquisition/${batch}/commit`,{headers:{...headers,"content-type":"application/json"},data:firstBody});
    expect(replay.ok()).toBe(true);expect((await replay.json()).replay).toBe(true);expect(ledger()).toEqual(firstCommitted);
    const second=await preview(2);holdReply=true;await second.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();
    const completed=await deadline(held,20000,"Successful second commit was not held");const durable=ledger();
    expect(durable.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(2);expect(durable.receipts).toHaveLength(2);expect(durable.members).toHaveLength(2);expect(durable.audits).toHaveLength(2);
    writeFileSync(test.info().outputPath("durable-before-crash.json"),JSON.stringify(durable));
    await crashAndRecover("committed",async()=>{expect(ledger()).toEqual(durable);});expect(ledger()).toEqual(durable);
    writeFileSync(test.info().outputPath("durable-after-recovery.json"),JSON.stringify(ledger()));
    await heldRoute!.abort("failed");heldRoute=undefined;
    await expect(panel.getByRole("button",{name:"Retry Inventory addition",exact:true})).toBeEnabled();
    await panel.screenshot({path:test.info().outputPath("durable-recovery-retry.png")});
    const retryResponse=page.waitForResponse(r=>r.url().endsWith(`/api/acquisition/${batch}/commit`)&&r.request().postDataJSON().action==="commit");
    await panel.getByRole("button",{name:"Retry Inventory addition",exact:true}).click();
    const recovered=await deadline(retryResponse,15000,"Original durable retry response missing");
    expect(recovered.status()).toBe(200);expect((await recovered.json()).replay).toBe(true);
    await expect(panel).toContainText("Added 1 copy to Inventory.");expect(sent.at(-1)).toBe(completed.body);expect(ledger()).toEqual(durable);
    writeFileSync(test.info().outputPath("original-retry.json"),JSON.stringify({status:recovered.status(),sameFrozenBody:true,replay:true}));
    const third=await preview(3);await third.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();await expect(panel).toContainText("Added 1 copy to Inventory.");
    const final=ledger();expect(final.lots.reduce((sum,row)=>sum+row.quantity,0)).toBe(3);expect(final.receipts).toHaveLength(3);expect(final.members).toHaveLength(3);expect(final.audits).toHaveLength(3);
    expect(originals()).toEqual(source);expect(reviewSourceState(batch).candidates.map(row=>row.review)).toEqual(reviews);
    expect(reviewDatabase(`return p.acquisitionProcessingJob.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}});`)).toEqual(jobs);
    const last=await (await page.request.get(`/api/acquisition/${batch}`)).json();expect(last.slots.filter((row:any)=>row.committed)).toHaveLength(3);expect(last.slots[3].review).toBe(null);expect(last.slots[3].committed).toBe(false);
    const original=await page.request.get(`/api/acquisition/${batch}/photos/${photos[0]}`);expect(original.status()).toBe(200);expect(hash(await original.body())).toBe(hash(bytes));
    const denied=await request.get(`/api/acquisition/${batch}/photos/${photos[0]}`,{headers:{cookie:`mtg_inventory_session=${foreignToken}`}});expect(denied.status()).toBe(403);
    const webAfter=inspect(web);expect(webAfter.Id).toBe(webBefore.Id);expect(webAfter.Image).toBe(webBefore.Image);expect(Date.parse(webAfter.State.StartedAt)).toBeGreaterThan(Date.parse(webBefore.State.StartedAt));expect(resourcesOwned()).toEqual(peersBefore);
    writeFileSync(test.info().outputPath("result.json"),JSON.stringify({width,settings,rolledBack,firstCommitted,durable,final,replay:true,pending:1,sameWebContainerAndConfiguration:true,peersUnchanged:true,crashes:2,originalRequestRetries:true}));
  }catch(error){failed=true;primary=error;}
  if(heldRoute)try{await heldRoute.abort("failed");}catch(error){cleanup.push(error);}
  if(failed)try{await page.screenshot({path:test.info().outputPath("failed-state.png")});}catch(error){cleanup.push(error);}
  const pageClosure=await observeServerLossPageClosure(page);if(pageClosure.error)cleanup.push(pageClosure.error);
  if(!blockerClosed&&blockerDone)try{await deadline(blockerDone,35000,"Owned blocker remains live; preserve recovery graph");}catch(error){cleanup.push(error);}
  let safe=blockerClosed&&pageClosure.closed;
  try{owned("running");expect(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND xact_start IS NOT NULL")).toBe("0");}catch(error){safe=false;cleanup.push(error);}
  if(safe){
    try{dropBarrier();expect(sql("SELECT count(*) FROM pg_trigger WHERE tgname='ServerLossBarrier'")).toBe("0");}catch(error){safe=false;cleanup.push(error);}
  }
  const cleaned=await withServerLossCleanup({pageClosed:pageClosure.closed,blockerClosed,databaseSafe:safe},async()=>{
    try{cleanupReviewFixture(tag,card);}catch(error){cleanup.push(error);}
    try{reviewDatabase(`const id=${JSON.stringify(foreign)};await p.authSession.deleteMany({where:{userId:id}});await p.user.deleteMany({where:{id}});await p.player.deleteMany({where:{id}});return true;`);}catch(error){cleanup.push(error);}
    try{const after=reviewFingerprint();writeFileSync(test.info().outputPath("after.json"),JSON.stringify(after));expect(after).toEqual(before);}catch(error){cleanup.push(error);}
  });
  if(!cleaned)cleanup.push(Error("Uncertain database/request/helper state preserves fixture recovery records"));
  if(failed||cleanup.length)throw new AggregateError([...(failed?[primary]:[]),...cleanup],"Server-loss qualification or cleanup failed",{cause:failed?primary:cleanup[0]});
});
