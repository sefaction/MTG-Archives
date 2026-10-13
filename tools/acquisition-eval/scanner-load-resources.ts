import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const execute = promisify(execFile);
export const loadRoles = ['web','acquisition-worker','acquisition-catalog-worker','acquisition-recognition-worker','acquisition-visual-worker','acquisition-printing-worker'] as const;
export function parseLoadCounters(text: string) {
  const lines=text.trim().split(/\r?\n/), integer=(value:string)=>{if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Invalid resource counter');return Number(value);};
  if(lines.length<8)throw Error('Incomplete resource counters');
  const [current,peak,limit,swapCurrent,swapPeak]=lines.slice(0,5);
  const counters:Record<string,number>={};
  for(const line of lines.slice(5)){const [key,value,extra]=line.trim().split(/\s+/);if(extra||!key||value===undefined)throw Error('Invalid counter row');if(['low','high','max','oom','oom_kill','oom_group_kill','usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec'].includes(key)){if(key in counters)throw Error('Duplicate counter');counters[key]=integer(value);}}
  for(const key of ['max','oom','oom_kill','usage_usec'])if(!(key in counters))throw Error('Required counter missing');
  return {current:integer(current),lifetimePeak:integer(peak),limit:limit==='max'?null:integer(limit),swapCurrent:integer(swapCurrent),swapLifetimePeak:integer(swapPeak),counters};
}
export type LoadSample = {at:string;roles:Array<{role:string;id:string;image:string;configuredMemory:number;running:boolean;oomKilled:boolean;restarts:number;startedAt:string;resources:ReturnType<typeof parseLoadCounters>}>};
async function docker(args:string[]){return (await execute('docker',args,{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024*1024})).stdout;}
export async function sampleLoadResources():Promise<LoadSample>{
  const roles=await Promise.all(loadRoles.map(async role=>{
    const name='mtg-anchor-qualification-'+role+'-1';
    const fields=(await docker(['inspect',name,'--format','{{.Id}} {{.Image}} {{.HostConfig.Memory}} {{.State.Running}} {{.State.OOMKilled}} {{.RestartCount}} {{.State.StartedAt}}'])).trim().split(/\s+/);
    if(fields.length!==7||!/^\w{64}$/.test(fields[0])||!/^sha256:[a-f0-9]{64}$/.test(fields[1]))throw Error('Unexpected local service');
    const memory=await docker(['exec',name,'sh','-c','cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.current /sys/fs/cgroup/memory.swap.peak /sys/fs/cgroup/memory.events /sys/fs/cgroup/cpu.stat']);
    return {role,id:fields[0],image:fields[1],configuredMemory:Number(fields[2]),running:fields[3]==='true',oomKilled:fields[4]==='true',restarts:Number(fields[5]),startedAt:fields[6],resources:parseLoadCounters(memory)};
  }));return {at:new Date().toISOString(),roles};
}
export function summarizeLoadResources(samples:LoadSample[]){
  if(samples.length<2)throw Error('Before and after observations required');
  return samples[0].roles.map(first=>{
    const rows=samples.map(sample=>sample.roles.find(row=>row.role===first.role));
    if(rows.some(row=>!row||row.id!==first.id||row.image!==first.image||row.configuredMemory!==first.configuredMemory||row.startedAt!==first.startedAt||row.resources.limit!==first.resources.limit||!row.running||row.oomKilled||row.restarts!==first.restarts))throw Error('Service identity, limit or lifetime changed');
    const last=rows.at(-1)!;const delta=(key:string)=>{const values=rows.map(row=>row!.resources.counters[key]);if(values.some((v,i)=>i>0&&v<values[i-1]))throw Error('Resource counter reset');return values.at(-1)!-values[0];};
    return {role:first.role,image:first.image,limit:first.resources.limit,samples:rows.length,sampledCurrentPeak:Math.max(...rows.map(r=>r!.resources.current)),lifetimePeakBefore:first.resources.lifetimePeak,lifetimePeakAfter:last.resources.lifetimePeak,sampledSwapPeak:Math.max(...rows.map(r=>r!.resources.swapCurrent)),lifetimeSwapPeakBefore:first.resources.swapLifetimePeak,lifetimeSwapPeakAfter:last.resources.swapLifetimePeak,maxEventsDelta:delta('max'),oomEventsDelta:delta('oom'),oomKillsDelta:delta('oom_kill'),cpuUsageUs:delta('usage_usec'),sameIdentityLimitsLifetime:true};
  });
}
export async function observeLoad(path:string){
  const samples:LoadSample[]=[],failures:string[]=[];let pending:Promise<void>|undefined;
  const take=()=>{if(pending)return pending;pending=sampleLoadResources().then(sample=>{samples.push(sample);writeFileSync(path,JSON.stringify({samples,failures},null,2));}).catch(()=>{failures.push('RESOURCE_OBSERVATION_FAILED');writeFileSync(path,JSON.stringify({samples,failures},null,2));}).finally(()=>{pending=undefined;});return pending;};
  await take();if(failures.length)throw Error('Initial resource observation failed');
  const timer=setInterval(()=>void take(),30000);
  return {stop:async()=>{clearInterval(timer);await pending;await take();if(failures.length)throw Error('Resource observation incomplete');const summary=summarizeLoadResources(samples);writeFileSync(path,JSON.stringify({samples,failures,summary},null,2));return summary;}};
}