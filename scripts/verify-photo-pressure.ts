import assert from "node:assert/strict";
import {randomUUID, createHash} from "node:crypto";
import {mkdtemp, mkdir, rm, writeFile, access} from "node:fs/promises";
import path from "node:path";
import type {PrismaClient} from "@prisma/client";
import {purgeAcquisitionPhotosUnderPressure} from "../lib/acquisition-photo-pressure";
import {manageAcquisitionBatch} from "../lib/acquisition-batch-lifecycle";
import {eligibleScannerOriginals} from "../lib/scanner-retention";
import {createScannerPairing, claimScannerPairing} from "../lib/scanner-store";
import {scannerSecret} from "../lib/scanner-protocol";

// Runs only against the existing disposable PostgreSQL qualification harness.
// Quota metadata represents 10 MiB originals; actual private files are tiny.
export async function verifyPhotoPressure(db: PrismaClient) {
  const tag = "photo-pressure-"+randomUUID(), other = tag+"-other", agentId = randomUUID(), epoch = randomUUID();
  await mkdir(path.resolve(".local-data"), {recursive: true});
  const root = await mkdtemp(path.resolve(".local-data/photo-pressure-"));
  const oldRoot = process.env.UPLOADS_DATA_PATH, oldLimit = process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB;
  process.env.UPLOADS_DATA_PATH = root;
  process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB = "1";
  const bytes = Buffer.from("synthetic pressure-cleanup original"), digest = createHash("sha256").update(bytes).digest("hex");
  const file = (id: string) => path.join(root,"acquisition-v1",id+".original");
  const sessions: string[] = [], runIds: string[] = [];
  try {
    for (const id of [tag,other]) {
      await db.player.create({data: {id,name: id,displayName: id}});
      await db.user.create({data: {id,username: id,displayName: id,playerId: id,passwordHash: "fixture-not-login"}});
    }
    const pair = await createScannerPairing(db,tag), secret = scannerSecret();
    await claimScannerPairing(db,{version: 1,pairCode: pair.code,agentId,secret,name: "Pressure fixture; no hardware"});
    const authorization = "Bearer "+agentId+"."+secret;
    const card = await db.card.create({data: {scryfallId: tag,name: tag,setCode: "tst",collectorNumber: "1",typeLine: "Creature",rarity: "common",lang: "en",digital: false,finishes: ["nonfoil"]}});
    const inventory = await db.inventoryItem.create({data: {currentOwnerId: tag,cardId: card.id,quantity: 30,condition: "NM",sourceType: "MANUAL"}});
    await mkdir(path.join(root,"acquisition-v1"));
    async function batch(kind: "complete"|"trash"|"active"|"unfinished"|"series"|"foreign", count: number, age: number) {
      const id = randomUUID(), runId = randomUUID(), scanId = randomUUID(), now = new Date();
      sessions.push(id); runIds.push(runId);
      await db.acquisitionSession.create({data: {id,createdByUserId: kind === "foreign" ? other : tag,ownerPlayerId: kind === "foreign" ? other : tag,
        section: "fixture",requestKey: id,requestPayload: "{}",placement: {},policy: {},phase: kind === "active" ? "CAPTURING" : kind === "trash" ? "CANCELLED" : "COMPLETE",
        createdAt: new Date(now.getTime()-age*1000),...(kind === "trash" ? {trashedAt: now,trashExpiresAt: new Date(now.getTime()+7*86400000)} : {}),
        run: {create: {id: runId,sourceRunId: id,providerId: "fixture",enforcement: "NONE",controls: []}}}});
      await db.scannerRun.create({data: {id: scanId,agentId,acquisitionRunId: runId,epoch,requestPayload: "{}",deviceId: "fixture",device: {},settings: {},executionId: randomUUID(),status: kind === "unfinished" ? "STARTED" : "DRAINED",
        ...(kind === "unfinished" ? {} : {admissionReleasedAt: now}),
        ...(kind === "series" ? {seriesRootId: scanId} : {})}});
      const commit = kind === "complete" || kind === "unfinished" || kind === "series" ? await db.acquisitionCommit.create({data: {runId,actorUserId: tag,requestKey: id,requestDigest: digest,snapshot: {}}}) : null;
      const photos: {artifactId: string; photoId: string; digest: string}[] = [];
      for (let position = 0; position < count; position++) {
        const slot = await db.acquisitionCaptureSlot.create({data: {runId,requestKey: randomUUID(),position}});
        const photo = await db.acquisitionPhoto.create({data: {runId,slotId: slot.id,uploadKey: slot.requestKey,generation: 1,digest,bytes: 10*1024**2,mediaType: "image/png",width: 75,height: 105,ready: true,readyAt: now}});
        const candidate = await db.acquisitionCandidate.create({data: {runId,physicalId: slot.id,identityKind: "NATIVE",acquisitionOrder: position,spatialOrder: 0,expectedSides: ["FRONT"],provisional: false,uncertainty: [],revision: 0}});
        if (commit) await db.acquisitionCommitMember.create({data: {runId,candidateId: candidate.id,commitId: commit.id,inventoryItemId: inventory.id,snapshot: {}}});
        await writeFile(file(photo.id),bytes); await writeFile(path.join(root,"acquisition-v1",photo.id+".preview.jpg"),bytes);
        photos.push({artifactId: slot.requestKey,photoId: photo.id,digest});
      }
      return {id,runId,scanId,photos};
    }
    const protectedBatches = [await batch("unfinished",10,600),await batch("series",10,500),await batch("active",40,400)];
    const complete = await batch("complete",30,300), trash = await batch("trash",20,200), foreign = await batch("foreign",5,700);
    // Fully received CAPTURE COMPLETE with uncommitted candidates is still review work.
    const review = await batch("active",1,800);
    await db.acquisitionSession.update({where: {id: review.id},data: {phase: "COMPLETE"}});
    protectedBatches.push(review);
    // Simulate unlink failure AFTER a successful durable deletion commit.
    process.env.UPLOADS_DATA_PATH = "relative-invalid-fixture-path";
    const first = await purgeAcquisitionPhotosUnderPressure(db);
    assert.equal(first.expired,2); assert.equal(first.purged,0); assert.equal(first.failed,45);
    assert.ok((await db.acquisitionSession.findUniqueOrThrow({where: {id: complete.id}})).deletedAt);
    await assert.rejects(manageAcquisitionBatch(db,{userId: tag,adminMode: false},trash.id,"restore"),/expired/);
    process.env.UPLOADS_DATA_PATH = root;
    const second = await purgeAcquisitionPhotosUnderPressure(db);
    assert.equal(second.expired,0); assert.equal(second.purged,45); assert.equal(second.failed,0);
    assert.equal((await purgeAcquisitionPhotosUnderPressure(db)).purged,5);
    assert.equal((await purgeAcquisitionPhotosUnderPressure(db)).purged,0);
    for (const b of [...protectedBatches,foreign]) {
      assert.equal((await db.acquisitionSession.findUniqueOrThrow({where: {id: b.id}})).deletedAt,null);
      assert.equal(await db.acquisitionPhoto.count({where: {runId: b.runId,purgedAt: {not: null}}}),0);
      await access(file(b.photos[0].photoId));
    }
    for (const p of [...complete.photos,...trash.photos]) {
      await assert.rejects(access(file(p.photoId)));
      await assert.rejects(access(path.join(root,"acquisition-v1",p.photoId+".preview.jpg")));
    }
    assert.equal((await db.inventoryItem.findUniqueOrThrow({where: {id: inventory.id}})).quantity,30);
    assert.equal(await db.acquisitionCommitMember.count({where: {runId: complete.runId}}),30);
    const retention = await eligibleScannerOriginals(db,authorization,{version: 1,runId: complete.scanId,epoch,artifacts: complete.photos},epoch);
    assert.equal(retention.eligible.length,30);
    assert.equal((await eligibleScannerOriginals(db,authorization,{version: 1,runId: complete.scanId,epoch,artifacts: [{...complete.photos[0],digest: "0".repeat(64)}]},epoch)).eligible.length,0);
    console.log("PASS: pressure cleanup deletes only settled completed/trashed batches, commits tombstones before unlink, retries below pressure, preserves Inventory/receipts/other owners/unfinished transfers/reviews/series, and attests matching helper originals");
  } finally {
    if (oldRoot === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = oldRoot;
    if (oldLimit === undefined) delete process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB; else process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB = oldLimit;
    const where = {runId: {in: runIds}};
    await db.scannerRun.deleteMany({where: {acquisitionRunId: {in: runIds}}});
    await db.acquisitionCommitMember.deleteMany({where}); await db.acquisitionCommit.deleteMany({where});
    await db.acquisitionProcessingJob.deleteMany({where}); await db.acquisitionCommand.deleteMany({where});
    await db.acquisitionPhoto.deleteMany({where}); await db.acquisitionCaptureSlot.deleteMany({where});
    await db.acquisitionCandidate.deleteMany({where}); await db.acquisitionRun.deleteMany({where: {id: {in: runIds}}});
    await db.acquisitionSession.deleteMany({where: {id: {in: sessions}}});
    await db.scannerAgent.deleteMany({where: {userId: tag}}); await db.scannerPairing.deleteMany({where: {userId: tag}});
    await db.inventoryItem.deleteMany({where: {currentOwnerId: tag}}); await db.card.deleteMany({where: {scryfallId: tag}});
    await db.user.deleteMany({where: {id: {in: [tag,other]}}}); await db.player.deleteMany({where: {id: {in: [tag,other]}}});
    await rm(root,{recursive: true,force: true});
  }
}
