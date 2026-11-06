import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {manageAcquisitionBatch} from "../lib/acquisition-batch-lifecycle";
import {inspectAcquisitionPhoto} from "../lib/acquisition-files";
import {beginAcquisitionPhoto, finalizeAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot, type AcquisitionActor, type CreateAcquisitionInput} from "../lib/acquisition-store";

/** Concurrent physical identities remain serialized, while distinct slots and
 * batches can pass former aggregate-byte thresholds. Metadata-only retained
 * history exercises those thresholds without allocating giant image files. */
export async function verifyAcquisitionPhotoLocking(db: PrismaClient, actor: AcquisitionActor,
  base: CreateAcquisitionInput, bytes: Buffer) {
  const metadata=await inspectAcquisitionPhoto(bytes,"image/jpeg");
  const sessions:string[]=[], seeded:string[]=[];
  const locationId=`photo-locking-${randomUUID()}`;
  await db.inventoryLocation.create({data:{id:locationId,ownerPlayerId:base.ownerPlayerId,
    name:locationId,normalizedName:locationId,type:"Box",
    storageLayout:{capacity:1000,sections:[{name:"A",capacity:1000}]}}});
  const make=async(quantity:number,reserveCount=quantity)=>{
    const capture=await createAcquisitionSession(db,actor,{...base,locationId,
      requestKey:randomUUID(),policy:{kind:"MANUAL",quantity},
      run:{...base.run,providerId:"phone-photo-v1",runId:randomUUID()}});
    const id=capture.session.id; sessions.push(id);
    await executeAcquisitionCommand(db,actor,id,{requestKey:"start",revision:0,command:"START"});
    const inputs=[];
    for(let i=0;i<reserveCount;i++){
      const {slot}=await reserveAcquisitionCaptureSlot(db,actor,id,`slot-${i}`);
      inputs.push({slotId:slot.id,generation:0,uploadKey:randomUUID(),metadata,inputKind:"CARD_SCAN" as const});
    }
    const run=await db.acquisitionRun.findUniqueOrThrow({where:{sessionId:id}});
    return {id,runId:run.id,inputs};
  };
  const seedReservedBytes=async(setup:Awaited<ReturnType<typeof make>>,total:number)=>{
    const slots=[],photos=[];
    for(let position=setup.inputs.length;total>0;position++){
      const slotId=randomUUID(),photoId=randomUUID(),size=Math.min(total,10*1024**2);
      slots.push({id:slotId,runId:setup.runId,requestKey:`reserved-${position}`,position,generation:1});
      photos.push({id:photoId,runId:setup.runId,slotId,uploadKey:randomUUID(),generation:1,
        ...metadata,bytes:size,inputKind:"CARD_SCAN" as const});
      total-=size; seeded.push(photoId);
    }
    await db.acquisitionCaptureSlot.createMany({data:slots});
    await db.acquisitionPhoto.createMany({data:photos});
  };
  const assertBothAccepted=(results:PromiseSettledResult<unknown>[])=>{
    assert.equal(results.filter(r=>r.status==="fulfilled").length,2);
  };
  try {
    const expired=await make(1);
    const accepted=await beginAcquisitionPhoto(db,actor,expired.id,expired.inputs[0]);
    let reached!:()=>void, release!:()=>void, intercepted=false;
    const readReached=new Promise<void>(resolve=>{reached=resolve;});
    const readReleased=new Promise<void>(resolve=>{release=resolve;});
    const waiting=db.$extends({query:{acquisitionSession:{async findUnique({args,query}){
      const result=await query(args);
      if(args.where.id===expired.id&&!intercepted){intercepted=true;reached();await readReleased;}
      return result;
    }}}}) as unknown as PrismaClient;
    const completion=finalizeAcquisitionPhoto(waiting,actor,expired.id,accepted.id);
    // Attach rejection handling before unblocking; this is an expected refusal.
    const refusal=assert.rejects(completion,/Capture batch has expired/);
    await Promise.race([readReached,completion.then(()=>{throw new Error("Expected upload pre-lock read");})]);
    try {
      await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${expired.id} FOR UPDATE`;
        await tx.acquisitionSession.update({where:{id:expired.id},data:{deletedAt:new Date(),phase:"CANCELLED"}});
      });
    } finally { release(); }
    await refusal;
    assert.equal((await db.acquisitionPhoto.findUniqueOrThrow({where:{id:accepted.id}})).ready,false);
    assert.equal(await db.acquisitionEvent.count({where:{runId:accepted.runId}}),0);

    const batch=await make(105,2);
    await seedReservedBytes(batch,1024**3-metadata.bytes);
    assertBothAccepted(await Promise.allSettled(batch.inputs.map(input=>
      beginAcquisitionPhoto(db,actor,batch.id,input))));
    assert.equal(await db.acquisitionPhoto.count({where:{runId:batch.runId}}),105);
    assert.deepEqual((await db.acquisitionCaptureSlot.findMany({where:{runId:batch.runId,position:{lt:2}},
      orderBy:{position:"asc"}})).map(s=>s.generation).sort((a,b)=>a-b),[1,1]);
    await db.acquisitionPhoto.updateMany({where:{id:{in:seeded}},data:{bytes:metadata.bytes}});

    const ownerFillers=[];
    for(let i=0;i<4;i++){
      ownerFillers.push(await make(104,0));
    }
    const contenders=await Promise.all([make(1),make(1)]);
    const usage=await db.acquisitionPhoto.aggregate({where:{run:{session:{ownerPlayerId:base.ownerPlayerId}},
      purgedAt:null},_sum:{bytes:true}});
    let remaining=4*1024**3-metadata.bytes-(usage._sum.bytes??0);
    assert.ok(remaining>0);
    for(const setup of ownerFillers){
      const added=Math.min(remaining,1024**3);
      await seedReservedBytes(setup,added);
      remaining-=added;
    }
    assert.equal(remaining,0);
    assertBothAccepted(await Promise.allSettled(contenders.map(setup=>
      beginAcquisitionPhoto(db,actor,setup.id,setup.inputs[0]))));
    const after=await db.acquisitionPhoto.aggregate({where:{run:{session:{ownerPlayerId:base.ownerPlayerId}},
      purgedAt:null},_sum:{bytes:true}});
    assert.equal(after._sum.bytes,4*1024**3+metadata.bytes);
    for(const setup of [batch,...contenders]) for(const input of setup.inputs) {
      const first=await beginAcquisitionPhoto(db,actor,setup.id,input);
      assert.equal((await beginAcquisitionPhoto(db,actor,setup.id,input)).id,first.id);
    }
    const physical=await make(1);
    const race=await Promise.allSettled([0,1].map(()=>beginAcquisitionPhoto(db,actor,physical.id,
      {...physical.inputs[0],uploadKey:randomUUID()})));
    assert.equal(race.filter(result=>result.status==="fulfilled").length,1);
    assert.match(String((race.find(result=>result.status==="rejected") as PromiseRejectedResult).reason),/Photo changed|Retry the unfinished/);
    assert.equal(await db.acquisitionPhoto.count({where:{runId:physical.runId}}),1);
    assert.equal((await db.acquisitionCaptureSlot.findUniqueOrThrow({where:{id:physical.inputs[0].slotId}})).generation,1);
    console.log("PASS: expiry, concurrent distinct slots/batches beyond former byte limits, exact replay and conflicting same-physical-slot serialization; unready originals preserved");
  } finally {
    if(seeded.length) await db.acquisitionPhoto.updateMany({where:{id:{in:seeded}},data:{bytes:metadata.bytes}});
    for(const id of sessions) if(!(await db.acquisitionSession.findUniqueOrThrow({where:{id}})).deletedAt)
      await manageAcquisitionBatch(db,actor,id,"cancel");
  }
}
