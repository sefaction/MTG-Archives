import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], { windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());` });
}

test("fast printing correction keeps drafts, metadata and destination while results update", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local fixtures; controlled suggestions, no recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag = `ui-fast-corrections-${randomUUID()}`, password = randomUUID();
  const original = { id: `${tag}-original`, name: "Fixture original printing", setCode: "tst", collectorNumber: "1",
    lang: "en", imageUri: "/fixture-card-original.svg", finishes: ["nonfoil", "foil"] };
  const alternate = { ...original, id: `${tag}-alternate`, name: "Fixture corrected printing", collectorNumber: "2",
    imageUri: "/fixture-card-alternate.svg", finishes: ["foil"] };
  let batch = "", reverse = false, refreshes = 0;
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[{name:'A',capacity:3}]}}});for(const card of ${JSON.stringify([original, alternate])})await p.card.create({data:{...card,scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", { headers: { origin: baseURL! }, data: {
      requestKey: randomUUID(), locationId: tag, section: "A", quantity: 3,
    } }); expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    const photos: string[] = [];
    for (let index = 0; index < 3; index++) {
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! }, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, {
        headers: { origin: baseURL!, "content-type": "image/jpeg" }, data: bytes,
      }); expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      // Deliberate presentation fixture: skip expensive recognition. Real saved
      // originals, revisions, reviews and destination remain authoritative.
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    }
    const reviewEndpoint = `/api/acquisition/${batch}/review`;
    const middle = await (await page.request.get(`${reviewEndpoint}?photoId=${photos[1]}`)).json();
    expect((await page.request.post(reviewEndpoint, { headers: { origin: baseURL! }, data: { action: "accept", photoId: photos[1], revision: middle.revision,
      decision: { cardId: original.id, finish: "NONFOIL", condition: "NM", language: "en" } } })).ok()).toBe(true);
    await page.route("**/fixture-card-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#557799"/></svg>' }));
    await page.route(`**${reviewEndpoint}?*`, async route => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has("photoId")) {
        // Search result is controlled; persistence still uses the real catalog.
        expect(url.searchParams.get("query")).toBe(alternate.name);
        return route.fulfill({ json: [alternate] });
      }
      const response = await route.fetch(); expect(response.ok()).toBe(true); const record = await response.json();
      refreshes++;
      await route.fulfill({ json: { ...record, recognitionStatus: "PENDING", visualStatus: "RUNNING",
        printingStatus: "RUNNING", suggestions: (reverse ? [alternate, original] : [original, alternate]).map(printing => ({ printing, reasons: ["Controlled UI fixture"] })) } });
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    const card = page.getByTestId("capture-card-1"); await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: "Correct", exact: true }).click();
    const name = card.getByLabel("Card name", { exact: true });
    await expect(name).toBeFocused(); await expect(name).toHaveValue(original.name);
    await name.fill(alternate.name); await name.press("Enter");
    const choice = card.getByRole("radio", { name: /Fixture corrected printing/ }); await choice.check();
    await expect(card.getByRole("combobox", { name: "Card finish", exact: true })).toHaveValue("FOIL");
    await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("LP");
    const beforeRefresh = refreshes; reverse = true;
    await expect.poll(() => refreshes, { timeout: 12000 }).toBeGreaterThan(beforeRefresh);
    await expect(choice).toBeChecked(); await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    await page.getByRole("combobox", { name: "Show cards", exact: true }).selectOption("ready");
    await expect(card).toBeVisible(); await expect(name).toHaveValue(alternate.name);
    await page.getByRole("combobox", { name: "Show cards", exact: true }).selectOption("all");
    await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    await expect(name).toHaveValue(alternate.name);
    await expect(card).toContainText("Unsaved correction restored from this browser");
    await page.goto("/dashboard"); await page.goto(`/imports/scan?batch=${batch}`); await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 }); await card.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 1366) {
        const editor = await card.getByRole("group", { name: "Search results", exact: true }).boundingBox();
        const printing = await card.getByRole("figure", { name: "Proposed printing", exact: true }).boundingBox();
        expect(editor!.x).toBeGreaterThanOrEqual(printing!.x + printing!.width);
      }
      await page.screenshot({ path: `test-results/acquisition-fast-corrections-${width}.png` });
    }
    await name.focus(); await name.press("Control+Shift+Enter");
    await expect(page.getByTestId("capture-card-3")).toBeFocused();
    const saved = await (await page.request.get(`${reviewEndpoint}?photoId=${photos[0]}`)).json();
    expect(saved.review).toMatchObject({ cardId: alternate.id, finish: "FOIL", condition: "LP", language: "en" });
    const draftKey = `mtg-review-draft-v1:${[tag,batch,photos[0]].map(encodeURIComponent).join(":")}`;
    expect(await page.evaluate(key=>localStorage.getItem(key),draftKey)).toBeNull();
    const firstState = await (await page.request.get(`/api/acquisition/${batch}`)).json();
    expect(firstState).toMatchObject({ locationId: tag, section: "A" });
    expect(database(`console.log((await p.acquisitionSession.findUniqueOrThrow({where:{id:${JSON.stringify(batch)}}})).ownerPlayerId);`).trim()).toBe(tag);
    const metadata = JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photos[0])}},select:{inputKind:true,digest:true}})));`));
    expect(metadata.inputKind).toBe("CARD_SCAN"); expect(metadata.digest).toBe(createHash("sha256").update(bytes).digest("hex"));
    await page.reload(); await card.scrollIntoViewIfNeeded(); await expect(card).toContainText("Fixture corrected printing");
    await card.getByRole("button", { name: "Correct", exact: true }).click(); await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    await card.getByRole("button", { name: "Next awaiting review", exact: true }).click();
    await expect(page.getByTestId("capture-card-3")).toBeFocused();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("MP");
    const revision = (await (await page.request.get(`${reviewEndpoint}?photoId=${photos[0]}`)).json()).revision;
    expect((await page.request.post(reviewEndpoint, { headers: { origin: baseURL! }, data: { action: "accept", photoId: photos[0], revision,
      decision: { cardId: alternate.id, finish: "FOIL", condition: "HP", language: "en" } } })).ok()).toBe(true);
    await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("MP");
    await expect(card).toContainText("The saved review changed");
    await card.getByRole("button", { name: "Save card review", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("Stale");
    expect((await (await page.request.get(`${reviewEndpoint}?photoId=${photos[0]}`)).json()).review.condition).toBe("HP");
    await card.getByRole("button", { name: "Cancel changes", exact: true }).click();
    expect(await page.evaluate(key=>localStorage.getItem(key),draftKey)).toBeNull();
    await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: "Correct", exact: true }).click();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("HP");
    await page.evaluate(()=>{localStorage.setItem=()=>{throw new Error("Fixture quota");};});
    await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("DMG");
    await expect(card).toContainText("Save the review before leaving this page");
    await card.getByRole("button", { name: "Save card review", exact: true }).click();
    await expect(card).toContainText("Review saved. Not yet added to Inventory.");
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:{in:${JSON.stringify([original.id, alternate.id])}}}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');
      for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});
