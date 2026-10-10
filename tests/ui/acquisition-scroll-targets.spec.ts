import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";
import { acquisitionDraftKey } from "../../lib/acquisition-browser-review-draft";

function database(body: string) {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node", "--import", "tsx"], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
async function clearTarget(page: Page, target: Locator, stage: string) {
  await expect(target).toBeVisible();
  // React updates and deferred jumps settle on animation frames. Keep the
  // strict geometry requirement while allowing those real frames to finish.
  await expect.poll(() => target.evaluate(element => {
    const summary = document.querySelector('[aria-label="Batch progress"]')!;
    const box = element.getBoundingClientRect();
    return box.top >= summary.getBoundingClientRect().bottom + 8 && box.top < innerHeight - 40;
  }), { message: `${stage} must land visibly below the real sticky summary` }).toBe(true);
  const bounds = await target.evaluate(element => {
    const summary = document.querySelector('[aria-label="Batch progress"]')!;
    const targetBox = element.getBoundingClientRect(), summaryBox = summary.getBoundingClientRect();
    return { targetTop: targetBox.top, summaryBottom: summaryBox.bottom, summaryHeight: summaryBox.height,
      margin: getComputedStyle(element).scrollMarginTop, width: innerWidth, height: innerHeight };
  });
  console.log("Owned scan target bounds:", JSON.stringify({ stage, ...bounds }));
  await page.screenshot({ path: test.info().outputPath(`scan-scroll-${stage}-${bounds.width}.png`) });
  expect(bounds.targetTop, `${stage} must clear the real sticky summary`).toBeGreaterThanOrEqual(bounds.summaryBottom + 8);
  expect(bounds.targetTop, `${stage} must be in the viewport`).toBeLessThan(bounds.height - 40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1366, 320]) test(`scan jumps clear changing sticky progress at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned actual API/UI layout qualification; no recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000); page.setDefaultTimeout(15000);
  await page.setViewportSize({ width, height: 900 });
  const tag = `ui-scan-scroll-${randomUUID()}`, password = randomUUID();
  const printing = { id: `${tag}-card`, name: "Scan scroll proposal", setCode: "tst", collectorNumber: "1", lang: "en", imageUri: null, finishes: ["nonfoil"] };
  let batch = "", navigation = 0, closing = false;
  const cancelled = new WeakSet<object>(), errors: string[] = [], photos: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigation++; });
  page.on("requestfailed", request => { if (request.failure()?.errorText === "net::ERR_ABORTED") cancelled.add(request); });
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:4,sections:[{name:'A',capacity:4}]}}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Land',rarity:'common'}});await p.$transaction(tx=>require('./lib/acquisition-correction-library.ts').ensureCorrectionAccount(tx,n));await p.correctionLibraryAccount.update({where:{ownerPlayerId:n},data:{sampleBasisPoints:0}});console.log('{}');`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", { headers: { origin: baseURL! }, data: { requestKey: randomUUID(), locationId: tag, section: "A", quantity: 4 } });
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    for (let index = 0; index < 4; index++) {
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! }, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, {
        headers: { origin: baseURL!, "content-type": "image/jpeg" }, data: bytes,
      }); expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});console.log('{}');`);
    }
    const endpoint = `/api/acquisition/${batch}/review`;
    const savedCounts = () => database(`const n=${JSON.stringify(tag)};console.log(JSON.stringify({inventory:await p.inventoryItem.count({where:{currentOwnerId:n}}),commits:await p.acquisitionCommit.count({where:{run:{sessionId:${JSON.stringify(batch)}}}}),reviews:await p.acquisitionCandidate.count({where:{run:{sessionId:${JSON.stringify(batch)}},review:{not:require('@prisma/client').Prisma.DbNull}}})}));`);
    const first = await (await page.request.get(`${endpoint}?photoId=${photos[0]}`)).json();
    expect((await page.request.post(endpoint, { headers: { origin: baseURL! }, data: { action: "accept", photoId: photos[0], revision: first.revision,
      decision: { cardId: printing.id, language: "en", finish: "NONFOIL", condition: "NM" } } })).ok()).toBe(true);
    await page.route(`**${endpoint}?*`, async route => {
      const epoch = navigation, request = route.request();
      try {
        const response = await route.fetch(); expect(response.ok()).toBe(true); const record = await response.json();
        if (closing || epoch !== navigation || cancelled.has(request)) return;
        await route.fulfill({ json: { ...record, suggestions: [{ printing, reasons: ["Controlled layout proposal"] }] } });
      } catch (error) { if (!closing && epoch === navigation && !cancelled.has(request)) throw error; }
    });
    await page.goto(`/imports/scan?batch=${batch}`); await page.evaluate(() => document.fonts.ready);
    const summary = page.getByRole("region", { name: "Batch progress", exact: true });
    const bulk = page.getByRole("region", { name: "Bulk match review", exact: true });
    await bulk.getByRole("button", { name: "Bulk Confirm Match", exact: true }).click();
    await expect(bulk.getByRole("button", { name: "Confirm 3 selected matches", exact: true })).toBeEnabled();
    await bulk.getByRole("checkbox", { name: /^Card 4:/ }).uncheck();
    await bulk.getByRole("button", { name: "Confirm 2 selected matches", exact: true }).click();
    const inventory = page.locator("#scan-inventory"), review = page.locator("#scan-review"), capture = page.locator("#scan-capture");
    await expect(inventory).toBeFocused();
    const atHandoff = savedCounts();
    console.log("Owned scan handoff result:", JSON.stringify(atHandoff));
    expect(atHandoff).toEqual({ inventory: 0, commits: 0, reviews: 3 });
    await clearTarget(page, inventory, "bulk-inventory");
    await inventory.getByRole("button", { name: "Back to matches", exact: true }).click();
    await clearTarget(page, review, "back-matches");
    await summary.getByRole("link", { name: "Review saved cards", exact: true }).click();
    await clearTarget(page, review, "review-link");
    const card = page.getByTestId("capture-card-1"), pending = page.getByTestId("capture-card-4");
    await card.getByRole("button", { name: "Next awaiting review", exact: true }).click();
    await expect(pending).toBeFocused(); await clearTarget(page, pending, "next-card");
    const handoff = card.getByRole("button", { name: "Continue to Inventory", exact: true });
    await handoff.focus(); await page.keyboard.press("Enter");
    await expect(inventory).toBeFocused(); await clearTarget(page, inventory, "keyboard-inventory");
    await inventory.getByRole("link", { name: "Go to capture controls", exact: true }).click();
    await clearTarget(page, capture, "capture-link");
    for (const resized of [width === 320 ? 1366 : 320, 375, width]) {
      await page.setViewportSize({ width: resized, height: 900 });
      await summary.getByRole("link", { name: /^Add 3 confirmed cards to Inventory$/ }).click();
      await clearTarget(page, inventory, "resize-inventory");
    }
    // A real blocked handoff adds a wrapping alert to the sticky summary.
    await page.setViewportSize({ width: 320, height: 900 });
    await inventory.getByRole("button", { name: "Back to matches", exact: true }).click();
    const beforeHeight = await summary.evaluate(element => element.getBoundingClientRect().height);
    await handoff.evaluate((button, key) => {
      localStorage.setItem(key, "controlled unreadable correction"); (button as HTMLButtonElement).click(); localStorage.removeItem(key);
    }, acquisitionDraftKey({ userId: tag, batchId: batch, photoId: photos[0] }));
    await expect(summary.getByRole("alert")).toContainText("Save or cancel this correction");
    expect(await summary.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(beforeHeight);
    await summary.getByRole("link", { name: "Review saved cards", exact: true }).click();
    await clearTarget(page, review, "draft-alert-summary");
    await handoff.focus(); await page.keyboard.press("Enter");
    await clearTarget(page, inventory, "grown-summary");
    await page.reload(); await summary.getByRole("link", { name: "Review saved cards", exact: true }).click();
    await card.getByRole("button", { name: "Continue to Inventory", exact: true }).click();
    await clearTarget(page, inventory, "reload-inventory");
    expect(savedCounts()).toEqual({ inventory: 0, commits: 0, reviews: 3 }); expect(errors).toEqual([]);
  } finally {
    closing = true;
    try { await page.unrouteAll({ behavior: "ignoreErrors" }); await page.close(); }
    finally {
      database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Owned storage unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned original');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e});}console.log('{}');`);
    }
  }
});
