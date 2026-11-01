import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import Module, {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Opt-in qualification only. The host must first fence the exact disposable
// container, read-only script/image, no-network mode and fresh tmpfs identity.
const root='/byte-space',directory=root+'/acquisition-v1';
const filler=root+'/capacity-race.filler';
const GiB=1024**3;

async function main(){
  assert.equal(process.env.MTG_BYTE_EXHAUSTION_TEST,'1','Explicit byte-exhaustion opt-in required');
  assert.equal(process.env.MTG_LOCAL_PILOT_TEST,'1','Local fixture flag required');
  assert.equal(process.env.UPLOADS_DATA_PATH,root,'Only the disposable /byte-space target is allowed');
  let inert=false;
  try{const url=new URL(process.env.DATABASE_URL);inert=url.hostname==='127.0.0.1'&&url.port==='9'&&url.pathname==='/review_byte_probe';}catch{}
  assert.ok(inert,'Use only the inert fixture database URL; this verifier does not use a database');
  assert.match(process.env.MTG_BYTE_EXHAUSTION_RUN||'',/^photo-byte-exhaustion-305-[a-z0-9-]+$/);
  assert.equal(process.platform,'linux','Use the isolated Linux review container');
  assert.equal(process.cwd(),'/app','Run only from /app in the isolated review image');
  assert.ok(Object.values(os.networkInterfaces()).flat().every(x=>x.internal),'The container must have no external network');
  const memory=BigInt((await fs.readFile('/sys/fs/cgroup/memory.max','utf8')).trim());
  assert.ok(memory>=4n*BigInt(GiB)&&memory<=6n*BigInt(GiB),'A bounded 4–6 GiB cgroup is required');
  assert.equal(await fs.realpath(root),root);
  const disk=await fs.statfs(root);
  assert.equal(disk.type,0x01021994,'Only tmpfs is allowed');
  assert.equal(disk.blocks*disk.bsize,3*GiB,'Only the new 3 GiB fixture filesystem is allowed');
  assert.ok(disk.ffree>100,'Inodes must not be exhausted');
  assert.deepEqual(await fs.readdir(root),[],'Refuse every populated filesystem before writing');

  const filename='/app/lib/acquisition-files.ts';
  const source=readFileSync(filename,'utf8');
  const manifest=JSON.parse(readFileSync('/app/build-source-manifest.json','utf8'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),manifest.files['lib/acquisition-files.ts']);
  const real=createRequire(filename),ts=real('typescript');
  let armed=false,payloadBytes=0,observation;
  const partials=[];
  async function drain(measured){
    const available=measured.bavail*measured.bsize;
    assert.ok(available>=2*GiB+payloadBytes,'The unchanged admission check must have genuinely sufficient space');
    const target=available-4*measured.bsize;
    assert.ok(target>2*GiB&&target<3*GiB);
    const handle=await fs.open(filler,'wx',0o600),chunk=Buffer.alloc(1024*1024);
    let written=0;
    try{
      while(written<target){const size=Math.min(chunk.length,target-written);const r=await handle.write(chunk,0,size);assert.ok(r.bytesWritten>0);written+=r.bytesWritten;}
      await handle.sync();
    }finally{await handle.close();}
    const after=await fs.statfs(directory);
    assert.ok(after.ffree>100,'The failure must be byte exhaustion, not inode exhaustion');
    assert.ok(after.bavail*after.bsize>0&&after.bavail*after.bsize<payloadBytes);
    observation={admittedFreeBytes:available,afterDrainFreeBytes:after.bavail*after.bsize,freeInodes:after.ffree,fillerBytes:written};
  }
  const adapted={...fs,
    // Return the real measurement unchanged, after an independently written
    // filler consumes capacity. This models a concurrent writer after admission.
    statfs:async(...args)=>{const measured=await fs.statfs(...args);if(armed){armed=false;await drain(measured);}return measured;},
    // Observe actual partial bytes immediately before normal cleanup removes
    // them. Never synthesize an error, alter a write or skip an unlink.
    unlink:async file=>{if(String(file).endsWith('.part')){try{partials.push({name:path.basename(file),size:(await fs.lstat(file)).size});}catch(e){if(e.code!=='ENOENT')throw e;}}return fs.unlink(file);},
  };
  const loaded=new Module(filename);loaded.filename=filename;loaded.paths=Module._nodeModulePaths('/app/lib');
  loaded.require=name=>name==='node:fs/promises'?adapted:real(name);
  loaded._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
  const api=loaded.exports,neighbor=crypto.randomUUID(),photos=[neighbor];
  const peer=Buffer.from('Independent neighboring original'),results=[];
  let primary;
  try{
    await fs.mkdir(directory);
    await api.writeAcquisitionPhotoBytes(neighbor,peer,'raw',api.photoDigest(peer));
    for(const variant of ['raw','preview']){
      const photo=crypto.randomUUID(),bytes=crypto.randomBytes(1024*1024);
      photos.push(photo);payloadBytes=bytes.length;armed=true;observation=undefined;
      const priorPartials=partials.length;
      let failure;
      try{await api.writeAcquisitionPhotoBytes(photo,bytes,variant,api.photoDigest(bytes));}catch(e){failure=e;}
      assert.ok(failure);assert.equal(failure.code,'ENOSPC');assert.equal(failure.syscall,'write');
      assert.ok(observation);assert.equal(partials.length,priorPartials+1);
      const partial=partials.at(-1);assert.ok(partial.size>0&&partial.size<bytes.length);
      assert.equal((await fs.readdir(directory)).some(x=>x.startsWith(photo)),false,'No partial or published file may remain');
      assert.deepEqual(await api.readAcquisitionPhotoBytes(neighbor,'raw',api.photoDigest(peer)),peer);
      await fs.unlink(filler);
      await api.writeAcquisitionPhotoBytes(photo,bytes,variant,api.photoDigest(bytes));
      await api.writeAcquisitionPhotoBytes(photo,bytes,variant,api.photoDigest(bytes));
      assert.deepEqual(await api.readAcquisitionPhotoBytes(photo,variant,api.photoDigest(bytes)),bytes);
      assert.deepEqual(await api.readAcquisitionPhotoBytes(neighbor,'raw',api.photoDigest(peer)),peer);
      results.push({variant,code:failure.code,syscall:failure.syscall,...observation,partialBytes:partial.size,recoveredExactBytes:bytes.length,replayExact:true,neighborPreserved:true});
    }
  }catch(e){primary=e;}
  const cleanup=[];
  for(const id of photos){try{await api.removeAcquisitionPhotoBytes(id);}catch(e){cleanup.push(e);}}
  try{await fs.unlink(filler);}catch(e){if(e.code!=='ENOENT')cleanup.push(e);}
  try{assert.deepEqual(await fs.readdir(directory),[]);}catch(e){cleanup.push(e);}
  if(primary||cleanup.length)throw new AggregateError([...(primary?[primary]:[]),...cleanup],'Byte-exhaustion qualification or cleanup failed',{cause:primary});
  console.log(JSON.stringify({status:'PASS',run:process.env.MTG_BYTE_EXHAUSTION_RUN,verifierSHA256:crypto.createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),sourceManifest:manifest.digest,sourceSHA256:manifest.files['lib/acquisition-files.ts'],results,cleanup:'All exact fixture photos/filler removed',scope:'Actual file-write module only; no database, HTTP, browser, process-loss or production qualification'}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
