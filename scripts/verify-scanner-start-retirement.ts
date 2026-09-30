import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createScannerPairing, claimScannerPairing, recordScannerPulse, revokeScannerAgent } from "../lib/scanner-store";
import { scannerSecret } from "../lib/scanner-protocol";
import { createScannerBatch, retireScannerBatchCreation, claimScannerRun } from "../lib/scanner-runs";
import { scannerSiteEpoch, scannerStartRetired, persistScannerStartMarker, scannerStartMarkerExists } from "../lib/scanner-control-files";
import { SCANNER_CAPTURE_PROVIDER } from "../lib/scanner-run-protocol";
import { createAcquisitionSession } from "../lib/acquisition-store";

export async function verifyScannerStartRetirement(db:PrismaClient) {
  const tag=`scanner-retire-db-${randomUUID()}`,other=`${tag}-other`,parent=path.resolve(".local-data");
  await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,"scanner-retire-db-")),prior=process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH=root;
  const actor={userId:tag,adminMode:false},epoch=await scannerSiteEpoch(),ids=[tag,other];
  const source={id:"fixture-retirement",name:"Retirement fixture",backend:"fixture",source:"Fixture",qualification:"GenericUnqualified"};
  const settings={dpi:600,widthInches:2.6,heightInches:3.6,horizontalPlacement:"Start",duplex:false,color:"RGB",autoCrop:false,deskew:false,removeBlank:false};
  try {
    for(const id of ids){await db.player.create({data:{id,name:id,displayName:id}});await db.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash:"fixture-not-login"}});}
    await db.inventoryLocation.create({data:{id:tag,name:tag,normalizedName:tag,ownerPlayerId:tag,type:"Box"}});
    async function helper() {
      const pair=await createScannerPairing(db,tag),agentId=randomUUID(),secret=scannerSecret();
      await claimScannerPairing(db,{version:1,pairCode:pair.code,agentId,secret,name:"Retirement fixture"});
      const token=`Bearer ${agentId}.${secret}`;
      await recordScannerPulse(db,token,{version:1,agentVersion:"fixture",devices:[source]});
      return {agentId,token};
    }
    const first=await helper();
    const input={requestKey:randomUUID(),agentId:first.agentId,deviceId:source.id,locationId:tag,section:"",
      quantity:null,loadedCount:null,operatorLoadedSimplexFronts:true,settings,defaults:{finish:"NONFOIL" as const,condition:"NM" as const}};
    await assert.rejects(retireScannerBatchCreation(db,{userId:other,adminMode:true},input));
    assert.equal(await scannerStartRetired(input.requestKey),false);
    await db.user.update({where:{id:tag},data:{isActive:false}});
    await assert.rejects(retireScannerBatchCreation(db,actor,input));
    assert.equal(await scannerStartRetired(input.requestKey),false);
    await db.user.update({where:{id:tag},data:{isActive:true}});
    const retired=await retireScannerBatchCreation(db,actor,input);
    assert.deepEqual(retired,{retired:true,partialBatchId:null});
    assert.deepEqual(await retireScannerBatchCreation(db,actor,input),retired);
    await assert.rejects(createScannerBatch(db,actor,input,epoch),/cancelled/);
    await assert.rejects(retireScannerBatchCreation(db,actor,{...input,settings:{...settings,dpi:300}}),/does not match/);

    const partial={...input,requestKey:randomUUID()};
    await createAcquisitionSession(db,actor,{requestKey:partial.requestKey,ownerPlayerId:tag,locationId:tag,section:"",
      defaults:input.defaults,policy:{kind:"FILL"},run:{providerId:SCANNER_CAPTURE_PROVIDER,runId:partial.requestKey,enforcement:"LOGICAL_ALLOCATION",controls:["STOP"]}});
    await assert.rejects(retireScannerBatchCreation(db,actor,{...partial,quantity:1}),/uncertain evidence/);
    assert.equal(await scannerStartRetired(partial.requestKey),false);
    const cancelled=await retireScannerBatchCreation(db,actor,partial);assert.equal(cancelled.retired,true);
    const partialRow=await db.acquisitionSession.findUniqueOrThrow({where:{createdByUserId_requestKey:{createdByUserId:tag,requestKey:partial.requestKey}}});
    assert.equal(partialRow.phase,"CANCELLED");
    // Restoring an earlier DB row does not erase appdata retirement evidence.
    await db.acquisitionSession.update({where:{id:partialRow.id},data:{phase:"DRAFT",revision:0}});
    await assert.rejects(createScannerBatch(db,actor,partial,epoch),/cancelled/);
    assert.equal((await retireScannerBatchCreation(db,actor,partial)).retired,true);
    assert.equal((await db.acquisitionSession.findUniqueOrThrow({where:{id:partialRow.id}})).phase,"CANCELLED");

    const marked={...input,requestKey:randomUUID()};await persistScannerStartMarker(marked.requestKey,epoch,randomUUID());
    await assert.rejects(retireScannerBatchCreation(db,actor,marked),/uncertain scanner evidence/);
    assert.equal(await scannerStartRetired(marked.requestKey),false);
    assert.equal(await scannerStartMarkerExists(marked.requestKey),true);
    await revokeScannerAgent(db,tag,first.agentId);

    // Pause after each real creation transaction commits. Retirement can land
    // between phases without treating a missing ScannerRun as completed work.
    for(const afterPhase of [1,2,3]) {
      const h=await helper(),value={...input,agentId:h.agentId,requestKey:randomUUID(),quantity:1};
      let release!:()=>void,notify!:()=>void,count=0;
      const gate=new Promise<void>(resolve=>{release=resolve;}),paused=new Promise<void>(resolve=>{notify=resolve;});
      const pausing=new Proxy(db,{get(target,key){
        if(key==="$transaction")return async (work:(tx:Prisma.TransactionClient)=>Promise<unknown>,options?:{isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number})=>{
          // The first transaction lists/authorizes the helper, before creation.
          const result=await target.$transaction(work,options);if(++count===afterPhase+1){notify();await gate;}return result;
        };
        const member=Reflect.get(target,key,target);return typeof member==="function"?member.bind(target):member;
      }}) as PrismaClient;
      const creating=createScannerBatch(pausing,actor,value,epoch);
      // Attach rejection immediately so a failing phase cannot leak a rejection.
      const outcome=creating.then(value=>({value,error:null}),error=>({value:null,error}));
      try {
        await Promise.race([paused,outcome.then(result=>{if(result.error)throw result.error;throw Error("Creation did not reach paused phase");})]);
        const settlement=await retireScannerBatchCreation(db,actor,value);
        if(afterPhase<3){assert.equal(settlement.retired,true);assert.equal(await scannerStartRetired(value.requestKey),true);}
        else {
          assert.equal(settlement.retired,false);assert.equal(await scannerStartRetired(value.requestKey),false);
          const claim=await claimScannerRun(db,h.token,{version:1,runId:value.requestKey,epoch,executionId:randomUUID()},epoch);
          assert.equal(claim.feedAuthorized,true); // protocol fixture only, no helper/motor
          assert.equal((await retireScannerBatchCreation(db,actor,value)).retired,false);
        }
      } finally { release(); }
      const result=await outcome;
      if(afterPhase<3){assert.match(String(result.error),/cancelled/);assert.equal(await db.scannerRun.count({where:{id:value.requestKey}}),0);}
      else {assert.equal(result.error,null);assert.equal(result.value!.runId,value.requestKey);}
      await revokeScannerAgent(db,tag,h.agentId);
    }
    // Slot evidence in a partial batch prevents cancellation; nothing deleted.
    const h=await helper(),value={...input,agentId:h.agentId,requestKey:randomUUID(),quantity:1};
    const capture=await createAcquisitionSession(db,actor,{requestKey:value.requestKey,ownerPlayerId:tag,locationId:tag,section:"",
      defaults:value.defaults,policy:{kind:"MANUAL",quantity:1},run:{providerId:SCANNER_CAPTURE_PROVIDER,runId:value.requestKey,enforcement:"LOGICAL_ALLOCATION",controls:["STOP"]}});
    const run=await db.acquisitionRun.findUniqueOrThrow({where:{sessionId:capture.session.id}});
    await db.acquisitionCaptureSlot.create({data:{id:randomUUID(),runId:run.id,requestKey:"saved-slot",position:0}});
    await assert.rejects(retireScannerBatchCreation(db,actor,value),/uncertain evidence/);
    assert.equal(await scannerStartRetired(value.requestKey),false);assert.equal(await db.acquisitionCaptureSlot.count({where:{runId:run.id}}),1);
    assert.equal(await db.acquisitionPhoto.count({where:{run:{session:{createdByUserId:tag}}}}),0);
    assert.equal(await db.inventoryItem.count({where:{currentOwnerId:tag}}),0);
    console.log("PASS: retired/replayed creation, partial identity/cancellation/restore, three late-creation phases, accepted+started adoption, foreign actor and saved START/slot evidence; no motor/Inventory");
  } finally {
    const where={run:{session:{createdByUserId:{in:ids}}}};
    await db.scannerRun.deleteMany({where:{agent:{userId:{in:ids}}}});
    await db.acquisitionProcessingJob.deleteMany({where});await db.acquisitionProcessingTurn.deleteMany({where});
    await db.acquisitionPhoto.deleteMany({where});await db.acquisitionObservation.deleteMany({where});
    await db.acquisitionCountCorrection.deleteMany({where});await db.acquisitionCandidate.deleteMany({where});
    await db.acquisitionArtifact.deleteMany({where});await db.acquisitionCaptureSlot.deleteMany({where});
    await db.acquisitionCommand.deleteMany({where});await db.acquisitionEvent.deleteMany({where});
    await db.acquisitionRun.deleteMany({where:{session:{createdByUserId:{in:ids}}}});await db.acquisitionSession.deleteMany({where:{createdByUserId:{in:ids}}});
    await db.scannerPairing.deleteMany({where:{userId:{in:ids}}});await db.scannerAgent.deleteMany({where:{userId:{in:ids}}});await db.inventoryLocation.deleteMany({where:{id:tag}});
    await db.user.deleteMany({where:{id:{in:ids}}});await db.player.deleteMany({where:{id:{in:ids}}});
    if(prior===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=prior;
    if(path.dirname(root)!==parent||!path.basename(root).startsWith("scanner-retire-db-"))throw Error("Fixture escaped");await rm(root,{recursive:true,force:true});
  }
}
