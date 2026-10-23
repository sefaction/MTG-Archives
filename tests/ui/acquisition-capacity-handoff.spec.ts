import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";

const container = process.env.MTG_INVENTORY_TEST_CONTAINER || "";
const databaseName = process.env.MTG_INVENTORY_TEST_DATABASE || "";
test.skip(!container || !databaseName, "Requires an owned isolated local review target");
test.use({ trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" });

function database<T = unknown>(body: string): T {
  if (!/^[a-f0-9]{64}$/.test(container) || !/^review\w+$/.test(databaseName))
    throw new Error("Expected immutable review container and explicit review database");
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30_000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify("/" + databaseName)})throw Error('Wrong fixture database');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
function fingerprint() {
  return database(`const result={};for(const {tablename} of await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unexpected table');const rows=await p.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);
}

for (const width of [1366, 320]) for (const outcome of ["subset", "overfill"] as const) {
  test(`263-to258 ${outcome} handoff preserves physical copies at ${width}px`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
    await page.setViewportSize({ width, height: 900 });
    database(`const root=process.env.UPLOADS_DATA_PATH;if(!root||!require('path').isAbsolute(root))throw Error('Configure isolated acquisition storage');return true;`);
    const before = fingerprint();
    const tag = `ui-capacity-handoff-${randomUUID()}`, token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const headers = { origin: baseURL! };
    const printing = { id: `${tag}-card`, name: "Capacity handoff fixture", setCode: "tst", collectorNumber: "1", lang: "en", imageUri: null, finishes: ["nonfoil"] };
    let batch = "";
    let primaryError: unknown;
    writeFileSync(test.info().outputPath("fixture-before.json"), JSON.stringify({ tag, before }));
    try {
      database(`const n=${JSON.stringify(tag)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{await tx.player.create({data:{id:n,name:n,displayName:n}});await tx.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash}});for(const [id,name,capacity] of [[n,'Capacity original',800],[n+'-other','Capacity alternative',5]])await tx.inventoryLocation.create({data:{id,name,normalizedName:id,ownerPlayerId:n,type:'Box',storageLayout:{capacity,sections:[]}}});await tx.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Artifact',rarity:'common'}});await tx.inventoryItem.create({data:{cardId:${JSON.stringify(printing.id)},currentOwnerId:n,originalOpenerId:n,quantity:537,condition:'NM',locationId:n,sourceType:'MANUAL'}});await tx.authSession.create({data:{tokenHash:${JSON.stringify(tokenHash)},userId:n,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+600000)}});});return true;`);
      await page.context().addCookies([{ name: "mtg_inventory_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      const created = await page.request.post("/api/acquisition", { headers, data: { requestKey: randomUUID(), locationId: tag, section: "", quantity: 263 } });
      expect(created.ok(), await created.text()).toBe(true); batch = (await created.json()).id;
      const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers, data: { action: "reserve", requestKey: randomUUID() } });
      expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
      const bytes = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#335577" } }).jpeg().toBuffer();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`, { headers: { ...headers, "content-type": "image/jpeg" }, data: bytes });
      expect(uploaded.ok(), await uploaded.text()).toBe(true); const photo = (await uploaded.json()).id;
      database(`const where={run:{sessionId:${JSON.stringify(batch)}}};if(await p.acquisitionProcessingJob.count({where:{...where,status:'RUNNING'}}))throw Error('Unexpected fixture worker');await p.acquisitionProcessingJob.updateMany({where:{...where,status:'PENDING'},data:{status:'FAILED',errorCode:'CONTROLLED_UI_FIXTURE'}});return true;`);
      const endpoint = `/api/acquisition/${batch}/review`;
      const record = await (await page.request.get(`${endpoint}?photoId=${photo}`)).json();
      const accepted = await page.request.post(endpoint, { headers, data: { action: "accept", photoId: photo, revision: record.revision, decision: { cardId: printing.id, finish: "NONFOIL", condition: "NM", language: "en" }, evidenceTokens: { current: record.evidenceToken } } });
      expect(accepted.ok(), await accepted.text()).toBe(true);
      // Expand one actual saved upload into explicit persisted UI fixtures.
      // Distinct slots/photos/lineage and real bytes are retained; this is not
      // 263 provider acknowledgements, native recognition or human decisions.
      database(`const original=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photo)}}}),runId=original.runId;const candidate=await p.acquisitionCandidate.findUniqueOrThrow({where:{runId_physicalId:{runId,physicalId:original.slotId}}});const observation=await p.acquisitionObservation.findFirstOrThrow({where:{candidateId:candidate.id}});const artifact=await p.acquisitionArtifact.findUniqueOrThrow({where:{id:observation.artifactId}});const slots=[],photos=[],candidates=[],artifacts=[],observations=[];const uuid=()=>require('crypto').randomUUID();for(let index=1;index<263;index++){const slotId=uuid(),photoId=uuid(),candidateId=uuid(),artifactId=uuid(),sourceId=photoId;slots.push({id:slotId,runId,requestKey:uuid(),position:index,generation:original.generation});const copy={...original,id:photoId,slotId,uploadKey:uuid()};for(const field of ['sourceMetadata','firstMachineEvidence'])if(copy[field]===null)delete copy[field];photos.push(copy);const choice={...candidate,id:candidateId,physicalId:slotId,acquisitionOrder:index};for(const field of ['proposal','manualAnalysis'])if(choice[field]===null)delete choice[field];candidates.push(choice);artifacts.push({...artifact,id:artifactId,sourceId});observations.push({...observation,id:uuid(),sourceId,candidateId,artifactId});}await p.acquisitionCaptureSlot.createMany({data:slots});await p.acquisitionPhoto.createMany({data:photos});await p.acquisitionArtifact.createMany({data:artifacts});await p.acquisitionCandidate.createMany({data:candidates});await p.acquisitionObservation.createMany({data:observations});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;for(const copy of photos)for(const suffix of ['.original','.preview.jpg']){const input=paths.join(root,'acquisition-v1',original.id+suffix);if(suffix==='.preview.jpg'&&!(await fs.stat(input).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e})))continue;await fs.copyFile(input,paths.join(root,'acquisition-v1',copy.id+suffix),require('fs').constants.COPYFILE_EXCL);}return true;`);
      const progress = await (await page.request.get(`/api/acquisition/${batch}`)).json();
      expect(progress.slots).toHaveLength(263);
      expect(progress.slots.every((value: { review: { cardId: string }; physicalReadiness: { ready: boolean } }) => value.review?.cardId === printing.id)).toBe(true);
      const stopped = await page.request.post(`/api/acquisition/${batch}`, { headers, data: { action: "control", requestKey: randomUUID(), revision: progress.revision, command: "STOP" } });
      expect(stopped.ok(), await stopped.text()).toBe(true);
      const sourceState = () => database(`const w={run:{sessionId:${JSON.stringify(batch)}}};const photos=await p.acquisitionPhoto.findMany({where:w,orderBy:{id:'asc'},select:{id:true,slotId:true,generation:true,digest:true,bytes:true,ready:true,purgedAt:true}});const fs=require('fs/promises'),paths=require('path'),crypto=require('crypto');for(const photo of photos){const bytes=await fs.readFile(paths.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.original'));photo.actualDigest=crypto.createHash('sha256').update(bytes).digest('hex');if(photo.actualDigest!==photo.digest||bytes.length!==photo.bytes)throw Error('Fixture original identity mismatch');}return {photos,candidates:await p.acquisitionCandidate.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}})};`);
      const originals = sourceState();
      writeFileSync(test.info().outputPath("originals-before.json"), JSON.stringify(originals));
      await page.goto(`/imports/scan?batch=${batch}`);
      await page.getByRole("link", { name: "Add 263 confirmed cards to Inventory", exact: true }).click();
      const inventory = page.getByRole("region", { name: "Add reviewed cards to Inventory", exact: true });
      await inventory.getByRole("button", { name: "Review 263 confirmed cards for Inventory", exact: true }).click();
      const confirm = inventory.getByLabel("Confirm Inventory addition", { exact: true });
      await expect(confirm).toContainText("537 currently stored / 800 capacity");
      await expect(confirm.getByRole("alert")).toHaveCount(0);
      database(`await p.inventoryItem.create({data:{cardId:${JSON.stringify(printing.id)},currentOwnerId:${JSON.stringify(tag)},originalOpenerId:${JSON.stringify(tag)},quantity:5,condition:'NM',locationId:${JSON.stringify(tag)},sourceType:'MANUAL'}});return true;`);
      const stale = page.waitForResponse(response => response.url().endsWith(`/api/acquisition/${batch}/commit`) && response.request().postDataJSON()?.action === "commit");
      await confirm.getByRole("button", { name: "Add 263 copies to Inventory", exact: true }).click();
      expect((await stale).status()).toBe(409);
      await expect(inventory.getByRole("alert")).toContainText("preview changed");
      expect(database(`return {stock:(await p.inventoryItem.aggregate({where:{currentOwnerId:${JSON.stringify(tag)}},_sum:{quantity:true}}))._sum.quantity,receipts:await p.acquisitionCommit.count({where:{run:{sessionId:${JSON.stringify(batch)}}}}),members:await p.acquisitionCommitMember.count({where:{candidate:{run:{sessionId:${JSON.stringify(batch)}}}}}),audits:await p.inventoryAuditLog.count({where:{changedByUserId:${JSON.stringify(tag)},changeType:'acquisition_committed'}})};`)).toEqual({ stock: 542, receipts: 0, members: 0, audits: 0 });
      await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).click();
      await expect(confirm.getByRole("alert")).toContainText("5 selected copies exceed");
      await expect(confirm.getByRole("button", { name: "Add 263 copies to Inventory", exact: true })).toBeDisabled();
      if (outcome === "subset") {
        for (let position = 1; position <= 5; position++)
          await page.getByRole("checkbox", { name: `Select card ${position} for Inventory`, exact: true }).uncheck();
        await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).click();
        await expect(confirm).toContainText("Add 258 copies");
        await expect(confirm.getByRole("alert")).toHaveCount(0);
      } else {
        await confirm.getByLabel("Overfill reason", { exact: true }).fill("Physically checked five additional spaces");
        await expect(confirm.getByRole("button", { name: "Add 263 copies to Inventory", exact: true })).toBeDisabled();
        await confirm.getByRole("checkbox", { name: "I checked the available physical space.", exact: true }).check();
      }
      const count = outcome === "subset" ? 258 : 263;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath("confirmation.png") });
      await confirm.getByRole("button", { name: `Add ${count} copies to Inventory`, exact: true }).click();
      await expect(inventory).toContainText(`Added ${count} copies to Inventory.`);
      const final = await (await page.request.get(`/api/acquisition/${batch}`)).json();
      expect(final.slots.filter((value: { committed: boolean }) => value.committed)).toHaveLength(count);
      const pending = final.slots.filter((value: { committed: boolean }) => !value.committed);
      expect(pending).toHaveLength(263 - count);
      expect(pending.every((value: { review: { cardId: string } }) => value.review.cardId === printing.id)).toBe(true);
      const saved = database<{ copies: number; members: number; audit: { reason: string | null; afterJson: { quantity: number; overfill: number } }[] }>(`return {copies:(await p.inventoryItem.aggregate({where:{currentOwnerId:${JSON.stringify(tag)}},_sum:{quantity:true}}))._sum.quantity,members:await p.acquisitionCommitMember.count({where:{candidate:{run:{sessionId:${JSON.stringify(batch)}}}}}),audit:await p.inventoryAuditLog.findMany({where:{changedByUserId:${JSON.stringify(tag)},changeType:'acquisition_committed'},select:{afterJson:true,reason:true}})};`);
      expect(saved.copies).toBe(542 + count); expect(saved.members).toBe(count);
      expect(saved.audit).toHaveLength(1); expect(saved.audit[0].afterJson.quantity).toBe(count);
      expect(saved.audit[0].afterJson.overfill).toBe(outcome === "subset" ? 0 : 5);
      expect(saved.audit[0].reason).toBe(outcome === "subset" ? null : "Physically checked five additional spaces");
      await page.reload();
      await expect(page.getByRole("region", { name: "Batch progress", exact: true })).toContainText(`${count} added`);
      if (outcome === "subset") {
        await page.getByRole("link", { name: "Add 5 confirmed cards to Inventory", exact: true }).click();
        await inventory.getByRole("button", { name: "Review 5 confirmed cards for Inventory", exact: true }).click();
        await expect(confirm.getByRole("alert")).toContainText("5 selected copies exceed");
        // Change only the proposed destination; preview cannot move or consume
        // the five pending physical copies. Their actual later commit is separate.
        await inventory.getByText("Change destination", { exact: true }).click();
        await inventory.getByRole("button", { name: "Change", exact: true }).click();
        await inventory.getByRole("combobox", { name: "Search destinations", exact: true }).fill("Capacity alternative");
        await inventory.getByRole("option", { name: /Capacity alternative/ }).click();
        await inventory.getByRole("button", { name: "Preview selected cards", exact: true }).click();
        await expect(confirm).toContainText("Capacity alternative");
        await expect(confirm.getByRole("alert")).toHaveCount(0);
        expect((await (await page.request.get(`/api/acquisition/${batch}`)).json()).slots.filter((value: { committed: boolean }) => !value.committed)).toHaveLength(5);
        expect(database(`return (await p.inventoryItem.aggregate({where:{currentOwnerId:${JSON.stringify(tag)}},_sum:{quantity:true}}))._sum.quantity;`)).toBe(800);
      }
      const retained = sourceState();
      writeFileSync(test.info().outputPath("originals-after.json"), JSON.stringify(retained));
      expect(retained).toEqual(originals);
    } catch (error) { primaryError = error; throw error; }
    finally {
      const cleanupErrors: unknown[] = [];
      try { await page.unrouteAll({ behavior: "wait" }); await page.goto("about:blank"); }
      catch (error) { cleanupErrors.push(error); }
      try { await page.context().clearCookies(); }
      catch (error) { cleanupErrors.push(error); }
      try {
          database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{ownerPlayerId:n},data:{phase:'CANCELLED'}});const w={run:{session:{ownerPlayerId:n}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Live fixture job prevents cleanup');const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Missing fixture root');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Unexpected fixture photo');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e});}return true;`);
          const after = fingerprint();
          writeFileSync(test.info().outputPath("fixture-after.json"), JSON.stringify({ tag, after }));
          expect(after).toEqual(before);
      } catch (error) { cleanupErrors.push(error); }
      if (cleanupErrors.length) {
        throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "Capacity handoff cleanup failed; all independent cleanup was attempted");
      }
    }
  });
}
