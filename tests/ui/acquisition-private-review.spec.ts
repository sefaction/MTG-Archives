import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";

test.skip(process.env.MTG_PRIVATE_REVIEW_TEST !== "1", "Requires an explicitly owned isolated private-review fixture");
test.use({ trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" });

function database<T = unknown>(body: string): T {
  const container = process.env.MTG_INVENTORY_TEST_CONTAINER || "", name = process.env.MTG_INVENTORY_TEST_DATABASE || "";
  if (process.env.MTG_PRIVATE_REVIEW_TEST !== "1" || !/^[a-f0-9]{64}$/.test(container) || !/^review\w+$/.test(name))
    throw Error("Expected opt-in, immutable fixture container and isolated review database");
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30_000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify("/" + name)})throw Error('Wrong isolated database');const root=process.env.UPLOADS_DATA_PATH;if(!root||!require('path').isAbsolute(root))throw Error('Missing isolated uploads');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
function fingerprint() {
  return database(`const result={};for(const {tablename} of await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unexpected table');const rows=await p.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);
}
function state(tag: string, batch: string) {
  return database<{ photo: unknown; original: string; authority: unknown; candidate: { revision: number; review: unknown }; commands: { payload: string }[]; events: { id: string; actorId: string; ownerPlayerId: string }[]; stock: number; commits: number; audits: number }>(`const n=${JSON.stringify(tag)},batch=${JSON.stringify(batch)},w={run:{sessionId:batch}},photo=await p.acquisitionPhoto.findFirstOrThrow({where:w}),session=await p.acquisitionSession.findUniqueOrThrow({where:{id:batch}});return {photo,original:require('crypto').createHash('sha256').update(await require('fs/promises').readFile(require('path').join(root,'acquisition-v1',photo.id+'.original'))).digest('hex'),authority:{ownerPlayerId:session.ownerPlayerId,createdByUserId:session.createdByUserId,locationId:session.locationId,section:session.section,target:session.target},candidate:await p.acquisitionCandidate.findFirstOrThrow({where:w}),commands:await p.acquisitionCommand.findMany({where:w,orderBy:{id:'asc'}}),events:await p.correctionReviewEvent.findMany({where:{ownerPlayerId:n},orderBy:{id:'asc'}}),stock:await p.inventoryItem.count(),commits:await p.acquisitionCommit.count(),audits:await p.inventoryAuditLog.count()};`);
}
function cleanup(tag: string) {
  database(`const n=${JSON.stringify(tag)};if(!/^ui-private-review-[a-f0-9-]{36}$/.test(n))throw Error('Unexpected fixture owner');await p.acquisitionSession.updateMany({where:{ownerPlayerId:n},data:{phase:'CANCELLED'}});const w={run:{session:{ownerPlayerId:n}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Live worker prevents cleanup');const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});const owners=[n,n+'-foreign',n+'-admin'];await p.authSession.deleteMany({where:{user:{playerId:{in:owners}}}});await p.user.deleteMany({where:{playerId:{in:owners}}});await p.player.deleteMany({where:{id:{in:owners}}});await p.card.deleteMany({where:{id:n+'-card'}});for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Unexpected photo identity');for(const suffix of ['.original','.preview.jpg'])await require('fs/promises').unlink(require('path').join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e});}return true;`);
}
async function authenticate(context: BrowserContext, baseURL: string, token: string) {
  await context.addCookies([{ name: "mtg_inventory_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}
async function privateImage(page: Page, url: string, digest: string) {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(digest);
}

for (const width of [1366, 390, 320]) test(`owner and explicit Admin Mode protect private review at ${width}px`, async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000); page.setDefaultTimeout(15_000);
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const viewport = { width, height: width === 1366 ? 768 : 844 };
  await page.setViewportSize(viewport);
  const tag = `ui-private-review-${randomUUID()}`, before = fingerprint(), contexts: BrowserContext[] = [];
  writeFileSync(test.info().outputPath("fixture-before.json"), JSON.stringify({ tag, before }));
  let primaryError: unknown;
  try {
    const tokens = [0, 1, 2].map(() => randomBytes(32).toString("base64url"));
    const hashes = tokens.map(token => createHash("sha256").update(token).digest("hex"));
    const printing = { id: tag + "-card", name: "Private review sentinel", setCode: "tst", collectorNumber: "1", lang: "en", finishes: ["nonfoil"] };
    database(`const n=${JSON.stringify(tag)},hashes=${JSON.stringify(hashes)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{for(const [index,suffix] of ['','-foreign','-admin'].entries()){const id=n+suffix;await tx.player.create({data:{id,name:id,displayName:id}});await tx.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash,role:index===2?'ADMIN':'PLAYER'}});await tx.authSession.create({data:{tokenHash:hashes[index],userId:id,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+300000)}});}await tx.inventoryLocation.create({data:{id:n,name:'Private destination sentinel',normalizedName:n,ownerPlayerId:n,type:'Box',visibility:'PRIVATE',storageLayout:{capacity:2,sections:[]}}});await tx.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Artifact',rarity:'common'}});});return true;`);
    await authenticate(page.context(), baseURL!, tokens[0]);
    const headers = { origin: baseURL! };
    const created = await page.request.post("/api/acquisition", { headers, data: { requestKey: randomUUID(), locationId: tag, section: "", quantity: 1 } });
    expect(created.ok(), await created.text()).toBe(true); const batch = (await created.json()).id as string;
    const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers, data: { action: "reserve", requestKey: randomUUID() } });
    expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
    const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
    const digest = createHash("sha256").update(bytes).digest("hex");
    const upload = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`, { headers: { ...headers, "content-type": "image/jpeg" }, data: bytes });
    expect(upload.ok(), await upload.text()).toBe(true); const photo = (await upload.json()).id as string;
    database(`const w={run:{sessionId:${JSON.stringify(batch)}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Unexpected fixture worker');await p.acquisitionProcessingJob.updateMany({where:{...w,status:'PENDING'},data:{status:'FAILED',errorCode:'CONTROLLED_UI_FIXTURE'}});return true;`);
    const endpoint = `/api/acquisition/${batch}/review`, photoURL = `/api/acquisition/${batch}/photos/${photo}`, reviewURL = `${endpoint}?photoId=${photo}`;
    const original = await (await page.request.get(reviewURL)).json();
    const decision = { cardId: printing.id, finish: "NONFOIL", condition: "NM", language: "en" };
    const accepted = await page.request.post(endpoint, { headers, data: { action: "accept", photoId: photo, revision: original.revision, decision, evidenceTokens: { current: original.evidenceToken } } });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    await page.goto(`/imports/scan?batch=${batch}`);
    const ownCard = page.getByTestId("capture-card-1"); await ownCard.scrollIntoViewIfNeeded();
    await expect(ownCard).toContainText(printing.name); await privateImage(page, photoURL, digest);
    const saved = state(tag, batch);
    writeFileSync(test.info().outputPath("source-before.json"), JSON.stringify(saved));
    const anonymous = await browser.newContext({ baseURL }); contexts.push(anonymous);
    for (const url of [reviewURL, photoURL]) expect((await anonymous.request.get(url)).status()).toBe(403);
    expect(state(tag, batch)).toEqual(saved);
    // Neither an unrelated player nor the ADMIN role alone grants access.
    for (const index of [1, 2]) {
      const context = await browser.newContext({ baseURL, viewport }); contexts.push(context);
      await authenticate(context, baseURL!, tokens[index]); const other = await context.newPage(); other.setDefaultTimeout(15_000);
      await other.goto(`/imports/scan?batch=${batch}`);
      await expect(other.getByTestId("capture-card-1")).toHaveCount(0);
      await expect(other.getByRole("alert").filter({ hasText: "Capture session unavailable" })).toBeVisible();
      await expect(other.locator("body")).not.toContainText(printing.name);
      await expect(other.locator("body")).not.toContainText("Private destination sentinel");
      for (const url of [`/api/acquisition/${batch}`, reviewURL, photoURL, photoURL + "?preview=1"]) {
        const denied = await other.request.get(url); expect(denied.status()).toBe(403);
        expect(denied.headers()["cache-control"]).toBe("no-store");
        expect(await denied.text()).not.toContain(printing.name);
      }
      const deniedWrite = await other.request.post(endpoint, { headers, data: { action: "accept", photoId: photo, revision: saved.candidate.revision, decision: { ...decision, condition: "HP" } } });
      expect(deniedWrite.status()).toBe(403); expect(state(tag, batch)).toEqual(saved);
      if (index === 1) {
        // A forged Admin Mode cookie also cannot promote a non-admin user.
        await context.addCookies([{ name: "mtg_admin_mode", value: "1", url: baseURL! }]);
        expect((await other.request.get(photoURL)).status()).toBe(403);
        expect(state(tag, batch)).toEqual(saved); continue;
      }
      await other.getByRole("button", { name: "Enter Admin Mode", exact: true }).click();
      await expect(other.getByRole("button", { name: "Exit Admin Mode", exact: true })).toBeVisible();
      await other.reload();
      const card = other.getByTestId("capture-card-1"); await card.scrollIntoViewIfNeeded();
      await expect(card).toContainText(printing.name); await privateImage(other, photoURL, digest);
      await other.getByRole("button", { name: "Advanced", exact: true }).click(); await card.scrollIntoViewIfNeeded();
      await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("LP");
      const response = other.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
      await card.getByRole("button", { name: "Save card review", exact: true }).click();
      expect((await response).status()).toBe(200); await expect(card).toContainText("Review saved. Not yet added to Inventory.");
      const updated = state(tag, batch);
      expect(updated.photo).toEqual(saved.photo); expect(updated.original).toBe(digest); expect(updated.authority).toEqual(saved.authority);
      expect(updated.candidate.review).toMatchObject({ condition: "LP", actorId: tag + "-admin" });
      expect(updated.candidate.revision).toBe(saved.candidate.revision + 1);
      const added = updated.commands.filter(command => !saved.commands.some(old => old.payload === command.payload));
      expect(added).toHaveLength(1); expect(JSON.parse(added[0].payload)).toMatchObject({ action: "accept", actorId: tag + "-admin", photoId: photo, after: { condition: "LP" } });
      expect(updated.events.filter(event => saved.events.some(old => old.id === event.id))).toEqual(saved.events);
      const addedEvents = updated.events.filter(event => !saved.events.some(old => old.id === event.id));
      expect(addedEvents).toHaveLength(1); expect(addedEvents[0]).toMatchObject({ actorId: tag + "-admin", ownerPlayerId: tag });
      expect([updated.stock, updated.commits, updated.audits]).toEqual([0, 0, 0]);
      expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await other.screenshot({ path: test.info().outputPath("admin-review.png") });
      writeFileSync(test.info().outputPath("source-after.json"), JSON.stringify(updated));
      await other.getByRole("button", { name: "Exit Admin Mode", exact: true }).click();
      await expect(other.getByRole("button", { name: "Enter Admin Mode", exact: true })).toBeVisible();
      // Fresh requests/navigation must lose access; previously seen pixels are
      // not claimed erased from browser memory by a permission transition.
      for (const url of [reviewURL, photoURL]) expect((await other.request.get(url)).status()).toBe(403);
      await other.reload(); await expect(other.getByRole("alert").filter({ hasText: "Capture session unavailable" })).toBeVisible();
      await expect(other.getByTestId("capture-card-1")).toHaveCount(0); expect(state(tag, batch)).toEqual(updated);
      await page.reload(); await ownCard.scrollIntoViewIfNeeded();
      await expect(ownCard).toContainText(printing.name); await privateImage(page, photoURL, digest);
      expect(state(tag, batch).candidate.review).toMatchObject({ condition: "LP", actorId: tag + "-admin" });
    }
  } catch (error) { primaryError = error; throw error; }
  finally {
    const errors: unknown[] = [];
    for (const context of contexts) try { await context.close(); } catch (error) { errors.push(error); }
    try { await page.goto("about:blank"); } catch (error) { errors.push(error); }
    try { await page.context().clearCookies(); } catch (error) { errors.push(error); }
    try { cleanup(tag); } catch (error) { errors.push(error); }
    try { const after = fingerprint(); writeFileSync(test.info().outputPath("fixture-after.json"), JSON.stringify({ tag, after })); expect(after).toEqual(before); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(primaryError ? [primaryError, ...errors] : errors, "Private review and independent cleanup failures");
  }
});
