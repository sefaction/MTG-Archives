import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";
import { acquisitionDraftKey } from "../../lib/acquisition-browser-review-draft";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node", "--import", "tsx"], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
  });
}
function databaseAsync(body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("docker", ["exec", "-i", "mtg-archives-web-1", "node", "--import", "tsx"],
      { windowsHide: true, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout) => error ? reject(new Error("Owned recovery signing failed")) : resolve(stdout));
    child.stdin?.on("error", () => child.kill());
    child.stdin?.end(`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());`);
  });
}

const cases = [
  { width: 1366, mode: "once" }, { width: 320, mode: "once" },
  { width: 1366, mode: "twice" }, { width: 320, mode: "draft" },
  { width: 1366, mode: "conflict" },
] as const;
for (const { width, mode } of cases) test(`bulk lost-response recovery ${mode} at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local actual saves with controlled proposals; no recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  await page.setViewportSize({ width, height: 900 });
  const tag = `ui-bulk-recovery-${randomUUID()}`, password = randomUUID();
  const printing = { id: `${tag}-card`, name: "Bulk recovery proposal", setCode: "tst", collectorNumber: "1",
    lang: "en", imageUri: "/fixture-bulk-recovery.svg", finishes: ["nonfoil"] };
  let batch = "", closing = false, navigation = 0, losses = 0;
  const photos: string[] = [], presentations = new Map<string, Promise<string>>();
  const writes: Array<{ photoId: string; body: string }> = [], errors: string[] = [], cancelled = new WeakSet<object>();
  page.on("pageerror", error => errors.push(error.message));
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigation++; });
  page.on("requestfailed", request => { if (request.failure()?.errorText === "net::ERR_ABORTED") cancelled.add(request); });
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[{name:'A',capacity:2}]}}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Land',rarity:'common'}});await p.$transaction(tx=>require('./lib/acquisition-correction-library.ts').ensureCorrectionAccount(tx,n));await p.correctionLibraryAccount.update({where:{ownerPlayerId:n},data:{sampleBasisPoints:0}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", { headers: { origin: baseURL! }, data: { requestKey: randomUUID(), locationId: tag, section: "A", quantity: 2 } });
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    for (let index = 0; index < 2; index++) {
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! }, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, {
        headers: { origin: baseURL!, "content-type": "image/jpeg" }, data: bytes,
      }); expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    }
    const draftKey = acquisitionDraftKey({ userId: tag, batchId: batch, photoId: photos[0] });
    await page.route("**/fixture-bulk-recovery.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#557755"/></svg>' }));
    const endpoint = `/api/acquisition/${batch}/review`;
    await page.route(`**${endpoint}?*`, async route => {
      const epoch = navigation, request = route.request(), photoId = new URL(request.url()).searchParams.get("photoId");
      if (!photoId) return route.continue();
      try {
        const response = await route.fetch(); expect(response.ok()).toBe(true); const record = await response.json();
        if (closing || epoch !== navigation || cancelled.has(request)) return;
        const key = JSON.stringify([photoId, record.revision]);
        let signing = presentations.get(key);
        if (!signing) {
          signing = databaseAsync(`const n=${JSON.stringify(tag)};const photo=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photoId)}}});const candidate=await p.acquisitionCandidate.findFirstOrThrow({where:{physicalId:photo.slotId}});const jobs=await p.acquisitionProcessingJob.findMany({where:{runId:photo.runId,candidateId:candidate.id,artifact:{sourceId:photo.id}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:16});console.log(await p.$transaction(tx=>require('./lib/acquisition-correction-library.ts').correctionDisplayToken(tx,n,{userId:n,adminMode:false},photo,{id:candidate.id,revision:${record.revision}},jobs,[${JSON.stringify(printing)}],'PENDING')));`).then(value => value.trim());
          presentations.set(key, signing);
        }
        const token = await signing;
        if (!closing && epoch === navigation && !cancelled.has(request)) await route.fulfill({ json: { ...record, evidenceToken: token, suggestions: [{ printing, reasons: ["Controlled recovery presentation"] }] } });
      } catch (error) { if (!closing && epoch === navigation && !cancelled.has(request)) throw error; }
    });
    await page.route(`**${endpoint}`, async route => {
      const input = route.request().postDataJSON();
      if (route.request().method() !== "POST" || input.action !== "accept") return route.continue();
      writes.push({ photoId: input.photoId, body: route.request().postData()! });
      const response = await route.fetch();
      const lose = input.photoId === photos[0] && losses < (mode === "twice" ? 2 : 1);
      if (lose) {
        expect(response.ok()).toBe(true); losses++;
        if (mode === "draft") await page.evaluate(key => localStorage.setItem(key, "controlled new correction"), draftKey);
        if (mode === "conflict") {
          const state = await (await page.request.get(`${endpoint}?photoId=${photos[0]}`)).json();
          const changed = await page.request.post(endpoint, { headers: { origin: baseURL! }, data: { action: "accept", photoId: photos[0], revision: state.revision,
            decision: { cardId: printing.id, language: "en", finish: "NONFOIL", condition: "LP" } } });
          expect(changed.ok()).toBe(true);
        }
        // The actual server transaction has succeeded before its reply is lost.
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    const bulk = page.getByRole("region", { name: "Bulk match review", exact: true });
    await bulk.getByRole("button", { name: "Bulk Confirm Match", exact: true }).click();
    await expect(bulk.getByRole("button", { name: "Confirm 2 selected matches", exact: true })).toBeEnabled();
    await bulk.getByRole("button", { name: "Confirm 2 selected matches", exact: true }).click();
    if (mode === "twice" || mode === "draft") {
      const retry = bulk.getByRole("button", { name: "Continue original confirmations", exact: true });
      await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
      expect(writes).toHaveLength(mode === "twice" ? 2 : 1);
      expect(writes.every(write => write.photoId === photos[0])).toBe(true);
      await expect(bulk.getByRole("button", { name: "Reload proposals", exact: true })).toBeDisabled();
      await expect(bulk.getByRole("button", { name: "Bulk Confirm Match", exact: true })).toBeDisabled();
      for (const checkbox of await bulk.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();
      await expect(bulk).toContainText("Original confirmation: nonfoil · NM.");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/bulk-recovery-pending-${mode}-${width}.png` });
      await bulk.getByRole("button", { name: "Back to card list", exact: true }).click();
      await expect(retry).toBeVisible();
      if (mode === "twice") {
        await page.locator("summary").filter({ hasText: "Batch defaults:" }).click();
        const defaults = page.getByRole("region", { name: "Batch review defaults", exact: true });
        await defaults.getByLabel("Batch condition", { exact: true }).selectOption("LP");
        await defaults.getByRole("button", { name: "Save batch defaults", exact: true }).click();
        await expect(page.locator("summary").filter({ hasText: "Batch defaults:" })).toContainText("LP");
      } else {
        await retry.click(); // The new draft still prevents a write.
        await expect(bulk.getByRole("status").filter({ hasText: "uncertain" })).toBeVisible();
        expect(writes).toHaveLength(1);
        await page.evaluate(key => localStorage.removeItem(key), draftKey);
      }
      await retry.click();
    }
    await expect.poll(() => Number(database(`console.log(await p.acquisitionCandidate.count({where:{run:{sessionId:${JSON.stringify(batch)}},review:{not:require('@prisma/client').Prisma.DbNull}}}));`))).toBe(2);
    const observed = JSON.parse(database(`const n=${JSON.stringify(tag)};console.log(JSON.stringify({events:await p.correctionReviewEvent.count({where:{ownerPlayerId:n}}),candidates:await p.acquisitionCandidate.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'},select:{revision:true,review:true}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:n}}),commits:await p.acquisitionCommit.count({where:{run:{sessionId:${JSON.stringify(batch)}}}}),examples:await p.correctionExample.count({where:{ownerPlayerId:n}})}));`));
    console.log("Owned recovery result:", JSON.stringify({ mode, losses, writes: writes.length, events: observed.events, revisions: observed.candidates.map((row: any) => row.revision), inventory: observed.inventory, commits: observed.commits }));
    expect(observed.inventory).toBe(0); expect(observed.commits).toBe(0); expect(observed.examples).toBe(mode === "conflict" ? 1 : 0);
    const firstWrites = writes.filter(write => write.photoId === photos[0]);
    expect(firstWrites).toHaveLength(mode === "twice" ? 3 : 2);
    expect(new Set(firstWrites.map(write => write.body)).size).toBe(1);
    expect(writes.every(write => JSON.parse(write.body).decision.condition === "NM")).toBe(true);
    if (mode === "conflict") {
      const originalRevision = JSON.parse(firstWrites[0].body).revision;
      expect(observed.events).toBe(3); expect(observed.candidates.map((row: any) => row.revision).sort()).toEqual([originalRevision + 1, originalRevision + 2]);
      expect(observed.candidates.some((row: any) => row.review.condition === "LP")).toBe(true);
      await expect(bulk.getByRole("alert")).toContainText("Capture card changed");
      await expect(bulk.getByRole("button", { name: "Continue original confirmations", exact: true })).toHaveCount(0);
    } else {
      expect(observed.events).toBe(2);
      const expectedRevisions = photos.map(photo => JSON.parse(writes.find(write => write.photoId === photo)!.body).revision + 1).sort();
      expect(observed.candidates.map((row: any) => row.revision).sort()).toEqual(expectedRevisions);
      expect(observed.candidates.every((row: any) => row.review.condition === "NM")).toBe(true);
      await expect(bulk.getByRole("button", { name: "Back to card list", exact: true })).toHaveCount(0);
      const inventory = page.getByRole("region", { name: "Add reviewed cards to Inventory", exact: true });
      await expect(inventory).toBeVisible(); await expect(inventory).toContainText("2 selected");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/bulk-recovery-${mode}-${width}.png` });
    expect(errors).toEqual([]);
  } finally {
    closing = true;
    try { await page.unrouteAll({ behavior: "ignoreErrors" }); await page.close(); await Promise.allSettled(presentations.values()); }
    finally {
      database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}
        await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});
        for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:printingId}});
        const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Fixture storage unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned original');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`.replace("printingId", JSON.stringify(printing.id)));
    }
  }
});
