import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {writeFileSync} from "node:fs";
import sharp from "sharp";
import {cleanupCorrectionFixture} from "./correction-fixture";
import {cleanupOwnedPhotoFixtureFiles} from "./owned-fixture-files";
import {requireServerLossOwnership, observeServerLossPageClosure, withServerLossCleanup,
  SERVER_LOSS_UPLOADS_ROOT, type ServerLossIdentity} from "./acquisition-server-loss-ownership";

test.skip(process.env.MTG_FILESYSTEM_RESTART_TEST !== "1", "Requires a newly owned inode-full/server-loss fixture");
test.use({trace: "retain-on-failure", screenshot: "only-on-failure", video: "off"});
const docker = (...args: string[]) => execFileSync("docker", args, {encoding: "utf8", windowsHide: true, timeout: 30_000}).trim();
const inspect = (id: string) => JSON.parse(docker("inspect", id))[0];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

for (const width of [1366, 320]) test(`refused storage upload survives owned server loss at ${width}px`, async ({page, baseURL}) => {
  test.setTimeout(240_000); page.setDefaultTimeout(20_000);
  expect(baseURL).toBe("http://127.0.0.1:13935");
  if(process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT)throw Error("No Docker endpoint override is allowed for this local fixture");
  expect(docker("context","inspect","--format","{{.Endpoints.docker.Host}}")).toBe("npipe:////./pipe/dockerDesktopLinuxEngine");
  const client = process.env.MTG_INVENTORY_TEST_CONTAINER ?? "", databaseName = process.env.MTG_INVENTORY_TEST_DATABASE ?? "";
  const postgres = process.env.MTG_FILESYSTEM_RESTART_POSTGRES ?? "", network = process.env.MTG_FILESYSTEM_RESTART_NETWORK ?? "";
  const identity: ServerLossIdentity = {id: process.env.MTG_SERVER_LOSS_WEB ?? "", image: process.env.MTG_SERVER_LOSS_WEB_IMAGE ?? "",
    run: process.env.MTG_SERVER_LOSS_RUN ?? "", nonce: process.env.MTG_SERVER_LOSS_NONCE ?? "",
    anchor: process.env.MTG_SERVER_LOSS_ANCHOR ?? "", uploads: process.env.MTG_SERVER_LOSS_UPLOAD_VOLUME ?? "", database: databaseName};
  for (const id of [client, postgres, network]) if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Immutable isolated fixture identities required");
  if (new Set([identity.id, identity.anchor, client, postgres]).size !== 4) throw Error("Distinct fixture roles required");
  const ownedWeb = (phase: "running" | "terminal") => requireServerLossOwnership(inspect(identity.id), identity, phase);
  const webBefore = ownedWeb("running");
  const configuration = (value: any) => hash(JSON.stringify({config: value.Config, host: value.HostConfig, mounts: value.Mounts}));
  function peers() {
    return [[client, "filesystem-restart-client"], [postgres, "filesystem-restart-postgres"], [identity.anchor, "filesystem-restart-anchor"]].map(([id, role]) => {
      const value = inspect(id);
      if (value.Id !== id || value.Config.Labels?.["mtg.run"] !== identity.run || value.Config.Labels?.["mtg.server-loss.nonce"] !== identity.nonce ||
          value.Config.Labels?.["mtg.fixture.role"] !== role || value.HostConfig.Privileged !== false || value.HostConfig.RestartPolicy?.Name !== "no" ||
          !value.State.Running || value.State.Paused || value.State.Restarting || value.State.Dead || value.State.OOMKilled)
        throw Error("Independent fixture role/state differs");
      if (id === client && (value.HostConfig.NetworkMode !== network || value.Mounts.length !== 1 || value.Mounts[0].Name !== identity.uploads ||
          value.Mounts[0].Type !== "volume" || value.Mounts[0].Destination !== SERVER_LOSS_UPLOADS_ROOT || value.Mounts[0].RW !== true))
        throw Error("Storage keeper must retain the same private mounted volume");
      if(id===postgres && (value.HostConfig.NetworkMode!==network || value.Mounts.length!==1 || value.Mounts[0].Type!=="volume" ||
          value.Mounts[0].Name!=="mtg-enospc-restart-data-"+identity.nonce.slice(0,12) || value.Mounts[0].Destination!=="/var/lib/postgresql/data" ||
          value.Mounts[0].RW!==true || !value.Config.Env.includes("POSTGRES_DB="+databaseName)))throw Error("Unexpected private database storage or namespace");
      if(id===identity.anchor){
        expect(value.HostConfig.NetworkMode).toBe(network);expect(value.Mounts).toHaveLength(0);
        expect(value.HostConfig.PortBindings).toEqual({"3000/tcp":[{HostIp:"127.0.0.1",HostPort:"13935"}]});
        const connections=Object.values(value.NetworkSettings.Networks) as {NetworkID:string}[];
        expect(connections).toHaveLength(2);
        for(const connection of connections){const net=JSON.parse(docker("network","inspect",connection.NetworkID))[0];
          if(net.Id!==connection.NetworkID || net.Labels?.["mtg.run"]!==identity.run || net.Labels?.["mtg.server-loss.nonce"]!==identity.nonce)
            throw Error("HTTP anchor is attached to an unexpected network");
          expect(Object.keys(net.Containers??{}).sort()).toEqual(connection.NetworkID===network?[client,postgres,identity.anchor].sort():[identity.anchor]);
          expect(net.Internal).toBe(connection.NetworkID===network);
        }
      }
      return {id, image: value.Image, startedAt: value.State.StartedAt, restarts: value.RestartCount, configuration: configuration(value)};
    });
  }
  const peerBaseline = peers();
  const volume = JSON.parse(docker("volume", "inspect", identity.uploads))[0];
  if (volume.Name !== identity.uploads || volume.Labels?.["mtg.run"] !== identity.run || volume.Labels?.["mtg.server-loss.nonce"] !== identity.nonce ||
      volume.Driver !== "local" || volume.Options?.type !== "tmpfs" || volume.Options?.device !== "tmpfs" ||
      volume.Options?.o !== "size=3g,nr_inodes=64,mode=0777") throw Error("Expected newly owned inode-bounded tmpfs volume");
  const volumeUsers = () => docker("ps", "-aq", "--no-trunc", "--filter", `volume=${identity.uploads}`).split(/\s+/).filter(Boolean).sort();
  expect(volumeUsers()).toEqual([client, identity.id].sort());
  function database<T = any>(body: string): T {
    return JSON.parse(execFileSync("docker", ["exec", "-i", client, "node"], {encoding: "utf8", windowsHide: true, timeout: 30_000,
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).hostname!=='server-loss-pg'||new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify('/'+databaseName)}||process.env.UPLOADS_DATA_PATH!==${JSON.stringify(SERVER_LOSS_UPLOADS_ROOT)})throw Error('Wrong disposable target');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`}));
  }
  function fingerprint() {
    return database(`const r={};for(const{tablename}of await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unexpected table');const rows=await p.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');r[tablename]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return r;`);
  }
  const before = fingerprint(); expect(Object.keys(before)).toHaveLength(85);
  writeFileSync(test.info().outputPath("before.json"), JSON.stringify(before));
  const tag = "ui-filesystem-restart-" + randomUUID(), foreign = "ui-filesystem-peer-" + randomUUID(), token = randomBytes(32).toString("base64url");
  for(const owner of [tag,foreign])if(!/^ui-[a-z-]+-[a-f0-9-]{36}$/.test(owner))throw Error("Invalid generated fixture owner");
  const headers = {origin: baseURL!}, directory = SERVER_LOSS_UPLOADS_ROOT + "/acquisition-v1";
  const bytes = await sharp({create: {width: 80, height: 120, channels: 3, background: "#335577"}}).png().toBuffer(), digest = hash(bytes);
  const lifecycle: unknown[] = [], requests: string[] = [];
  let batch = "", primary: unknown, failed = false;
  const save = () => writeFileSync(test.info().outputPath("lifecycle.json"), JSON.stringify(lifecycle));
  const releaseFillers = () => database(`const fs=require('fs/promises'),dir=${JSON.stringify(directory)},prefix=${JSON.stringify(tag+'-filler-')};for(const name of await fs.readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})){if(name.startsWith(prefix))await fs.unlink(dir+'/'+name);}return true;`);
  const state = () => database(`const w={run:{sessionId:${JSON.stringify(batch)}}};return {photos:await p.acquisitionPhoto.findMany({where:w,orderBy:{id:'asc'}}),artifacts:await p.acquisitionArtifact.findMany({where:w,orderBy:{id:'asc'}}),candidates:await p.acquisitionCandidate.findMany({where:w,orderBy:{id:'asc'}}),jobs:await p.acquisitionProcessingJob.findMany({where:w,orderBy:{id:'asc'}}),receipts:await p.acquisitionCommit.findMany({where:w,orderBy:{id:'asc'}}),stock:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}},orderBy:{id:'asc'}})};`);
  const peerState = () => database(`const n=${JSON.stringify(foreign)};return {player:await p.player.findUnique({where:{id:n}}),user:await p.user.findUnique({where:{id:n}}),stock:await p.inventoryItem.findMany({where:{currentOwnerId:n},orderBy:{id:'asc'}}),bytes:await require('fs/promises').readFile(${JSON.stringify(directory+'/'+foreign)},'utf8')};`);
  try {
    database(`const fs=require('fs/promises');await fs.mkdir(${JSON.stringify(directory)},{recursive:true});await fs.writeFile(${JSON.stringify(directory+'/'+foreign)},'protected peer original',{flag:'wx'});for(const n of ${JSON.stringify([tag,foreign])}){const passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{await tx.player.create({data:{id:n,name:n,displayName:n}});await tx.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash}});await tx.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:10,sections:[]}}});await tx.card.create({data:{id:n,scryfallId:require('crypto').randomUUID(),name:n,setCode:'tst',collectorNumber:'1',lang:'en',finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});await tx.inventoryItem.create({data:{cardId:n,currentOwnerId:n,originalOpenerId:n,quantity:2,condition:'NM',locationId:n,sourceType:'MANUAL'}});${'if(n==='+JSON.stringify(tag)+')'}await tx.authSession.create({data:{tokenHash:${JSON.stringify(hash(token))},userId:n,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+600000)}});});}return true;`);
    const protectedPeer = peerState();
    await page.context().addCookies([{name: "mtg_inventory_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax"}]);
    await page.setViewportSize({width, height: 900});
    const created = await page.request.post("/api/acquisition", {headers, data: {requestKey: randomUUID(), locationId: tag, section: "", quantity: 1}, timeout: 90_000});
    expect(created.status(), await created.text()).toBe(200); batch = (await created.json()).id;
    await page.goto(`/imports/scan?batch=${batch}`, {timeout: 90_000});
    const pressure = database(`const fs=require('fs/promises'),dir=${JSON.stringify(directory)},disk=await fs.statfs(dir);if(disk.type!==0x01021994||disk.files!==64||disk.bavail*disk.bsize<2*1024**3+${bytes.length})throw Error('Expected bounded tmpfs with unchanged byte guard');let fillers=0,code='';try{for(;fillers<128;fillers++)await fs.writeFile(dir+'/'+${JSON.stringify(tag+'-filler-')}+fillers,'',{flag:'wx'});}catch(e){code=e.code;}const full=await fs.statfs(dir);return {fillers,code,freeInodes:full.ffree,freeBytes:full.bavail*full.bsize};`);
    expect(pressure.code).toBe("ENOSPC"); expect(pressure.freeInodes).toBe(0); expect(pressure.freeBytes).toBeGreaterThan(2*1024**3+bytes.length);
    page.on("request", request => {if(request.method()==="POST" && request.url().includes(`/api/acquisition/${batch}/photos?`))requests.push(request.url());});
    const refused = page.waitForResponse(response => response.url().includes(`/api/acquisition/${batch}/photos?`) && response.status()===409);
    await page.getByLabel("Choose card photos").setInputFiles({name: "saved-card.png", mimeType: "image/png", buffer: bytes});
    expect(await (await refused).json()).toEqual({error: "Photo storage is full. Free storage space or ask the administrator, then retry."});
    const pending = page.getByRole("region", {name: "Pending uploads", exact: true});
    await expect(pending.getByRole("button", {name: "Retry upload", exact: true})).toBeVisible();
    const refusedState = state(); expect(refusedState.photos).toHaveLength(1);
    expect(refusedState.photos[0]).toMatchObject({ready: false, readyAt: null, digest, bytes: bytes.length});
    expect([refusedState.artifacts.length,refusedState.candidates.length,refusedState.jobs.length,refusedState.receipts.length]).toEqual([0,0,0,0]);
    const original = refusedState.photos[0];
    const beforeKill = ownedWeb("running"); expect(peers()).toEqual(peerBaseline); expect(volumeUsers()).toEqual([client,identity.id].sort());
    lifecycle.push({event:"before-kill",web:beforeKill.State,pressure}); save();
    expect(docker("kill", "--signal", "KILL", identity.id)).toBeTruthy();
    const stopped = ownedWeb("terminal"); expect(stopped.State.ExitCode).toBe(137);
    expect(configuration(stopped)).toBe(configuration(webBefore)); expect(peers()).toEqual(peerBaseline);
    expect(state()).toEqual(refusedState); expect(peerState()).toEqual(protectedPeer);
    // The mounted keeper survives. A container restart must not silently replace
    // full storage with an empty tmpfs and thereby manufacture recovery.
    expect(database(`const s=await require('fs/promises').statfs(${JSON.stringify(directory)});return s.ffree;`)).toBe(0);
    lifecycle.push({event:"stopped",web:stopped.State,peers:peers(),refusedState}); save();
    docker("start", identity.id);
    const restarted = ownedWeb("running"); expect(configuration(restarted)).toBe(configuration(webBefore));
    expect(restarted.State.StartedAt).not.toBe(beforeKill.State.StartedAt); expect(peers()).toEqual(peerBaseline);
    await expect.poll(async()=>{try{return (await page.request.get("/login",{timeout:3000})).status();}catch{return 0;}},{timeout:60_000,intervals:[250,500,1000]}).toBe(200);
    expect(state()).toEqual(refusedState); expect(peerState()).toEqual(protectedPeer); expect(requests).toHaveLength(1);
    // The genuine storage fault persists across process loss, and the UI still
    // requires deliberate retry. Refusing again cannot create another identity.
    const refusedAgain = page.waitForResponse(response => response.url()===requests[0] && response.status()===409);
    await pending.getByRole("button", {name: "Retry upload", exact: true}).click(); await refusedAgain;
    expect(state()).toEqual(refusedState); expect(requests).toHaveLength(2);
    releaseFillers();
    const recovered = page.waitForResponse(response => response.url()===requests[0] && response.status()===200);
    await pending.getByRole("button", {name: "Retry upload", exact: true}).click();
    const ack = await (await recovered).json(); expect(ack).toEqual({id:original.id,digest,ready:true});
    await expect(pending).toHaveCount(0); expect(requests).toEqual([requests[0],requests[0],requests[0]]);
    const ready = state(); expect(ready.photos).toHaveLength(1); expect(ready.photos[0]).toMatchObject({id:original.id,slotId:original.slotId,uploadKey:original.uploadKey,ready:true});
    for(const field of Object.keys(original).filter(key=>!["ready","readyAt"].includes(key)))expect(ready.photos[0][field],field).toEqual(original[field]);
    expect([ready.artifacts.length,ready.candidates.length,ready.jobs.length,ready.receipts.length]).toEqual([1,1,1,0]); expect(ready.stock).toEqual(refusedState.stock);
    const replay = await page.request.post(requests[0], {headers:{...headers,"content-type":"image/png"},data:bytes});
    expect(replay.status()).toBe(200); expect(await replay.json()).toEqual(ack); expect(state()).toEqual(ready);
    const files = database(`const fs=require('fs/promises'),dir=${JSON.stringify(directory)},data=await fs.readFile(dir+'/'+${JSON.stringify(original.id+'.original')});return {digest:require('crypto').createHash('sha256').update(data).digest('hex'),bytes:data.length,partials:(await fs.readdir(dir)).filter(n=>n.endsWith('.part'))};`);
    expect(files).toEqual({digest,bytes:bytes.length,partials:[]}); expect(peerState()).toEqual(protectedPeer); expect(peers()).toEqual(peerBaseline);
    await page.reload(); await expect(page.getByRole("region",{name:"Batch progress",exact:true})).toContainText("1 photo saved");
    expect(state()).toEqual(ready); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`recovered-${width}.png`)});
    lifecycle.push({event:"recovered",web:restarted.State,ready,files,requests}); save();
  } catch(error) {primary=error;failed=true;}
  finally {
    const errors:unknown[]=failed?[primary]:[];
    const closure=await observeServerLossPageClosure(page);if(closure.error)errors.push(closure.error);
    let safe=false;try{ownedWeb("running");expect(peers()).toEqual(peerBaseline);safe=true;}catch(error){errors.push(error);}
    lifecycle.push({event:"cleanup-guard",pageClosed:closure.closed,databaseSafe:safe});save();
    try {
      const cleaned=await withServerLossCleanup({pageClosed:closure.closed,blockerClosed:true,databaseSafe:safe},async()=>{
        releaseFillers();
        database(`const owners=${JSON.stringify([tag,foreign])},fs=require('fs/promises'),dir=${JSON.stringify(directory)};const wAll={run:{session:{ownerPlayerId:{in:owners}}}};await p.acquisitionSession.updateMany({where:{ownerPlayerId:{in:owners}},data:{phase:'CANCELLED'}});if(await p.acquisitionProcessingJob.count({where:{...wAll,status:'RUNNING'}}))throw Error('Live fixture worker');const photos=await p.acquisitionPhoto.findMany({where:wAll,select:{id:true}}),fileFailures=[];try{${cleanupOwnedPhotoFixtureFiles}}catch(error){fileFailures.push(error);}try{await fs.unlink(dir+'/'+${JSON.stringify(foreign)});}catch(error){if(error.code!=='ENOENT')fileFailures.push(error);}if(fileFailures.length)throw new AggregateError(fileFailures,'Keep fixture recovery rows');await p.$transaction(async tx=>{const p=tx;for(const n of owners){const w={run:{session:{ownerPlayerId:n}}};${cleanupCorrectionFixture}await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:n}});}});return true;`);
        const after=fingerprint();writeFileSync(test.info().outputPath("after.json"),JSON.stringify(after));expect(after).toEqual(before);
      });
      if(!cleaned)errors.push(Error("Fixture retained: terminal proofs incomplete"));
    }catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,"Storage/server-loss qualification or cleanup failed");
  }
  expect(failed).toBe(false);
});
