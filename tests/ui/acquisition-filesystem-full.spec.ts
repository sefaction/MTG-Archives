import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";

const container = process.env.MTG_INVENTORY_TEST_CONTAINER || "";
const databaseName = process.env.MTG_INVENTORY_TEST_DATABASE || "";
test.skip(!container || !databaseName, "Requires a fresh owned tmpfs review installation");
test.use({ trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" });
function database<T = unknown>(body: string): T {
  if (!/^[a-f0-9]{64}$/.test(container) || !/^review_enospc_\w+$/.test(databaseName))
    throw new Error("Expected immutable ENOSPC review target");
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30_000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify("/" + databaseName)}||process.env.UPLOADS_DATA_PATH!=='/inode-pressure')throw Error('Wrong isolated fixture');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
function fingerprint() {
  return database(`const result={};for(const {tablename} of await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unexpected table');const rows=await p.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);
}

test("real inode ENOSPC preserves pending upload and recovers its exact identity on phone", async ({ page, baseURL }) => {
  test.setTimeout(180_000); page.setDefaultTimeout(15_000);
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const tag = `ui-filesystem-full-${randomUUID()}`, token = randomBytes(32).toString("base64url");
  const before = fingerprint(), headers = { origin: baseURL! };
  writeFileSync(test.info().outputPath("fixture-before.json"), JSON.stringify({ tag, before }));
  const bytes = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#335577" } }).png().toBuffer();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const message = "Photo storage is full. Free storage space or ask the administrator, then retry.";
  const requests: { url: string; digest: string }[] = [];
  let batch = "", primary: unknown;
  const releaseFillers = () => database(`const fs=require('fs/promises'),dir='/inode-pressure/acquisition-v1',prefix=${JSON.stringify(tag + "-filler-")};for(const name of await fs.readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})){if(name.startsWith(prefix))await fs.unlink(dir+'/'+name);}return true;`);
  const state = () => database<{ photos: { id: string; ready: boolean; readyAt: string | null; uploadKey: string; slotId: string }[]; counts: number[]; stock: unknown[] }>(`const w={run:{sessionId:${JSON.stringify(batch)}}};return {photos:await p.acquisitionPhoto.findMany({where:w,orderBy:{id:'asc'}}),counts:await Promise.all(['acquisitionArtifact','acquisitionCandidate','acquisitionProcessingJob','acquisitionCommit'].map(m=>p[m].count({where:w}))),stock:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}},orderBy:{id:'asc'}})};`);
  try {
    database(`const n=${JSON.stringify(tag)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{await tx.player.create({data:{id:n,name:n,displayName:n}});await tx.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash}});await tx.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:10,sections:[]}}});await tx.card.create({data:{id:n,scryfallId:require('crypto').randomUUID(),name:n,setCode:'tst',collectorNumber:'1',lang:'en',finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});await tx.inventoryItem.create({data:{cardId:n,currentOwnerId:n,originalOpenerId:n,quantity:2,condition:'NM',locationId:n,sourceType:'MANUAL'}});await tx.authSession.create({data:{tokenHash:${JSON.stringify(createHash("sha256").update(token).digest("hex"))},userId:n,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+600000)}});});return true;`);
    await page.context().addCookies([{ name: "mtg_inventory_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    const created = await page.request.post("/api/acquisition", { headers, data: { requestKey: randomUUID(), locationId: tag, section: "", quantity: 1 } });
    expect(created.ok(), await created.text()).toBe(true); batch = (await created.json()).id;
    const inventory = state().stock;
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`/imports/scan?batch=${batch}`);
    const pressure = database<{ freeBytes: number; freeInodes: number; code: string; fillers: number }>(`const fs=require('fs/promises'),dir='/inode-pressure/acquisition-v1';await fs.mkdir(dir,{recursive:true});const disk=await fs.statfs(dir);if(disk.type!==0x01021994||disk.files>64||disk.bavail*disk.bsize<2*1024**3+${bytes.length})throw Error('Expected bounded tmpfs with unchanged free-space guard');await fs.writeFile(dir+'/'+${JSON.stringify(tag + "-neighbor")},'unchanged neighbor',{flag:'wx'});let count=0,code='';try{for(;count<128;count++)await fs.writeFile(dir+'/'+${JSON.stringify(tag + "-filler-")}+count,'',{flag:'wx'});}catch(e){code=e.code;}const full=await fs.statfs(dir);return {freeBytes:full.bavail*full.bsize,freeInodes:full.ffree,code,fillers:count};`);
    expect(pressure.code).toBe("ENOSPC"); expect(pressure.freeInodes).toBe(0); expect(pressure.freeBytes).toBeGreaterThan(2 * 1024 ** 3 + bytes.length);
    writeFileSync(test.info().outputPath("kernel-pressure.json"), JSON.stringify(pressure));
    page.on("request", request => {
      if (request.method() === "POST" && request.url().includes(`/api/acquisition/${batch}/photos?`))
        requests.push({ url: request.url(), digest: createHash("sha256").update(request.postDataBuffer()!).digest("hex") });
    });
    const failed = page.waitForResponse(response => response.url().includes(`/api/acquisition/${batch}/photos?`) && response.status() === 409);
    await page.getByLabel("Choose card photos").setInputFiles({ name: "saved-card.png", mimeType: "image/png", buffer: bytes });
    const failure = await failed; expect(await failure.json()).toEqual({ error: message });
    const pending = page.getByRole("region", { name: "Pending uploads", exact: true });
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(pending).toContainText(message);
      await pending.scrollIntoViewIfNeeded();
      await expect(pending.getByRole("button", { name: "Retry upload", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`storage-full-${width}.png`) });
    }
    expect(requests).toHaveLength(1); expect(requests[0].digest).toBe(digest);
    const failedState = state(); expect(failedState.photos).toHaveLength(1);
    expect(failedState.photos[0]).toMatchObject({ ready: false, readyAt: null });
    expect(failedState.counts).toEqual([0, 0, 0, 0]); expect(failedState.stock).toEqual(inventory);
    const photo = failedState.photos[0];
    expect(database(`const fs=require('fs/promises'),names=await fs.readdir('/inode-pressure/acquisition-v1');return names.filter(name=>name.startsWith(${JSON.stringify(photo.id)}));`)).toEqual([]);
    releaseFillers();
    const recovered = page.waitForResponse(response => response.url() === requests[0].url && response.status() === 200);
    await pending.getByRole("button", { name: "Retry upload", exact: true }).click();
    const response = await recovered, ack = await response.json();
    expect(ack).toEqual({ id: photo.id, digest, ready: true });
    await expect(pending).not.toContainText(message);
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
    const ready = state(); expect(ready.photos).toHaveLength(1);
    expect(ready.photos[0]).toMatchObject({ id: photo.id, slotId: photo.slotId, uploadKey: photo.uploadKey, ready: true });
    expect(ready.counts).toEqual([1, 1, 1, 0]); expect(ready.stock).toEqual(inventory);
    const replay = await page.request.post(requests[0].url, { headers: { ...headers, "content-type": "image/png" }, data: bytes });
    expect(replay.status()).toBe(200); expect(await replay.json()).toEqual(ack); expect(state()).toEqual(ready);
    const fileProof = database(`const fs=require('fs/promises'),dir='/inode-pressure/acquisition-v1',data=await fs.readFile(dir+'/'+${JSON.stringify(photo.id + ".original")});return {digest:require('crypto').createHash('sha256').update(data).digest('hex'),bytes:data.length,neighbor:await fs.readFile(dir+'/'+${JSON.stringify(tag + "-neighbor")},'utf8'),partials:(await fs.readdir(dir)).filter(name=>name.endsWith('.part'))};`);
    expect(fileProof).toEqual({ digest, bytes: bytes.length, neighbor: "unchanged neighbor", partials: [] });
    writeFileSync(test.info().outputPath("recovered-state.json"), JSON.stringify({ failedState, ready, fileProof, requests }));
    await page.reload(); await expect(page.getByRole("region", { name: "Batch progress", exact: true })).toContainText("1 photos saved");
    expect(state()).toEqual(ready);
  } catch (error) { primary = error; throw error; }
  finally {
    const failures: unknown[] = [];
    try { await page.goto("about:blank"); } catch (error) { failures.push(error); }
    try { await page.context().clearCookies(); } catch (error) { failures.push(error); }
    try { releaseFillers(); } catch (error) { failures.push(error); }
    try {
      database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{ownerPlayerId:n},data:{phase:'CANCELLED'}});const w={run:{session:{ownerPlayerId:n}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Live fixture worker');const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:n}});const fs=require('fs/promises'),dir='/inode-pressure/acquisition-v1';for(const photo of photos)for(const suffix of ['.original','.preview.jpg'])await fs.unlink(dir+'/'+photo.id+suffix).catch(e=>{if(e.code!=='ENOENT')throw e});await fs.unlink(dir+'/'+n+'-neighbor').catch(e=>{if(e.code!=='ENOENT')throw e});return true;`);
      const after = fingerprint(); writeFileSync(test.info().outputPath("fixture-after.json"), JSON.stringify({ tag, after })); expect(after).toEqual(before);
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(primary ? [primary, ...failures] : failures, "Filesystem-full fixture cleanup failed");
  }
});
