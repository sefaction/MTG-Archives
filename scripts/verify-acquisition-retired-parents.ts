import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Prisma,type PrismaClient} from "@prisma/client";

// Admission-only synthetic parent records in the guarded disposable database.
// Original photos/reviews/source jobs are read but never changed by this probe.
export async function verifyRetiredHandoffParents(
  db:PrismaClient,sourceId:string,stage:string,enqueue:(client:PrismaClient)=>Promise<number>,
){
  const original=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:sourceId}});
  const candidate=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:original.candidateId}});
  const artifact=await db.acquisitionArtifact.findUniqueOrThrow({where:{id:original.artifactId}});
  const photos=await db.acquisitionPhoto.findMany({where:{runId:original.runId},orderBy:{id:'asc'}});
  const inventory=await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  const identity=randomUUID();let jobId='',candidateId='',artifactId='',removed=false;
  const supportingJobs:string[]=[];
  try{
    const max=await db.acquisitionCandidate.aggregate({where:{runId:original.runId},_max:{acquisitionOrder:true}});
    const parent=await db.acquisitionCandidate.create({data:{runId:original.runId,physicalId:'retired-'+identity,
      identityKind:candidate.identityKind,acquisitionOrder:(max._max.acquisitionOrder??0)+1,spatialOrder:0,
      expectedSides:candidate.expectedSides,provisional:candidate.provisional,uncertainty:candidate.uncertainty,
      revision:original.candidateRevision}});candidateId=parent.id;
    const image=await db.acquisitionArtifact.create({data:{runId:original.runId,sourceId:'retired-'+identity,digest:artifact.digest}});artifactId=image.id;
    const clone=await db.acquisitionProcessingJob.create({data:{...original,id:randomUUID(),candidateId,artifactId,versionKey:identity,
      input:original.input as Prisma.InputJsonValue,output:original.output===null?Prisma.DbNull:original.output as Prisma.InputJsonValue,
      createdAt:new Date()}});jobId=clone.id;
    if(stage==='photo-visual-retrieval-v1'){
      const upstream=await db.acquisitionProcessingJob.findFirstOrThrow({where:{
        candidateId:original.candidateId,artifactId:original.artifactId,candidateRevision:original.candidateRevision,
        stage:'photo-recognition-v1',status:'COMPLETE'},orderBy:[{createdAt:'desc'},{id:'desc'}]});
      const support=await db.acquisitionProcessingJob.create({data:{...upstream,id:randomUUID(),candidateId,artifactId,
        versionKey:identity,input:upstream.input as Prisma.InputJsonValue,
        output:upstream.output===null?Prisma.DbNull:upstream.output as Prisma.InputJsonValue,createdAt:new Date()}});
      supportingJobs.push(support.id);
    }
    const boundary=new Proxy(db,{
      get(target,property){
        if(property==='$queryRaw')return async(...args:unknown[])=>{
          const rows=await Reflect.apply(target.$queryRaw,target,args) as {id:string}[];
          assert(rows.some(row=>row.id===jobId),`${stage} synthetic source must be selected by real SQL`);
          return rows.filter(row=>row.id===jobId);
        };
        if(property==='acquisitionProcessingJob')return new Proxy(target.acquisitionProcessingJob,{
          get(model,method){
            if(method==='findUnique')return async(...args:any[])=>{
              const row=await Reflect.apply(model.findUnique,model,args);
              if(args[0].where.id===jobId&&row&&!removed){
                await db.acquisitionProcessingJob.delete({where:{id:jobId}});
                await db.acquisitionProcessingJob.deleteMany({where:{id:{in:supportingJobs}}});
                await db.acquisitionCandidate.delete({where:{id:candidateId}});
                await db.acquisitionArtifact.delete({where:{id:artifactId}});removed=true;
              }
              return row;
            };
            const value=Reflect.get(model,method);return typeof value==='function'?value.bind(model):value;
          },
        });
        const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
      },
    });
    assert.equal(await enqueue(boundary),0,'retired parent references must not stop worker admission');
    assert(removed,'the post-read parent-deletion boundary must run');
    assert.equal(await db.acquisitionProcessingJob.count({where:{candidateId}}),0);
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:original.candidateId}}),candidate);
    assert.deepEqual(await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:sourceId}}),original);
    assert.deepEqual(await db.acquisitionPhoto.findMany({where:{runId:original.runId},orderBy:{id:'asc'}}),photos);
    assert.deepEqual(await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),inventory);
    console.log(`PASS: ${stage} parent removal after source read is skipped; original source/photos/review/Inventory unchanged`);
  }finally{
    await db.acquisitionProcessingJob.deleteMany({where:{id:{in:supportingJobs}}});
    if(jobId)await db.acquisitionProcessingJob.deleteMany({where:{id:jobId}});
    if(candidateId)await db.acquisitionCandidate.deleteMany({where:{id:candidateId}});
    if(artifactId)await db.acquisitionArtifact.deleteMany({where:{id:artifactId}});
  }
}
