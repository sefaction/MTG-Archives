import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import * as files from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import sharp from "sharp";
import type {PrismaClient} from "@prisma/client";
import {cancelAndCleanCorrectionFixture} from "../tests/ui/correction-fixture";
import {ensureCorrectionAccount} from "../lib/acquisition-correction-library";
import {createScannerPairing,claimScannerPairing,recordScannerPulse} from "../lib/scanner-store";
import {scannerSecret} from "../lib/scanner-protocol";
import {createScannerBatch,claimScannerRun,receiveScannerImage} from "../lib/scanner-runs";
import {scannerSiteEpoch} from "../lib/scanner-control-files";

/** Real filesystem/SQL failure and replay; no browser, helper or physical feed. */
export async function verifyScannerStorageFileCleanup(db:PrismaClient){
 const url=new URL(process.env.DATABASE_URL||"http://invalid");
 assert.equal(process.env.MTG_LOCAL_PILOT_TEST,"1");assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));assert.ok(url.pathname.startsWith("/acquisition_"));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const module=(name:string)=>{if(name==="fs/promises")return files;if(name==="path")return path;throw Error("Unexpected embedded cleanup module");};
 const execute=(script:string)=>new AsyncFunction("p","require","process",script)(db,module,process) as Promise<void>;
 const records=["scanner-counted","scanner-photo-storage","scanner-section-series"].map(name=>{
  const source=ts.createSourceFile(name,readFileSync("tests/ui/"+name+".spec.ts","utf8"),ts.ScriptTarget.Latest,true),expressions:string[]=[];
  function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==="database"&&node.arguments[0]?.getText(source).includes(".preview.jpg"))expressions.push(node.arguments[0].getText(source));ts.forEachChild(node,visit);}visit(source);assert.equal(expressions.length,1);
  return {name,script:(owner:string)=>new Function("tag","return "+expressions[0])(owner) as string};
 });
 async function snapshot(){const names=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;const out:Record<string,unknown>={};for(const {tablename}of names){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const rows=await db.$queryRawUnsafe<{row:string}[]>('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');out[tablename]={count:rows.length,hash:createHash("sha256").update(JSON.stringify(rows)).digest("hex")};}return out;}
 async function tree(root:string){const out:Record<string,string>={};async function walk(dir:string){for(const entry of await files.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())await walk(file);else out[path.relative(root,file)]=createHash("sha256").update(await files.readFile(file)).digest("hex");}}await walk(root);return out;}
 const before=await snapshot(); // Refuse an unreachable database before filesystem/env changes.
 const parent=await files.mkdtemp(path.join(os.tmpdir(),"mtg-scanner-storage-cleanup-")),uploads=path.join(parent,"uploads"),priorUploads=process.env.UPLOADS_DATA_PATH;
 process.env.UPLOADS_DATA_PATH=uploads;
 const peer="ui-scanner-audit-"+randomUUID(),owners:string[]=[];
 let failed=false,primary:unknown,recoveryPending=false,restored=false;
 async function seed(owner:string,count:number){
  await db.player.create({data:{id:owner,name:owner,displayName:owner}});await db.user.create({data:{id:owner,username:owner,displayName:owner,playerId:owner,passwordHash:"fixture-only"}});
  await db.$transaction(tx=>ensureCorrectionAccount(tx,owner));await db.correctionLibraryAccount.update({where:{ownerPlayerId:owner},data:{sampleBasisPoints:0}});
  await db.inventoryLocation.create({data:{id:owner,name:owner,normalizedName:owner,ownerPlayerId:owner,type:"BOX"}});
  const pair=await createScannerPairing(db,owner),agentId=randomUUID(),secret=scannerSecret(),token=`Bearer ${agentId}.${secret}`;
  await claimScannerPairing(db,{version:1,pairCode:pair.code,agentId,secret,name:"File cleanup fixture"});
  const device={id:"fixture-wia",name:"Fixture source",backend:"fixture",source:"Wia",qualification:"GenericUnqualified"};
  await recordScannerPulse(db,token,{version:1,agentVersion:"fixture",devices:[device]});
  const epoch=await scannerSiteEpoch(),run=await createScannerBatch(db,{userId:owner,adminMode:false},{requestKey:randomUUID(),agentId,deviceId:device.id,locationId:owner,section:"",quantity:count,loadedCount:count,operatorLoadedSimplexFronts:true,settings:{dpi:300,widthInches:2.6,heightInches:3.6,horizontalPlacement:"Start",duplex:false,color:"RGB",autoCrop:false,deskew:false,removeBlank:false}},epoch);
  const claim={version:1,runId:run.runId,epoch,executionId:randomUUID()};await claimScannerRun(db,token,claim,epoch);
  const bytes=await sharp({create:{width:75,height:105,channels:3,background:"white"}}).png().toBuffer();
  for(let sequence=1;sequence<=count;sequence++)await receiveScannerImage(db,token,{...claim,artifactId:randomUUID(),sequence,timestamp:new Date().toISOString(),side:"UNKNOWN",physicalBoundary:"UNKNOWN"},epoch,bytes,"image/png");
 }
 try{
  await seed(peer,1);const peerRows=await snapshot(),peerFiles=await tree(uploads);
  for(const record of records){
   const owner="ui-scanner-audit-"+randomUUID();owners.push(owner);await seed(owner,2);
   await execute(cancelAndCleanCorrectionFixture(owner));
   const photos=await db.acquisitionPhoto.findMany({where:{run:{session:{createdByUserId:owner}}},orderBy:{id:"asc"}}),runs=await db.scannerRun.findMany({where:{agent:{userId:owner}},orderBy:{id:"asc"}});
   assert.equal(photos.length,2);assert.equal(runs.length,1);for(const item of [...photos,...runs])assert.match(item.id,/^[a-f0-9-]{36}$/);
   const blocked=path.join(uploads,"acquisition-v1",photos[0].id+".original"),held=path.join(parent,"held-"+photos[0].id),bytes=await files.readFile(blocked);
   let caseFailed=false,caseError:unknown,sourceRestored=false;const recoveryErrors:unknown[]=[];
   try{
    recoveryPending=true;await files.rename(blocked,held);await files.mkdir(blocked);
    await assert.rejects(execute(record.script(owner)),(e:unknown)=>e instanceof AggregateError&&e.errors.length===1&&["EISDIR","EPERM"].includes((e.errors[0] as NodeJS.ErrnoException).code??""));
    assert.equal((await files.lstat(blocked)).isDirectory(),true);assert.deepEqual(await files.readFile(held),bytes);
    for(const photo of photos)for(const suffix of [".original",".preview.jpg"])if(photo.id!==photos[0].id||suffix!==".original")await assert.rejects(files.readFile(path.join(uploads,"acquisition-v1",photo.id+suffix)),(e:NodeJS.ErrnoException)=>e.code==="ENOENT");
    for(const run of runs)await assert.rejects(files.readFile(path.join(uploads,"scanner-control-v1",run.id+".start.json")),(e:NodeJS.ErrnoException)=>e.code==="ENOENT");
    assert.deepEqual(await db.acquisitionPhoto.findMany({where:{run:{session:{createdByUserId:owner}}},orderBy:{id:"asc"}}),photos);
    assert.deepEqual(await db.scannerRun.findMany({where:{agent:{userId:owner}},orderBy:{id:"asc"}}),runs);
    assert.equal(await db.acquisitionCandidate.count({where:{run:{session:{createdByUserId:owner}}}}),2);assert.equal(await db.user.count({where:{id:owner}}),1);
   }catch(error){caseFailed=true;caseError=error;}
   // Remove only the empty owned obstruction; verify restoration before any relational retry.
   try{
    const target=await files.lstat(blocked).catch((e:NodeJS.ErrnoException)=>{if(e.code==="ENOENT")return null;throw e;});
    if(target){assert.equal(target.isDirectory(),true);assert.equal(path.dirname(path.resolve(blocked)),path.resolve(uploads,"acquisition-v1"));await files.rmdir(blocked);}
    await files.rename(held,blocked);assert.deepEqual(await files.readFile(blocked),bytes);sourceRestored=true;recoveryPending=false;
   }catch(error){recoveryErrors.push(error);}
   try{assert.equal(sourceRestored,true,"Unverified original restoration preserves relational recovery references");assert.equal(recoveryPending,false,"Original recovery still pending");await execute(record.script(owner));await execute(record.script(owner));}catch(error){recoveryErrors.push(error);}
   try{assert.deepEqual(await snapshot(),peerRows);assert.deepEqual(await tree(uploads),peerFiles);}catch(error){recoveryErrors.push(error);}
   if(caseFailed||recoveryErrors.length)throw new AggregateError([...(caseFailed?[caseError]:[]),...recoveryErrors],"Protocol file cleanup qualification/recovery failed");
   console.log(JSON.stringify({event:"scanner-storage-file-cleanup",fixture:record.name,realUnlinkRefusal:true,independentPaths:5,photoAndRunRowsPreserved:true,verifiedOriginalRestoration:true,retryAndReplay:true,peerRowsAndFilesExact:true,tables:Object.keys(peerRows).length}));
  }
 }catch(error){failed=true;primary=error;}
 const cleanupErrors:unknown[]=[];
 for(const owner of [...owners,peer]){
  if(recoveryPending&&owner===owners.at(-1)){cleanupErrors.push(Error("Incomplete original restoration retains this owner's rows/files"));continue;}
  for(const script of [cancelAndCleanCorrectionFixture(owner),records[0].script(owner),cancelAndCleanCorrectionFixture(owner)])try{await execute(script);}catch(error){cleanupErrors.push(error);}
 }
 try{const after=await snapshot();assert.deepEqual(after,before);restored=true;console.log(JSON.stringify({event:"scanner-storage-file-conservation",before,after,tables:Object.keys(after).length}));}catch(error){cleanupErrors.push(error);}
 if(priorUploads===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=priorUploads;
 try{assert.equal(recoveryPending,false);assert.equal(restored,true);assert.equal(path.dirname(parent),os.tmpdir());assert.ok(path.basename(parent).startsWith("mtg-scanner-storage-cleanup-"));await files.rm(parent,{recursive:true,force:true});}catch(error){cleanupErrors.push(error);}
 if(failed||cleanupErrors.length)throw new AggregateError([...(failed?[primary]:[]),...cleanupErrors],"Scanner protocol file cleanup verification failed");
 console.log("PASS three actual scanner protocol file phases: real obstruction, independent removals, exact recovery graph, verified restore, retry/replay, neighbor and all-table conservation; no helper/hardware");
}