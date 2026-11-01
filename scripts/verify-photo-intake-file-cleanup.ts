import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import sharp from "sharp";
import type {PrismaClient} from "@prisma/client";
import {createAcquisitionSession,executeAcquisitionCommand,reserveAcquisitionCaptureSlot,beginAcquisitionPhoto,finalizeAcquisitionPhoto} from "../lib/acquisition-store";
import {inspectAcquisitionPhoto,writeAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {cancelAndCleanCorrectionFixture} from "../tests/ui/correction-fixture";

/** Executes only the owned teardown, not its browser/camera workflow. */
export async function verifyPhotoIntakeFileCleanup(db:PrismaClient){
 const url=new URL(process.env.DATABASE_URL||"http://invalid");
 assert.equal(process.env.MTG_LOCAL_PILOT_TEST,"1");assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));assert.ok(url.pathname.startsWith("/acquisition_"));
 const source=ts.createSourceFile("photo-intake",readFileSync("tests/ui/acquisition-photo-intake.spec.ts","utf8"),ts.ScriptTarget.Latest,true),expressions:string[]=[];
 function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==="database"&&node.arguments[0]?.getText(source).includes("fs.unlink"))expressions.push(node.arguments[0].getText(source));ts.forEachChild(node,visit);}visit(source);assert.equal(expressions.length,1);
 const script=(tag:string)=>new Function("tag","return "+expressions[0])(tag) as string;
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const modules=(name:string)=>{if(name==="path")return path;if(name==="fs/promises")return fs;if(name==="crypto")return {createHash};throw Error("Unexpected fixture module");};
 const execute=(body:string)=>new AsyncFunction("p","require","process",body)(db,modules,process) as Promise<void>;
 async function snapshot(){const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;const result:Record<string,unknown>={};for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const rows=await db.$queryRawUnsafe<{row:string}[]>('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:createHash("sha256").update(JSON.stringify(rows)).digest("hex")};}return result;}
 async function tree(root:string){const result:Record<string,string>={};async function walk(dir:string){for(const entry of await fs.readdir(dir,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else result[path.relative(root,file)]=createHash("sha256").update(await fs.readFile(file)).digest("hex");}}await walk(root);return result;}
 const baseline=await snapshot();
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),"mtg-photo-intake-cleanup-")),uploads=path.join(parent,"uploads"),previous=process.env.UPLOADS_DATA_PATH;
 process.env.UPLOADS_DATA_PATH=uploads;
 const owner="ui-acquisition-"+randomUUID(),peer="ui-acquisition-"+randomUUID();
 let failed=false,primary:unknown,recoveryPending=false,baselineRestored=false;
 const errors:unknown[]=[];
 async function seed(id:string,count:number){
  await db.player.create({data:{id,name:id,displayName:id}});await db.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash:"fixture-only"}});
  await db.inventoryLocation.create({data:{id,name:id,normalizedName:id,ownerPlayerId:id,type:"Box"}});
  const actor={userId:id,adminMode:false},capture=await createAcquisitionSession(db,actor,{requestKey:randomUUID(),ownerPlayerId:id,locationId:id,section:"",policy:{kind:"MANUAL",quantity:count},run:{providerId:"phone-photo-v1",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL"]}});
  await executeAcquisitionCommand(db,actor,capture.session.id,{requestKey:"start",revision:0,command:"START"});
  const bytes=await sharp({create:{width:100,height:140,channels:3,background:"#335577"}}).png().toBuffer(),preview=await sharp(bytes).jpeg().toBuffer();
  for(let i=0;i<count;i++){const {slot}=await reserveAcquisitionCaptureSlot(db,actor,capture.session.id,randomUUID());const photo=await beginAcquisitionPhoto(db,actor,capture.session.id,{slotId:slot.id,uploadKey:randomUUID(),generation:0,metadata:await inspectAcquisitionPhoto(bytes,"image/png")});await writeAcquisitionPhotoBytes(photo.id,bytes,"raw",photo.digest);await writeAcquisitionPhotoBytes(photo.id,preview,"preview",createHash("sha256").update(preview).digest("hex"));await finalizeAcquisitionPhoto(db,actor,capture.session.id,photo.id);}
  await execute(cancelAndCleanCorrectionFixture(id));
 }
 try{
  await seed(peer,1);const peerRows=await snapshot(),peerFiles=await tree(uploads);
  await seed(owner,2);const ownRows=await snapshot(),photos=await db.acquisitionPhoto.findMany({where:{run:{session:{ownerPlayerId:owner}}},orderBy:{id:"asc"}});assert.equal(photos.length,2);
  for(const photo of photos)assert.match(photo.id,/^[a-f0-9-]{36}$/);
  const blocked=path.join(uploads,"acquisition-v1",photos[0].id+".original"),held=path.join(parent,"held-original"),bytes=await fs.readFile(blocked);
  let sourceRestored=false;
  try{
   recoveryPending=true;await fs.rename(blocked,held);await fs.mkdir(blocked);
   await assert.rejects(execute(script(owner)),(error:unknown)=>error instanceof AggregateError&&error.errors.length===1&&["EISDIR","EPERM"].includes((error.errors[0] as NodeJS.ErrnoException).code??""));
   assert.deepEqual(await snapshot(),ownRows);assert.deepEqual(await fs.readFile(held),bytes);
   for(const photo of photos)for(const suffix of [".original",".preview.jpg"])if(photo.id!==photos[0].id||suffix!==".original")await assert.rejects(fs.readFile(path.join(uploads,"acquisition-v1",photo.id+suffix)),(e:NodeJS.ErrnoException)=>e.code==="ENOENT");
  }catch(error){failed=true;primary=error;}
  try{const target=await fs.lstat(blocked).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});if(target){assert.equal(target.isDirectory(),true);assert.equal(path.dirname(path.resolve(blocked)),path.resolve(uploads,"acquisition-v1"));await fs.rmdir(blocked);}await fs.rename(held,blocked);assert.deepEqual(await fs.readFile(blocked),bytes);sourceRestored=true;recoveryPending=false;}catch(error){errors.push(error);}
  try{assert.equal(sourceRestored,true,"Original restoration unverified; preserve fixture rows");assert.equal(recoveryPending,false,"Original recovery is pending");await execute(script(owner));await execute(script(owner));}catch(error){errors.push(error);}
  try{assert.deepEqual(await snapshot(),peerRows);assert.deepEqual(await tree(uploads),peerFiles);}catch(error){errors.push(error);}
  if(!failed&&!errors.length)console.log(JSON.stringify({event:"photo-intake-file-cleanup",paths:4,realUnlinkRefusal:true,allRowsRetainedOnFileError:true,originalRestored:true,retryAndReplay:true,populatedPeerExact:true,tables:Object.keys(peerRows).length}));
 }catch(error){failed=true;primary=error;}
 for(const id of [owner,peer]){
  if(id===owner&&recoveryPending){errors.push(Error("Unverified original retains owner rows/private files"));continue;}
  for(const body of [cancelAndCleanCorrectionFixture(id),script(id),cancelAndCleanCorrectionFixture(id)])try{await execute(body);}catch(error){errors.push(error);}
 }
 try{const after=await snapshot();assert.deepEqual(after,baseline);baselineRestored=true;console.log(JSON.stringify({event:"photo-intake-file-conservation",before:baseline,after,tables:Object.keys(after).length}));}catch(error){errors.push(error);}
 if(previous===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=previous;
 try{assert.equal(recoveryPending,false);assert.equal(baselineRestored,true);assert.equal(path.dirname(parent),os.tmpdir());assert.ok(path.basename(parent).startsWith("mtg-photo-intake-cleanup-"));await fs.rm(parent,{recursive:true,force:true});}catch(error){errors.push(error);}
 if(failed||errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],"Photo-intake fixture cleanup/recovery failed");
}
