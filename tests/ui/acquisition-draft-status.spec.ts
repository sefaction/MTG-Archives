import { expect, test, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { acquisitionDraftKey } from "../../lib/acquisition-browser-review-draft";
import { cleanupCorrectionFixture } from "./correction-fixture";

function database(body: string) {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node", "--import", "tsx"], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.code||'Owned fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
async function dirtyStatus(card: Locator) {
  await expect(card.getByTestId("scan-review-status")).toContainText("Unsaved correction");
  await expect(card.getByTestId("scan-compact-status")).toHaveText("Unsaved correction");
}

for (const width of [1366, 320]) for (const lostReply of [false, true])
test(`draft choice status ${lostReply ? "lost reply" : "normal"} at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned actual API/UI choice-state qualification; no recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000); page.setDefaultTimeout(15000);
  await page.setViewportSize({ width, height: 900 });
  const tag = `ui-draft-status-${randomUUID()}`, password = randomUUID();
  const original = { id: `${tag}-original`, name: `Draft original ${tag}`, setCode: "tst", collectorNumber: "1", lang: "en", imageUri: null, finishes: ["nonfoil", "foil"] };
  const alternative = { ...original, id: `${tag}-alternative`, name: `Draft alternative ${tag}`, collectorNumber: "2" };
  let batch = "", photo = "", abortNextSave = false, interruptedSaves = 0;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[{name:'A',capacity:2}]}}});for(const card of ${JSON.stringify([original, alternative])})await p.card.create({data:{...card,scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});console.log('{}');`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const headers = { origin: baseURL! };
    const created = await page.request.post("/api/acquisition", { headers, data: { requestKey: randomUUID(), locationId: tag, section: "A", quantity: 1 } });
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers, data: { action: "reserve", requestKey: randomUUID() } });
    expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, {
      headers: { ...headers, "content-type": "image/jpeg" }, data: bytes,
    }); expect(uploaded.ok()).toBe(true); photo = (await uploaded.json()).id;
    database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});console.log('{}');`);
    const endpoint = `/api/acquisition/${batch}/review`;
    const record = await (await page.request.get(`${endpoint}?photoId=${photo}`)).json();
    expect((await page.request.post(endpoint, { headers, data: { action: "accept", photoId: photo, revision: record.revision,
      decision: { cardId: original.id, finish: "NONFOIL", condition: "NM", language: "en" }, evidenceTokens: { current: record.evidenceToken } } })).ok()).toBe(true);
    const savedState = async () => {
      const value = await (await page.request.get(`${endpoint}?photoId=${photo}`)).json();
      return { revision: value.revision, cardId: value.review.cardId, finish: value.review.finish, condition: value.review.condition, language: value.review.language };
    };
    const before = await savedState(); expect(before).toMatchObject({ cardId: original.id, condition: "NM", finish: "NONFOIL" });
    const inventoryCount = () => database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`);
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== "POST" || !abortNextSave) return route.continue();
      abortNextSave = false;
      const response = await route.fetch(); expect(response.ok()).toBe(true); interruptedSaves++;
      await route.abort("failed");
    });
    await page.goto(`/imports/scan?batch=${batch}`); await page.getByRole("button", { name: "Simple", exact: true }).click();
    const card = page.getByTestId("capture-card-1"); await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("scan-compact-status")).toHaveText("Review saved");
    await card.getByRole("button", { name: "Correct", exact: true }).click();
    await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("LP");
    expect(await savedState()).toEqual(before); expect(inventoryCount()).toBe(0);
    console.log("Saved vs displayed baseline:", JSON.stringify({ width, saved: "NM", displayed: "LP", revisionUnchanged: true,
      header: await card.getByTestId("scan-review-status").innerText(), choiceStatus: await card.getByTestId("scan-compact-status").innerText() }));
    await card.getByTestId("scan-compact-status").scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("condition-edit.png") });
    await dirtyStatus(card);
    await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    await dirtyStatus(card); expect(await savedState()).toEqual(before);
    await card.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await expect(card.getByTestId("scan-compact-status")).toHaveText("Review saved"); expect(await savedState()).toEqual(before);
    await card.getByRole("button", { name: "Correct", exact: true }).click();
    await card.getByLabel("Card name", { exact: true }).fill(alternative.name);
    await card.getByRole("button", { name: "Find printing", exact: true }).click();
    await card.getByRole("radio", { name: `${alternative.name} · TST #2 (en)`, exact: true }).check();
    await dirtyStatus(card); expect(await savedState()).toEqual(before);
    await card.getByRole("combobox", { name: "Card finish", exact: true }).selectOption("FOIL");
    await dirtyStatus(card); expect(await savedState()).toEqual(before);
    await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("HP");
    await dirtyStatus(card); expect(await savedState()).toEqual(before);
    const key = acquisitionDraftKey({ userId: tag, batchId: batch, photoId: photo });
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) !== null, key)).toBe(true);
    const obsoleteDraft = await page.evaluate(key => localStorage.getItem(key), key);
    abortNextSave = lostReply;
    if (width === 320) await page.keyboard.press("Control+Enter");
    else await card.getByRole("button", { name: "Save card review", exact: true }).click();
    if (lostReply) {
      await expect(card.getByRole("alert")).toBeVisible(); await dirtyStatus(card);
      expect(interruptedSaves).toBe(1);
      expect(await savedState()).toMatchObject({ cardId: alternative.id, finish: "FOIL", condition: "HP", revision: before.revision + 1 });
      await card.getByRole("button", { name: "Save card review", exact: true }).click();
    }
    await expect(card.getByTestId("scan-compact-status")).toHaveText("Review saved");
    await expect(card.getByTestId("scan-review-status")).toContainText("Reviewed");
    expect(await savedState()).toMatchObject({ cardId: alternative.id, finish: "FOIL", condition: "HP", revision: before.revision + 1 });
    expect(inventoryCount()).toBe(0);
    const events = database(`console.log(await p.correctionReviewEvent.count({where:{ownerPlayerId:${JSON.stringify(tag)}}}));`);
    expect(events).toBe(2);
    await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("scan-compact-status")).toHaveText("Review saved");
    if (!lostReply) {
      await card.getByRole("button", { name: "Continue to Inventory", exact: true }).click();
      const inventory = page.getByRole("region", { name: "Add reviewed cards to Inventory", exact: true });
      if (await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).isDisabled()) {
        await inventory.getByRole("link", { name: "Go to capture controls", exact: true }).click();
        await page.getByRole("button", { name: "Stop capture", exact: true }).click();
        await card.getByRole("button", { name: "Continue to Inventory", exact: true }).click();
      }
      await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).click();
      const confirmation = inventory.getByLabel("Confirm Inventory addition", { exact: true });
      await confirmation.getByRole("button", { name: "Add 1 copy to Inventory", exact: true }).click();
      await expect(inventory).toContainText("Added 1 copy to Inventory."); expect(inventoryCount()).toBe(1);
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value!), { key, value: obsoleteDraft });
      await page.reload(); await card.scrollIntoViewIfNeeded();
      await expect(card.getByTestId("scan-review-status")).toHaveText("Added to Inventory");
      await expect(card.getByTestId("scan-compact-status")).toHaveText("Added to Inventory");
      await expect(card.getByRole("button", { name: "Save card review", exact: true })).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
    const hash = database(`const row=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photo)}}});const fs=require('fs/promises'),paths=require('path');console.log(JSON.stringify({stored:row.digest,actual:require('crypto').createHash('sha256').update(await fs.readFile(paths.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',row.id+'.original'))).digest('hex')}));`);
    expect(hash).toEqual({ stored: createHash("sha256").update(bytes).digest("hex"), actual: createHash("sha256").update(bytes).digest("hex") });
    await page.screenshot({ path: test.info().outputPath("final-status.png") });
  } finally {
    try { await page.unrouteAll({ behavior: "wait" }); await page.close(); }
    finally {
      database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:{in:${JSON.stringify([original.id, alternative.id])}}}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Owned storage unavailable');for(const row of photos){if(!/^[a-f0-9-]{36}$/.test(row.id))throw Error('Invalid owned original');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',row.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e});}console.log('{}');`);
    }
  }
});
