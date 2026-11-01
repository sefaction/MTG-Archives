import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { cleanupCorrectionFixture } from "./correction-fixture";
import { cleanupOwnedPhotoFixtureFiles } from "./owned-fixture-files";

const container = process.env.MTG_INVENTORY_TEST_CONTAINER || "";
const databaseName = process.env.MTG_INVENTORY_TEST_DATABASE || "";
test.skip(!container || !databaseName, "Requires an owned isolated local review target");
test.use({ trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" });

function database<T = unknown>(body: string): T {
  if (!/^[a-f0-9]{64}$/.test(container) || !/^review\w+$/.test(databaseName))
    throw new Error("Expected immutable review container and explicit review database");
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify("/" + databaseName)})throw Error('Wrong fixture database');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30_000,
  }));
}

function fingerprint() {
  return database(`const result={};const tables=await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");for(const {tablename} of tables){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unexpected table');const rows=await p.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);
}

for (const width of [1366, 320]) for (const mode of ["Simple", "Advanced"] as const) {
  test(`${mode} Cancel changes restores correction focus at ${width}px`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
    await page.setViewportSize({ width, height: 900 });
    database(`const root=process.env.UPLOADS_DATA_PATH;if(!root||!require('path').isAbsolute(root))throw Error('Configure isolated acquisition storage before creating fixtures');return true;`);
    const before = fingerprint();
    const tag = `ui-cancel-focus-${randomUUID()}`, token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    let batch = "", photo = "", failRead = false, decisionPosts = 0;
    let holdRead = false, releaseRead = () => {}, readHeld = () => {};
    const held = new Promise<void>(resolve => { readHeld = resolve; });
    const release = new Promise<void>(resolve => { releaseRead = resolve; });
    const printing = { id: `${tag}-card`, name: "Correction focus fixture", setCode: "tst", collectorNumber: "1", lang: "en", imageUri: null, finishes: ["nonfoil"] };
    const headers = { origin: baseURL! };
    writeFileSync(test.info().outputPath("fixture-before.json"), JSON.stringify({ tag, before }));
    let primaryFailed = false; let primaryError: unknown;
    const savedState = () => database(`const tag=${JSON.stringify(tag)};return {candidate:await p.acquisitionCandidate.findFirst({where:{run:{session:{ownerPlayerId:tag}}}}),events:await p.correctionReviewEvent.findMany({where:{ownerPlayerId:tag},orderBy:{id:'asc'}}),inventory:await p.inventoryItem.findMany({where:{currentOwnerId:tag}}),commits:await p.acquisitionCommit.findMany({where:{run:{session:{ownerPlayerId:tag}}}})};`);
    try {
      database(`const tag=${JSON.stringify(tag)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{await tx.player.create({data:{id:tag,name:tag,displayName:tag}});await tx.user.create({data:{id:tag,username:tag,displayName:tag,playerId:tag,passwordHash}});await tx.inventoryLocation.create({data:{id:tag,name:tag,normalizedName:tag,ownerPlayerId:tag,type:'Box',storageLayout:{capacity:2,sections:[]}}});await tx.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Artifact',rarity:'common'}});await tx.authSession.create({data:{tokenHash:${JSON.stringify(tokenHash)},userId:tag,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+300000)}});});return true;`);
      await page.context().addCookies([{ name: "mtg_inventory_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      const created = await page.request.post("/api/acquisition", { headers, data: { requestKey: randomUUID(), locationId: tag, section: "", quantity: 1 } });
      expect(created.ok(), await created.text()).toBe(true); batch = (await created.json()).id;
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const bytes = await sharp({ create: { width: 300, height: 420, channels: 3, background: "#335577" } }).jpeg().toBuffer();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`, { headers: { ...headers, "content-type": "image/jpeg" }, data: bytes });
      expect(uploaded.ok(), await uploaded.text()).toBe(true); photo = (await uploaded.json()).id;
      // This isolated review has no processing workers. Settle only its own
      // unclaimed fixture jobs; never rewrite a running lease.
      database(`const where={run:{sessionId:${JSON.stringify(batch)}}};if(await p.acquisitionProcessingJob.count({where:{...where,status:'RUNNING'}}))throw Error('Unexpected fixture worker');await p.acquisitionProcessingJob.updateMany({where:{...where,status:'PENDING'},data:{status:'FAILED',errorCode:'CONTROLLED_UI_FIXTURE'}});return true;`);
      const endpoint = `/api/acquisition/${batch}/review`;
      const original = await page.request.get(`${endpoint}?photoId=${photo}`); expect(original.ok()).toBe(true);
      const record = await original.json();
      // Use the actual review writer once to establish a saved choice. Cancel
      // must perform only reads and leave that entire durable choice intact.
      const accepted = await page.request.post(endpoint, { headers, data: { action: "accept", photoId: photo, revision: record.revision, decision: { cardId: printing.id, finish: "NONFOIL", condition: "NM", language: "en" }, evidenceTokens: { current: record.evidenceToken } } });
      expect(accepted.ok(), await accepted.text()).toBe(true);
      const saved = savedState();
      await page.route(`**${endpoint}?*`, async route => {
        if (failRead) { failRead = false; return route.fulfill({ status: 503, json: { error: "Controlled discard unavailable" } }); }
        if (holdRead) {
          holdRead = false;
          const response = await route.fetch(); readHeld();
          await release;
          return route.fulfill({ response });
        }
        return route.continue();
      });
      page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === endpoint) decisionPosts++; });
      await page.goto(`/imports/scan?batch=${batch}`);
      await page.getByRole("button", { name: mode, exact: true }).click();
      const card = page.getByTestId("capture-card-1"); await card.scrollIntoViewIfNeeded();
      if (mode === "Simple") {
        const correct = card.getByRole("button", { name: "Correct", exact: true });
        await correct.focus(); await correct.press("Enter");
      }
      const name = card.getByLabel("Card name", { exact: true });
      await name.fill("Unsaved keyboard correction");
      const cancel = card.getByRole("button", { name: "Cancel changes", exact: true });
      failRead = true; await cancel.focus(); await cancel.press("Enter");
      await expect(card.getByRole("alert")).toContainText("Controlled discard unavailable");
      await expect(name).toHaveValue("Unsaved keyboard correction"); expect(savedState()).toEqual(saved);
      await cancel.focus(); await cancel.press("Enter");
      await expect(card).toContainText("Unsaved changes discarded.");
      const target = mode === "Simple" ? card.getByRole("button", { name: "Correct", exact: true }) : name;
      await expect(target).toBeFocused();
      expect(decisionPosts).toBe(0); expect(savedState()).toEqual(saved);
      if (mode === "Simple") {
        await target.press("Enter"); await expect(name).toBeFocused();
      } else {
        await target.press("Tab"); await expect(card.getByLabel("Set code", { exact: true })).toBeFocused();
      }
      await name.fill("Another unsaved correction");
      holdRead = true;
      await cancel.focus(); await cancel.press("Enter"); await held;
      const outside = page.getByRole("button", { name: mode, exact: true });
      await outside.focus(); releaseRead();
      await expect(card).toContainText("Unsaved changes discarded.");
      await expect(cancel).toHaveCount(0);
      await expect(outside).toBeFocused();
      expect(decisionPosts).toBe(0); expect(savedState()).toEqual(saved);
      const originalPhoto = await page.request.get(`/api/acquisition/${batch}/photos/${photo}`);
      expect(originalPhoto.ok()).toBe(true);
      expect(createHash("sha256").update(await originalPhoto.body()).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath("cancel-focus.png"), fullPage: true });
    } catch (error) {
      primaryFailed = true; primaryError = error;
      throw error;
    } finally {
      try {
      releaseRead();
      try { await page.unrouteAll({ behavior: "wait" }); await page.goto("about:blank"); }
      finally {
        await page.context().clearCookies();
        database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{ownerPlayerId:n},data:{phase:'CANCELLED'}});const w={run:{session:{ownerPlayerId:n}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Live owned job prevents cleanup');const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupOwnedPhotoFixtureFiles}${cleanupCorrectionFixture}await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});return true;`);
        const after = fingerprint();
        writeFileSync(test.info().outputPath("fixture-after.json"), JSON.stringify({ tag, after }));
        expect(after).toEqual(before);
      }
      } catch (cleanupError) {
        if (primaryFailed) throw new AggregateError([primaryError, cleanupError], "Correction focus check and owned cleanup both failed");
        throw cleanupError;
      }
    }
  });
}
