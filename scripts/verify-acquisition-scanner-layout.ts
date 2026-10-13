import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import sharp from 'sharp';
import {createAcquisitionSession,executeAcquisitionCommand,reserveAcquisitionCaptureSlot,beginAcquisitionPhoto,finalizeAcquisitionPhoto,
  getAcquisitionCardReview,saveAcquisitionReview,type AcquisitionActor,type CreateAcquisitionInput} from '../lib/acquisition-store';
import {inspectAcquisitionPhoto,writeAcquisitionPhotoBytes,readAcquisitionPhotoBytes} from '../lib/acquisition-files';
import {scannerLayoutTemplateSchema} from '../lib/acquisition-scanner-layout';
import {nativeSchema} from '../lib/acquisition-recognition-worker';
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from '../lib/acquisition-recognition';

// Real store, ownership, transactions and immutable upload snapshots. The native
// source fixture is explicitly synthetic; separate real OCR controls qualify it.
export async function verifyAcquisitionScannerLayout(db:PrismaClient,actor:AcquisitionActor,stranger:AcquisitionActor,base:CreateAcquisitionInput){
  const beforeOwner=await db.player.findUniqueOrThrow({where:{id:base.ownerPlayerId},select:{scannerLayoutProfile:true}});
  const stock=()=>db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),stockBefore=await stock();
  const locationId='scanner-layout-'+randomUUID();
  await db.inventoryLocation.create({data:{id:locationId,name:locationId,normalizedName:locationId,ownerPlayerId:base.ownerPlayerId,
    type:'Box',storageLayout:{capacity:3,sections:[{name:'A',capacity:3}]}}});
  const capture=await createAcquisitionSession(db,actor,{...base,locationId,requestKey:randomUUID(),policy:{kind:'MANUAL',quantity:3},
    run:{...base.run,providerId:'phone-photo-v1',runId:randomUUID()}}),sessionId=capture.session.id;
  await executeAcquisitionCommand(db,actor,sessionId,{requestKey:'start',revision:0,command:'START'});
  const bytes=await sharp({create:{width:1700,height:2300,channels:3,background:'#dddddd'}}).jpeg().toBuffer();
  const metadata=await inspectAcquisitionPhoto(bytes,'image/jpeg');
  async function upload(key:string,inputKind:'CARD_SCAN'|'PHOTO'){
    const {slot}=await reserveAcquisitionCaptureSlot(db,actor,sessionId,key);
    const photo=await beginAcquisitionPhoto(db,actor,sessionId,{slotId:slot.id,generation:0,uploadKey:randomUUID(),metadata,inputKind});
    await writeAcquisitionPhotoBytes(photo.id,bytes,'raw',photo.digest);await finalizeAcquisitionPhoto(db,actor,sessionId,photo.id);
    return photo;
  }
  try{
    await db.player.update({where:{id:base.ownerPlayerId},data:{scannerLayoutProfile:null}});
    const source=await upload('source','CARD_SCAN');
    assert.equal(source.scannerLayoutProfile,null);
    let state=await getAcquisitionCardReview(db,actor,sessionId,source.id);
    const request=()=>({action:'scanner-layout',photoId:source.id,revision:state.revision,requestKey:randomUUID(),reset:false});
    await assert.rejects(saveAcquisitionReview(db,actor,sessionId,request()));
    const region={version:1 as const,quad:[[50/1699,30/2299],[1650/1699,30/2299],[1650/1699,2270/2299],[50/1699,2270/2299]] as [[number,number],[number,number],[number,number],[number,number]]};
    await saveAcquisitionReview(db,actor,sessionId,{action:'region',photoId:source.id,revision:state.revision,requestKey:randomUUID(),region});
    state=await getAcquisitionCardReview(db,actor,sessionId,source.id);
    const candidate=await db.acquisitionCandidate.findUniqueOrThrow({where:{runId_physicalId:{runId:source.runId,physicalId:source.slotId}}});
    const canonical=await db.acquisitionProcessingJob.findFirstOrThrow({where:{runId:source.runId,artifact:{sourceId:source.id},stage:'photo-canonical-v1'}});
    const template=scannerLayoutTemplateSchema.parse({version:1,policy:'scanner-layout-anchor-v1',sourceDigest:source.digest,sourceMethod:'manual-card-region-v1',
      frame:{width:1700,height:2300},region,anchors:[{kind:'COLLECTOR',point:[40/999,1320/1396]},{kind:'TITLE',point:[60/999,115/1396]}]});
    const text={title:['Calibration Creature'],footer:['R 0017','TST EN']};
    const lines=[{text:'Calibration Creature',score:.97,polygon:[[60,80],[500,80],[500,115],[60,115]]},
      {text:'R 0017',score:.98,polygon:[[40,1290],[150,1290],[150,1320],[40,1320]]}];
    const native=nativeSchema.parse({version:1,descriptor:'a'.repeat(64),descriptorDetails:{},photoDigest:source.digest,
      geometry:{status:'PROPOSED',method:'manual-card-region-v1',manualRegion:region,quad:[[50,30],[1650,30],[1650,2270],[50,2270]]},
      text,lines,orientations:[{rotationDegrees:0,text,lines},{rotationDegrees:180,text:{title:[],footer:[]},lines:[]}],
      milliseconds:1,automaticAcceptance:false,scannerLayoutTemplate:template});
    const output={version:1,photoId:source.id,versions:{model:'a'.repeat(64),catalog:'b'.repeat(64)},native,
      proposals:proposeOrientedAcquisitionPrintings(createAcquisitionRecognitionIndex([]),native.orientations)};
    const job=await db.acquisitionProcessingJob.create({data:{runId:source.runId,artifactId:canonical.artifactId,candidateId:candidate.id,
      candidateRevision:candidate.revision,stage:'photo-recognition-v1',versionKey:'scanner-layout-fixture',status:'COMPLETE',
      input:{photoId:source.id,digest:source.digest,manualAnalysis:candidate.manualAnalysis},output:output as unknown as Prisma.InputJsonObject}});
    state=await getAcquisitionCardReview(db,actor,sessionId,source.id);assert.equal(state.scannerLayout?.canSave,true);
    const save=request();
    await assert.rejects(saveAcquisitionReview(db,stranger,sessionId,save),/unavailable/);
    await assert.rejects(saveAcquisitionReview(db,actor,sessionId,{...save,revision:state.revision-1}),/changed/);
    const fault=db.$extends({query:{acquisitionCommand:{async create(){throw Error('injected layout history failure');}}}}) as unknown as PrismaClient;
    await assert.rejects(saveAcquisitionReview(fault,actor,sessionId,save),/injected/);
    assert.equal((await db.player.findUniqueOrThrow({where:{id:base.ownerPlayerId}})).scannerLayoutProfile,null);
    const concurrent=await Promise.all([1,2].map(()=>saveAcquisitionReview(db,actor,sessionId,save)));
    assert.equal(concurrent.filter(r=>r.replay).length,1);
    const saved=(await db.player.findUniqueOrThrow({where:{id:base.ownerPlayerId}})).scannerLayoutProfile!;
    const storedJob=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:job.id}});
    const observedTemplate=nativeSchema.parse((storedJob.output as {native:unknown}).native).scannerLayoutTemplate;
    assert.deepEqual(JSON.parse(saved),observedTemplate,'profile preserves the actual database observation exactly');
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:candidate.id}}),candidate);
    assert.equal((await db.acquisitionPhoto.findUniqueOrThrow({where:{id:source.id}})).scannerLayoutProfile,null);
    const future=await upload('future','CARD_SCAN'),phone=await upload('phone','PHOTO');
    assert.equal(future.scannerLayoutProfile,saved);assert.equal(phone.scannerLayoutProfile,null);
    await saveAcquisitionReview(db,actor,sessionId,{...save,requestKey:randomUUID(),reset:true});
    await saveAcquisitionReview(db,actor,sessionId,save); // replay cannot restore a reset setting
    assert.equal((await db.player.findUniqueOrThrow({where:{id:base.ownerPlayerId}})).scannerLayoutProfile,null);
    assert.equal((await db.acquisitionPhoto.findUniqueOrThrow({where:{id:future.id}})).scannerLayoutProfile,saved);
    const replacement=await beginAcquisitionPhoto(db,actor,sessionId,{slotId:future.slotId,generation:future.generation,
      uploadKey:randomUUID(),metadata,inputKind:'CARD_SCAN'});assert.equal(replacement.scannerLayoutProfile,null);
    // A template from old/manual/unknown bytes is never a new owner setting.
    await db.acquisitionProcessingJob.update({where:{id:job.id},data:{output:{...output,native:{...native,photoDigest:'e'.repeat(64)}} as unknown as Prisma.InputJsonObject}});
    await assert.rejects(saveAcquisitionReview(db,actor,sessionId,{...save,requestKey:randomUUID()}));
    assert.equal((await db.player.findUniqueOrThrow({where:{id:base.ownerPlayerId}})).scannerLayoutProfile,null);
    await saveAcquisitionReview(db,actor,sessionId,{action:'region',photoId:source.id,revision:state.revision,requestKey:randomUUID(),region:null});
    state=await getAcquisitionCardReview(db,actor,sessionId,source.id);
    const cleared=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:candidate.id}});
    const fabricated={...native,geometry:{...native.geometry,manualRegion:undefined}};
    await db.acquisitionProcessingJob.create({data:{runId:source.runId,artifactId:canonical.artifactId,candidateId:candidate.id,
      candidateRevision:cleared.revision,stage:'photo-recognition-v1',versionKey:'scanner-layout-unselected-manual-fixture',status:'COMPLETE',
      input:{photoId:source.id,digest:source.digest,manualAnalysis:cleared.manualAnalysis},
      output:{...output,native:fabricated} as unknown as Prisma.InputJsonObject}});
    state=await getAcquisitionCardReview(db,actor,sessionId,source.id);
    assert.equal(state.scannerLayout?.canSave,false,'unselected manual provenance cannot train a layout');
    await assert.rejects(saveAcquisitionReview(db,actor,sessionId,{...save,revision:state.revision,requestKey:randomUUID()}),/manual layout source changed/);
    assert.equal((await db.player.findUniqueOrThrow({where:{id:base.ownerPlayerId}})).scannerLayoutProfile,null);
    assert.deepEqual(await readAcquisitionPhotoBytes(source.id,'raw',source.digest),bytes);
    assert.deepEqual(await stock(),stockBefore);
    console.log('PASS scanner layout: owner/source/revision guards, atomic history and concurrency, replay/reset, frozen future scans, phone exclusion, no Inventory or original change');
  }finally{
    await db.player.update({where:{id:base.ownerPlayerId},data:beforeOwner});
    await db.acquisitionSession.update({where:{id:sessionId},data:{phase:'CANCELLED',cancelledAt:new Date(),deletedAt:new Date()}});
  }
}
