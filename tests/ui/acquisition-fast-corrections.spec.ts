import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node", "--import", "tsx"], { windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());` });
}

test("correction drafts, lost acknowledgement, private library, original viewing and safe removal", async ({ page, baseURL, browser }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local fixtures; controlled suggestions, no recognition accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag = `ui-fast-corrections-${randomUUID()}`, password = randomUUID();
  const peer=`ui-correction-peer-${randomUUID()}`;
  const original = { id: `${tag}-original`, name: "Fixture original printing", setCode: "tst", collectorNumber: "1",
    lang: "en", imageUri: "/fixture-card-original.svg", finishes: ["nonfoil", "foil"] };
  const alternate = { ...original, id: `${tag}-alternate`, name: "Fixture corrected printing", collectorNumber: "2",
    imageUri: "/fixture-card-alternate.svg", finishes: ["foil"] };
  let batch = "", reverse = false, refreshes = 0;
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[{name:'A',capacity:3}]}}});for(const card of ${JSON.stringify([original, alternate])})await p.card.create({data:{...card,scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    const defaults=JSON.parse(database(`const {ensureCorrectionAccount}=require('./lib/acquisition-correction-library.ts');const a=await p.$transaction(tx=>ensureCorrectionAccount(tx,${JSON.stringify(tag)}));console.log(JSON.stringify({limitBytes:String(a.limitBytes),sampleBasisPoints:a.sampleBasisPoints}));await p.correctionLibraryAccount.update({where:{ownerPlayerId:a.ownerPlayerId},data:{sampleBasisPoints:0,limitBytes:1}});`));
    expect(defaults).toEqual({limitBytes:"64000000000",sampleBasisPoints:200});
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
      const offers=reverse?[alternate,original]:[original,alternate];
      // Sign exactly this fixture's displayed order using real owner/photo/jobs.
      // Production never accepts machine evidence supplied by a browser.
      const token=database(`const {correctionDisplayToken}=require('./lib/acquisition-correction-library.ts');const n=${JSON.stringify(tag)};const photo=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(url.searchParams.get("photoId"))}}});const candidate=await p.acquisitionCandidate.findFirstOrThrow({where:{physicalId:photo.slotId}});const jobs=await p.acquisitionProcessingJob.findMany({where:{runId:photo.runId,candidateId:candidate.id,artifact:{sourceId:photo.id}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:32});console.log(await p.$transaction(tx=>correctionDisplayToken(tx,n,{userId:n,adminMode:false},photo,{id:candidate.id,revision:${record.revision}},jobs,${JSON.stringify(offers)},'PENDING')));`).trim();
      await route.fulfill({ json: { ...record, evidenceToken:token, recognitionStatus: "PENDING", visualStatus: "RUNNING",
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
        const choices = card.getByRole("group", { name: /^(Search results|Possible printings)$/ });
        await expect(choices).toBeVisible();
        const editor = await choices.boundingBox();
        const printing = await card.getByRole("figure", { name: "Proposed printing", exact: true }).boundingBox();
        expect(editor!.x).toBeGreaterThanOrEqual(printing!.x + printing!.width);
      }
      await page.screenshot({ path: `test-results/acquisition-fast-corrections-${width}.png` });
    }
    let loseAcknowledgement=true;
    await page.route(`**${reviewEndpoint}`,async route=>{
      const input=route.request().postDataJSON();
      if(input.photoId===photos[0]&&input.action==="accept"&&loseAcknowledgement) {
        loseAcknowledgement=false;const response=await route.fetch();expect(response.ok()).toBe(true);return route.abort("failed");
      }
      return route.continue();
    });
    await name.focus(); await name.press("Control+Shift+Enter");
    await expect(card.getByRole("alert")).toContainText("Failed to fetch");
    expect(Number(database(`console.log(await p.correctionReviewEvent.count({where:{sourcePhotoId:${JSON.stringify(photos[0])}}}));`))).toBe(1);
    const drafted=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),`mtg-review-draft-v1:${[tag,batch,photos[0]].map(encodeURIComponent).join(":")}`);
    expect(drafted.evidenceTokens.initial).toBeTruthy();expect(drafted.evidenceTokens.edit).toBeTruthy();expect(drafted.evidenceTokens.displayed.length).toBeGreaterThan(0);
    await name.focus();await name.press("Control+Shift+Enter");
    await expect(page.getByTestId("capture-card-3")).toBeFocused();
    const correction=JSON.parse(database(`const e=await p.correctionReviewEvent.findMany({where:{sourcePhotoId:${JSON.stringify(photos[0])}}});console.log(JSON.stringify(e.map(v=>({classification:v.classification,payload:v.payload}))));`));
    expect(correction).toHaveLength(1);expect(correction[0].classification).toBe("OFFERED_ALTERNATIVE_SELECTED");
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
    await expect(card).toContainText("Unsaved correction. Save the review when ready.");
    const revision = (await (await page.request.get(`${reviewEndpoint}?photoId=${photos[0]}`)).json()).revision;
    expect((await page.request.post(reviewEndpoint, { headers: { origin: baseURL! }, data: { action: "accept", photoId: photos[0], revision,
      decision: { cardId: alternate.id, finish: "FOIL", condition: "HP", language: "en" } } })).ok()).toBe(true);
    await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("MP");
    await expect(card).toContainText("The saved review changed");
    await card.getByRole("button", { name: "Save card review", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("Capture card changed");
    expect((await (await page.request.get(`${reviewEndpoint}?photoId=${photos[0]}`)).json()).review.condition).toBe("HP");
    await card.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),draftKey)).toBeNull();
    await page.reload(); await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: "Correct", exact: true }).click();
    await expect(card.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("HP");
    await page.evaluate(()=>{Object.defineProperty(Storage.prototype,"setItem",{configurable:true,value:()=>{throw new Error("Fixture quota");}});});
    expect(await page.evaluate(()=>{try{localStorage.setItem("fixture-check","x");return false;}catch{return true;}})).toBe(true);
    await card.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("DMG");
    await expect(card).toContainText("Save the review before leaving this page");
    await card.getByRole("button", { name: "Save card review", exact: true }).click();
    await expect(card).toContainText("Review saved. Not yet added to Inventory.");
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    await expect(page.getByText("The correction library has reached its allowance. Originals will stay protected until space is available or you remove the examples.")).toBeVisible();
    await page.goto("/imports/corrections");await expect(page.getByRole("heading",{name:"Correction photos",exact:true})).toBeVisible();
    await expect(page.getByText(/The library allowance is full/)).toBeVisible();
    expect(Number(database(`console.log(await p.correctionRetentionPin.count({where:{ownerPlayerId:${JSON.stringify(tag)},releasedAt:null}}));`))).toBe(2);
    expect(await page.getByRole("button",{name:"View original",exact:true}).count()).toBe(0);
    database(`const n=${JSON.stringify(tag)};await p.correctionLibraryAccount.update({where:{ownerPlayerId:n},data:{limitBytes:64000000000n}});await p.correctionCaptureOutbox.updateMany({where:{blob:{ownerPlayerId:n}},data:{availableAt:new Date(0)}});`);
    await expect.poll(async()=>{
      const response=await page.request.get(`/api/acquisition/corrections?owner=${tag}`);
      return (await response.json()).examples[0]?.blob.state;
    },{timeout:45000}).toBe("PRESERVED");
    await page.reload();
    await expect(page.getByText(/of 64 GB/)).toBeVisible();
    expect(await page.getByRole("img",{name:"Preserved original correction photo",exact:true}).count()).toBe(0);
    let originalReads=0;page.on("request",request=>{if(new URL(request.url()).pathname.match(/\/api\/acquisition\/corrections\/[a-f0-9-]{36}$/)&&request.method()==="GET")originalReads++;});
    const article=page.getByRole("article").filter({has:page.getByRole("heading",{name:/Fixture corrected printing/})}).first();
    await article.getByRole("button",{name:"View original",exact:true}).click();
    const picture=article.getByRole("img",{name:"Preserved original correction photo",exact:true});
    await expect(picture).toBeVisible();await expect.poll(()=>picture.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(300);
    expect(originalReads).toBe(1);
    const viewedId=new URL((await picture.getAttribute("src"))!,baseURL).pathname.split("/").at(-1);
    const example=(await (await page.request.get(`/api/acquisition/corrections?owner=${tag}`)).json()).examples.find((entry:{id:string})=>entry.id===viewedId);
    const download=await page.request.get(`/api/acquisition/corrections/${example.id}?owner=${tag}`);
    expect(download.ok()).toBe(true);expect(download.headers()["cache-control"]).toContain("no-store");expect(await download.body()).toEqual(bytes);
    const peerExample=database(`const n=${JSON.stringify(peer)},library=require('./lib/acquisition-correction-library.ts'),files=require('./lib/acquisition-correction-files.ts');await p.player.create({data:{id:n,name:n,displayName:n}});await p.$transaction(tx=>library.ensureCorrectionAccount(tx,n));const digest=${JSON.stringify(createHash("sha256").update(bytes).digest("hex"))},raw=await files.readCorrectionBlob(${JSON.stringify(tag)},digest,${bytes.length});const staged=await files.prepareCorrectionBlob(n,digest,raw,require('crypto').randomUUID());try{await staged.publish();}finally{await staged.cleanup();}const blob=await p.correctionBlob.create({data:{ownerPlayerId:n,digest,bytes:raw.length,mediaType:'image/jpeg',state:'PRESERVED',preservedAt:new Date()}});await p.correctionLibraryAccount.update({where:{ownerPlayerId:n},data:{preservedBytes:raw.length}});const e=await p.correctionExample.create({data:{ownerPlayerId:n,blobId:blob.id,sourcePhotoId:require('crypto').randomUUID(),sourceCandidateId:require('crypto').randomUUID(),sourceSessionId:require('crypto').randomUUID(),sourceGeneration:1,physicalCopyGroup:require('crypto').randomUUID(),label:{printing:{name:'Other owner private label'}}}});console.log(e.id);`).trim();
    for(const request of [page.request.get(`/api/acquisition/corrections?owner=${peer}`),page.request.get(`/api/acquisition/corrections/${peerExample}?owner=${peer}`),
      page.request.post(`/api/acquisition/corrections/${peerExample}`,{headers:{origin:baseURL!},data:{owner:peer,action:"REMOVE"}})])expect((await request).ok()).toBe(false);
    const anonymous=await browser.newContext();try{expect((await anonymous.request.get(`${baseURL}/api/acquisition/corrections?owner=${tag}`)).ok()).toBe(false);}finally{await anonymous.close();}
    for(const width of [1366,320]){
      await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/correction-library-${width}.png`});
    }
    const eventsBefore=Number(database(`console.log(await p.correctionReviewEvent.count({where:{ownerPlayerId:${JSON.stringify(tag)}}}));`));
    await article.getByRole("button",{name:"Withdraw label",exact:true}).click();await expect(page.getByText("Label withdrawn",{exact:false})).toBeVisible();
    expect(Number(database(`console.log(await p.correctionReviewEvent.count({where:{ownerPlayerId:${JSON.stringify(tag)}}}));`))).toBe(eventsBefore);
    const withdrawn=page.getByRole("article").filter({hasText:"Label withdrawn"});
    await withdrawn.getByRole("button",{name:"Remove example",exact:true}).click();await expect(withdrawn).toContainText("shared with another of your examples");
    await withdrawn.getByRole("button",{name:"Keep example",exact:true}).click();expect(Number(database(`console.log(await p.correctionDeletionTombstone.count({where:{ownerPlayerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    await withdrawn.getByRole("button",{name:"Remove example",exact:true}).click();await withdrawn.getByRole("button",{name:"Confirm removal",exact:true}).click();
    await expect(page.getByText("Label withdrawn",{exact:false})).toHaveCount(0);
    expect(Number(database(`console.log(await p.correctionDeletionTombstone.count({where:{ownerPlayerId:${JSON.stringify(tag)}}}));`))).toBe(1);
    expect((await page.request.get(`/api/acquisition/corrections/${example.id}?owner=${tag}`)).ok()).toBe(false);
    expect(Number(database(`console.log((await require('./lib/acquisition-correction-files.ts').readCorrectionBlob(${JSON.stringify(peer)},${JSON.stringify(createHash("sha256").update(bytes).digest("hex"))},${bytes.length})).length);`))).toBe(bytes.length);
    // Pagination remains bounded, including a deleted cursor boundary. These
    // independent synthetic memberships intentionally share the preserved blob.
    database(`const n=${JSON.stringify(tag)};const e=await p.correctionExample.findFirstOrThrow({where:{ownerPlayerId:n,deletedAt:null}});await p.correctionExample.createMany({data:Array.from({length:51},(_,i)=>({ownerPlayerId:n,blobId:e.blobId,sourcePhotoId:require('crypto').randomUUID(),sourceCandidateId:require('crypto').randomUUID(),sourceSessionId:require('crypto').randomUUID(),sourceGeneration:1,physicalCopyGroup:require('crypto').randomUUID(),label:{printing:{name:'Pagination fixture '+i}},createdAt:new Date(Date.UTC(2000,0,1)+i)}))});`);
    await page.reload();await expect(page.getByRole("article")).toHaveCount(50);
    const listed=await (await page.request.get(`/api/acquisition/corrections?owner=${tag}`)).json();
    expect((await page.request.post(`/api/acquisition/corrections/${listed.nextCursor}`,{headers:{origin:baseURL!},data:{owner:tag,action:"REMOVE"}})).ok()).toBe(true);
    await page.getByRole("button",{name:"Next",exact:true}).click();await expect(page.getByRole("article")).toHaveCount(2);
    await page.getByRole("button",{name:"Previous",exact:true}).click();await expect(page.getByRole("article")).toHaveCount(50);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    expect((await (await page.request.get(`${reviewEndpoint}?photoId=${photos[0]}`)).json()).review.condition).toBe("DMG");
  } finally {
    await page.unrouteAll({behavior:"wait"});
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      ${cleanupCorrectionFixture}
      {const n=${JSON.stringify(peer)};${cleanupCorrectionFixture}await p.player.deleteMany({where:{id:n}});}
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:{in:${JSON.stringify([original.id, alternate.id])}}}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');
      for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});
