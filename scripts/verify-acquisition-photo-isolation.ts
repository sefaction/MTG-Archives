import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {manageAcquisitionBatch} from "../lib/acquisition-batch-lifecycle";
import {inspectAcquisitionPhoto, writeAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {beginAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand,
  finalizeAcquisitionPhoto, getAcquisitionProgress, proposeAcquisitionCandidate,
  reserveAcquisitionCaptureSlot, reviewAcquisitionCandidate,
  type AcquisitionActor, type CreateAcquisitionInput} from "../lib/acquisition-store";

/** Exercise late accepted uploads beside independent saved review/proposal rows.
 * Duplicate bytes remain four physical copies; replay cannot overwrite old work. */
export async function verifyAcquisitionPhotoIsolation(db: PrismaClient, actor: AcquisitionActor,
  stranger: AcquisitionActor, base: CreateAcquisitionInput, bytes: Buffer) {
  const locationId=`photo-isolation-${randomUUID()}`;
  await db.inventoryLocation.create({data:{id:locationId,ownerPlayerId:base.ownerPlayerId,
    name:locationId,normalizedName:locationId,type:"Box",
    storageLayout:{capacity:4,sections:[{name:"A",capacity:4}]}}});
  const capture=await createAcquisitionSession(db,actor,{...base,locationId,
    requestKey:randomUUID(),policy:{kind:"MANUAL",quantity:4},
    run:{...base.run,providerId:"phone-photo-v1",runId:randomUUID()}});
  const sessionId=capture.session.id;
  await executeAcquisitionCommand(db,actor,sessionId,{requestKey:"start",revision:0,command:"START"});
  const metadata=await inspectAcquisitionPhoto(bytes,"image/jpeg");
  const photos=[];
  for(let n=0;n<4;n++){
    const {slot}=await reserveAcquisitionCaptureSlot(db,actor,sessionId,`physical-${n}`);
    const photo=await beginAcquisitionPhoto(db,actor,sessionId,{slotId:slot.id,
      generation:0,uploadKey:randomUUID(),metadata,inputKind:"CARD_SCAN"});
    await writeAcquisitionPhotoBytes(photo.id,bytes,"raw",photo.digest);
    photos.push(photo);
  }
  await Promise.all(photos.slice(0,2).map(photo=>finalizeAcquisitionPhoto(db,actor,sessionId,photo.id)));
  let state=await getAcquisitionProgress(db,actor,sessionId);
  const card=await db.card.findFirstOrThrow({select:{id:true}});
  const first=state.session.candidates.find(c=>c.input.order[0]===0)!;
  await reviewAcquisitionCandidate(db,actor,sessionId,state.revision,first.key,first.revision,
    {cardId:card.id,language:"en",finish:"NONFOIL",condition:"LP"});
  state=await getAcquisitionProgress(db,actor,sessionId);
  const second=state.session.candidates.find(c=>c.input.order[0]===1)!;
  await proposeAcquisitionCandidate(db,actor,sessionId,state.revision,second.key,second.revision,
    {cardId:card.id,language:"en",finish:"FOIL",condition:"NM"});
  const runId=photos[0].runId;
  const priorCards=await db.acquisitionCandidate.findMany({where:{runId,acquisitionOrder:{lt:2}},
    orderBy:{acquisitionOrder:"asc"},include:{observations:true,receipt:true}});
  const priorEvents=await db.acquisitionEvent.findMany({where:{runId},orderBy:{sourceEventId:"asc"}});
  state=await getAcquisitionProgress(db,actor,sessionId);
  await executeAcquisitionCommand(db,actor,sessionId,{requestKey:"stop",revision:state.revision,command:"STOP"});
  await assert.rejects(finalizeAcquisitionPhoto(db,stranger,sessionId,photos[2].id),/unavailable/);
  await Promise.all(photos.slice(2).map(photo=>finalizeAcquisitionPhoto(db,actor,sessionId,photo.id)));
  await finalizeAcquisitionPhoto(db,actor,sessionId,photos[3].id);
  await beginAcquisitionPhoto(db,actor,sessionId,{slotId:photos[3].slotId,generation:0,
    uploadKey:photos[3].uploadKey,metadata,inputKind:"CARD_SCAN"});
  assert.deepEqual(await db.acquisitionCandidate.findMany({where:{runId,acquisitionOrder:{lt:2}},
    orderBy:{acquisitionOrder:"asc"},include:{observations:true,receipt:true}}),priorCards);
  assert.deepEqual(await db.acquisitionEvent.findMany({where:{runId,sourceEventId:{in:priorEvents.map(e=>e.sourceEventId)}},
    orderBy:{sourceEventId:"asc"}}),priorEvents);
  const final=await getAcquisitionProgress(db,actor,sessionId);
  assert.equal(final.session.phase,"STOPPING");
  assert.equal(final.slots.length,4);
  assert.equal(final.slots.filter(slot=>slot.photos.some(photo=>photo.ready)).length,4);
  assert.deepEqual(final.session.candidates.map(c=>c.input.order[0]).sort((a,b)=>a-b),[0,1,2,3]);
  assert.equal(final.session.artifacts.length,4);
  assert.equal(final.session.receipts.length,4);
  assert.equal(await db.acquisitionProcessingJob.count({where:{runId,stage:"photo-canonical-v1"}}),4);
  assert.equal(await db.acquisitionObservation.count({where:{runId}}),4);
  await manageAcquisitionBatch(db,actor,sessionId,"cancel");
  console.log("PASS: parallel accepted photo finalization preserves earlier review/proposal/events, owner fences and exact replay counts");
}
