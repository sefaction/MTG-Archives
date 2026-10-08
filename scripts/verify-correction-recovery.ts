import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

// Copies current source into a UUID-owned capsule; no live database, uploads,
// model directories, host ports or production configuration are attached.
const root = process.cwd(), id = randomUUID(), label = `mtg.correction-recovery=${id}`;
const prefix = `mtg-correction-recovery-${id}`;
const output = path.join(root,".local-data","verification",prefix);
mkdirSync(output,{recursive:true});
const log = path.join(output,"checks.log"), started = Date.now();
let network = "", database = "", capsule = "", image = "", cleaned = false;
let source: { commit:string; contentSha256:string } | undefined;
let originalRuntime: unknown;
function command(args: string[]) {
  return execFileSync("docker",args,{cwd:root,encoding:"utf8",windowsHide:true,
    timeout:600000,maxBuffer:32*1024*1024,stdio:["ignore","pipe","pipe"]});
}
function record(name:string,args:string[]) {
  try { const value=command(args); appendFileSync(log,`\n## ${name}\n${value}\n`); console.log(`PASS ${name}`); return value; }
  catch(error:any) { appendFileSync(log,`\n## FAILED ${name}\n${error.stdout??""}\n${error.stderr??""}\n`);
    console.error(String(error.stderr??error.message).slice(-6000)); throw new Error(`Failed: ${name}`); }
}
function runtime() {
  const ids=command(["ps","-aq","--filter","label=com.docker.compose.project=mtg-archives"]).trim().split(/\s+/).filter(Boolean);
  if(!ids.length) throw new Error("Local project runtime must exist for the isolation comparison");
  const values=JSON.parse(command(["inspect",...ids]));
  return values.map((c:any)=>({id:c.Id,image:c.Image,started:c.State.StartedAt,restarts:c.RestartCount,
    mounts:c.Mounts.sort((a:any,b:any)=>a.Destination.localeCompare(b.Destination)),
    limits:{memory:c.HostConfig.Memory,nanoCpus:c.HostConfig.NanoCpus}})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
}
function ownedContainer(container:string) {
  assert.match(container,/^[a-f0-9]{64}$/);
  const labels=JSON.parse(command(["inspect",container,"--format","{{json .Config.Labels}}"]));
  assert.equal(labels["mtg.correction-recovery"],id,"Refusing cleanup of an unowned container");
}
async function main() {
  const paths=execFileSync("git",["ls-files","--cached","--others","--exclude-standard","-z","lib","scripts","prisma","prisma.config.ts"],
    {cwd:root,encoding:"utf8",windowsHide:true}).split("\0").filter(Boolean);
  const hash=createHash("sha256");
  for(const file of [...new Set(paths)].sort()) hash.update(file).update("\0").update(readFileSync(path.join(root,file))).update("\0");
  source={commit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8",windowsHide:true}).trim(),contentSha256:hash.digest("hex")};
  const context=command(["context","show"]).trim();
  const endpoint=JSON.parse(command(["context","inspect",context,"--format","{{json .Endpoints.docker.Host}}"]));
  const local=(value:string)=>/^(npipe:\/\/|unix:\/\/)/.test(value);
  assert.ok(local(endpoint)&&(!process.env.DOCKER_HOST||local(process.env.DOCKER_HOST)),"A local Docker engine is required");
  originalRuntime=runtime();
  image=command(["inspect","mtg-archives-web-1","--format","{{.Image}}"]).trim(); assert.match(image,/^sha256:[a-f0-9]{64}$/);
  network=record("create owned internal network",["network","create","--internal","--label",label,`${prefix}-network`]).trim();
  database=record("start owned empty PostgreSQL",["run","-d","--name",`${prefix}-db`,"--label",label,
    "--network",network,"--network-alias","correction-restore-fixture","-e","POSTGRES_USER=libraryfixture",
    "-e","POSTGRES_PASSWORD=fixture-only","-e","POSTGRES_DB=acquisition_correction_restore","postgres:16-alpine"]).trim();
  ownedContainer(database);
  let ready=false;
  for(let n=0;n<120;n++) {
    try { command(["exec",database,"pg_isready","-U","libraryfixture","-d","acquisition_correction_restore"]); ready=true; break; }
    catch { await setTimeout(250); }
  }
  assert.ok(ready,"Owned database did not become ready");
  const instructions=["set -eu","cp -R /fixture/lib/. /app/lib/","cp -R /fixture/scripts/. /app/scripts/",
    "cp -R /fixture/prisma/. /app/prisma/","cp /fixture/prisma.config.ts /app/prisma.config.ts",
    "mkdir -p /drill/staged-migration",
    "mv /app/prisma/migrations/20261006193000_recognition_correction_library /drill/staged-migration/",
    "node /app/node_modules/prisma/build/index.js generate",
    "node /app/node_modules/prisma/build/index.js migrate deploy",
    "node /app/node_modules/tsx/dist/cli.mjs scripts/verify-correction-archive.ts"].join("\n");
  const mounts=["lib","scripts","prisma","prisma.config.ts"].flatMap(file=>["--mount",`type=bind,source=${path.join(root,file)},target=/fixture/${file},readonly`]);
  capsule=record("create owned source capsule",["create","--name",`${prefix}-capsule`,"--label",label,
    "--network",network,"--entrypoint","sh","--workdir","/app","--user","0","--tmpfs","/failure-space:rw,size=128k,mode=0777",
    "-e","DATABASE_URL=postgresql://libraryfixture:fixture-only@correction-restore-fixture:5432/acquisition_correction_restore?schema=public",
    "-e","MTG_LOCAL_PILOT_TEST=1","-e","UPLOADS_DATA_PATH=/drill/uploads","-e","BACKUP_DIR=/drill/backups",
    "--mount",`type=bind,source=${output},target=/drill`,...mounts,image,"-c",instructions]).trim();
  ownedContainer(capsule);
  const inspected=JSON.parse(command(["inspect",capsule]))[0];
  assert.deepEqual(Object.keys(inspected.HostConfig.PortBindings??{}),[]);
  assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs),["/failure-space"]);
  assert.ok(inspected.Mounts.every((mount:any)=>mount.Destination==="/drill"||mount.Destination==="/failure-space"||mount.Destination.startsWith("/fixture/")));
  assert.equal(inspected.Mounts.filter((mount:any)=>mount.Type==="bind").length,5);
  record("real archive, process kill and older restore",["start","--attach",capsule]);
  assert.equal(Number(command(["inspect",capsule,"--format","{{.State.ExitCode}}"])),0);
  assert.deepEqual(runtime(),originalRuntime,"Live project runtime changed during the isolated drill");
  console.log("PASS original project container identities, starts, mounts and limits remain unchanged");
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{
  try {
    for(const container of [capsule,database].filter(Boolean)) { ownedContainer(container); command(["rm","-f","-v",container]); }
    if(network) {
      const value=JSON.parse(command(["network","inspect",network]))[0]; assert.equal(value.Labels["mtg.correction-recovery"],id);
      command(["network","rm",network]);
    }
    cleaned=true;
  } catch(error:any) {console.error(error.message);process.exitCode=1;}
  writeFileSync(path.join(output,"result.json"),JSON.stringify({version:1,passed:!process.exitCode,cleaned,source,image,
    originalRuntime,elapsedMs:Date.now()-started},null,2));
  console.log(`Evidence: ${output}`);
});
