/** Controlled real process death; no fabricated filesystem failure or motor. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn, execFileSync, type ChildProcess} from "node:child_process";
import {once} from "node:events";
import * as fs from "node:fs/promises";
import {readFileSync} from "node:fs";
import Module, {createRequire} from "node:module";
import path from "node:path";
import ts from "typescript";
import sharp from "sharp";
import {PrismaClient} from "@prisma/client";
import {photoDigest, inspectAcquisitionPhoto, readAcquisitionPhotoBytes, writeAcquisitionPhotoBytes,
  findAcquisitionPhotoTemporaryFiles} from "../lib/acquisition-files";
import {beginAcquisitionPhoto, finalizeAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot} from "../lib/acquisition-store";
import {manageAcquisitionBatch} from "../lib/acquisition-batch-lifecycle";
import {purgeTrashedAcquisitionPhotos,repairPurgedAcquisitionPhotoTemporaries} from "../lib/acquisition-photo-retention";
import {ensureCorrectionAccount} from "../lib/acquisition-correction-library";
import {verifyAcquisitionRetentionPinRaces} from "./verify-acquisition-retention-pin-races";
import {verifyPhotoPressure} from "./verify-photo-pressure";

function loadActual(relative: string, replace: (name: string) => unknown) {
  const filename=path.resolve(relative), real=createRequire(filename), loaded=new (Module as any)(filename);
  loaded.filename=filename;loaded.paths=(Module as any)._nodeModulePaths(path.dirname(filename));
  loaded.require=(name:string)=>replace(name)??real(name);
  loaded._compile(ts.transpileModule(readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
  return loaded.exports;
}
const children=new Set<ChildProcess>();
export async function interruptAcquisitionPhotoWrite(id:string, bytes:Buffer,
  point:"before-link"|"after-link", variant:"raw"|"preview"="raw") {
  const worker=spawn(process.execPath,["--import","tsx",path.resolve("scripts/verify-acquisition-interrupted-storage.ts"),"--write-child"],
    {stdio:["pipe","pipe","pipe","ipc"],env:{...process.env,MTG_PHOTO_WRITE_CHILD:"1"}});
  children.add(worker);
  let stderr="",terminal=false,failed=false,primary:unknown;
  worker.stderr!.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
  worker.stdout!.resume();
  try {
    const boundary=new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error("Writer boundary timeout: "+stderr)),15000);
      worker.once("message",message=>{clearTimeout(timeout);try{assert.equal((message as {point:string}).point,point);resolve();}catch(error){reject(error);}});
      worker.once("exit",(code,signal)=>{clearTimeout(timeout);reject(new Error(`Writer exited before boundary ${code}/${signal}: ${stderr}`));});
      worker.once("error",error=>{clearTimeout(timeout);reject(error);});
    });
    worker.stdin!.on("error",()=>{});
    worker.stdin!.end(JSON.stringify({id,bytes:bytes.toString("base64"),point,variant}));
    await boundary;
    const ended=once(worker,"exit",{signal:AbortSignal.timeout(5000)});
    assert(worker.kill("SIGKILL"));
    const [code,signal]=await ended;terminal=true;
    assert.equal(code,null);assert.equal(signal,"SIGKILL");
    return {code:null,signal:"SIGKILL",point};
  } catch(error) { failed=true;primary=error;throw error; } finally {
    try{if(!terminal&&worker.exitCode===null&&worker.signalCode===null){
      const ended=once(worker,"exit",{signal:AbortSignal.timeout(5000)});worker.kill("SIGKILL");await ended;terminal=true;
    }}catch(error){throw new AggregateError([...(failed?[primary]:[]),error],"Writer boundary and termination failed");}
    if(terminal||worker.exitCode!==null||worker.signalCode!==null)children.delete(worker);
  }
}
async function writeChild(){
  assert.equal(process.env.MTG_PHOTO_WRITE_CHILD,"1");
  const input=JSON.parse(readFileSync(0,"utf8"));
  assert(["before-link","after-link"].includes(input.point));assert(["raw","preview"].includes(input.variant));
  const root=process.env.UPLOADS_DATA_PATH;assert(root&&path.isAbsolute(root));
  assert(path.resolve(root).startsWith(path.resolve(".local-data")+path.sep));
  setTimeout(()=>process.exit(70),30000);
  const paused=()=>{process.send?.({point:input.point});return new Promise(()=>{setInterval(()=>{},1000);});};
  const files=loadActual("lib/acquisition-files.ts",name=>name==="node:fs/promises"?{...fs,
    link:async(...args:Parameters<typeof fs.link>)=>{
      if(input.point==="before-link")await paused();
      await fs.link(...args);
      if(input.point==="after-link")await paused();
    }}:undefined);
  const bytes=Buffer.from(input.bytes,"base64");
  await files.writeAcquisitionPhotoBytes(input.id,bytes,input.variant,photoDigest(bytes));
  throw new Error("Controlled writer unexpectedly returned");
}
async function fingerprints(db:PrismaClient){
  const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result:Record<string,{rows:number;digest:string}>={};
  for(const {tablename} of tables){const quoted='"'+tablename.replaceAll('"','""')+'"';
    const [row]=await db.$queryRawUnsafe<{rows:number;digest:string}[]>(`SELECT count(*)::int rows,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) digest FROM ${quoted} t`);result[tablename]=row;}
  return result;
}
async function verify(){
  const url=new URL(process.env.DATABASE_URL??"http://invalid");
  assert.equal(process.env.MTG_LOCAL_PILOT_TEST,"1");
  assert(["localhost","127.0.0.1","[::1]"].includes(url.hostname)&&url.pathname.startsWith("/acquisition_"),"Disposable local acquisition_* database only");
  const db=new PrismaClient(), tag="interrupted-photo-"+randomUUID(),owner=tag+"-owner",userId=tag+"-user",locationId=tag+"-box",cardId=tag+"-card";
  const actor={userId,adminMode:false}, sessions:string[]=[],runs:string[]=[];
  let root:string|undefined, baseline:Awaited<ReturnType<typeof fingerprints>>|undefined;
  const previous=process.env.UPLOADS_DATA_PATH,errors:unknown[]=[];
  let primary:unknown,failed=false,rowsRestored=false;
  try {
    assert.equal(await db.user.count(),0);assert.equal(await db.inventoryItem.count(),0);assert.equal(await db.acquisitionSession.count(),0);
    baseline=await fingerprints(db);
    await fs.mkdir(path.resolve(".local-data"),{recursive:true});root=await fs.mkdtemp(path.resolve(".local-data/acq-interrupted-"));
    process.env.UPLOADS_DATA_PATH=root;
    await db.player.create({data:{id:owner,name:owner,displayName:owner}});
    await db.user.create({data:{id:userId,username:userId,displayName:userId,playerId:owner,passwordHash:"not-a-login-hash"}});
    await db.$transaction(tx=>ensureCorrectionAccount(tx,owner));
    await db.correctionLibraryAccount.update({where:{ownerPlayerId:owner},data:{sampleBasisPoints:0}});
    await db.inventoryLocation.create({data:{id:locationId,ownerPlayerId:owner,name:"Fixture",normalizedName:tag,type:"Box"}});
    await db.card.create({data:{id:cardId,scryfallId:randomUUID(),name:"Untouched fixture",typeLine:"Artifact",setCode:"tst",collectorNumber:"1",rarity:"common",lang:"en"}});
    await db.inventoryItem.create({data:{currentOwnerId:owner,cardId,quantity:2,condition:"NM",locationId,locationSection:"untouched"}});
    const stock=await db.inventoryItem.findMany(),audits=await db.inventoryAuditLog.findMany();
    const bytes=await sharp({create:{width:80,height:120,channels:3,background:"#337755"}}).png().toBuffer();
    async function prepared(){
      const created=await createAcquisitionSession(db,actor,{requestKey:randomUUID(),ownerPlayerId:owner,locationId,section:"A",policy:{kind:"MANUAL",quantity:1},
        run:{providerId:"phone-photo-v1",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL"]}});
      const sessionId=created.session.id;sessions.push(sessionId);
      await executeAcquisitionCommand(db,actor,sessionId,{requestKey:"start",revision:0,command:"START"});
      const {slot}=await reserveAcquisitionCaptureSlot(db,actor,sessionId,"one"),uploadKey=randomUUID();
      const input={slotId:slot.id,uploadKey,generation:0,metadata:await inspectAcquisitionPhoto(bytes,"image/png")};
      const photo=await beginAcquisitionPhoto(db,actor,sessionId,input);runs.push(photo.runId);
      return {sessionId,photo,input};
    }
    const neighbor=await prepared();await writeAcquisitionPhotoBytes(neighbor.photo.id,bytes,"raw",neighbor.photo.digest);
    await finalizeAcquisitionPhoto(db,actor,neighbor.sessionId,neighbor.photo.id);
    const neighborBefore=await db.acquisitionPhoto.findUniqueOrThrow({where:{id:neighbor.photo.id}});
    for(const point of ["before-link","after-link"] as const){
      const {sessionId,photo,input}=await prepared();
      await interruptAcquisitionPhotoWrite(photo.id,bytes,point);
      const [temporary]=(await findAcquisitionPhotoTemporaryFiles([photo.id])).get(photo.id)!;assert(temporary);
      const temporaryPath=path.join(root,"acquisition-v1",temporary);
      assert.deepEqual(await fs.readFile(temporaryPath),bytes);
      const original=path.join(root,"acquisition-v1",photo.id+".original");
      if(point==="after-link"){
        const [a,b]=await Promise.all([fs.stat(original),fs.stat(temporaryPath)]);assert.equal(a.ino,b.ino);assert.equal(a.dev,b.dev);assert.equal(b.nlink,2);
      }else await assert.rejects(fs.lstat(original),{code:"ENOENT"});
      assert.equal((await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photo.id}})).ready,false);
      for(const model of [db.acquisitionArtifact,db.acquisitionCandidate,db.acquisitionProcessingJob])assert.equal(await (model as any).count({where:{runId:photo.runId}}),0);
      const replayed=await beginAcquisitionPhoto(db,actor,sessionId,input);assert.equal(replayed.id,photo.id);
      await writeAcquisitionPhotoBytes(photo.id,bytes,"raw",photo.digest);
      const ready=await finalizeAcquisitionPhoto(db,actor,sessionId,photo.id);
      const readyRow=await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photo.id}});
      assert.deepEqual(await finalizeAcquisitionPhoto(db,actor,sessionId,photo.id),{
        ...ready,slot:await db.acquisitionCaptureSlot.findUniqueOrThrow({where:{id:photo.slotId}})});
      assert.deepEqual(await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photo.id}}),readyRow);
      for(const model of [db.acquisitionArtifact,db.acquisitionCandidate,db.acquisitionProcessingJob])assert.equal(await (model as any).count({where:{runId:photo.runId}}),1);
      assert.deepEqual(await readAcquisitionPhotoBytes(photo.id,"raw",photo.digest),bytes);
      await manageAcquisitionBatch(db,actor,sessionId,"trash");
      const graph=()=>Promise.all([db.acquisitionArtifact.findMany({where:{runId:photo.runId}}),db.acquisitionCandidate.findMany({where:{runId:photo.runId}}),db.acquisitionProcessingJob.findMany({where:{runId:photo.runId}})]);
      const immutable=await graph(),now=new Date(Date.now()+8*86400000);
      if(point==="after-link"){
        let injected=false;
        const files=loadActual("lib/acquisition-files.ts",name=>name==="node:fs/promises"?{...fs,unlink:async(file:string)=>{
          if(file===temporaryPath&&!injected){injected=true;throw Object.assign(new Error("owned unlink failure"),{code:"EACCES"});}return fs.unlink(file);
        }}:undefined);
        const retention=loadActual("lib/acquisition-photo-retention.ts",name=>name==="./acquisition-files"?files:undefined);
        const refused=await retention.purgeTrashedAcquisitionPhotos(db,now);
        assert.equal(injected,true);assert.equal(refused.failed,1);assert.equal(refused.purged,0);
        assert.equal((await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photo.id}})).purgedAt,null);
        assert.deepEqual(await fs.readFile(temporaryPath),bytes);assert.deepEqual(await graph(),immutable);
      }
      const removed=await purgeTrashedAcquisitionPhotos(db,now);assert.equal(removed.failed,0);assert.equal(removed.purged,1);
      assert.equal((await findAcquisitionPhotoTemporaryFiles([photo.id])).get(photo.id)!.length,0);
      await assert.rejects(fs.lstat(original),{code:"ENOENT"});
      assert.deepEqual((await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photo.id}})).purgedAt,now);
      assert.equal((await purgeTrashedAcquisitionPhotos(db,now)).purged,0);
      // Reproduce an older run which already marked the photo purged but left
      // its alias. Normal retention no longer selects that row; repair is
      // explicit, preview-first and still refuses another owner/live neighbor.
      await fs.writeFile(temporaryPath,bytes);
      const neighborTemporary=path.join(root,"acquisition-v1",`${neighbor.photo.id}.${randomUUID()}.part`);
      await fs.link(path.join(root,"acquisition-v1",neighbor.photo.id+".original"),neighborTemporary);
      assert.equal((await repairPurgedAcquisitionPhotoTemporaries(db,"another-owner",[photo.id],true,now)).checked,0);
      const oldRow=await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photo.id}});
      const preview=await repairPurgedAcquisitionPhotoTemporaries(db,owner,[photo.id,neighbor.photo.id],false,now);
      assert.deepEqual(preview,{checked:1,eligible:1,temporaryFiles:1,repaired:0,failed:0});
      assert.deepEqual(await fs.readFile(temporaryPath),bytes);
      const repairArgs=["--import","tsx","scripts/repair-acquisition-photo-temporaries.ts",`--owner=${owner}`,`--photo=${photo.id}`,`--photo=${neighbor.photo.id}`];
      const previewCLI=JSON.parse(execFileSync(process.execPath,repairArgs,{encoding:"utf8"}));
      assert.deepEqual(previewCLI,{mode:"preview",...preview});
      const noApply={...process.env};delete noApply.MTG_PHOTO_TEMPORARY_REPAIR;
      assert.throws(()=>execFileSync(process.execPath,[...repairArgs,"--apply"],{env:noApply,stdio:"pipe"}),/Command failed/);
      assert.deepEqual(await fs.readFile(temporaryPath),bytes);
      const repaired=JSON.parse(execFileSync(process.execPath,[...repairArgs,"--apply"],{env:{...process.env,MTG_PHOTO_TEMPORARY_REPAIR:"1"},encoding:"utf8"}));
      assert.deepEqual(repaired,{mode:"apply",checked:1,eligible:1,temporaryFiles:1,repaired:1,failed:0});
      await assert.rejects(fs.lstat(temporaryPath),{code:"ENOENT"});
      assert.equal((await repairPurgedAcquisitionPhotoTemporaries(db,owner,[photo.id],true,now)).repaired,0);
      assert.deepEqual(await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photo.id}}),oldRow);
      assert.deepEqual(await fs.readFile(neighborTemporary),bytes);
      assert.deepEqual(await graph(),immutable);
      await assert.rejects(beginAcquisitionPhoto(db,actor,sessionId,input),/unavailable|expired|cancelled/i);
      assert.deepEqual(await readAcquisitionPhotoBytes(neighbor.photo.id,"raw",neighbor.photo.digest),bytes);
      assert.deepEqual(await db.acquisitionPhoto.findUniqueOrThrow({where:{id:neighbor.photo.id}}),neighborBefore);
      assert.deepEqual(await db.inventoryItem.findMany(),stock);assert.deepEqual(await db.inventoryAuditLog.findMany(),audits);
      assert.equal(await db.acquisitionCommit.count(),0);
      console.log(`PASS: actual writer SIGKILL ${point}; non-READY/no-derived state, same-identity recovery/replay, exact expired temporary cleanup/failed-unlink retry and neighbor/Inventory/receipt conservation`);
    }
    await verifyAcquisitionRetentionPinRaces(db,actor,{requestKey:randomUUID(),ownerPlayerId:owner,locationId,
      section:"A",policy:{kind:"MANUAL",quantity:1},run:{providerId:"fixture",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL"]}});
    await verifyPhotoPressure(db);
    assert.deepEqual(await db.inventoryItem.findMany(),stock);assert.deepEqual(await db.inventoryAuditLog.findMany(),audits);
    assert.deepEqual(await readAcquisitionPhotoBytes(neighbor.photo.id,"raw",neighbor.photo.digest),bytes);
  }catch(error){primary=error;failed=true;}
  try{
    assert.equal(children.size,0,"Never remove fixture files while a writer may live");
    const where={runId:{in:runs}};
    await db.acquisitionCommitMember.deleteMany({where});await db.acquisitionCommit.deleteMany({where});await db.acquisitionProcessingJob.deleteMany({where});await db.acquisitionCommand.deleteMany({where});
    await db.acquisitionPhoto.deleteMany({where});await db.acquisitionCaptureSlot.deleteMany({where});await db.acquisitionCountCorrection.deleteMany({where});await db.acquisitionObservation.deleteMany({where});await db.acquisitionEvent.deleteMany({where});await db.acquisitionCandidate.deleteMany({where});await db.acquisitionArtifact.deleteMany({where});
    await db.acquisitionRun.deleteMany({where:{id:{in:runs}}});await db.acquisitionSession.deleteMany({where:{id:{in:sessions}}});
    await db.correctionLibraryAccount.deleteMany({where:{ownerPlayerId:owner}});
    await db.inventoryItem.deleteMany({where:{currentOwnerId:owner}});await db.inventoryLocation.deleteMany({where:{id:locationId}});await db.user.deleteMany({where:{id:userId}});await db.player.deleteMany({where:{id:owner}});await db.card.deleteMany({where:{id:cardId}});
    if(baseline){const after=await fingerprints(db);assert.deepEqual(after,baseline);console.log(`PASS: interrupted-storage fixture restored all ${Object.keys(after).length} public-table fingerprints`);}
    rowsRestored=true;
  }catch(error){errors.push(error);}
  try{if(root&&rowsRestored&&children.size===0)await fs.rm(root,{recursive:true,force:true});}catch(error){errors.push(error);}
  if(previous===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=previous;
  try{await db.$disconnect();}catch(error){errors.push(error);}
  if(failed||errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],"Interrupted storage qualification failed");
}
if(process.argv[2]==="--write-child")writeChild().catch(error=>{console.error(error);process.exitCode=1;});
else if(process.argv[2]==="--verify")verify().catch(error=>{console.error(error);process.exitCode=1;});
