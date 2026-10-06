import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { type PrismaClient } from "@prisma/client";
import { createScannerPairing, claimScannerPairing, recordScannerPulse } from "../lib/scanner-store";
import { scannerSecret } from "../lib/scanner-protocol";
import { scannerSiteEpoch, scannerStartMarkerExists } from "../lib/scanner-control-files";
import { COUNTED_SCANNER_DEVICE, COUNTED_SCANNER_BACKEND, countedScannerSettings as settings } from "../lib/scanner-counted-profile";
import { createScannerBatch, claimScannerRun, receiveScannerImage, finishScannerRun, reconcileScannerBatch,
  refillScannerBatch, endScannerBatch, stopScannerBatch, stopScannerSeries, getScannerBatch, pollScannerRun } from "../lib/scanner-runs";
import { readScannerCapacity, readScannerCapacitySnapshot } from "../lib/scanner-capacity";
import { scannerContinuation, currentScannerContinuation } from "../lib/scanner-continuation";
import { getAcquisitionSession, saveAcquisitionReview, getAcquisitionCardReview } from "../lib/acquisition-store";
import { previewAcquisitionCommit, commitAcquisitionCards } from "../lib/acquisition-commit-service";
import { manageAcquisitionBatch } from "../lib/acquisition-batch-lifecycle";
import { purgeTrashedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
import {Prisma} from "@prisma/client";
import {eligibleScannerOriginals} from "../lib/scanner-retention";

// Disposable PostgreSQL protocol qualification. All images are synthetic and
// no native backend is created; an 83-image pass is not an 83-card feed pass.
export async function verifyCountedScanner(db: PrismaClient) {
  const tag = "counted-scanner-"+randomUUID(), foreign = tag+"-foreign";
  const parent = path.resolve(".local-data"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent,"counted-scanner-db-")), oldRoot = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  const actor = { userId: tag, adminMode: false }, epoch = await scannerSiteEpoch();
  const source = { id: COUNTED_SCANNER_DEVICE, name: "Counted fixture (no hardware)", backend: COUNTED_SCANNER_BACKEND,
    source: "Twain", qualification: "KnownWorking" };
  const bytes = await sharp({create:{width:75,height:105,channels:3,background:"white"}}).png().toBuffer();
  const createdLocations: string[] = [];
  try {
    for (const id of [tag,foreign]) {
      await db.player.create({data:{id,name:id,displayName:id}});
      await db.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash:"fixture-not-login"}});
    }
    const card = await db.card.create({data:{scryfallId:tag,name:tag,setCode:"tst",collectorNumber:"1",typeLine:"Creature",rarity:"common",lang:"en",digital:false,finishes:["nonfoil"]}});
    const decision = { cardId: card.id, language:"en", finish:"NONFOIL", condition:"NM" };
    async function location(total:number|null, sections:{name:string;capacity:number}[]) {
      const id=tag+"-box-"+createdLocations.length; createdLocations.push(id);
      await db.inventoryLocation.create({data:{id,name:id,normalizedName:id,ownerPlayerId:tag,type:"Box",storageLayout:{capacity:total,sections}}}); return id;
    }
    async function enroll() {
      const pair=await createScannerPairing(db,tag),agentId=randomUUID(),secret=scannerSecret();
      await claimScannerPairing(db,{version:1,pairCode:pair.code,agentId,secret,name:"Counted fixture"});
      const token="Bearer "+agentId+"."+secret;
      const pulse=(devices=[source])=>recordScannerPulse(db,token,{version:1,agentVersion:"fixture",devices});
      await pulse(); return {agentId,token,pulse};
    }
    const first=await enroll(),second=await enroll();
    const box=await location(170,[{name:"A",capacity:85},{name:"B",capacity:85}]);
    await db.inventoryItem.create({data:{currentOwnerId:tag,cardId:card.id,quantity:2,locationId:box,locationSection:"A",foilStatus:"NONFOIL",condition:"NM",sourceType:"MANUAL"}});
    const setup=(helper:typeof first,locationId=box,section="A",quantity:number|null=null,loadedCount:number|null=null)=>({
      requestKey:randomUUID(),agentId:helper.agentId,deviceId:source.id,locationId,section,quantity,loadedCount,settings,operatorLoadedSimplexFronts:true});
    const capacity=(locationId=box,section="A",excludeSessionId?:string)=>db.$transaction(tx=>readScannerCapacity(tx,{locationId,section,ownerPlayerId:tag,excludeSessionId}));
    assert.equal((await capacity()).remaining,83);
    const beforeQualification = await db.acquisitionSession.count({where:{createdByUserId:tag}});
    await first.pulse([{...source,qualification:"GenericUnqualified"}]);
    await assert.rejects(createScannerBatch(db,actor,setup(first),epoch));
    assert.equal(await db.acquisitionSession.count({where:{createdByUserId:tag}}),beforeQualification);
    assert.equal((await capacity()).remaining,83);
    await first.pulse();
    // No section is direct placement in the parent, even if named sections exist.
    const directInput=setup(first,box,"",null);
    const direct=await createScannerBatch(db,actor,directInput,epoch);
    assert.equal(direct.physicalTarget,168); assert.equal(direct.logicalTarget,168);
    assert.equal((await getScannerBatch(db,tag,direct.runId)).series,null);
    assert.equal((await getAcquisitionSession(db,actor,direct.sessionId)).session.placement.section,"");
    assert.deepEqual(await createScannerBatch(db,actor,directInput,epoch),direct);
    assert.equal((await capacity(box,"B")).remaining,0);
    assert.equal((await capacity(box,"")).pendingSection,168);
    const beforeDirectRefusal=await db.acquisitionSession.count({where:{createdByUserId:tag}});
    await assert.rejects(createScannerBatch(db,actor,setup(second,box,"B",1),epoch));
    assert.equal(await db.acquisitionSession.count({where:{createdByUserId:tag}}),beforeDirectRefusal);
    await stopScannerBatch(db,tag,direct.runId);
    assert.equal((await capacity(box,"")).remaining,168);
    const directFixed=await createScannerBatch(db,actor,setup(first,box,"",3),epoch);
    assert.equal(directFixed.physicalTarget,3);
    await stopScannerBatch(db,tag,directFixed.runId);
    await assert.rejects(createScannerBatch(db,actor,setup(first,box,"",169),epoch),/remaining capacity/);
    const unbounded=await location(null,[]);
    const beforeUnbounded=await db.acquisitionSession.count({where:{createdByUserId:tag}});
    await assert.rejects(createScannerBatch(db,actor,setup(first,unbounded,""),epoch));
    assert.equal(await db.acquisitionSession.count({where:{createdByUserId:tag}}),beforeUnbounded);
    const unboundedFixed=await createScannerBatch(db,actor,setup(first,unbounded,"",2),epoch);
    assert.equal(unboundedFixed.physicalTarget,2);
    await stopScannerBatch(db,tag,unboundedFixed.runId);
    await assert.rejects(createScannerBatch(db,actor,{...setup(first,box,""),continuous:true},epoch),/Choose a section/);
    await assert.rejects(createScannerBatch(db,actor,{...setup(first,unbounded,""),continuous:true},epoch),/Choose a section/);
    await assert.rejects(createScannerBatch(db,actor,setup(first,box,"missing"),epoch),/Choose a section/);
    const large=await createScannerBatch(db,actor,setup(first,box,"A",null,84),epoch);
    assert.equal(large.physicalTarget,83); assert.equal(large.logicalTarget,83); assert.equal(large.counted,true);
    assert.equal((await capacity()).remaining,0);
    await assert.rejects(createScannerBatch(db,actor,setup(second),epoch));
    assert.equal((await capacity(box,"B")).remaining,85);
    // A busy-helper refusal must roll back the admission reservation/session.
    const beforeBusy = await db.acquisitionSession.count({where:{createdByUserId:tag}});
    await assert.rejects(createScannerBatch(db,actor,setup(first,box,"B",1),epoch),/unfinished batch/);
    assert.equal(await db.acquisitionSession.count({where:{createdByUserId:tag}}),beforeBusy);
    assert.equal((await capacity(box,"B")).remaining,85);
    const claim=async(helper:typeof first,runId:string)=>{
      await helper.pulse(); const c={version:1,runId,epoch,executionId:randomUUID()};
      assert.equal((await claimScannerRun(db,helper.token,c,epoch)).feedAuthorized,true); return c;
    };
    const images=async(helper:typeof first,c:Awaited<ReturnType<typeof claim>>,count:number)=>{
      const values=[];
      for(let sequence=1;sequence<=count;sequence++) {
        const t={...c,artifactId:randomUUID(),sequence,timestamp:new Date().toISOString(),side:"UNKNOWN",physicalBoundary:"UNKNOWN"};
        if (count === 83 && sequence === 1) {
          const acquisitionRun = await db.acquisitionRun.findUniqueOrThrow({where: {sessionId: large.sessionId}});
          const quotaSlots = Array.from({length: 103}, (_,i) => ({id: randomUUID(),runId: acquisitionRun.id,requestKey: randomUUID(),position: 1000+i}));
          const oldLimit = process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB;
          const oldBatchLimit = process.env.ACQUISITION_PHOTO_BATCH_LIMIT_GIB;
          try {
            // Metadata-only retained originals exercise billing without allocating a GiB.
            await db.acquisitionCaptureSlot.createMany({data: quotaSlots});
            await db.acquisitionPhoto.createMany({data: quotaSlots.map(slot => ({id: randomUUID(),runId: slot.runId,slotId: slot.id,
              uploadKey: slot.requestKey,generation: 1,digest: "0".repeat(64),bytes: 10*1024**2,mediaType: "image/png",width: 75,height: 105,ready: true,readyAt: new Date()}))});
            process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB = "1";
            process.env.ACQUISITION_PHOTO_BATCH_LIMIT_GIB = "4";
            await assert.rejects(receiveScannerImage(db,helper.token,t,epoch,bytes,"image/png"),/Photo storage limit reached/);
            const blocked = await getScannerBatch(db,tag,c.runId);
            assert.equal(blocked.status,"STARTED"); assert.equal((blocked.uploadProblem as Prisma.JsonObject)?.code,"PHOTO_STORAGE_LIMIT");
            assert.equal(blocked.preflightProblem,null);
            process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB = "64";
            const receipt = await receiveScannerImage(db,helper.token,t,epoch,bytes,"image/png");
            assert.equal(receipt.ready,true);
            assert.equal((await getScannerBatch(db,tag,c.runId)).uploadProblem,null);
            const replay = await receiveScannerImage(db,helper.token,t,epoch,bytes,"image/png");
            assert.equal(replay.photoId,receipt.photoId);
          } finally {
            if (oldLimit === undefined) delete process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB; else process.env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB = oldLimit;
            if (oldBatchLimit === undefined) delete process.env.ACQUISITION_PHOTO_BATCH_LIMIT_GIB; else process.env.ACQUISITION_PHOTO_BATCH_LIMIT_GIB = oldBatchLimit;
            await db.acquisitionPhoto.deleteMany({where: {slotId: {in: quotaSlots.map(s => s.id)}}});
            await db.acquisitionCaptureSlot.deleteMany({where: {id: {in: quotaSlots.map(s => s.id)}}});
          }
        }
        values.push({transfer:t,ack:await receiveScannerImage(db,helper.token,t,epoch,bytes,"image/png")});
      } return values;
    };
    const finish=async(helper:typeof first,c:Awaited<ReturnType<typeof claim>>,count:number,empty:boolean)=>{
      const outcome={outcome:empty?"SOURCE_EXHAUSTED":"COMPLETED",imageCount:count,elapsedMs:100,knownPhysicalItems:null,
        sourceExhausted:empty?"REPORTED_EMPTY":"UNKNOWN",nativeError:null};
      await finishScannerRun(db,helper.token,{...c,outcome},epoch); return outcome;
    };
    const observe=(runId:string,count:number,remaining=0)=>({runId,cardsEmitted:count,feederEmpty:remaining===0,remainingCards:remaining,
      remainingWhollyInHopper:true,transportEmpty:true,eachImageIsOneCardFront:true,noJamOrDouble:true});
    // A source can lose qualification after admission, before durable START.
    // Refusal preserves the queued run and its reservation without a marker.
    for (const devices of [[{...source,qualification:"Unsupported"}],
      [{...source,qualification:"GenericUnqualified"}], [], [{...source,backend:"another-backend"}]]) {
      await first.pulse(devices);
      await assert.rejects(claimScannerRun(db,first.token,{version:1,runId:large.runId,epoch,executionId:randomUUID()},epoch));
      assert.equal(await scannerStartMarkerExists(large.runId),false);
      assert.equal((await getScannerBatch(db,tag,large.runId)).status,"QUEUED");
      assert.equal((await capacity()).remaining,0);
    }
    await db.scannerAgent.update({where:{id:first.agentId},data:{lastSeenAt:new Date(Date.now()-31000)}});
    await assert.rejects(claimScannerRun(db,first.token,{version:1,runId:large.runId,epoch,executionId:randomUUID()},epoch));
    assert.equal(await scannerStartMarkerExists(large.runId),false);
    const largeClaim=await claim(first,large.runId);
    await first.pulse([{...source,qualification:"Unsupported"}]);
    // Existing START replay and retained image delivery are still recoverable.
    assert.equal((await claimScannerRun(db,first.token,largeClaim,epoch)).replay,true);
    const largeImages=await images(first,largeClaim,83);
    await finish(first,largeClaim,83,false);
    assert.equal((await getScannerBatch(db,tag,large.runId)).phase,"COMPLETE");
    assert.equal((await getAcquisitionSession(db,actor,large.sessionId)).session.candidates.filter(c=>c.countConfirmed).length,83);
    assert.equal(((await getScannerBatch(db,tag,large.runId)).reconciliation as {mode?:string})?.mode,"SCANNER_IMAGE_COUNT");
    await assert.rejects(reconcileScannerBatch(db,tag,observe(large.runId,82,2)));
    await reconcileScannerBatch(db,tag,observe(large.runId,83,1));
    assert.equal((await capacity()).remaining,0);
    assert.equal((await db.inventoryItem.aggregate({where:{locationId:box},_sum:{quantity:true}}))._sum.quantity,2);
    const nextPreferences=await scannerContinuation(db,tag,large.runId);
    assert.equal(nextPreferences.nextSectionRequired,undefined);
    assert.equal(currentScannerContinuation(nextPreferences,[{id:box,name:box,sections:[{name:"A",capacity:85,quantity:2},{name:"B",capacity:85,quantity:0}]}]).setup?.section,"A");
    // Saving a review and previewing change no Inventory. A committed receipt
    // replaces one pending card with one stored copy, without counting twice.
    const review=await getAcquisitionCardReview(db,actor,large.sessionId,largeImages[0].ack.photoId);
    await saveAcquisitionReview(db,actor,large.sessionId,{action:"accept",photoId:review.photoId,revision:review.revision,decision});
    const selection={photoIds:[review.photoId],locationId:box,section:"A"};
    const preview=await previewAcquisitionCommit(db,actor,large.sessionId,selection);
    assert.equal((await capacity()).remaining,0);
    await commitAcquisitionCards(db,actor,large.sessionId,{...selection,requestKey:randomUUID(),previewToken:preview.token,overfillReason:null});
    assert.equal((await capacity()).remaining,0); assert.equal((await capacity()).pendingSection,82);
    const snapshot = await db.$transaction(tx => readScannerCapacitySnapshot(tx, { locationId: box, section: "A", ownerPlayerId: tag }));
    assert.equal(snapshot.destination.quantity, 3);
    assert.equal(snapshot.destination.sections.find(section => section.name === "A")?.quantity, 3);
    assert.equal(snapshot.destination.sections.find(section => section.name === "A")?.pendingQuantity, 82);
    assert.equal(snapshot.destination.pendingQuantity, snapshot.pendingTotal);
    assert.equal(snapshot.pendingSections.find(section => section.section === "A")?.quantity, 82);
    assert.equal((await db.inventoryItem.aggregate({where:{locationId:box},_sum:{quantity:true}}))._sum.quantity,3);

    await first.pulse();
    const small=await createScannerBatch(db,actor,setup(first,box,"B",3,2),epoch);
    const smallClaim=await claim(first,small.runId),smallImages=await images(first,smallClaim,2);
    const earlyOutcome=await finish(first,smallClaim,2,true);
    assert.equal((await getScannerBatch(db,tag,small.runId)).phase,"PAUSED");
    assert.equal((await getScannerBatch(db,tag,small.runId)).remainingTarget,1);
    const refill={runId:small.runId,requestKey:randomUUID(),loadedCount:3,operatorLoadedSimplexFronts:true};
    assert.equal(((await getScannerBatch(db,tag,small.runId)).reconciliation as {mode?:string})?.mode,"SCANNER_IMAGE_COUNT");
    await reconcileScannerBatch(db,tag,observe(small.runId,2));
    await assert.rejects(scannerContinuation(db,tag,small.runId),/unfinished batch/);
    const firstReview=await getAcquisitionCardReview(db,actor,small.sessionId,smallImages[0].ack.photoId);
    await saveAcquisitionReview(db,actor,small.sessionId,{action:"accept",photoId:firstReview.photoId,revision:firstReview.revision,decision});
    const saved=await getAcquisitionCardReview(db,actor,small.sessionId,firstReview.photoId);
    await assert.rejects(refillScannerBatch(db,foreign,refill,epoch));
    await assert.rejects(refillScannerBatch(db,tag,refill,randomUUID()));
    await first.pulse();
    const beforeRefillRuns=await db.scannerRun.count({where:{agentId:first.agentId}});
    for (const devices of [[{...source,qualification:"Unsupported"}], [{...source,qualification:"GenericUnqualified"}], []]) {
      await first.pulse(devices);
      await assert.rejects(refillScannerBatch(db,tag,refill,epoch));
      assert.equal(await db.scannerRun.count({where:{agentId:first.agentId}}),beforeRefillRuns);
      assert.equal((await getAcquisitionSession(db,actor,small.sessionId)).session.phase,"PAUSED");
      assert.equal(await scannerStartMarkerExists(refill.requestKey),false);
    }
    await first.pulse();
    const concurrent=await Promise.all([refillScannerBatch(db,tag,refill,epoch),refillScannerBatch(db,tag,refill,epoch)]);
    assert.equal(concurrent[0].runId,concurrent[1].runId);
    const segment=concurrent[0]; assert.notEqual(segment.runId,small.runId); assert.equal(segment.sessionId,small.sessionId);
    assert.equal(segment.physicalTarget,1); assert.equal(segment.sequenceOffset,2); assert.equal(segment.segment,1);
    assert.equal((await db.acquisitionSession.findUniqueOrThrow({where:{id:small.sessionId}})).target,3);
    assert.equal(await scannerStartMarkerExists(segment.runId),false);
    assert.equal((await pollScannerRun(db,first.token,epoch)).run?.runId,segment.runId);
    // Replaying old delivery/finish/reconciliation never restarts or changes the
    // newer capturing phase, and never invalidates a saved earlier review.
    assert.deepEqual(await receiveScannerImage(db,first.token,smallImages[0].transfer,epoch,bytes,"image/png"),smallImages[0].ack);
    await finishScannerRun(db,first.token,{...smallClaim,outcome:earlyOutcome},epoch);
    await reconcileScannerBatch(db,tag,observe(small.runId,2));
    assert.equal((await getAcquisitionSession(db,actor,small.sessionId)).session.phase,"CAPTURING");
    assert.deepEqual(await getAcquisitionCardReview(db,actor,small.sessionId,firstReview.photoId),saved);
    const segmentClaim=await claim(first,segment.runId),tail=await images(first,segmentClaim,1);
    await finish(first,segmentClaim,1,false); await reconcileScannerBatch(db,tag,observe(segment.runId,1,2));
    assert.equal((await getScannerBatch(db,tag,small.runId)).phase,"COMPLETE");
    const positions=await db.acquisitionPhoto.findMany({where:{run:{sessionId:small.sessionId}},include:{slot:true},orderBy:{slot:{position:"asc"}}});
    assert.deepEqual(positions.map(p=>p.slot.position),[0,1,2]); assert.equal(positions[2].id,tail[0].ack.photoId);
    assert.deepEqual(await getAcquisitionCardReview(db,actor,small.sessionId,firstReview.photoId),saved);
    assert.equal(await db.inventoryAuditLog.count({where:{changedByUserId:tag,changeType:"acquisition_committed"}}),1);

    // An empty attempt after saved cards can be confirmed after reloading. It
    // resumes the same batch at the unchanged offset, without replaying a feed.
    const reloadBox=await location(3,[{name:"A",capacity:3}]); await first.pulse();
    const reloadBatch=await createScannerBatch(db,actor,setup(first,reloadBox,"A",3),epoch);
    const reloadClaim=await claim(first,reloadBatch.runId),reloadImages=await images(first,reloadClaim,1);
    await finish(first,reloadClaim,1,true); await reconcileScannerBatch(db,tag,observe(reloadBatch.runId,1));
    await first.pulse();
    const emptyReload=await refillScannerBatch(db,tag,{runId:reloadBatch.runId,requestKey:randomUUID(),loadedCount:null,operatorLoadedSimplexFronts:true},epoch);
    const emptyReloadClaim=await claim(first,emptyReload.runId);
    await finish(first,emptyReloadClaim,0,true);
    const loadedRefill={runId:emptyReload.runId,requestKey:randomUUID(),loadedCount:3,operatorLoadedSimplexFronts:true};
    assert.equal(((await getScannerBatch(db,tag,emptyReload.runId)).reconciliation as {mode?:string})?.mode,"SCANNER_IMAGE_COUNT");
    await first.pulse();
    const resumedReload=await refillScannerBatch(db,tag,loadedRefill,epoch);
    assert.equal(resumedReload.sessionId,reloadBatch.sessionId);
    assert.equal(resumedReload.sequenceOffset,1); assert.equal(resumedReload.physicalTarget,2);
    assert.equal((await refillScannerBatch(db,tag,loadedRefill,epoch)).runId,resumedReload.runId);
    const resumedReloadClaim=await claim(first,resumedReload.runId); await images(first,resumedReloadClaim,2);
    await finish(first,resumedReloadClaim,2,false); await reconcileScannerBatch(db,tag,observe(resumedReload.runId,2,1));
    const reloadPhotos=await db.acquisitionPhoto.findMany({where:{run:{sessionId:reloadBatch.sessionId}},include:{slot:true},orderBy:{slot:{position:"asc"}}});
    assert.deepEqual(reloadPhotos.map(p=>p.slot.position),[0,1,2]);
    assert.equal(reloadPhotos[0].id,reloadImages[0].ack.photoId);
    assert.equal((await getScannerBatch(db,tag,resumedReload.runId)).phase,"COMPLETE");
    assert.equal(await db.inventoryItem.count({where:{locationId:reloadBox}}),0);

    // Fixed-size batches preserve the operator's limit and section preference,
    // not a target/capacity snapshot, readiness or an execution identity.
    const fixedHelper = await enroll(), fixedBox = await location(40, [{name:"A",capacity:40}]);
    const fixedBatch = await createScannerBatch(db, actor, setup(fixedHelper,fixedBox,"A",15),epoch);
    const fixedClaim = await claim(fixedHelper,fixedBatch.runId); await images(fixedHelper,fixedClaim,15);
    await finish(fixedHelper,fixedClaim,15,false);
    const fixedPreferences = await scannerContinuation(db,tag,fixedBatch.runId);
    assert.equal(fixedPreferences.batchLimit,15); assert.equal(fixedPreferences.nextSectionRequired,undefined);
    assert.equal(currentScannerContinuation(fixedPreferences,[{id:fixedBox,name:fixedBox,sections:[{name:"A",capacity:40,quantity:0}]}]).setup?.section,"A");
    await db.inventoryLocation.update({where:{id:fixedBox},data:{storageLayout:{capacity:25,sections:[{name:"A",capacity:25}]}}});
    await fixedHelper.pulse();
    const tooLarge = setup(fixedHelper,fixedBox,"A",fixedPreferences.batchLimit);
    const sessionsBeforeLimit = await db.acquisitionSession.count({where:{createdByUserId:tag}});
    await assert.rejects(createScannerBatch(db,actor,tooLarge,epoch));
    assert.equal(await scannerStartMarkerExists(tooLarge.requestKey),false);
    assert.equal(await db.acquisitionSession.count({where:{createdByUserId:tag}}),sessionsBeforeLimit);
    const nextFixed = await createScannerBatch(db,actor,setup(fixedHelper,fixedBox,"A",10),epoch);
    assert.notEqual(nextFixed.sessionId,fixedBatch.sessionId); assert.equal(nextFixed.physicalTarget,10);
    assert.equal(nextFixed.sequenceOffset,0); assert.equal(await scannerStartMarkerExists(nextFixed.runId),false);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{sessionId:nextFixed.sessionId}}}),0);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{sessionId:fixedBatch.sessionId}}}),15);
    await stopScannerBatch(db,tag,nextFixed.runId);
    console.log("PASS: fixed15-card continuation retains limit/section, lower current capacity refuses stale preference before START, adjusted count has fresh identity/target and retains previous originals; physical feeds=0");

    // Different sections share the parent's total limit, and two concurrent
    // admissions cannot each consume the same free spaces.
    const tight=await location(3,[{name:"A",capacity:3},{name:"B",capacity:3}]);
    const h1=await enroll(),h2=await enroll();
    const races=await Promise.allSettled([createScannerBatch(db,actor,setup(h1,tight,"A",2),epoch),createScannerBatch(db,actor,setup(h2,tight,"B",2),epoch)]);
    assert.equal(races.filter(r=>r.status==="fulfilled").length,1);
    const winner=races.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof createScannerBatch>>>;
    assert.equal((await capacity(tight,winner.value.counted?"B":"A")).pendingTotal,2);
    await stopScannerBatch(db,tag,winner.value.runId); assert.equal((await capacity(tight,"B")).remaining,3);
    // A manual stock write after admission is caught before server START. The
    // unstarted journal can be cancelled; no marker/feed authorization exists.
    await h1.pulse(); const stale=await createScannerBatch(db,actor,setup(h1,tight,"A",3),epoch);
    await db.inventoryItem.create({data:{currentOwnerId:tag,cardId:card.id,quantity:1,locationId:tight,locationSection:"B",foilStatus:"NONFOIL",condition:"NM",sourceType:"MANUAL"}});
    await assert.rejects(claimScannerRun(db,h1.token,{version:1,runId:stale.runId,epoch,executionId:randomUUID()},epoch),/capacity changed/);
    assert.equal(await scannerStartMarkerExists(stale.runId),false); await stopScannerBatch(db,tag,stale.runId);
    // Explicitly ending an empty/early batch releases only unfed space.
    const endBox=await location(3,[{name:"A",capacity:3}]); await second.pulse();
    const ended=await createScannerBatch(db,actor,setup(second,endBox,"A",3,1),epoch),endedClaim=await claim(second,ended.runId);
    await images(second,endedClaim,1); await finish(second,endedClaim,1,true); await reconcileScannerBatch(db,tag,observe(ended.runId,1));
    assert.equal((await capacity(endBox)).remaining,0); await endScannerBatch(db,tag,ended.runId);
    assert.equal((await capacity(endBox)).remaining,2);
    // Cancelling an explicitly queued refill releases its unfed allocation,
    // retains all previous images and does not authorize another Enable.
    const cancelBox=await location(3,[{name:"A",capacity:3}]); await second.pulse();
    const cancelBatch=await createScannerBatch(db,actor,setup(second,cancelBox,"A",3,1),epoch),cancelClaim=await claim(second,cancelBatch.runId);
    await images(second,cancelClaim,1);await finish(second,cancelClaim,1,true);await reconcileScannerBatch(db,tag,observe(cancelBatch.runId,1));
    const queuedRefill=await refillScannerBatch(db,tag,{runId:cancelBatch.runId,requestKey:randomUUID(),loadedCount:null,operatorLoadedSimplexFronts:true},epoch);
    await stopScannerBatch(db,tag,queuedRefill.runId);
    assert.equal((await getScannerBatch(db,tag,cancelBatch.runId)).phase,"COMPLETE");
    assert.equal(await scannerStartMarkerExists(queuedRefill.runId),false);
    assert.equal((await capacity(cancelBox)).remaining,2);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{sessionId:cancelBatch.sessionId}}}),1);
    // Transfer overflow is preserved and blocks refill, including after the
    // operator accounts for every card. Only an explicit end closes the batch.
    const overflowBox=await location(3,[{name:"A",capacity:3}]); await second.pulse();
    const overflow=await createScannerBatch(db,actor,setup(second,overflowBox,"A",1,3),epoch),overflowClaim=await claim(second,overflow.runId);
    await images(second,overflowClaim,2);await finish(second,overflowClaim,2,false);
    assert.equal((await getScannerBatch(db,tag,overflow.runId)).status,"ERROR");
    assert.equal((await getScannerBatch(db,tag,overflow.runId)).reconciliation,null);
    await reconcileScannerBatch(db,tag,observe(overflow.runId,2,1));
    await assert.rejects(refillScannerBatch(db,tag,{runId:overflow.runId,requestKey:randomUUID(),loadedCount:null,operatorLoadedSimplexFronts:true},epoch));
    await endScannerBatch(db,tag,overflow.runId);assert.equal((await capacity(overflowBox)).remaining,1);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{sessionId:overflow.sessionId}}}),2);
    // An explicit section series has server-persisted succession and Stop.
    // Simulated events exercise admission, not the scanner's physical behavior.
    const chainHelper=await enroll(), chainBox=await location(6,[{name:"A",capacity:2},{name:"B",capacity:3},{name:"C",capacity:1}]);
    const chainInput={...setup(chainHelper,chainBox,"A"),continuous:true};
    const chainA=await createScannerBatch(db,actor,chainInput,epoch);
    const chainAClaim=await claim(chainHelper,chainA.runId);await images(chainHelper,chainAClaim,2);await finish(chainHelper,chainAClaim,2,false);
    assert.equal((await scannerContinuation(db,tag,chainA.runId)).continueFrom,chainA.runId);
    await reconcileScannerBatch(db,tag,observe(chainA.runId,2,4));
    const chainDefaults=await scannerContinuation(db,tag,chainA.runId);
    assert.equal(chainDefaults.continueFrom,chainA.runId);
    assert.equal(chainDefaults.seriesRootId,chainA.runId);
    assert.equal(chainDefaults.nextSectionRequired,true);
    assert.equal((await getScannerBatch(db,tag,chainA.runId)).series?.ordinal,0);
    await assert.rejects(createScannerBatch(db,actor,{...setup(chainHelper,chainBox,""),continuous:true,continueFrom:chainA.runId},epoch),/Choose a section/);
    await assert.rejects(createScannerBatch(db,actor,{...setup(chainHelper,chainBox,"A"),continuous:true,continueFrom:chainA.runId},epoch),/different section/);
    await assert.rejects(createScannerBatch(db,{userId:foreign,adminMode:false},{...setup(chainHelper,chainBox,"B"),continuous:true,continueFrom:chainA.runId},epoch));
    await chainHelper.pulse();
    const chainNext={...setup(chainHelper,chainBox,"B"),continuous:true,continueFrom:chainA.runId};
    const admissions=await Promise.allSettled([createScannerBatch(db,actor,chainNext,epoch),
      createScannerBatch(db,actor,{...chainNext,requestKey:randomUUID()},epoch)]);
    assert.equal(admissions.filter(r=>r.status==="fulfilled").length,1);
    const chainB=(admissions.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<typeof chainA>).value;
    assert.equal(await db.scannerRun.count({where:{seriesRootId:chainA.runId,seriesOrdinal:1}}),1);
    assert.equal(await scannerStartMarkerExists(chainB.runId),false);
    assert.equal((await getScannerBatch(db,tag,chainA.runId)).series?.current,false);
    await assert.rejects(scannerContinuation(db,tag,chainA.runId),/newer batch/);
    const chainBClaim=await claim(chainHelper,chainB.runId);await images(chainHelper,chainBClaim,1);await finish(chainHelper,chainBClaim,1,true);
    await reconcileScannerBatch(db,tag,observe(chainB.runId,1));
    assert.equal((await getScannerBatch(db,tag,chainB.runId)).remainingTarget,2);
    await assert.rejects(createScannerBatch(db,actor,{...setup(chainHelper,chainBox,"C"),continuous:true,continueFrom:chainB.runId},epoch),/Finish and reconcile/);
    const chainRefillRequest={runId:chainB.runId,requestKey:randomUUID(),loadedCount:null,operatorLoadedSimplexFronts:true};
    const chainRefill=await refillScannerBatch(db,tag,chainRefillRequest,epoch);
    assert.equal(chainRefill.sessionId,chainB.sessionId);assert.equal(chainRefill.physicalTarget,2);
    assert.equal((await getScannerBatch(db,tag,chainB.runId)).series?.ordinal,1);
    const chainTailClaim=await claim(chainHelper,chainRefill.runId);await images(chainHelper,chainTailClaim,2);await finish(chainHelper,chainTailClaim,2,false);
    await reconcileScannerBatch(db,tag,observe(chainRefill.runId,2,1));
    const chainTailDefaults=await scannerContinuation(db,tag,chainB.runId);
    assert.equal(chainTailDefaults.continueFrom,chainRefill.runId);
    await chainHelper.pulse();
    const chainCRequest={...setup(chainHelper,chainBox,"C"),continuous:true,continueFrom:chainRefill.runId};
    const chainC=await createScannerBatch(db,actor,chainCRequest,epoch);
    assert.equal((await getScannerBatch(db,tag,chainC.runId)).series?.ordinal,2);
    assert.equal((await capacity(chainBox,"C")).remaining,0);
    await stopScannerSeries(db,tag,chainA.runId); // Stop from an older page stops the current batch.
    await stopScannerSeries(db,tag,chainC.runId); // Repeated Stop is safe.
    assert.equal((await getScannerBatch(db,tag,chainC.runId)).status,"CANCELLED_BEFORE_START");
    assert.equal((await getScannerBatch(db,tag,chainA.runId)).series?.stopped,true);
    assert.equal((await capacity(chainBox,"C")).remaining,1);
    await assert.rejects(claim(chainHelper,chainC.runId));
    await assert.rejects(scannerContinuation(db,tag,chainC.runId),/stopped/);
    assert.equal((await createScannerBatch(db,actor,chainCRequest,epoch)).runId,chainC.runId); // recovery never restarts
    await assert.rejects(createScannerBatch(db,actor,{...setup(chainHelper,chainBox,"C"),continuous:true,continueFrom:chainRefill.runId},epoch),/stopped/);
    assert.equal(await db.inventoryItem.count({where:{locationId:chainBox}}),0);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{session:{locationId:chainBox}}}}),5);
    const stopBox=await location(3,[{name:"A",capacity:3}]);await chainHelper.pulse();
    const pausedSeries=await createScannerBatch(db,actor,{...setup(chainHelper,stopBox,"A"),continuous:true},epoch);
    const pausedClaim=await claim(chainHelper,pausedSeries.runId);await images(chainHelper,pausedClaim,1);await finish(chainHelper,pausedClaim,1,true);
    await reconcileScannerBatch(db,tag,observe(pausedSeries.runId,1));
    await stopScannerSeries(db,tag,pausedSeries.runId);
    assert.equal((await getScannerBatch(db,tag,pausedSeries.runId)).phase,"COMPLETE");
    assert.equal((await capacity(stopBox)).remaining,2);
    await assert.rejects(refillScannerBatch(db,tag,{runId:pausedSeries.runId,requestKey:randomUUID(),loadedCount:null,operatorLoadedSimplexFronts:true},epoch),/stopped/);
    const activeBox=await location(2,[{name:"A",capacity:2}]);await chainHelper.pulse();
    const activeSeries=await createScannerBatch(db,actor,{...setup(chainHelper,activeBox,"A"),continuous:true},epoch);
    const activeClaim=await claim(chainHelper,activeSeries.runId);
    await stopScannerSeries(db,tag,activeSeries.runId);
    assert.equal((await getScannerBatch(db,tag,activeSeries.runId)).status,"STARTED");
    assert.equal((await getScannerBatch(db,tag,activeSeries.runId)).stopRequested,true);
    await images(chainHelper,activeClaim,2);await finish(chainHelper,activeClaim,2,false);
    await reconcileScannerBatch(db,tag,observe(activeSeries.runId,2));
    assert.equal((await getScannerBatch(db,tag,activeSeries.runId)).series?.stopped,true);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{sessionId:activeSeries.sessionId}}}),2);
    await assert.rejects(scannerContinuation(db,tag,activeSeries.runId),/stopped/);
    const trashHelper = await enroll(), trashBox = await location(2, [{name: "A", capacity: 2}]);
    const trashBatch = await createScannerBatch(db, actor, {...setup(trashHelper, trashBox), continuous: true}, epoch);
    const trashClaim = await claim(trashHelper, trashBatch.runId), trashAt = new Date();
    await manageAcquisitionBatch(db, actor, trashBatch.sessionId, "trash", trashAt);
    assert.equal((await capacity(trashBox)).remaining, 0);
    assert.equal((await purgeTrashedAcquisitionPhotos(db, new Date(trashAt.getTime() + 8 * 86400000))).expired, 0);
    const restoredActive = await manageAcquisitionBatch(db, actor, trashBatch.sessionId, "restore");
    assert.equal(restoredActive.phase, "CANCELLED"); assert.equal(restoredActive.draining, true);
    assert.equal((await getScannerBatch(db, tag, trashBatch.runId)).status, "STARTED");
    assert.equal((await capacity(trashBox)).remaining, 0);
    await assert.rejects(manageAcquisitionBatch(db, actor, trashBatch.sessionId, "resume-processing"), /draining/);
    await assert.rejects(createScannerBatch(db, actor, setup(trashHelper, await location(1, [{name: "A", capacity: 1}])), epoch), /unfinished batch/);
    await images(trashHelper, trashClaim, 2); await finish(trashHelper, trashClaim, 2, false);
    const trashSession = await db.acquisitionSession.findUniqueOrThrow({where: {id: trashBatch.sessionId}});
    assert.equal(trashSession.phase, "CANCELLED"); assert.equal(trashSession.trashedAt, null);
    assert.equal(trashSession.scannerReserved, 0);
    assert.equal((await capacity(trashBox)).remaining, 0); // The two restored saved cards still occupy space.
    assert.equal(await db.acquisitionPhoto.count({where: {run: {sessionId: trashBatch.sessionId}, ready: true}}), 2);
    assert.ok((await db.acquisitionProcessingJob.findMany({where: {run: {sessionId: trashBatch.sessionId}}})).every(job => job.status === "SUPERSEDED"));
    assert.equal((await getScannerBatch(db, tag, trashBatch.runId)).series?.stopped, true);
    await assert.rejects(scannerContinuation(db, tag, trashBatch.runId), /stopped/);
    await manageAcquisitionBatch(db, actor, trashBatch.sessionId, "resume-processing");
    assert.ok((await db.acquisitionProcessingJob.findMany({where: {run: {sessionId: trashBatch.sessionId}}})).every(job => job.status === "PENDING"));
    assert.equal((await getScannerBatch(db, tag, trashBatch.runId)).series?.stopped, true);
    const neverStarted = await createScannerBatch(db, actor, setup(trashHelper, await location(1, [{name: "A", capacity: 1}])), epoch);
    await manageAcquisitionBatch(db, actor, neverStarted.sessionId, "cancel");
    assert.equal((await db.scannerRun.findUniqueOrThrow({where: {id: neverStarted.runId}})).status, "CANCELLED_BEFORE_START");
    await assert.rejects(claimScannerRun(db, trashHelper.token, {version: 1, runId: neverStarted.runId, epoch, executionId: randomUUID()}, epoch));
    const errorHelper = await enroll(), errorBox = await location(2, [{name: "A", capacity: 2}]);
    const errorBatch = await createScannerBatch(db, actor, setup(errorHelper, errorBox), epoch);
    const errorClaim = await claim(errorHelper, errorBatch.runId), errorTrashAt = new Date();
    // A restored error without a finish outcome is still uncertain: it cannot
    // release helper admission, original retention or capacity just by Trash.
    await db.scannerRun.update({where: {id: errorBatch.runId}, data: {status: "ERROR", outcome: Prisma.DbNull}});
    await manageAcquisitionBatch(db, actor, errorBatch.sessionId, "trash", errorTrashAt);
    assert.equal((await capacity(errorBox)).remaining, 0);
    assert.equal((await purgeTrashedAcquisitionPhotos(db, new Date(errorTrashAt.getTime() + 8 * 86400000))).expired, 0);
    const restoredError = await manageAcquisitionBatch(db, actor, errorBatch.sessionId, "restore");
    assert.equal(restoredError.phase, "CANCELLED"); assert.equal(restoredError.draining, true);
    assert.equal((await getScannerBatch(db, tag, errorBatch.runId)).status, "ERROR");
    const uncertain = await db.scannerRun.findUniqueOrThrow({where: {id: errorBatch.runId}});
    assert.equal(uncertain.outcome, null); assert.equal(uncertain.reconciliation, null); assert.equal(uncertain.admissionReleasedAt, null);
    assert.equal((await capacity(errorBox)).remaining, 0);
    await assert.rejects(manageAcquisitionBatch(db, actor, errorBatch.sessionId, "resume-processing"), /recovery/);
    await assert.rejects(createScannerBatch(db, actor, setup(errorHelper, await location(1, [{name: "A", capacity: 1}])), epoch), /unfinished batch/);
    assert.equal((await pollScannerRun(db, errorHelper.token, epoch)).run?.runId, errorBatch.runId);
    const errorOriginals = await images(errorHelper, errorClaim, 1);
    await finishScannerRun(db, errorHelper.token, {...errorClaim, outcome: {outcome: "ERROR", imageCount: 1, elapsedMs: 100,
      knownPhysicalItems: null, sourceExhausted: "UNKNOWN", nativeError: {type: "FixtureSourceError", nativeStatus: 1}}}, epoch);
    assert.equal((await pollScannerRun(db, errorHelper.token, epoch)).run, null);
    assert.equal((await capacity(errorBox)).remaining, 1); // One retained card; the unused target space is released.
    const savedError = await db.scannerRun.findUniqueOrThrow({where: {id: errorBatch.runId}});
    assert.equal(savedError.status, "ERROR"); assert.equal(savedError.reconciliation, null);
    assert.ok(savedError.admissionReleasedAt);
    assert.equal((await receiveScannerImage(db, errorHelper.token, errorOriginals[0].transfer, epoch, bytes, "image/png")).photoId, errorOriginals[0].ack.photoId);
    await assert.rejects(receiveScannerImage(db, errorHelper.token, {...errorOriginals[0].transfer,
      artifactId: randomUUID(), sequence: 2}, epoch, bytes, "image/png"));
    assert.equal(await db.acquisitionPhoto.count({where: {run: {sessionId: errorBatch.sessionId}}}), 1);
    assert.ok((await db.acquisitionProcessingJob.findMany({where: {run: {sessionId: errorBatch.sessionId}}})).every(job => job.status === "SUPERSEDED"));
    await manageAcquisitionBatch(db, actor, errorBatch.sessionId, "resume-processing");
    assert.ok((await db.acquisitionProcessingJob.findMany({where: {run: {sessionId: errorBatch.sessionId}}})).every(job => job.status === "PENDING"));
    const errorRetention = {version: 1, runId: errorBatch.runId, epoch,
      artifacts: errorOriginals.map(original => ({artifactId: original.transfer.artifactId, photoId: original.ack.photoId, digest: original.ack.digest}))};
    assert.deepEqual((await eligibleScannerOriginals(db, errorHelper.token, errorRetention, epoch)).eligible, []);
    const retrashAt = new Date(errorTrashAt.getTime() + 86400000);
    await manageAcquisitionBatch(db, actor, errorBatch.sessionId, "trash", retrashAt);
    const errorExpiry = new Date(retrashAt.getTime() + 7 * 86400000);
    assert.equal((await db.acquisitionSession.findUniqueOrThrow({where: {id: errorBatch.sessionId}})).trashExpiresAt?.getTime(), errorExpiry.getTime());
    assert.equal((await purgeTrashedAcquisitionPhotos(db, errorExpiry)).purged, 1);
    assert.ok((await db.acquisitionSession.findUniqueOrThrow({where: {id: errorBatch.sessionId}})).deletedAt);
    assert.deepEqual((await eligibleScannerOriginals(db, errorHelper.token, errorRetention, epoch, errorExpiry)).eligible, [errorOriginals[0].transfer.artifactId]);
    assert.deepEqual((await eligibleScannerOriginals(db, errorHelper.token, {...errorRetention,
      artifacts: [{...errorRetention.artifacts[0], digest: "0".repeat(64)}]}, epoch, errorExpiry)).eligible, []);
    const afterDiscard = await createScannerBatch(db, actor, setup(errorHelper, await location(1, [{name: "A", capacity: 1}])), epoch);
    assert.equal(await scannerStartMarkerExists(afterDiscard.runId), false);
    await manageAcquisitionBatch(db, actor, afterDiscard.sessionId, "cancel");
    console.log("PASS: finished error outcomes can expire without invented physical counts or blocked helper; missing outcomes retain recovery/capacity and cannot authorize new START");
    console.log("PASS: active and unknown-outcome Trash restores visible cancelled batches with capacity/admission held, originals drain without inference, explicit processing resume waits for settlement and never restarts a scanner series; physical feeds=0");
    console.log("PASS: explicit multi-section series, concurrent next admission, stale-page/refresh recovery, same-batch refill, durable/repeated Stop, released unfed reservations and retained uncommitted cards; physical feeds=0");
    console.log("PASS: counted 83-image allocation, hopper remainder observation, pending/commit capacity conservation, concurrent parent limits, fresh no-START guard, same-batch refill segments and old-segment replay with saved review; physical feeds=0");
  } finally {
    const w={run:{session:{createdByUserId:{in:[tag,foreign]}}}};
    await db.scannerRun.deleteMany({where:{agent:{userId:{in:[tag,foreign]}}}});
    await db.acquisitionCommitMember.deleteMany({where:{commit:w}}); await db.acquisitionCommit.deleteMany({where:w});
    for(const model of ["acquisitionProcessingJob","acquisitionProcessingTurn","acquisitionPhoto","acquisitionObservation","acquisitionCountCorrection","acquisitionCandidate","acquisitionArtifact","acquisitionCaptureSlot","acquisitionCommand","acquisitionEvent"] as const) await (db[model].deleteMany as (arg:unknown)=>Promise<unknown>)({where:w});
    await db.acquisitionRun.deleteMany({where:{session:{createdByUserId:{in:[tag,foreign]}}}});
    await db.acquisitionSession.deleteMany({where:{createdByUserId:{in:[tag,foreign]}}});
    await db.scannerPairing.deleteMany({where:{userId:{in:[tag,foreign]}}});await db.scannerAgent.deleteMany({where:{userId:{in:[tag,foreign]}}});
    await db.inventoryAuditLog.deleteMany({where:{changedByUserId:tag}});await db.inventoryItem.deleteMany({where:{currentOwnerId:tag}});
    await db.card.deleteMany({where:{scryfallId:tag}});await db.inventoryLocation.deleteMany({where:{id:{in:createdLocations}}});
    await db.user.deleteMany({where:{id:{in:[tag,foreign]}}});await db.player.deleteMany({where:{id:{in:[tag,foreign]}}});
    if(oldRoot===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=oldRoot;
    if(path.dirname(root)!==parent||!path.basename(root).startsWith("counted-scanner-db-"))throw new Error("Fixture root escaped");
    await rm(root,{recursive:true,force:true});
  }
}
