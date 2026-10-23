import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import sharp from 'sharp';
import type {PrismaClient} from '@prisma/client';
import {cancelAndCleanCorrectionFixture} from '../tests/ui/correction-fixture';
import {ensureCorrectionAccount} from '../lib/acquisition-correction-library';
import {createScannerPairing,claimScannerPairing,recordScannerPulse} from '../lib/scanner-store';
import {scannerSecret} from '../lib/scanner-protocol';
import {createScannerBatch,claimScannerRun,receiveScannerImage} from '../lib/scanner-runs';
import {scannerSiteEpoch} from '../lib/scanner-control-files';

// Invoked only by the disposable acquisition_* runner. The real Node child is
// a supervised fixture stand-in; no Windows helper, scanner or recognition runs.
export async function verifyNativeScannerCleanup(db:PrismaClient) {
 const url=new URL(process.env.DATABASE_URL||'http://invalid');
 assert.equal(process.env.MTG_LOCAL_PILOT_TEST,'1');assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.ok(url.pathname.startsWith('/acquisition_'));
 const source=ts.createSourceFile('native',readFileSync('tests/ui/scanner-native.spec.ts','utf8'),ts.ScriptTarget.Latest,true);
 let target:ts.TryStatement|undefined;
 function visit(n:ts.Node){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(source).includes('const cleanupErrors'))target=n;ts.forEachChild(n,visit);}visit(source);assert.ok(target?.catchClause);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const body='let primaryFailed=false;let primaryError;try{throw injected;}'+target!.catchClause!.getText(source)+' finally '+target!.finallyBlock!.getText(source);
 const run=new AsyncFunction('database','cancelAndCleanCorrectionFixture','tag','child','writeFileSync','helper','agentId','log','path','process','rmSync','injected',ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
 const parent=await mkdtemp(path.join(os.tmpdir(),'mtg-native-cleanup-')),uploads=path.join(parent,'uploads'),local=path.join(parent,'local');
 await mkdir(uploads);await mkdir(local);
 const priorUploads=process.env.UPLOADS_DATA_PATH,priorLocal=process.env.LOCALAPPDATA;
 process.env.UPLOADS_DATA_PATH=uploads;process.env.LOCALAPPDATA=local;
 const tag=`ui-scanner-native-${randomUUID()}`,peer=`ui-scanner-native-${randomUUID()}`;
 let child:ChildProcess|undefined;
 async function snapshot(){const rows=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;const out:Record<string,unknown>={};for(const {tablename} of rows){const [row]=await db.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "${tablename.replaceAll('"','""')}" t`);out[tablename]=row;}return out;}
 async function files(root:string){const out:Record<string,string>={};async function walk(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())await walk(file);else out[path.relative(root,file)]=createHash('sha256').update(await readFile(file)).digest('hex');}}await walk(root);return out;}
 function database(sql:string){return execFileSync(process.execPath,['-e',"const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{"+sql+"})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());"],{encoding:'utf8',timeout:30000,windowsHide:true});}
 // Execute the exact legacy cleanup SQL, also for recovery after a failed probe.
 let legacySQL='';function findSQL(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(source)==='database'&&n.arguments[0]&&ts.isTemplateExpression(n.arguments[0])&&n.arguments[0].getText(source).includes('await p.scannerRun.deleteMany'))legacySQL=n.arguments[0].getText(source);ts.forEachChild(n,findSQL);}findSQL(target!.finallyBlock!);assert.ok(legacySQL);
 const legacy=new Function('tag','return '+legacySQL);
 async function seed(owner:string){
  await db.player.create({data:{id:owner,name:owner,displayName:owner}});await db.user.create({data:{id:owner,username:owner,displayName:owner,playerId:owner,passwordHash:'fixture-only'}});
  await db.$transaction(tx=>ensureCorrectionAccount(tx,owner));await db.correctionLibraryAccount.update({where:{ownerPlayerId:owner},data:{sampleBasisPoints:0}});
  await db.inventoryLocation.create({data:{id:owner,name:owner,normalizedName:owner,ownerPlayerId:owner,type:'BOX'}});
  const pair=await createScannerPairing(db,owner),agentId=randomUUID(),secret=scannerSecret(),token=`Bearer ${agentId}.${secret}`;
  await claimScannerPairing(db,{version:1,pairCode:pair.code,agentId,secret,name:'Cleanup fixture'});
  const device={id:'fixture-wia',name:'Fixture source',backend:'fixture',source:'Wia',qualification:'GenericUnqualified'};
  await recordScannerPulse(db,token,{version:1,agentVersion:'fixture',devices:[device]});
  const epoch=await scannerSiteEpoch(),run=await createScannerBatch(db,{userId:owner,adminMode:false},{requestKey:randomUUID(),agentId,deviceId:device.id,locationId:owner,section:'',quantity:1,loadedCount:1,operatorLoadedSimplexFronts:true,settings:{dpi:300,widthInches:2.6,heightInches:3.6,horizontalPlacement:'Start',duplex:false,color:'RGB',autoCrop:false,deskew:false,removeBlank:false}},epoch);
  const claim={version:1,runId:run.runId,epoch,executionId:randomUUID()};await claimScannerRun(db,token,claim,epoch);
  const bytes=await sharp({create:{width:75,height:105,channels:3,background:'white'}}).png().toBuffer();
  await receiveScannerImage(db,token,{...claim,artifactId:randomUUID(),sequence:1,timestamp:new Date().toISOString(),side:'UNKNOWN',physicalBoundary:'UNKNOWN'},epoch,bytes,'image/png');
  return agentId;
 }
 const before=await snapshot();
 let primaryFailed=false;let primaryError:unknown;
 try {
  const peerAgent=await seed(peer),peerBaseline=await snapshot(),peerFiles=await files(uploads);
  const peerSpool=path.join(local,'MTGArchives','ScannerAgent',peerAgent);await mkdir(peerSpool,{recursive:true});writeFileSync(path.join(peerSpool,'journal'),'peer journal');
  const agentId=await seed(tag),ownSpool=path.join(local,'MTGArchives','ScannerAgent',agentId);await mkdir(ownSpool,{recursive:true});writeFileSync(path.join(ownSpool,'journal'),'owned journal');
  child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe'],windowsHide:true});await once(child.stdout!,'data');assert.equal(child.exitCode,null);
  const primary=Error('controlled original workflow failure'),early=Error('controlled first database sweep failure');let calls=0,forgot=false;
  const failingDatabase=(sql:string)=>{if(calls++===0)throw early;return database(sql);};
  await assert.rejects(run(failingDatabase,cancelAndCleanCorrectionFixture,tag,child,(_name:string,content:string)=>writeFileSync(path.join(parent,'helper.log'),content),(args:string[])=>{assert.deepEqual(args,['forget',agentId]);assert.ok(child!.exitCode!==null||child!.signalCode!==null,'Forget only after actual child termination');forgot=true;},agentId,'owned helper output',path,process,rmSync,primary),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[primary,early])===undefined);
  assert.equal(calls,3);assert.equal(forgot,true);assert.ok(child.exitCode!==null||child.signalCode!==null);
  assert.equal(readFileSync(path.join(parent,'helper.log'),'utf8'),'owned helper output');
  assert.throws(()=>readFileSync(path.join(ownSpool,'journal')));assert.equal(readFileSync(path.join(peerSpool,'journal'),'utf8'),'peer journal');
  assert.deepEqual(await snapshot(),peerBaseline,'Every pre-existing full-row table fingerprint, including peer lineage, remains');assert.deepEqual(await files(uploads),peerFiles,'Entire upload tree remains byte-exact after owned cleanup');
 } catch(error) {primaryFailed=true;primaryError=error;throw error;} finally {
  const cleanupErrors:unknown[]=[];
  try {if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned fixture child did not terminate')),5000);child!.once('exit',()=>{clearTimeout(timer);resolve();});});}}
  catch(error){cleanupErrors.push(error);}
  for(const owner of [tag,peer])for(const sql of [cancelAndCleanCorrectionFixture(owner),legacy(owner),cancelAndCleanCorrectionFixture(owner)])try{database(sql);}catch(error){cleanupErrors.push(error);}
  try {assert.deepEqual(await snapshot(),before,'All public database tables return to pre-fixture baseline');}catch(error){cleanupErrors.push(error);}
  if(priorUploads===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=priorUploads;
  if(priorLocal===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=priorLocal;
  try {assert.ok(!child||child.exitCode!==null||child.signalCode!==null,'Retain recovery files for an uncertain child');assert.equal(path.dirname(parent),os.tmpdir());assert.ok(path.basename(parent).startsWith('mtg-native-cleanup-'));await rm(parent,{recursive:true,force:true});}catch(error){cleanupErrors.push(error);}
  if(cleanupErrors.length)throw new AggregateError(primaryFailed?[primaryError,...cleanupErrors]:cleanupErrors,'Native cleanup qualification finalization failed');
 }
 console.log(`PASS actual native finally: first SQL sweep failure preserves original/cleanup errors, terminates real supervised child, removes only owned journal/rows/originals/marker, and conserves all peer table/file fingerprints; all ${Object.keys(before).length} tables restored after final cleanup; no native helper/hardware`);
}
