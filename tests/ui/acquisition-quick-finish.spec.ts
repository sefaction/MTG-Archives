import { cleanupCorrectionFixture } from "./correction-fixture";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

for (const width of [1366, 390]) test(`direct finish buttons preserve review authority at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local printing fixtures; no recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(120000);
  await page.setViewportSize({ width, height: 900 });
  const tag = `ui-quick-finish-${randomUUID()}`, password = randomUUID();
  const printings = [
    { id: `${tag}-dual`, name: "Fixture dual finish", finishes: ["nonfoil", "foil"] },
    { id: `${tag}-foil`, name: "Fixture foil only", finishes: ["foil"] },
    { id: `${tag}-etched`, name: "Fixture etched only", finishes: ["etched"] },
    { id: `${tag}-unknown`, name: "Fixture unknown availability", finishes: [] },
  ].map((card, index) => ({ ...card, setCode: "tst", collectorNumber: String(index + 1),
    lang: "en", imageUri: "/fixture-finish.svg" }));
  const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).png().toBuffer();
  const digest = createHash("sha256").update(bytes).digest("hex");
  let batch = "", refreshes = 0; const photos: string[] = [];
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});for(const card of ${JSON.stringify(printings)})await p.card.create({data:{...card,scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", { headers: { origin: baseURL! },
      data: { requestKey: randomUUID(), locationId: tag, section: "", quantity: 4 } });
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    for (let index = 0; index < 4; index++) {
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! }, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`,
        { headers: { origin: baseURL!, "content-type": "image/png" }, data: bytes });
      expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    }
    await page.route("**/fixture-finish.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#557799"/></svg>' }));
    const endpoint = `/api/acquisition/${batch}/review`;
    await page.route(`**${endpoint}?*`, async route => {
      const response = await route.fetch(); expect(response.ok()).toBe(true); const record = await response.json(); refreshes++;
      const printing = printings[photos.indexOf(record.photoId)];
      await route.fulfill({ json: { ...record, recognitionStatus: "PENDING", visualStatus: "RUNNING",
        printingStatus: "RUNNING", suggestions: [{ printing, reasons: ["Controlled UI fixture"] }] } });
    });
    const read = async () => (await (await page.request.get(`${endpoint}?photoId=${photos[0]}`)).json()).review;
    const inventory = () => Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`));
    await page.goto(`/imports/scan?batch=${batch}`);
    const card = page.getByTestId("capture-card-1"); await card.scrollIntoViewIfNeeded();
    const choices = card.getByRole("group", { name: "Card finish choices", exact: true });
    const foil = choices.getByRole("button", { name: "Foil", exact: true });
    const nonfoil = choices.getByRole("button", { name: "Nonfoil", exact: true });
    await expect(nonfoil).toHaveAttribute("aria-pressed", "true");
    await expect(foil).toBeEnabled(); await expect(card.getByLabel("Card name", { exact: true })).toHaveCount(0);
    await foil.click();
    await expect(foil).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByLabel("Card name", { exact: true })).toHaveCount(0);
    await expect(card.getByRole("combobox", { name: "Card finish", exact: true })).toHaveCount(0);
    expect(await read()).toBeNull(); expect(inventory()).toBe(0);
    await page.screenshot({ path: `test-results/quick-finish-draft-${width}.png` });
    const before = refreshes; await expect.poll(() => refreshes, { timeout: 12000 }).toBeGreaterThan(before);
    await expect(foil).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Save card review", exact: true }).click();
    await expect(card).toContainText("Review saved. Not yet added to Inventory.");
    expect(await read()).toMatchObject({ cardId: printings[0].id, finish: "FOIL", condition: "NM", language: "en" });
    expect(inventory()).toBe(0);
    // Saved reviews remain unchanged until another explicit save; cancellation
    // restores the saved finish without opening the correction menu.
    await nonfoil.click(); expect((await read()).finish).toBe("FOIL");
    await expect(card.getByLabel("Card name", { exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await expect(foil).toHaveAttribute("aria-pressed", "true");
    await nonfoil.click(); await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(nonfoil).toHaveAttribute("aria-pressed", "true");
    await expect(card).toContainText("Unsaved correction restored from this browser");
    expect((await read()).finish).toBe("FOIL");
    await card.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await page.getByRole("button", { name: "Advanced", exact: true }).click(); await card.scrollIntoViewIfNeeded();
    await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("LP");
    await nonfoil.click();
    await expect(card.getByRole("combobox", { name: "Card finish", exact: true })).toHaveValue("NONFOIL");
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    await card.getByRole("button", { name: "Save card review", exact: true }).click();
    await expect(card).toContainText("Review saved. Not yet added to Inventory.");
    expect(await read()).toMatchObject({ finish: "NONFOIL", condition: "LP" });
    await page.getByRole("button", { name: "Simple", exact: true }).click();
    for (const [position, state] of [[2, "FOIL"], [3, "ETCHED"], [4, "NONFOIL"]] as const) {
      const row = page.getByTestId(`capture-card-${position}`); await row.scrollIntoViewIfNeeded();
      const group = row.getByRole("group", { name: "Card finish choices", exact: true });
      if (state === "FOIL") {
        await expect(group.getByRole("button", { name: "Nonfoil", exact: true })).toBeDisabled();
        await expect(group.getByRole("button", { name: "Foil", exact: true })).toHaveAttribute("aria-pressed", "true");
      } else if (state === "ETCHED") {
        await expect(group.getByRole("button", { name: "Nonfoil", exact: true })).toBeDisabled();
        await expect(group.getByRole("button", { name: "Foil", exact: true })).toBeDisabled();
        await expect(row).toContainText("etched");
      } else {
        await expect(group.getByRole("button", { name: "Nonfoil", exact: true })).toBeEnabled();
        await expect(group.getByRole("button", { name: "Foil", exact: true })).toBeEnabled();
      }
    }
    expect(inventory()).toBe(0);
    const raw = await page.request.get(`/api/acquisition/${batch}/photos/${photos[0]}`);
    expect(createHash("sha256").update(await raw.body()).digest("hex")).toBe(digest);
    // Commit only this owned fixture through the real explicit preview/commit
    // path, then verify that quick controls cannot mutate committed Inventory.
    const latest = await (await page.request.get(`/api/acquisition/${batch}`)).json();
    if (latest.phase === "CAPTURING") {
      const stopped = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! },
        data: { action: "control", revision: latest.revision, command: "STOP", requestKey: randomUUID() } });
      expect(stopped.ok()).toBe(true);
    }
    const selection = { photoIds: [photos[0]], locationId: tag, section: "" };
    const preview = await page.request.post(`/api/acquisition/${batch}/commit`, { headers: { origin: baseURL! }, data: { action: "preview", ...selection } });
    expect(preview.ok()).toBe(true); const token = (await preview.json()).token;
    const committed = await page.request.post(`/api/acquisition/${batch}/commit`, { headers: { origin: baseURL! },
      data: { action: "commit", ...selection, requestKey: randomUUID(), previewToken: token, overfillReason: null } });
    expect(committed.ok()).toBe(true); expect(inventory()).toBe(1);
    await page.reload(); await card.scrollIntoViewIfNeeded(); await expect(card).toContainText("Added to Inventory");
    await expect(choices).toHaveCount(0); await expect(card.getByRole("button", { name: "Save card review", exact: true })).toHaveCount(0);
    expect((await read()).finish).toBe("NONFOIL"); expect(inventory()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/quick-finish-${width}.png` });
  } finally {
    try { if (!page.isClosed()) { await page.unrouteAll({ behavior: "wait" }); await page.goto("/dashboard"); } } catch { console.log("Browser cleanup unavailable; owned database cleanup still runs"); }
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const runs=await p.acquisitionRun.findMany({where:{session:{createdByUserId:n}},select:{id:true}});const w={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      ${cleanupCorrectionFixture}
      for(const model of ['acquisitionCommitMember','acquisitionCommit','acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:{in:${JSON.stringify(printings.map(p=>p.id))}}}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});