import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import type {PrismaClient} from "@prisma/client";
import {enqueueCatalogReconciliation} from "../lib/acquisition-catalog-reconciliation";
import {enqueueReadyVisual} from "../lib/acquisition-visual-worker";
import {enqueueReadyPrinting} from "../lib/acquisition-printing-worker";

const handoffs = [
  {name:"catalog",enqueue:(db:PrismaClient)=>enqueueCatalogReconciliation(db,new Date(),false)},
  {name:"visual",enqueue:(db:PrismaClient)=>enqueueReadyVisual(db,"a".repeat(64))},
  {name:"printing",enqueue:(db:PrismaClient)=>enqueueReadyPrinting(db,"a".repeat(64))},
];
for(const {name,enqueue} of handoffs){
  test(`${name} skips a deleted selection and still admits the next live source`,async()=>{
    const removed=randomUUID(),live=randomUUID(),photoId=randomUUID();
    const source={id:live,runId:randomUUID(),artifactId:randomUUID(),candidateId:randomUUID(),candidateRevision:3,
      candidate:{revision:3},input:{photoId,digest:"b".repeat(64)}};
    const admitted:any[]=[];
    const read=async({where}:{where:{id:string}})=>where.id===removed?null:source;
    const db={
      $queryRaw:async()=>[{id:removed},{id:live}],
      acquisitionProcessingJob:{findUnique:read,findUniqueOrThrow:async(args:any)=>{
        const result=await read(args);if(!result)throw Error("Selected source disappeared");return result;},
        createMany:async({data}:any)=>{admitted.push(...data);return{count:data.length};}},
      acquisitionPhoto:{findUnique:async()=>({ready:true,purgedAt:null,digest:source.input.digest,
        runId:source.runId,generation:1,slot:{generation:1}})},
    } as unknown as PrismaClient;
    assert.equal(await enqueue(db),1);
    assert.equal(admitted.length,1);
    assert.equal(admitted[0].candidateId,source.candidateId);
    assert.equal(admitted[0].candidateRevision,3);
    assert.equal(admitted[0].input.photoId,photoId);
  });
  test(`${name} continues when its entire selected source set disappeared`,async()=>{
    let writes=0;
    const db={$queryRaw:async()=>[{id:randomUUID()}],acquisitionProcessingJob:{
      findUnique:async()=>null,findUniqueOrThrow:async()=>{throw Error("Selected source disappeared");},
      createMany:async()=>{writes++;return{count:1};},
    }} as unknown as PrismaClient;
    assert.equal(await enqueue(db),0);assert.equal(writes,0);
  });
  test(`${name} propagates genuine read failures`,async()=>{
    const failed=async()=>{throw Error("Database unavailable fixture");};
    const db={$queryRaw:async()=>[{id:randomUUID()}],acquisitionProcessingJob:{
      findUnique:failed,findUniqueOrThrow:failed,
    }} as unknown as PrismaClient;
    await assert.rejects(enqueue(db),/Database unavailable fixture/);
  });
}
