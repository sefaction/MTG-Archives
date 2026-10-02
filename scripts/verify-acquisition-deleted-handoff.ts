import assert from "node:assert/strict";
import {Prisma,type PrismaClient} from "@prisma/client";

// Called only by the guarded disposable PostgreSQL verifier. Real SQL must
// select this eligible source before we delete it at the query/read boundary.
export async function verifyDeletedHandoffSource(
  db:PrismaClient,sourceId:string,stage:string,enqueue:(client:PrismaClient)=>Promise<number>,
){
  const original=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:sourceId}});
  const before=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:original.candidateId}});
  const inventory=await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  let selected=false;
  const boundary=new Proxy(db,{
    get(target,property){
      if(property==="$queryRaw")return async(...args:unknown[])=>{
        const rows=await Reflect.apply(target.$queryRaw,target,args) as {id:string}[];
        assert(rows.some(row=>row.id===sourceId),`${stage} fixture source must actually be SQL-eligible`);
        await db.acquisitionProcessingJob.delete({where:{id:sourceId}});selected=true;
        // Isolate the controlled boundary; live-source continuation also has
        // unit coverage and the caller runs ordinary enqueue after restoration.
        return rows.filter(row=>row.id===sourceId);
      };
      const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
    },
  });
  try{
    assert.equal(await enqueue(boundary),0,"deleted eligible source must not stop admission");
    assert(selected,"the deletion boundary must be exercised");
    assert.equal(await db.acquisitionProcessingJob.count({where:{candidateId:original.candidateId,stage}}),0,
      "deleted source creates no downstream work");
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:original.candidateId}}),before);
    assert.deepEqual(await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),inventory);
    console.log(`PASS: ${stage} real SQL-selected source deletion is skipped without review/Inventory changes`);
  }finally{
    if(selected)await db.acquisitionProcessingJob.create({data:{...original,
      input:original.input as Prisma.InputJsonValue,output:original.output===null?Prisma.DbNull:original.output as Prisma.InputJsonValue}});
  }
}
