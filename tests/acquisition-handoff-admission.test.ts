import assert from "node:assert/strict";
import test from "node:test";
import {Prisma,type PrismaClient} from "@prisma/client";
import {admitAcquisitionHandoff} from "../lib/acquisition-handoff-admission";
const source={runId:"run",artifactId:"artifact",candidateId:"candidate"};
const constraint=()=>new Prisma.PrismaClientKnownRequestError("Fixture foreign key",{code:"P2003",clientVersion:"fixture"});
function database(missing=-1,failure?:Error){
  let reads=0;const models=["acquisitionRun","acquisitionArtifact","acquisitionCandidate"];
  const db=Object.fromEntries(models.map((name,index)=>[name,{findUnique:async()=>{
    reads++;if(failure)throw failure;return index===missing?null:{id:name};
  }}])) as unknown as PrismaClient;
  return{db,reads:()=>reads};
}
test("normal admission returns unchanged result without extra parent queries",async()=>{
  const fixture=database(),result={count:2};assert.equal(await admitAcquisitionHandoff(fixture.db,source,async()=>result),result);assert.equal(fixture.reads(),0);
});
for(const [index,parent] of ["run","artifact","candidate"].entries())test(`confirmed missing ${parent} permits retired admission to be skipped`,async()=>{
  const fixture=database(index);assert.deepEqual(await admitAcquisitionHandoff(fixture.db,source,async()=>{throw constraint();}),{count:0});assert.equal(fixture.reads(),3);
});
test("foreign-key failure with all parents still present remains an error",async()=>{
  const fixture=database(),error=constraint();await assert.rejects(admitAcquisitionHandoff(fixture.db,source,async()=>{throw error;}),e=>e===error);
});
test("ordinary database/validation errors propagate without probing parents",async()=>{
  const fixture=database(),error=new Error("Fixture unavailable");await assert.rejects(admitAcquisitionHandoff(fixture.db,source,async()=>{throw error;}),e=>e===error);assert.equal(fixture.reads(),0);
});
test("structurally similar non-Prisma errors cannot be silently skipped",async()=>{
  const fixture=database(0),error={code:"P2003"};await assert.rejects(admitAcquisitionHandoff(fixture.db,source,async()=>{throw error;}),e=>e===error);assert.equal(fixture.reads(),0);
});
test("failed parent verification propagates its database failure",async()=>{
  const failure=new Error("Fixture lookup unavailable"),fixture=database(0,failure);await assert.rejects(admitAcquisitionHandoff(fixture.db,source,async()=>{throw constraint();}),e=>e===failure);
});
