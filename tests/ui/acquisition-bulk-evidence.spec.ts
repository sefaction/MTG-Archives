import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";

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
      (error, stdout) => error ? reject(new Error("Owned proposal signing failed")) : resolve(stdout));
    child.stdin?.on("error", () => child.kill());
    child.stdin?.end(`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());`);
  });
}

for (const width of [1366, 320]) test(`bulk review retains the selected preview identity at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local controlled proposals; no recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  await page.setViewportSize({ width, height: 900 });
  const tag = `ui-bulk-evidence-${randomUUID()}`, password = randomUUID();
  const original = { id: `${tag}-original`, name: "Bulk original proposal", setCode: "tst", collectorNumber: "1",
    lang: "en", imageUri: "/fixture-bulk-original.svg", finishes: ["nonfoil"] };
  const alternate = { ...original, id: `${tag}-alternate`, name: "Bulk replacement proposal", collectorNumber: "2", imageUri: "/fixture-bulk-alternate.svg" };
  let batch = "", replacement = false, closing = false;
  const photos: string[] = [], presentations = new Map<string, Promise<string>>();
  const displayed = new Map<string, string>(), writes: Array<{ photoId: string; evidenceTokens?: { current?: string; displayed: string[] } }> = [];
  const pageErrors: string[] = []; page.on("pageerror", error => pageErrors.push(error.message));
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[{name:'A',capacity:3}]}}});for(const card of ${JSON.stringify([original, alternate])})await p.card.create({data:{...card,scryfallId:require('crypto').randomUUID(),typeLine:'Land',rarity:'common'}});await p.$transaction(tx=>require('./lib/acquisition-correction-library.ts').ensureCorrectionAccount(tx,n));await p.correctionLibraryAccount.update({where:{ownerPlayerId:n},data:{sampleBasisPoints:0}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", { headers: { origin: baseURL! }, data: { requestKey: randomUUID(), locationId: tag, section: "A", quantity: 3 } });
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    for (let index = 0; index < 3; index++) {
      if (index === 2) database(`await p.correctionLibraryAccount.update({where:{ownerPlayerId:${JSON.stringify(tag)}},data:{sampleBasisPoints:10000}});`);
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! }, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, {
        headers: { origin: baseURL!, "content-type": "image/jpeg" }, data: bytes,
      }); expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    }
    database(`await p.correctionLibraryAccount.update({where:{ownerPlayerId:${JSON.stringify(tag)}},data:{sampleBasisPoints:0}});`);
    await page.route("**/fixture-bulk-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#557755"/></svg>' }));
    const endpoint = `/api/acquisition/${batch}/review`;
    await page.route(`**${endpoint}?*`, async route => {
      const url = new URL(route.request().url()), photoId = url.searchParams.get("photoId");
      if (!photoId) return route.continue();
      const response = await route.fetch(); expect(response.ok()).toBe(true); const record = await response.json();
      if (closing) return route.abort();
      const printing = replacement && photoId === photos[0] ? alternate : original;
      let token: string | undefined;
      if (photoId !== photos[1]) {
        const key = JSON.stringify([photoId, record.revision, printing.id]);
        let signing = presentations.get(key);
        if (!signing) {
          // The server signs this controlled presentation using its real owner,
          // original, candidate and jobs. Save-time evidence stays server-resolved.
          signing = databaseAsync(`const n=${JSON.stringify(tag)};const photo=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photoId)}}});const candidate=await p.acquisitionCandidate.findFirstOrThrow({where:{physicalId:photo.slotId}});const jobs=await p.acquisitionProcessingJob.findMany({where:{runId:photo.runId,candidateId:candidate.id,artifact:{sourceId:photo.id}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:32});console.log(await p.$transaction(tx=>require('./lib/acquisition-correction-library.ts').correctionDisplayToken(tx,n,{userId:n,adminMode:false},photo,{id:candidate.id,revision:${record.revision}},jobs,[${JSON.stringify(printing)}],'PENDING')));`).then(value => value.trim());
          presentations.set(key, signing);
        }
        token = await signing; displayed.set(photoId, token);
      }
      if (closing) return route.abort();
      await route.fulfill({ json: { ...record, evidenceToken: token, suggestions: [{ printing, reasons: ["Controlled bulk presentation"] }] } });
    });
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      writes.push(route.request().postDataJSON());
      const response = await route.fetch(); expect(response.ok()).toBe(true); await route.fulfill({ response });
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    const bulk = page.getByRole("region", { name: "Bulk match review", exact: true });
    await bulk.getByRole("button", { name: "Bulk Confirm Match", exact: true }).click();
    await expect(bulk.getByRole("button", { name: "Confirm 3 selected matches", exact: true })).toBeEnabled();
    const oldToken = displayed.get(photos[0]); expect(oldToken).toBeTruthy();
    // Exercise the existing explicit-choice fence, rather than treating the
    // default selection as an explicit operator approval.
    const initial = bulk.getByRole("checkbox", { name: `Card 1: ${original.name}`, exact: true });
    await initial.uncheck(); await initial.check();
    replacement = true;
    await bulk.getByRole("button", { name: "Reload proposals", exact: true }).click();
    const changed = bulk.getByRole("checkbox", { name: `Card 1: ${alternate.name}`, exact: true });
    await expect(changed).not.toBeChecked(); await changed.check();
    await expect(bulk.getByRole("button", { name: "Confirm 3 selected matches", exact: true })).toBeEnabled();
    const selectedTokens = new Map(displayed); expect(selectedTokens.get(photos[0])).not.toBe(oldToken);
    for (const picture of [bulk.getByRole("img", { name: "Scan of card 1", exact: true }),
      bulk.getByRole("img", { name: `Proposed ${alternate.name}`, exact: true })]) {
      await picture.scrollIntoViewIfNeeded();
      await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await changed.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/bulk-evidence-preview-${width}.png` });
    await bulk.getByRole("button", { name: "Confirm 3 selected matches", exact: true }).click();
    await expect(bulk.getByRole("button", { name: "Back to card list", exact: true })).toHaveCount(0);
    const observed = JSON.parse(database(`const n=${JSON.stringify(tag)};const ids=${JSON.stringify(photos)};console.log(JSON.stringify({events:await p.correctionReviewEvent.findMany({where:{ownerPlayerId:n},select:{sourcePhotoId:true,classification:true,payload:true}}),examples:await p.correctionExample.findMany({where:{ownerPlayerId:n},select:{sourcePhotoId:true,labelState:true}}),controls:await p.acquisitionPhoto.findMany({where:{id:{in:ids}},select:{id:true,correctionControl:true}}),reviews:await p.acquisitionCandidate.count({where:{run:{sessionId:${JSON.stringify(batch)}},review:{not:require('@prisma/client').Prisma.DbNull}}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:n}}),commits:await p.acquisitionCommit.count({where:{run:{sessionId:${JSON.stringify(batch)}}}})}));`));
    console.log("Owned bulk evidence result:", JSON.stringify({ classifications: photos.map(id => observed.events.find((event: any) => event.sourcePhotoId === id)?.classification), examples: observed.examples.length, reviews: observed.reviews, inventory: observed.inventory, commits: observed.commits }));
    expect(observed.reviews).toBe(3); expect(observed.inventory).toBe(0); expect(observed.commits).toBe(0); expect(writes).toHaveLength(3);
    for (const [index, card] of [[0, alternate], [2, original]] as const) {
      const event = observed.events.find((event: any) => event.sourcePhotoId === photos[index]);
      expect(event.classification).toBe("FIRST_CHOICE_AGREEMENT");
      expect(event.payload.displayKnown).toBe(true); expect(event.payload.firstDisplayedSuggestion.id).toBe(card.id);
      expect(event.payload.missing).not.toContain("DISPLAY_IDENTITY_UNKNOWN"); expect(event.payload.independentVerification).toBe("UNVERIFIED");
      expect(writes.find(write => write.photoId === photos[index])?.evidenceTokens).toEqual({ current: selectedTokens.get(photos[index]), displayed: [selectedTokens.get(photos[index])] });
    }
    expect(observed.examples.some((example: any) => example.sourcePhotoId === photos[0])).toBe(false);
    const missing = observed.events.find((event: any) => event.sourcePhotoId === photos[1]);
    expect(missing.classification).toBe("DISPLAY_IDENTITY_UNKNOWN"); expect(missing.payload.displayKnown).toBe(false);
    expect(missing.payload.missing).toContain("DISPLAY_IDENTITY_UNKNOWN");
    expect(writes.find(write => write.photoId === photos[1])?.evidenceTokens).toBeUndefined();
    expect(observed.examples.map((example: any) => example.sourcePhotoId).sort()).toEqual([photos[1], photos[2]].sort());
    expect(observed.examples.every((example: any) => example.labelState === "UNVERIFIED")).toBe(true);
    expect(observed.controls.find((photo: any) => photo.id === photos[0]).correctionControl).toBe(false);
    expect(observed.controls.find((photo: any) => photo.id === photos[2]).correctionControl).toBe(true);
    await page.screenshot({ path: `test-results/bulk-evidence-saved-${width}.png` });
    expect(pageErrors).toEqual([]);
  } finally {
    closing = true;
    try {
      // A failing assertion must not wait forever for a polling request whose
      // controlled reply was suppressed during teardown.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.close();
      await Promise.allSettled(presentations.values());
    }
    finally {
      database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
        ${cleanupCorrectionFixture}
        await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});
        for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
        await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:{in:${JSON.stringify([original.id, alternate.id])}}}});
        const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Fixture storage unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned original');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
    }
  }
});
