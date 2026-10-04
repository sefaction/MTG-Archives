import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {manageAcquisitionBatch} from "../lib/acquisition-batch-lifecycle";
import {inspectAcquisitionPhoto} from "../lib/acquisition-files";
import {beginAcquisitionPhoto, finalizeAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot, type AcquisitionActor, type CreateAcquisitionInput} from "../lib/acquisition-store";

/** Reserved bytes count even before durable receipt. Competing intakes may not
 * both consume the last available bytes, within a batch or across its owner's
 * independent batches. Metadata-only fixtures never create giant image files. */
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
  const assertOneAccepted=(results:PromiseSettledResult<unknown>[])=>{
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    const rejected=results.find(r=>r.status==="rejected") as PromiseRejectedResult;
    assert.match(String(rejected.reason),/Photo storage limit reached/);
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
    assertOneAccepted(await Promise.allSettled(batch.inputs.map(input=>
      beginAcquisitionPhoto(db,actor,batch.id,input))));
    assert.equal(await db.acquisitionPhoto.count({where:{runId:batch.runId}}),104);
    assert.deepEqual((await db.acquisitionCaptureSlot.findMany({where:{runId:batch.runId,position:{lt:2}},
      orderBy:{position:"asc"}})).map(s=>s.generation).sort((a,b)=>a-b),[0,1]);
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
    assertOneAccepted(await Promise.allSettled(contenders.map(setup=>
      beginAcquisitionPhoto(db,actor,setup.id,setup.inputs[0]))));
    const after=await db.acquisitionPhoto.aggregate({where:{run:{session:{ownerPlayerId:base.ownerPlayerId}},
      purgedAt:null},_sum:{bytes:true}});
    assert.equal(after._sum.bytes,4*1024**3);
    console.log("PASS: locked uploads recheck expiry and simultaneous intakes preserve final session/owner quota bytes, including unready reservations");
  } finally {
    if(seeded.length) await db.acquisitionPhoto.updateMany({where:{id:{in:seeded}},data:{bytes:metadata.bytes}});
    for(const id of sessions) if(!(await db.acquisitionSession.findUniqueOrThrow({where:{id}})).deletedAt)
      await manageAcquisitionBatch(db,actor,id,"cancel");
  }
}
