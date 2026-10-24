import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type {PrismaClient} from "@prisma/client";
import {createAcquisitionSession,executeAcquisitionCommand,reserveAcquisitionCaptureSlot,beginAcquisitionPhoto,finalizeAcquisitionPhoto} from "../lib/acquisition-store";
import {inspectAcquisitionPhoto,writeAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {cancelAndCleanCorrectionFixture} from "../tests/ui/correction-fixture";
import {loadLegacyFixtureCleanups} from "../tests/legacy-fixture-cleanup-sources";

export async function retryVerifiedLegacyFixtureCleanup(restored:boolean,recoveryPending:boolean,cleanup:()=>Promise<void>){
  assert.equal(restored,true,"Original restoration unverified; preserve fixture graph");
  assert.equal(recoveryPending,false,"Original recovery is pending");
  await cleanup();await cleanup();
}

/** Real file refusal and SQL recovery for the finite original-audit remainder. */
export async function verifyLegacyFixtureFiles(db:PrismaClient){
  const url=new URL(process.env.DATABASE_URL||"http://invalid");
  assert.equal(process.env.MTG_LOCAL_PILOT_TEST,"1");
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));assert.ok(url.pathname.startsWith("/acquisition_"));
  const sources=loadLegacyFixtureCleanups();assert.equal(sources.length,25);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  let beforeFirstUnlink:(()=>Promise<void>)|undefined;
  const observedFs={...fs,unlink:async(file:Parameters<typeof fs.unlink>[0])=>{const observe=beforeFirstUnlink;beforeFirstUnlink=undefined;if(observe)await observe();return fs.unlink(file);}};
  const modules=(name:string)=>{if(name==="path")return path;if(name==="fs/promises")return observedFs;if(name==="crypto")return {createHash};throw Error("Unexpected fixture module");};
  const execute=(body:string)=>new AsyncFunction("p","require","process","console",body)(db,modules,process,{log:()=>{}}) as Promise<void>;
  async function snapshot(){
    const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const result:Record<string,unknown>={};
    for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const rows=await db.$queryRawUnsafe<{row:string}[]>('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:createHash("sha256").update(JSON.stringify(rows)).digest("hex")};}
    return result;
  }
  async function tree(root:string){
    const result:Record<string,string>={};
    async function walk(dir:string){for(const entry of await fs.readdir(dir,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else result[path.relative(root,file)]=createHash("sha256").update(await fs.readFile(file)).digest("hex");}}
    await walk(root);return result;
  }
  const baseline=await snapshot(),parent=await fs.mkdtemp(path.join(os.tmpdir(),"mtg-legacy-fixture-files-")),uploads=path.join(parent,"uploads"),previous=process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH=uploads;
  let recoveryPending=false,baselineRestored=false;
  const allErrors:unknown[]=[];
  async function seed(id:string,kind:"photo"|"scanner",count:number,suffixes:readonly string[]){
    await db.player.create({data:{id,name:id,displayName:id}});await db.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash:"fixture-only"}});
    await db.inventoryLocation.create({data:{id,name:id,normalizedName:id,ownerPlayerId:id,type:"Box"}});
    const actor={userId:id,adminMode:false};
    const session=()=>createAcquisitionSession(db,actor,{requestKey:randomUUID(),ownerPlayerId:id,locationId:id,section:"",policy:{kind:"MANUAL",quantity:count},run:{providerId:"phone-photo-v1",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL"]}});
    const identities:string[]=[];
    if(kind==="photo"){
      const capture=await session();await executeAcquisitionCommand(db,actor,capture.session.id,{requestKey:"start",revision:0,command:"START"});
      const bytes=await sharp({create:{width:100,height:140,channels:3,background:"#335577"}}).png().toBuffer(),preview=await sharp(bytes).jpeg().toBuffer();
      for(let i=0;i<count;i++){
        const {slot}=await reserveAcquisitionCaptureSlot(db,actor,capture.session.id,randomUUID());
        const photo=await beginAcquisitionPhoto(db,actor,capture.session.id,{slotId:slot.id,uploadKey:randomUUID(),generation:0,metadata:await inspectAcquisitionPhoto(bytes,"image/png")});
        await writeAcquisitionPhotoBytes(photo.id,bytes,"raw",photo.digest);await writeAcquisitionPhotoBytes(photo.id,preview,"preview",createHash("sha256").update(preview).digest("hex"));
        await finalizeAcquisitionPhoto(db,actor,capture.session.id,photo.id);identities.push(photo.id);
      }
    }else{
      const agent=await db.scannerAgent.create({data:{id:randomUUID(),userId:id,tokenHash:randomUUID(),credentialHash:randomUUID(),name:"generated fixture",expiresAt:new Date(Date.now()+60000)}});
      await fs.mkdir(path.join(uploads,"scanner-control-v1"),{recursive:true});
      for(let i=0;i<count;i++){
        const capture=await session(),run=await db.acquisitionRun.findFirstOrThrow({where:{sessionId:capture.session.id}}),identity=randomUUID();
        await db.scannerRun.create({data:{id:identity,agentId:agent.id,acquisitionRunId:run.id,epoch:randomUUID(),requestPayload:"{}",deviceId:"fixture-only",device:{},settings:{},status:"CANCELLED"}});
        for(const suffix of suffixes)await fs.writeFile(path.join(uploads,"scanner-control-v1",identity+suffix),Buffer.from(JSON.stringify({fixture:true,id:identity,suffix})));
        identities.push(identity);
      }
    }
    await execute(cancelAndCleanCorrectionFixture(id));return identities.sort();
  }
  try{
    for(const [ordinal,source]of sources.entries()){
      const owner="ui-acquisition-"+randomUUID(),peer="ui-acquisition-"+randomUUID(),idsByOwner=new Map<string,string[]>();
      let failed=false,primary:unknown;
      const errors:unknown[]=[];
      try{
        idsByOwner.set(peer,await seed(peer,source.kind,source.kind==="photo"?1:2,source.suffixes));
        const peerRows=await snapshot(),peerFiles=await tree(uploads);
        const identities=await seed(owner,source.kind,2,source.suffixes);idsByOwner.set(owner,identities);
        const ownRows=await snapshot(),sessionsBefore=await db.acquisitionSession.findMany({orderBy:{id:"asc"}}),directory=source.kind==="photo"?"acquisition-v1":"scanner-control-v1";
        const paths=identities.flatMap(id=>source.suffixes.map(suffix=>path.join(uploads,directory,id+suffix)));
        const blocked=paths[0],held=path.join(parent,"held-original-"+ordinal),bytes=await fs.readFile(blocked);
        let sourceRestored=false,boundaryRows:Record<string,unknown>|undefined,prefixTimestampUpdates=0;
        try{
          recoveryPending=true;await fs.rename(blocked,held);await fs.mkdir(blocked);
          // Observe the real first unlink without replacing its filesystem call.
          // Existing cancellation prefixes may legitimately refresh updatedAt;
          // allow only that exact owned-row field, then freeze every full table.
          beforeFirstUnlink=async()=>{
            boundaryRows=await snapshot();
            for(const table of Object.keys(ownRows))if(table!=="AcquisitionSession")assert.deepEqual(boundaryRows[table],ownRows[table]);
            const sessionsAfter=await db.acquisitionSession.findMany({orderBy:{id:"asc"}});assert.equal(sessionsAfter.length,sessionsBefore.length);
            for(const [index,before]of sessionsBefore.entries()){
              const after=sessionsAfter[index];
              if(before.ownerPlayerId===owner&&source.script(owner,identities).includes("acquisitionSession.updateMany")){
                assert.equal(before.phase,"CANCELLED");assert.equal(after.phase,"CANCELLED");assert.ok(after.updatedAt.getTime()>=before.updatedAt.getTime());
                assert.deepEqual({...after,updatedAt:before.updatedAt},before);if(after.updatedAt.getTime()!==before.updatedAt.getTime())prefixTimestampUpdates++;
              }else assert.deepEqual(after,before);
            }
          };
          await assert.rejects(execute(source.script(owner,identities)),(error:unknown)=>error instanceof AggregateError&&error.errors.length===1&&["EISDIR","EPERM"].includes((error.errors[0] as NodeJS.ErrnoException).code??""));
          assert.ok(boundaryRows);assert.deepEqual(await snapshot(),boundaryRows);assert.deepEqual(await fs.readFile(held),bytes);
          for(const file of paths.slice(1))await assert.rejects(fs.readFile(file),(error:NodeJS.ErrnoException)=>error.code==="ENOENT");
        }catch(error){failed=true;primary=error;}finally{beforeFirstUnlink=undefined;}
        try{
          const target=await fs.lstat(blocked).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
          if(target){assert.equal(target.isDirectory(),true);assert.equal(path.dirname(path.resolve(blocked)),path.resolve(uploads,directory));await fs.rmdir(blocked);}
          await fs.rename(held,blocked);assert.deepEqual(await fs.readFile(blocked),bytes);sourceRestored=true;recoveryPending=false;
        }catch(error){errors.push(error);}
        try{await retryVerifiedLegacyFixtureCleanup(sourceRestored,recoveryPending,()=>execute(source.script(owner,identities)));}catch(error){errors.push(error);}
        try{assert.deepEqual(await snapshot(),peerRows);assert.deepEqual(await tree(uploads),peerFiles);}catch(error){errors.push(error);}
        if(!failed&&!errors.length)console.log(JSON.stringify({event:"legacy-fixture-file-cleanup",file:source.file,index:source.index,paths:paths.length,realUnlinkRefusal:true,allRowsRetainedOnFileError:true,prefixTimestampUpdates,originalRestored:true,retryAndReplay:true,populatedPeerExact:true,tables:Object.keys(peerRows).length}));
      }catch(error){failed=true;primary=error;}
      for(const id of [owner,peer]){
        if(id===owner&&recoveryPending){errors.push(Error("Unverified original retains owner rows/private files"));continue;}
        for(const body of [cancelAndCleanCorrectionFixture(id),source.script(id,idsByOwner.get(id)??[]),cancelAndCleanCorrectionFixture(id)])try{await execute(body);}catch(error){errors.push(error);}
      }
      try{const after=await snapshot();assert.deepEqual(after,baseline);console.log(JSON.stringify({event:"legacy-fixture-file-conservation",file:source.file,index:source.index,before:baseline,after,tables:Object.keys(after).length}));}catch(error){errors.push(error);}
      if(failed||errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],"Legacy fixture file cleanup/recovery failed");
    }
    assert.deepEqual(await snapshot(),baseline);baselineRestored=true;
  }catch(error){allErrors.push(error);}finally{
    if(previous===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=previous;
    try{assert.equal(recoveryPending,false);assert.equal(baselineRestored,true);assert.equal(path.dirname(parent),os.tmpdir());assert.ok(path.basename(parent).startsWith("mtg-legacy-fixture-files-"));await fs.rm(parent,{recursive:true,force:true});}catch(error){allErrors.push(error);}
  }
  if(allErrors.length)throw new AggregateError(allErrors,"Remaining legacy fixture qualification failed");
}
