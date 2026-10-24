import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import {photoDigest,writeAcquisitionPhotoBytes,readAcquisitionPhotoBytes,
  removeAcquisitionPhotoBytes,findAcquisitionPhotoTemporaryFiles} from "../lib/acquisition-files";
import {interruptAcquisitionPhotoWrite} from "../scripts/verify-acquisition-interrupted-storage";

async function fixture(run:(root:string,directory:string)=>Promise<void>){
  await fs.mkdir(path.resolve(".local-data"),{recursive:true});
  const root=await fs.mkdtemp(path.resolve(".local-data/acq-partials-")),previous=process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH=root;
  try{await run(root,path.join(root,"acquisition-v1"));}finally{
    if(previous===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=previous;
    await fs.rm(root,{recursive:true,force:true});
  }
}
test("terminal photo cleanup removes exact raw/preview aliases and unpublished temporary bytes",async()=>fixture(async(_root,directory)=>{
  const id=randomUUID(),neighbor=randomUUID(),bytes=Buffer.from("synthetic original"),digest=photoDigest(bytes);
  await writeAcquisitionPhotoBytes(id,bytes,"raw",digest);await writeAcquisitionPhotoBytes(id,bytes,"preview",digest);
  await writeAcquisitionPhotoBytes(neighbor,bytes,"raw",digest);
  const aliases=[`${id}.${randomUUID()}.part`,`${id}.${randomUUID()}.part`,`${id}.${randomUUID()}.part`];
  await fs.link(path.join(directory,id+".original"),path.join(directory,aliases[0]));
  await fs.link(path.join(directory,id+".preview.jpg"),path.join(directory,aliases[1]));
  await fs.writeFile(path.join(directory,aliases[2]),"unfinished");
  const unknown=[`${id}.not-a-uuid.part`,`${id}.${randomUUID()}.part.extra`,`${neighbor}.${randomUUID()}.part`];
  for(const name of unknown)await fs.writeFile(path.join(directory,name),"untouched");
  const selected=await findAcquisitionPhotoTemporaryFiles([id]);
  assert.deepEqual(selected.get(id)!.sort(),aliases.sort());assert.equal(selected.size,1);
  await removeAcquisitionPhotoBytes(id,selected.get(id));await removeAcquisitionPhotoBytes(id,selected.get(id));
  assert.deepEqual((await fs.readdir(directory)).sort(),[neighbor+".original",...unknown].sort());
  assert.deepEqual(await readAcquisitionPhotoBytes(neighbor,"raw",digest),bytes);
}));
test("temporary-only crash state is removed even when the canonical name never existed",async()=>fixture(async(_root,directory)=>{
  const id=randomUUID();await fs.mkdir(directory);await fs.writeFile(path.join(directory,`${id}.${randomUUID()}.part`),"partial");
  await removeAcquisitionPhotoBytes(id);assert.deepEqual(await fs.readdir(directory),[]);
}));
test("batch discovery retains only selected exact UUID temporary names",async()=>fixture(async(_root,directory)=>{
  await fs.mkdir(directory);const ids=Array.from({length:25},()=>randomUUID());
  for(const id of ids)await fs.writeFile(path.join(directory,`${id}.${randomUUID()}.part`),id);
  for(let n=0;n<300;n++)await fs.writeFile(path.join(directory,`${randomUUID()}.${randomUUID()}.part`),"neighbor");
  const selected=await findAcquisitionPhotoTemporaryFiles(ids);assert.equal(selected.size,25);
  for(const id of ids){assert.equal(selected.get(id)!.length,1);await removeAcquisitionPhotoBytes(id,selected.get(id));}
  assert.equal((await fs.readdir(directory)).length,300);
}));
test("unsafe selected temporary symlink is refused without following or removing its target",{skip:process.platform==="win32"},async()=>fixture(async(root,directory)=>{
  const id=randomUUID();await fs.mkdir(directory);const target=path.join(root,"neighbor"),temporary=path.join(directory,`${id}.${randomUUID()}.part`);
  await fs.writeFile(target,"untouched");await fs.symlink(target,temporary);
  await assert.rejects(removeAcquisitionPhotoBytes(id),/unsafe/);
  assert.equal(await fs.readFile(target,"utf8"),"untouched");assert((await fs.lstat(temporary)).isSymbolicLink());
  await fs.unlink(temporary);await removeAcquisitionPhotoBytes(id);
}));
test("temporary directories and traversal/mismatched batch names are never recursively deleted",async()=>fixture(async(_root,directory)=>{
  const id=randomUUID();await fs.mkdir(directory);const temporary=path.join(directory,`${id}.${randomUUID()}.part`);
  await fs.mkdir(temporary);await fs.writeFile(path.join(temporary,"keep"),"untouched");
  await assert.rejects(removeAcquisitionPhotoBytes(id),/unsafe/);
  assert.equal(await fs.readFile(path.join(temporary,"keep"),"utf8"),"untouched");
  await assert.rejects(removeAcquisitionPhotoBytes(id,["../outside"]),/unsafe/);
  await assert.rejects(findAcquisitionPhotoTemporaryFiles(["../outside"]));
  assert.equal((await findAcquisitionPhotoTemporaryFiles([])).size,0);
}));
test("actual terminated writers before/after publication retain exact bytes until legitimate removal",async()=>fixture(async(_root,directory)=>{
  const bytes=Buffer.from("actual controlled writer interruption");
  for(const point of ["before-link","after-link"] as const)for(const variant of ["raw","preview"] as const){
    const id=randomUUID(),result=await interruptAcquisitionPhotoWrite(id,bytes,point,variant);
    assert.equal(result.signal,"SIGKILL");assert.equal(result.code,null);
    const names=(await findAcquisitionPhotoTemporaryFiles([id])).get(id)!;assert.equal(names.length,1);
    assert.deepEqual(await fs.readFile(path.join(directory,names[0])),bytes);
    if(point==="after-link")assert.deepEqual(await readAcquisitionPhotoBytes(id,variant,photoDigest(bytes)),bytes);
    await removeAcquisitionPhotoBytes(id,names);assert.equal((await findAcquisitionPhotoTemporaryFiles([id])).get(id)!.length,0);
  }
}));
