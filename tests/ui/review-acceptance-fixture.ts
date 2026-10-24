import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";

export function reviewDatabase<T = unknown>(body: string): T {
  const container = process.env.MTG_INVENTORY_TEST_CONTAINER || "";
  const database = process.env.MTG_INVENTORY_TEST_DATABASE || "";
  if (process.env.MTG_REVIEW_ACCEPTANCE_TEST !== "1" || !/^[a-f0-9]{64}$/.test(container) || !/^review\w+$/.test(database))
    throw Error("Requires explicit isolated review fixture opt-in and immutable target");
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30_000,
    input: `const {PrismaClient,Prisma}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify("/" + database)})throw Error('Wrong isolated fixture database');const root=process.env.UPLOADS_DATA_PATH;if(!root||!require('path').isAbsolute(root))throw Error('Isolated uploads required');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
export function reviewFingerprint() {
  return reviewDatabase(`const result={};for(const {tablename} of await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unexpected table');const rows=await p.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);
}

/** One actual upload/review, expanded into explicit persisted presentation
 * fixtures with distinct physical/source identities and byte-identical files.
 * Never claims count provider acknowledgements, human labels or native work. */
export async function setupReviewFixture(page: Page, baseURL: string, tag: string, count: number) {
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  if (!/^ui-review-acceptance-[a-f0-9-]{36}$/.test(tag) || count !== 300) throw Error("Unexpected bounded fixture");
  const token = randomBytes(32).toString("base64url"), peerToken = randomBytes(32).toString("base64url");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const printing = { id: tag + "-card", name: "Review acceptance fixture", setCode: "tst", collectorNumber: "1", lang: "en", imageUri: null, finishes: ["nonfoil"] };
  reviewDatabase(`const n=${JSON.stringify(tag)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{await tx.player.create({data:{id:n,name:n,displayName:n}});for(const [id,tokenHash] of [[n,${JSON.stringify(hash(token))}],[n+'-peer',${JSON.stringify(hash(peerToken))}]]){await tx.user.create({data:{id,username:id,displayName:id,playerId:n,passwordHash}});await tx.authSession.create({data:{tokenHash,userId:id,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+900000)}});}await tx.inventoryLocation.create({data:{id:n,name:'Review acceptance box',normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:400,sections:[]}}});await tx.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Artifact',rarity:'common'}});});return true;`);
  await page.context().addCookies([{ name: "mtg_inventory_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const headers = { origin: baseURL };
  const created = await page.request.post("/api/acquisition", { headers, data: { requestKey: randomUUID(), locationId: tag, section: "", quantity: count } });
  expect(created.ok(), await created.text()).toBe(true); const batch = (await created.json()).id as string;
  const reserved = await page.request.post(`/api/acquisition/${batch}`, { headers, data: { action: "reserve", requestKey: randomUUID() } });
  expect(reserved.ok()).toBe(true); const { slot } = await reserved.json();
  const bytes = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#335577" } }).jpeg().toBuffer();
  const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}`, { headers: { ...headers, "content-type": "image/jpeg" }, data: bytes });
  expect(uploaded.ok(), await uploaded.text()).toBe(true); const photo = (await uploaded.json()).id as string;
  reviewDatabase(`const w={run:{sessionId:${JSON.stringify(batch)}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Unexpected fixture worker');await p.acquisitionProcessingJob.updateMany({where:{...w,status:'PENDING'},data:{status:'FAILED',errorCode:'CONTROLLED_UI_FIXTURE'}});return true;`);
  const endpoint = `/api/acquisition/${batch}/review`;
  const original = await (await page.request.get(`${endpoint}?photoId=${photo}`)).json();
  const accepted = await page.request.post(endpoint, { headers, data: { action: "accept", photoId: photo, revision: original.revision, decision: { cardId: printing.id, finish: "NONFOIL", condition: "NM", language: "en" }, evidenceTokens: { current: original.evidenceToken } } });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  reviewDatabase(`const original=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photo)}}}),runId=original.runId;const candidate=await p.acquisitionCandidate.findUniqueOrThrow({where:{runId_physicalId:{runId,physicalId:original.slotId}}});const observation=await p.acquisitionObservation.findFirstOrThrow({where:{candidateId:candidate.id}}),artifact=await p.acquisitionArtifact.findUniqueOrThrow({where:{id:observation.artifactId}});const slots=[],photos=[],candidates=[],artifacts=[],observations=[],uuid=()=>require('crypto').randomUUID();for(let index=1;index<${count};index++){const slotId=uuid(),photoId=uuid(),candidateId=uuid(),artifactId=uuid();slots.push({id:slotId,runId,requestKey:uuid(),position:index,generation:original.generation});const copy={...original,id:photoId,slotId,uploadKey:uuid()};for(const field of ['sourceMetadata','firstMachineEvidence'])if(copy[field]===null)delete copy[field];photos.push(copy);const choice={...candidate,id:candidateId,physicalId:slotId,acquisitionOrder:index};for(const field of ['proposal','manualAnalysis'])if(choice[field]===null)delete choice[field];candidates.push(choice);artifacts.push({...artifact,id:artifactId,sourceId:photoId});observations.push({...observation,id:uuid(),sourceId:photoId,candidateId,artifactId});}await p.acquisitionCaptureSlot.createMany({data:slots});await p.acquisitionPhoto.createMany({data:photos});await p.acquisitionArtifact.createMany({data:artifacts});await p.acquisitionCandidate.createMany({data:candidates});await p.acquisitionObservation.createMany({data:observations});const fs=require('fs/promises'),paths=require('path');for(const copy of photos)await fs.copyFile(paths.join(root,'acquisition-v1',original.id+'.original'),paths.join(root,'acquisition-v1',copy.id+'.original'),require('fs').constants.COPYFILE_EXCL);await p.acquisitionCandidate.updateMany({where:{runId,acquisitionOrder:1},data:{uncertainty:['MULTIFEED'],countConfirmed:false}});await p.acquisitionCandidate.updateMany({where:{runId,acquisitionOrder:${count-1}},data:{review:Prisma.DbNull}});await p.acquisitionSession.update({where:{id:${JSON.stringify(batch)}},data:{target:${count-1}}});return true;`);
  const progress = await (await page.request.get(`/api/acquisition/${batch}`)).json();
  expect(progress.slots).toHaveLength(count);
  const stopped = await page.request.post(`/api/acquisition/${batch}`, { headers, data: { action: "control", requestKey: randomUUID(), revision: progress.revision, command: "STOP" } });
  expect(stopped.ok(), await stopped.text()).toBe(true);
  return { batch, photo, endpoint, headers, printing, peerToken };
}

export function reviewSourceState(batch: string) {
  return reviewDatabase<{ photos: unknown[]; candidates: { id: string; acquisitionOrder: number; revision: number; review: unknown }[] }>(`const photos=await p.acquisitionPhoto.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{id:'asc'}}),fs=require('fs/promises'),paths=require('path');for(const photo of photos){const bytes=await fs.readFile(paths.join(root,'acquisition-v1',photo.id+'.original'));photo.actualDigest=require('crypto').createHash('sha256').update(bytes).digest('hex');if(photo.actualDigest!==photo.digest||bytes.length!==photo.bytes)throw Error('Fixture original identity mismatch');}return {photos,candidates:await p.acquisitionCandidate.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{acquisitionOrder:'asc'}})};`);
}
export function cleanupReviewFixture(tag: string, cardId: string) {
  reviewDatabase(`const n=${JSON.stringify(tag)};if(!/^ui-review-acceptance-[a-f0-9-]{36}$/.test(n))throw Error('Unexpected fixture owner');await p.acquisitionSession.updateMany({where:{ownerPlayerId:n},data:{phase:'CANCELLED'}});const w={run:{session:{ownerPlayerId:n}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Live fixture job prevents cleanup');const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUser:{playerId:n}}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{user:{playerId:n}}});await p.user.deleteMany({where:{playerId:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(cardId)}}});const fs=require('fs/promises'),paths=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Unexpected fixture photo');await fs.unlink(paths.join(root,'acquisition-v1',photo.id+'.original')).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.unlink(paths.join(root,'acquisition-v1',photo.id+'.preview.jpg')).catch(e=>{if(e.code!=='ENOENT')throw e;});}return true;`);
}
