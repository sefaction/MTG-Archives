import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
  });
}

for (const width of [1366, 390]) test(`scan preview survives leaving the viewport at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local image fixture; no scanner or recognition qualification");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript(() => {
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          for (const entry of entries) {
            if (options?.rootMargin === "500px" && entry.target.querySelector("canvas"))
              entry.target.setAttribute("data-fixture-scan-active", String(entry.isIntersecting));
          }
          callback(entries, observer);
        }, options);
      }
    };
  });
  const tag = `ui-scan-retention-${randomUUID()}`, password = randomUUID();
  let batch = "", photo = "", requests = 0, reviewRequests = 0, rejectPhoto = false;
  let releaseImage: () => void = () => {};
  const firstImage = new Promise<void>(resolve => { releaseImage = resolve; });
  const evidence = {
    geometry: { status: "PROPOSED", method: "declared-card-scan", quad: [[0,0],[300,0],[300,420],[0,420]] },
    observations: [], rotation: 0, identifiers: { setCodes: [], collectors: [], languages: [] },
    readingZones: { title: { top: 0, bottom: 200 }, footer: { top: 1100, bottom: 1397 } },
    printing: null, imageMatches: null, photoText: null,
  };
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[{name:'A',capacity:1}]}}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", { headers: { origin: baseURL! }, data: { requestKey: randomUUID(), locationId: tag, section: "A", quantity: 1 } });
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! }, data: { action: "reserve", requestKey: randomUUID() } });
    expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, { headers: { origin: baseURL!, "content-type": "image/jpeg" }, data: bytes });
    expect(uploaded.ok()).toBe(true); photo = (await uploaded.json()).id;
    database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    await page.route(`**/api/acquisition/${batch}/review?*`, async route => {
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      const record = await response.json(); reviewRequests++;
      await route.fulfill({ json: { ...record, evidence, recognitionStatus: "NO_MATCH", visualStatus: "COMPLETE", printingStatus: "COMPLETE" } });
    });
    await page.route(`**/api/acquisition/${batch}/photos/${photo}`, async route => {
      requests++;
      if (width === 390 && requests === 1) await firstImage;
      if (rejectPhoto) await route.fulfill({ status: 503, body: "Temporary fixture image outage" });
      else await route.continue();
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    const card = page.getByTestId("capture-card-1"); await card.scrollIntoViewIfNeeded();
    const canvas = card.locator("canvas");
    const pixels = () => canvas.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height, pixels: Array.from(element.getContext("2d")!.getImageData(100,100,1,1).data), rendered: element.toDataURL() }));
    // Give the real viewport observer room to deactivate this row.
    await page.evaluate(() => { const spacer = document.createElement("div"); spacer.id = "fixture-scroll-space"; spacer.style.height = "4000px"; document.querySelector("main")!.append(spacer); });
    await expect.poll(() => requests).toBeGreaterThan(0);
    if (width === 390) {
      // A first download must complete even if scrolling hides the row mid-load.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => card.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(-500);
      await expect(card.locator('[data-fixture-scan-active="false"]')).toHaveCount(1);
      releaseImage();
    }
    await expect.poll(async () => (await pixels()).pixels[3]).toBe(255);
    await card.scrollIntoViewIfNeeded();
    const original = await pixels(), loadedRequests = requests;
    expect(loadedRequests).toBe(1);
    rejectPhoto = true;
    for (let pass = 0; pass < 3; pass++) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => card.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(-500);
      await expect(card.locator('[data-fixture-scan-active="false"]')).toHaveCount(1);
      await expect(canvas).toHaveCount(1);
      expect(await pixels()).toEqual(original);
      const previousReviews = reviewRequests;
      await card.scrollIntoViewIfNeeded();
      // Returning to the row fetches a fresh review object with identical evidence.
      await expect.poll(() => reviewRequests).toBeGreaterThan(previousReviews);
      await expect(canvas).toBeVisible();
      await expect.poll(pixels).toEqual(original);
      expect(requests).toBe(loadedRequests);
    }
    rejectPhoto = false;
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: "Original", exact: true }).click();
    await expect(canvas).toHaveAttribute("aria-label", "Original scan 1");
    await expect.poll(async () => (await pixels()).width).toBe(300);
    // A real view change reloads; a failed load has an explicit recoverable retry.
    rejectPhoto = true;
    await card.getByRole("button", { name: "Reading zones", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("Photo could not be loaded");
    rejectPhoto = false;
    await card.getByRole("button", { name: "Retry scan image", exact: true }).click();
    await expect.poll(async () => (await pixels()).width).toBe(400);
    await expect(card.getByRole("alert")).toHaveCount(0);
    const zones = await pixels(), zoneRequests = requests, previousReviews = reviewRequests;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(card.locator('[data-fixture-scan-active="false"]')).toHaveCount(1);
    expect(await pixels()).toEqual(zones);
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => reviewRequests).toBeGreaterThan(previousReviews);
    await expect(canvas).toBeVisible();
    expect(await pixels()).toEqual(zones);
    expect(requests).toBe(zoneRequests);
    await page.screenshot({ path: `test-results/scan-retention-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    releaseImage();
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');
      for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});
