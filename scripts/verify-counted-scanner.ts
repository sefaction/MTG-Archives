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
  refillScannerBatch, endScannerBatch, stopScannerBatch, getScannerBatch, pollScannerRun } from "../lib/scanner-runs";
import { readScannerCapacity } from "../lib/scanner-capacity";
import { scannerContinuation, currentScannerContinuation } from "../lib/scanner-continuation";
import { getAcquisitionSession, saveAcquisitionReview, getAcquisitionCardReview } from "../lib/acquisition-store";
import { previewAcquisitionCommit, commitAcquisitionCards } from "../lib/acquisition-commit-service";

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
    async function location(total:number, sections:{name:string;capacity:number}[]) {
      const id=tag+"-box-"+createdLocations.length; createdLocations.push(id);
      await db.inventoryLocation.create({data:{id,name:id,normalizedName:id,ownerPlayerId:tag,type:"Box",storageLayout:{capacity:total,sections}}}); return id;
    }
    async function enroll() {
      const pair=await createScannerPairing(db,tag),agentId=randomUUID(),secret=scannerSecret();
      await claimScannerPairing(db,{version:1,pairCode:pair.code,agentId,secret,name:"Counted fixture"});
      const token="Bearer "+agentId+"."+secret;
      const pulse=()=>recordScannerPulse(db,token,{version:1,agentVersion:"fixture",devices:[source]});
      await pulse(); return {agentId,token,pulse};
    }
    const first=await enroll(),second=await enroll();
    const box=await location(170,[{name:"A",capacity:85},{name:"B",capacity:85}]);
    await db.inventoryItem.create({data:{currentOwnerId:tag,cardId:card.id,quantity:2,locationId:box,locationSection:"A",foilStatus:"NONFOIL",condition:"NM",sourceType:"MANUAL"}});
    const setup=(helper:typeof first,locationId=box,section="A",quantity:number|null=null,loadedCount:number|null=null)=>({
      requestKey:randomUUID(),agentId:helper.agentId,deviceId:source.id,locationId,section,quantity,loadedCount,settings,operatorLoadedSimplexFronts:true});
    const capacity=(locationId=box,section="A",excludeSessionId?:string)=>db.$transaction(tx=>readScannerCapacity(tx,{locationId,section,ownerPlayerId:tag,excludeSessionId}));
    assert.equal((await capacity()).remaining,83);
    await assert.rejects(createScannerBatch(db,actor,setup(first,box,""),epoch),/Choose a section/);
    await assert.rejects(createScannerBatch(db,actor,setup(first,box,"missing"),epoch),/Choose a section/);
    const large=await createScannerBatch(db,actor,setup(first,box,"A",null,84),epoch);
    assert.equal(large.physicalTarget,83); assert.equal(large.logicalTarget,83); assert.equal(large.counted,true);
    assert.equal((await capacity()).remaining,0);
    await assert.rejects(createScannerBatch(db,actor,setup(second),epoch));
    assert.equal((await capacity(box,"B")).remaining,85);
    const claim=async(helper:typeof first,runId:string)=>{
      await helper.pulse(); const c={version:1,runId,epoch,executionId:randomUUID()};
      assert.equal((await claimScannerRun(db,helper.token,c,epoch)).feedAuthorized,true); return c;
    };
    const images=async(helper:typeof first,c:Awaited<ReturnType<typeof claim>>,count:number)=>{
      const values=[];
      for(let sequence=1;sequence<=count;sequence++) {
        const t={...c,artifactId:randomUUID(),sequence,timestamp:new Date().toISOString(),side:"UNKNOWN",physicalBoundary:"UNKNOWN"};
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
    const largeClaim=await claim(first,large.runId),largeImages=await images(first,largeClaim,83);
    await finish(first,largeClaim,83,false);
    assert.equal((await getScannerBatch(db,tag,large.runId)).phase,"COMPLETE");
    assert.equal((await getAcquisitionSession(db,actor,large.sessionId)).session.candidates.filter(c=>c.countConfirmed).length,0);
    await assert.rejects(reconcileScannerBatch(db,tag,observe(large.runId,82,2)));
    await reconcileScannerBatch(db,tag,observe(large.runId,83,1));
    assert.equal((await capacity()).remaining,0);
    assert.equal((await db.inventoryItem.aggregate({where:{locationId:box},_sum:{quantity:true}}))._sum.quantity,2);
    const nextPreferences=await scannerContinuation(db,tag,large.runId);
    assert.equal(nextPreferences.nextSectionRequired,true);
    assert.equal(currentScannerContinuation(nextPreferences,[{id:box,name:box,sections:[{name:"A",capacity:85,quantity:2},{name:"B",capacity:85,quantity:0}]}]).setup?.section,"");
    // Saving a review and previewing change no Inventory. A committed receipt
    // replaces one pending card with one stored copy, without counting twice.
    const review=await getAcquisitionCardReview(db,actor,large.sessionId,largeImages[0].ack.photoId);
    await saveAcquisitionReview(db,actor,large.sessionId,{action:"accept",photoId:review.photoId,revision:review.revision,decision});
    const selection={photoIds:[review.photoId],locationId:box,section:"A"};
    const preview=await previewAcquisitionCommit(db,actor,large.sessionId,selection);
    assert.equal((await capacity()).remaining,0);
    await commitAcquisitionCards(db,actor,large.sessionId,{...selection,requestKey:randomUUID(),previewToken:preview.token,overfillReason:null});
    assert.equal((await capacity()).remaining,0); assert.equal((await capacity()).pendingSection,82);
    assert.equal((await db.inventoryItem.aggregate({where:{locationId:box},_sum:{quantity:true}}))._sum.quantity,3);

    await first.pulse();
    const small=await createScannerBatch(db,actor,setup(first,box,"B",3,2),epoch);
    const smallClaim=await claim(first,small.runId),smallImages=await images(first,smallClaim,2);
    const earlyOutcome=await finish(first,smallClaim,2,true);
    assert.equal((await getScannerBatch(db,tag,small.runId)).phase,"PAUSED");
    assert.equal((await getScannerBatch(db,tag,small.runId)).remainingTarget,1);
    const refill={runId:small.runId,requestKey:randomUUID(),loadedCount:3,operatorLoadedSimplexFronts:true};
    await assert.rejects(refillScannerBatch(db,tag,refill,epoch));
    await reconcileScannerBatch(db,tag,observe(small.runId,2));
    await assert.rejects(scannerContinuation(db,tag,small.runId),/unfinished batch/);
    const firstReview=await getAcquisitionCardReview(db,actor,small.sessionId,smallImages[0].ack.photoId);
    await saveAcquisitionReview(db,actor,small.sessionId,{action:"accept",photoId:firstReview.photoId,revision:firstReview.revision,decision});
    const saved=await getAcquisitionCardReview(db,actor,small.sessionId,firstReview.photoId);
    await assert.rejects(refillScannerBatch(db,foreign,refill,epoch));
    await assert.rejects(refillScannerBatch(db,tag,refill,randomUUID()));
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
    await reconcileScannerBatch(db,tag,observe(overflow.runId,2,1));
    await assert.rejects(refillScannerBatch(db,tag,{runId:overflow.runId,requestKey:randomUUID(),loadedCount:null,operatorLoadedSimplexFronts:true},epoch));
    await endScannerBatch(db,tag,overflow.runId);assert.equal((await capacity(overflowBox)).remaining,1);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{sessionId:overflow.sessionId}}}),2);
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
