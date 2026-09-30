import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], { windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());` });
}

test("unsaved corrections protect bulk reviews and Inventory while clean cards stay usable", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local fixtures; no hardware or recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag = `ui-draft-actions-${randomUUID()}`, password = randomUUID();
  const printing = { id: `${tag}-card`, name: "Draft protection fixture", setCode: "tst", collectorNumber: "1",
    lang: "en", imageUri: null, finishes: ["nonfoil", "foil"] };
  let batch = "";
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:20,sections:[{name:'A',capacity:20}]}}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", { headers: { origin: baseURL! }, data: { requestKey: randomUUID(), locationId: tag, section: "A", quantity: 14 } });
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    const photos: string[] = [];
    for (let index = 0; index < 14; index++) {
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers: { origin: baseURL! }, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, { headers: { origin: baseURL!, "content-type": "image/jpeg" }, data: bytes });
      expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    }
    const endpoint = `/api/acquisition/${batch}/review`;
    for (const photoId of [photos[0], photos[13]]) {
      const record = await (await page.request.get(`${endpoint}?photoId=${photoId}`)).json();
      expect((await page.request.post(endpoint, { headers: { origin: baseURL! }, data: { action: "accept", photoId, revision: record.revision,
        decision: { cardId: printing.id, finish: "NONFOIL", condition: "NM", language: "en" } } })).ok()).toBe(true);
    }
    await page.route(`**${endpoint}?*`, async route => {
      const response = await route.fetch(); const record = await response.json();
      const index = photos.indexOf(new URL(route.request().url()).searchParams.get("photoId")!);
      await route.fulfill({ json: { ...record, suggestions: index < 3 ? [{ printing, reasons: ["Controlled fixture"] }] : [] } });
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    const first = page.getByTestId("capture-card-1"); await first.scrollIntoViewIfNeeded();
    await first.getByRole("button", { name: "Correct", exact: true }).click();
    await first.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("LP");
    // Baseline defect: a saved review still offers its Inventory checkbox after editing.
    await expect(first.getByRole("checkbox", { name: "Select card 1 for Inventory", exact: true })).toBeDisabled();
    const second = page.getByTestId("capture-card-2"); await second.scrollIntoViewIfNeeded();
    await second.getByRole("button", { name: "Correct", exact: true }).click();
    await second.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("MP");
    const keyFor = (photoId: string) => `mtg-review-draft-v1:${[tag,batch,photoId].map(encodeURIComponent).join(":")}`;
    const lastRecord = await (await page.request.get(`${endpoint}?photoId=${photos[13]}`)).json();
    const draft = { version: 1, writeId: randomUUID(), revision: lastRecord.revision, selected: printing,
      finish: "NONFOIL", condition: "HP", language: "en", query: printing.name, set: "tst", number: "1" };
    // A real second tab writes an offscreen draft; the main tab receives StorageEvent.
    const other = await page.context().newPage(); await other.goto("/dashboard");
    await expect(page.getByTestId("capture-card-14")).toHaveCount(0);
    await other.evaluate(({ key, draft }) => localStorage.setItem(key,JSON.stringify(draft)), { key: keyFor(photos[13]), draft });
    await page.reload(); await first.scrollIntoViewIfNeeded();
    await expect(first).toContainText("Unsaved correction restored from this browser");
    await expect(page.getByTestId("capture-card-14")).toHaveCount(0);
    const bulk = page.getByRole("region", { name: "Bulk match review", exact: true });
    await expect(bulk).toContainText("1 card has an unsaved correction");
    await bulk.getByRole("button", { name: "Bulk Confirm Match", exact: true }).click();
    await expect(bulk.getByRole("button", { name: "Confirm 1 selected match", exact: true })).toBeEnabled();
    // Draft created after preview is open invalidates the proposal immediately.
    const thirdRecord = await (await page.request.get(`${endpoint}?photoId=${photos[2]}`)).json();
    await other.evaluate(({ key, draft }) => localStorage.setItem(key,JSON.stringify(draft)), { key: keyFor(photos[2]), draft: { ...draft, revision: thirdRecord.revision } });
    await expect(bulk.getByRole("button", { name: "Confirm 0 selected matches", exact: true })).toBeDisabled();
    await other.evaluate(key => localStorage.removeItem(key), keyFor(photos[2]));
    await bulk.getByRole("button", { name: "Confirm 1 selected match", exact: true }).click();
    await expect(bulk.getByRole("button", { name: "Back to card list", exact: true })).toHaveCount(0);
    const inventory = page.getByRole("region", { name: "Add reviewed cards to Inventory", exact: true });
    await expect(inventory).toContainText("2 reviewed cards are excluded because of unsaved corrections");
    await expect(inventory).toContainText("1 selected");
    await page.getByRole("button", { name: "Stop capture", exact: true }).click();
    await inventory.getByRole("button", { name: "Select reviewed cards", exact: true }).click();
    await expect(inventory).toContainText("1 selected");
    await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).click();
    await expect(inventory.getByLabel("Confirm Inventory addition", { exact: true })).toContainText("Add 1 copy");
    await inventory.getByRole("button", { name: "Add 1 copy to Inventory", exact: true }).click();
    await expect(inventory).toContainText("Added 1 copy to Inventory.");
    // Neither dirty saved review was committed, nor was its local correction cleared.
    expect(await page.evaluate(key => localStorage.getItem(key), keyFor(photos[0]))).not.toBeNull();
    expect(await page.evaluate(key => localStorage.getItem(key), keyFor(photos[13]))).not.toBeNull();
    await page.getByRole("button", { name: "Back to matches", exact: true }).click();
    await first.scrollIntoViewIfNeeded();
    await first.getByRole("button", { name: "Save card review", exact: true }).click();
    await expect(first.getByRole("checkbox", { name: "Select card 1 for Inventory", exact: true })).toBeEnabled();
    await second.scrollIntoViewIfNeeded();
    await second.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),keyFor(photos[1]))).toBeNull();
    await expect(bulk).not.toContainText("card has an unsaved correction");
    // Select/preview a clean saved card, then edit it while that preview is retained.
    await first.getByRole("checkbox", { name: "Select card 1 for Inventory", exact: true }).check();
    await page.getByRole("link", { name: "Go to Inventory confirmation", exact: true }).click();
    await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).click();
    await page.getByRole("button", { name: "Back to matches", exact: true }).click();
    await first.getByRole("button", { name: "Correct", exact: true }).click();
    await first.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("MP");
    await page.getByRole("link", { name: "Go to Inventory confirmation", exact: true }).click();
    await expect(inventory.getByRole("button", { name: "Add 1 copy to Inventory", exact: true })).toBeDisabled();
    await expect(inventory.getByRole("button", { name: "Preview selected cards", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Back to matches", exact: true }).click();
    await first.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await expect(first.getByRole("checkbox", { name: "Select card 1 for Inventory", exact: true })).toBeEnabled();
    await page.getByRole("link", { name: "Go to Inventory confirmation", exact: true }).click();
    await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).click();
    let originalCommit: unknown = null, receipt: any = null;
    await page.route(`**/api/acquisition/${batch}/commit`, async route => {
      const body = route.request().postDataJSON();
      if (body.action !== "commit") return route.continue();
      if (!originalCommit) {
        originalCommit = body;
        const response = await route.fetch(); expect(response.status()).toBe(200); receipt = await response.json();
        await route.abort("failed");
      } else { expect(body).toEqual(originalCommit); await route.continue(); }
    });
    await inventory.getByRole("button", { name: "Add 1 copy to Inventory", exact: true }).click();
    await expect(inventory.getByRole("button", { name: "Retry Inventory addition", exact: true })).toBeEnabled();
    // A newer browser draft must not replace the unknown-acknowledgement request.
    await other.evaluate(({ key, draft }) => localStorage.setItem(key,JSON.stringify(draft)), { key: keyFor(photos[0]), draft });
    await expect(inventory.getByRole("button", { name: "Select reviewed cards", exact: true })).toBeDisabled();
    await inventory.getByRole("button", { name: "Retry Inventory addition", exact: true }).click();
    await expect(inventory).toContainText("Added 1 copy to Inventory.");
    const evidence = JSON.parse(database(`console.log(JSON.stringify({rows:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}}}),members:await p.acquisitionCommitMember.findMany({where:{candidate:{run:{sessionId:${JSON.stringify(batch)}}}}}),audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:${JSON.stringify(tag)},changeType:'acquisition_committed'}}),photos:await p.acquisitionPhoto.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},select:{id:true,inputKind:true,digest:true,purgeAfter:true}})}));`));
    expect(evidence.rows.reduce((n:number,row:any)=>n+row.quantity,0)).toBe(2);
    expect(evidence.members).toHaveLength(2); expect(evidence.audits).toHaveLength(2);
    expect(evidence.members.filter((member:any)=>member.commitId===receipt.id)).toHaveLength(1);
    for (const row of evidence.rows) expect(row).toMatchObject({currentOwnerId:tag,locationId:tag,locationSection:"A",sourceType:"ACQUISITION",originalOpenerId:null,foilStatus:"NONFOIL"});
    expect(evidence.rows.map((row:any)=>row.condition).sort()).toEqual(["LP","NM"]);
    for (const photo of evidence.photos) expect(photo).toMatchObject({inputKind:"CARD_SCAN",digest:createHash("sha256").update(bytes).digest("hex")});
    expect(evidence.photos.filter((photo:any)=>photo.purgeAfter)).toHaveLength(2);
    expect(await page.evaluate(key=>localStorage.getItem(key),keyFor(photos[13]))).not.toBeNull();
    for (const width of [1366,320]) {
      await page.setViewportSize({width,height:900}); await inventory.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/acquisition-draft-actions-${width}.png`});
    }
    await other.close();
  } finally {
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});
