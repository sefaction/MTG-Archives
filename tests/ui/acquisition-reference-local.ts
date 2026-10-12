import {expect,type Page,type Locator} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const web='mtg-anchor-qualification-web-1',worker='mtg-anchor-qualification-acquisition-recognition-worker-1';
export function docker(args:string[],input?:string){return execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});}
export function database(body:string){return docker(['exec','-i',web,'node'],`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`);}
export const json=(body:string)=>JSON.parse(database(body));
export const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const nativeStat=()=>JSON.parse(docker(['exec',worker,'python','-c',
  "import os,json;rows=[]\nfor d in os.listdir('/proc'):\n if d.isdigit():\n  try:\n   c=open('/proc/'+d+'/cmdline','rb').read().split(b'\\0');s=open('/proc/'+d+'/stat').read().split()\n   if len(c)>2 and c[1]==b'/app/tools/acquisition-runtime/recognize.py' and b'--stream' in c:rows.append({'pid':int(d),'ticks':int(s[13])+int(s[14])})\n  except (FileNotFoundError,ProcessLookupError,PermissionError):pass\nassert len(rows)==1;print(json.dumps(rows[0]))"]));
export async function holdReference(owner:string){
  let job:any;
  await expect.poll(()=>{job=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findFirst({where:{run:{session:{ownerPlayerId:${JSON.stringify(owner)}}},stage:'photo-reference-refinement-v1',status:'RUNNING'},select:{id:true,input:true,candidateId:true,candidateRevision:true,leaseToken:true,leaseExpiresAt:true}})));`);return Boolean(job);},
    {timeout:300000,intervals:[100,200,300]}).toBe(true);
  const first=nativeStat();
  await expect.poll(()=>{const now=nativeStat();expect(now.pid).toBe(first.pid);return now.ticks-first.ticks},
    {timeout:3000,intervals:[100,100,200]}).toBeGreaterThan(0);
  expect(json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{stage:{in:['photo-recognition-v1','photo-reference-refinement-v1']},status:'RUNNING'},select:{id:true,leaseToken:true}})));`))
    .toEqual([{id:job.id,leaseToken:job.leaseToken}]);
  docker(['exec',worker,'python','-c',`import os,signal;pid=${first.pid};c=open('/proc/'+str(pid)+'/cmdline','rb').read().split(bytes([0]));assert c[1]==b'/app/tools/acquisition-runtime/recognize.py' and b'--stream' in c;os.kill(pid,signal.SIGSTOP)`]);
  return {job,pid:first.pid,heldAt:Date.now(),observedNativeCpu:true};
}
export function resumeNative(held:Awaited<ReturnType<typeof holdReference>>){
  return JSON.parse(docker(['exec',worker,'python','-c',
    `import os,signal,json;pid=${held.pid}\ntry:\n c=open('/proc/'+str(pid)+'/cmdline','rb').read().split(bytes([0]));assert c[1]==b'/app/tools/acquisition-runtime/recognize.py' and b'--stream' in c;os.kill(pid,signal.SIGCONT);print(json.dumps({'resumed':True}))\nexcept (FileNotFoundError,ProcessLookupError):print(json.dumps({'originalProcessGone':True}))`]));
}
export async function chooseOfferedPrinting(page:Page,card:Locator,batch:string,photoId:string){
  const response=await page.request.get(`/api/acquisition/${batch}/review?photoId=${photoId}`);expect(response.ok()).toBe(true);
  const record=await response.json(),printing=record.suggestions[0].printing;
  const label=`${printing.name} · ${printing.setCode.toUpperCase()} #${printing.collectorNumber} (${printing.lang??'unknown'})`;
  await card.getByRole('radio',{name:label,exact:true}).check();
  await card.getByRole('combobox',{name:'Card finish',exact:true}).selectOption(printing.finishes.includes('nonfoil')?'NONFOIL':printing.finishes.includes('foil')?'FOIL':'ETCHED');
  await card.getByRole('combobox',{name:'Card condition',exact:true}).selectOption('LP');
  return {printing,choice:label};
}

export function cleanupReferenceRows(tag:string){
  if(!/^ui-reference-scan-[a-f0-9-]{36}$/.test(tag))throw Error('Owned reference fixture required');
  database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned photo');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
}

