import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

test("three successive saved-scan batches reach recognition and survive refresh", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1" || process.env.MTG_ACQUISITION_NATIVE_BATCH_TEST !== "1",
    "Requires explicit local native-worker opt-in; no physical scanner or accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(300000);
  const tag = `ui-successive-${randomUUID()}`, password = randomUUID();
  // Representative immutable image intake; native processing is real. Blank
  // inputs deliberately make no claim about printing identification accuracy.
  const bytes = await sharp({ create: { width: 420, height: 600, channels: 3,
    background: "#dddddd" } }).png().toBuffer();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const batches: string[] = [];
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    for (let n = 0; n < 3; n++) {
      const started = Date.now();
      await page.goto("/imports/scan");
      await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: "Start batch", exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("batch")).toBeTruthy();
      const batch = new URL(page.url()).searchParams.get("batch")!;
      expect(batch).toBeTruthy(); expect(batches).not.toContain(batch); batches.push(batch);
      await page.getByRole("combobox", { name: "Library image type" }).selectOption("CARD_SCAN");
      await page.getByLabel("Choose card photos").setInputFiles({ name: `scan-${n}.png`, mimeType: "image/png", buffer: bytes });
      await expect(page.getByRole("heading", { name: /1 cards$/ })).toBeVisible();
      await page.reload();
      const scope = `run:{sessionId:${JSON.stringify(batch)}}`;
      await expect.poll(() => Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{${scope},stage:'photo-recognition-v1',status:'COMPLETE'}}));`)),
        { timeout: 80000, intervals: [1000,3000,5000] }).toBe(1);
      const native = JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{${scope},stage:'photo-recognition-v1',status:'COMPLETE'},select:{output:true}});console.log(JSON.stringify(job.output.native));`));
      expect(native.photoDigest).toBe(digest);
      console.log(JSON.stringify({ batch: n + 1, nativeCompleteMs: Date.now() - started }));
      const state = await (await page.request.get(`/api/acquisition/${batch}`)).json();
      expect(state.slots).toHaveLength(1); expect(state.slots[0].photos).toHaveLength(1);
      const photo = state.slots[0].photos[0]; expect(photo.digest).toBe(digest);
      const raw = await page.request.get(`/api/acquisition/${batch}/photos/${photo.id}`);
      expect(raw.ok()).toBe(true);
      expect(createHash("sha256").update(await raw.body()).digest("hex")).toBe(digest);
      const review = await (await page.request.get(`/api/acquisition/${batch}/review?photoId=${photo.id}`)).json();
      // The review status can remain PENDING while catalog/printing work follows
      // the completed native stage. The real worker claim is asserted above.
      expect(review.photoId).toBe(photo.id); expect(review.review).toBeNull();
      await page.reload();
      expect(Number(database(`console.log(await p.acquisitionPhoto.count({where:{${scope}}}));`))).toBe(1);
      expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
      // Stop intake explicitly through the normal application command; processing
      // is complete, but there is no review acceptance or Inventory commit.
      const latest = await (await page.request.get(`/api/acquisition/${batch}`)).json();
      expect((await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! },
        data: { action: "control", revision: latest.revision, requestKey: randomUUID(), command: "STOP" } })).ok()).toBe(true);
    }
  } finally {
    // Cancel only the owned fixtures, then let any visual/printing lease drain
    // before removing their rows and immutable files.
    database(`await p.acquisitionSession.updateMany({where:{createdByUserId:${JSON.stringify(tag)}},data:{phase:'CANCELLED'}});`);
    await expect.poll(() => Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{createdByUserId:${JSON.stringify(tag)}}},status:'RUNNING',leaseExpiresAt:{gt:new Date()}}}));`)),
      { timeout: 100000, intervals: [1000,3000,5000] }).toBe(0);
    database(`const n=${JSON.stringify(tag)};const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});