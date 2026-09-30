import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {createAcquisitionSession, executeAcquisitionCommand, getAcquisitionSession, ingestAcquisitionEvent} from "../lib/acquisition-store";
import {claimAcquisitionJobs, completeAcquisitionJob, runAcquisitionJobsOnce} from "../lib/acquisition-jobs";

// Called only by the guarded disposable acquisition database verifier.
export async function verifyAcquisitionOwnerFairness(db: PrismaClient) {
  const tag=`owner-fair-${randomUUID()}`;
  const owners=Array.from({length:4},(_,n)=>`${tag}-${n}`);
  const runs:{id:string;owner:number;artifactId:string;candidateId:string;revision:number}[]=[];
  let tick=Date.now()+1000;
  try {
    for(const [n,id] of owners.entries()) {
      await db.player.create({data:{id,name:id,displayName:id}});
      await db.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash:'fixture-not-login'}});
      await db.inventoryLocation.create({data:{id,ownerPlayerId:id,name:id,normalizedName:id,type:'Box',
        storageLayout:{capacity:100,sections:[{name:'A',capacity:100}]}}});
      // One owner's 40 batches exceed the selection window; other owners have
      // one batch each. Repeated version jobs model a queue, not physical cards.
      for(let batch=0;batch<(n===0 ? 40 : 1);batch++) {
        const actor={userId:id,adminMode:false};
        const session=await createAcquisitionSession(db,actor,{requestKey:randomUUID(),ownerPlayerId:id,
          locationId:id,section:'A',policy:{kind:'MANUAL',quantity:1},
          run:{providerId:'fixture',runId:'source',enforcement:'LOGICAL_ALLOCATION',controls:['STOP','CANCEL']}});
        const current=await getAcquisitionSession(db,actor,session.session.id);
        await executeAcquisitionCommand(db,actor,session.session.id,{requestKey:randomUUID(),
          revision:current.revision,command:'START'});
        await ingestAcquisitionEvent(db,actor,session.session.id,{version:1,providerId:'fixture',runId:'source',
          eventId:'one',artifacts:[{id:'image',digest:'fixture-queue-not-image'}],
          sightings:[{candidate:{id:'card',identityKind:'NATIVE',order:[0,0],expectedSides:['FRONT'],provisional:false},
            observation:{id:'front',artifactId:'image',side:'FRONT'},uncertainty:[]}]});
        const run=await db.acquisitionRun.findUniqueOrThrow({where:{sessionId:session.session.id},
          include:{artifacts:true,candidates:true}});
        runs.push({id:run.id,owner:n,artifactId:run.artifacts[0].id,candidateId:run.candidates[0].id,
          revision:run.candidates[0].revision});
      }
    }
    async function populate(stage:string) {
      await db.acquisitionProcessingJob.createMany({data:runs.flatMap((run,batch)=>
        Array.from({length:16},(_,n)=>({runId:run.id,artifactId:run.artifactId,candidateId:run.candidateId,
          candidateRevision:run.revision,stage,versionKey:randomUUID(),input:{},
          availableAt:new Date(0),createdAt:new Date(Date.UTC(2000,0,1,0,0,batch*16+n))})))});
    }
    const runById=new Map(runs.map(run=>[run.id,run]));
    const stages=['recognition','visual','catalog','printing'].map(s=>`${tag}-${s}`);
    for(const stage of stages) {
      await populate(stage);
      const counts=[0,0,0,0];
      const seenRuns=new Set<string>();
      const replacement=new PrismaClient();
      try {
        for(let n=0;n<20;n++) {
          const now=new Date(++tick);
          const [job]=await claimAcquisitionJobs(n<8 ? db : replacement,
            {workerId:'owner-fair',stages:[stage]},now);
          assert.ok(job);
          const run=runById.get(job.runId)!;
          assert.ok(run,'claim stays in this fixture stage');
          counts[run.owner]++;seenRuns.add(run.id);
          assert.equal(await completeAcquisitionJob(db,job,{fixture:true},now),'COMPLETE');
          if(n===3)assert.deepEqual(counts,[1,1,1,1],'first round includes every owner despite40 old batches');
        }
      } finally {await replacement.$disconnect();}
      assert.deepEqual(counts,[5,5,5,5],'many batches cannot multiply one owner\'s claim share');
      assert.equal([...seenRuns].filter(id=>runById.get(id)!.owner===0).length,5,
        'the busy owner still rotates through its own runs');
      const small=runs.find(run=>run.owner===1)!;
      const pending=await db.acquisitionProcessingJob.findMany({where:{runId:small.id,stage,status:'PENDING'},
        orderBy:[{availableAt:'asc'},{createdAt:'asc'},{id:'asc'}]});
      assert.equal(pending.length,11,'old work remains queued');
      assert.equal(await db.inventoryItem.count({where:{currentOwnerId:{in:owners}}}),0);
    }
    const pairStage=`${tag}-pair`;
    await populate(pairStage);
    const pair=await claimAcquisitionJobs(db,{workerId:'owner-pair',stages:[pairStage],limit:2},new Date(++tick));
    assert.equal(pair.length,2);
    assert.equal(new Set(pair.map(job=>runById.get(job.runId)!.owner)).size,2,
      'bounded two-job selection includes different equally eligible owners');
    const staleStage=`${tag}-stale`;
    const [changed, reviewed, excluded, current, leased, expired]=runs.slice(0,6);
    const jobs=await Promise.all([changed,reviewed,excluded,current,leased,expired].map((run,n)=>
      db.acquisitionProcessingJob.create({data:{runId:run.id,artifactId:run.artifactId,candidateId:run.candidateId,
        candidateRevision:run.revision,stage:staleStage,versionKey:randomUUID(),input:{},
        status:n>=4?'RUNNING':'PENDING',leaseToken:n>=4?`owned-${n}`:null,
        leaseExpiresAt:n===4?new Date(tick+60000):n===5?new Date(tick-1):null,
        availableAt:new Date(0)}})));
    for(const run of [changed,leased,expired])await db.acquisitionCandidate.update({where:{id:run.candidateId},data:{revision:{increment:1}}});
    await db.acquisitionCandidate.update({where:{id:reviewed.candidateId},data:{review:{fixture:'human-review'}}});
    await db.acquisitionCandidate.update({where:{id:excluded.candidateId},data:{excluded:true}});
    const called:string[]=[];
    const result=await runAcquisitionJobsOnce(db,{[staleStage]:async job=>{
      called.push(job.candidateId);return {fixture:true};
    }},'stale-native-guard');
    assert.deepEqual(called,[current.candidateId],'only a current queued card invokes the expensive handler');
    assert.equal(result.complete,1);
    for(const n of [0,1,2,5]) {
      const job=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:jobs[n].id}});
      assert.equal(job.status,'SUPERSEDED');assert.equal(job.attempts,0);
      assert.equal(job.errorCode,'INPUT_CHANGED');assert.equal(job.leaseToken,null);
    }
    const live=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:jobs[4].id}});
    assert.equal(live.status,'RUNNING');assert.equal(live.leaseToken,'owned-4','live lease is never retired by another worker');
    // A reviewed card still needs immutable-photo canonical preparation.
    const canonical=await db.acquisitionProcessingJob.create({data:{runId:reviewed.id,
      artifactId:reviewed.artifactId,candidateId:reviewed.candidateId,candidateRevision:0,
      stage:'photo-canonical-v1',versionKey:randomUUID(),input:{},availableAt:new Date(0)}});
    const [canonicalClaim]=await claimAcquisitionJobs(db,{workerId:'canonical-after-review',stages:['photo-canonical-v1']},new Date(++tick));
    assert.equal(canonicalClaim.id,canonical.id,'canonical preparation does not use the recognition revision/review guard');
    const reviewedState=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:reviewed.candidateId}});
    assert.deepEqual(reviewedState.review,{fixture:'human-review'});
    assert.equal(await db.inventoryItem.count({where:{currentOwnerId:{in:owners}}}),0);
    console.log('PASS: obsolete/reviewed/excluded queued inference retired before handlers, expired stale lease retired, live lease preserved, canonical independent, review and Inventory untouched');
    console.log('PASS: four-owner turns despite40 busy-owner runs, persisted reconnect, per-run rotation, stage independence, two-job bound and zero Inventory');
  } finally {
    const sessions=await db.acquisitionSession.findMany({where:{ownerPlayerId:{in:owners}},select:{id:true}});
    const allRuns=await db.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});
    const where={runId:{in:allRuns.map(r=>r.id)}};
    await db.acquisitionProcessingJob.deleteMany({where});
    await db.acquisitionCommand.deleteMany({where});
    await db.acquisitionEvent.deleteMany({where});
    await db.acquisitionObservation.deleteMany({where});
    await db.acquisitionCandidate.deleteMany({where});
    await db.acquisitionArtifact.deleteMany({where});
    await db.acquisitionRun.deleteMany({where:{id:{in:allRuns.map(r=>r.id)}}});
    await db.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});
    await db.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});
    await db.user.deleteMany({where:{id:{in:owners}}});
    await db.player.deleteMany({where:{id:{in:owners}}});
  }
}
