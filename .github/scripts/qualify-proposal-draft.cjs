// Temporary combined-source qualification. Never execute against a laptop or production.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = process.cwd();
const branch = 'refs/heads/codex/qualification-proposal-draft';
assert.equal(process.platform, 'linux', 'Hosted Linux only');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'GitHub Actions only');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'No self-hosted resources');
assert.equal(process.env.GITHUB_REPOSITORY, 'sefaction/MTG-Archives');
assert.equal(process.env.GITHUB_REF, branch, 'Qualification branch only');
assert.equal(Number(process.versions.node.split('.')[0]), 22);
assert(process.env.QUALIFICATION_BUILDER, 'Explicit owned Buildx builder required');
assert(!process.env.NODE_OPTIONS, 'Do not change canonical build heap configuration');
assert(!process.env.DATABASE_URL, 'No inherited database credentials');
if (process.env.DOCKER_HOST) assert.match(process.env.DOCKER_HOST, /^unix:\/\/\//);

const dir = path.join(root, '.local-data/qualification-ci');
fs.mkdirSync(dir, {recursive:true});
const runId = crypto.randomUUID();
const short = runId.slice(0,8);
const project = `mtg-ci-${short}`;
const builder = process.env.QUALIFICATION_BUILDER;
const productHead='5799e4bcd148add96227ca634fb4070d970c7bed';
const mainHead='c2c65102032b1e3da595da670c5310b3ae6c7f37';
const mergeBase='e133ddd8ab910092de7126f62f4d5f5b5b0a6775';
const proposalHead='8f41495f511dfcceebf59cfd170d1bf94cfefcbc';
const deletionHead='5960933aa77ba90ff0e4a5ed3e2efec945874d44';
const transportHead='7d8b4329898611122c6d9899330a08d14704af5f';
const transportFiles=['tests/ui/isolated-qualification-target.ts','tests/isolated-qualification-target.test.ts'];
const negativeTransportFile='tests/ui/trade-lifecycle.spec.ts';
const label = `mtg-isolated-qualification=${runId}`;
const containers = [];
let network;
let proxy;
let initialContainers = [];
const receipts = [];
const report = {runId, branch, startedAt:new Date().toISOString(), gates:{}, status:'RUNNING', localFailureUnresolved:true};
const save = (name, value) => fs.writeFileSync(path.join(dir,name), JSON.stringify(value,null,2)+'\n');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function safeArgs(args) {
  return args.map(value => /^(DATABASE_URL|.*PASSWORD|.*SECRET|.*TOKEN)=/.test(value) ? value.split('=')[0]+'=<synthetic-redacted>' : value);
}
function run(exe, args, options={}) {
  const record={exe,args:safeArgs(args),startedAt:new Date().toISOString()};
  const fd=options.log ? fs.openSync(path.join(dir,options.log),'w') : undefined;
  const result=cp.spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:options.timeout??60_000,maxBuffer:32*1024*1024,
    env:{...process.env,...options.env},input:options.input,stdio:fd===undefined?['pipe','pipe','pipe']:['ignore',fd,fd]});
  if(fd!==undefined) fs.closeSync(fd);
  if(result.status!==0 && result.stderr) {
    record.stderrFile=`command-${receipts.length}-stderr.log`;
    fs.writeFileSync(path.join(dir,record.stderrFile),result.stderr.slice(-32000));
  }
  Object.assign(record,{finishedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,errorCode:result.error?.code});
  receipts.push(record);save('command-receipts.json',receipts);
  if(result.status!==0) throw new Error(`${exe} ${args[0]} failed (${result.status ?? result.error?.code}); ${options.log??'see command receipt'}`);
  return result.stdout?.trim()??'';
}
const docker=(...args)=>run('docker',args);
const inspect=(kind,id)=>JSON.parse(docker(kind,'inspect',id))[0];
const git=(...args)=>run('git',args);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function owned(id) {
  const value=inspect('container',id);
  assert.equal(value.Id,id);
  assert.equal(value.Config.Labels?.['mtg-isolated-qualification'],runId);
  assert.equal(value.Config.Labels?.['com.docker.compose.project'],project);
  assert(!value.Mounts.some(m=>m.Type==='bind'),'Never use host data mounts');
  return value;
}
function create(args) {
  const id=docker('create','--label',label,'--label',`com.docker.compose.project=${project}`,...args);
  assert.match(id,/^[a-f0-9]{64}$/);containers.push(id);owned(id);return id;
}
function remove(id) {owned(id);docker('rm','-f',id);containers.splice(containers.indexOf(id),1);}
function capture(image,args,name,memory='256m') {
  const id=create(['--name',`${project}-${name}`,'--network','none','--memory',memory,'--memory-swap',memory,'--cpus','1','--pids-limit','128','--entrypoint',args[0],image,...args.slice(1)]);
  const output=docker('start','--attach',id);
  assert.equal(owned(id).State.ExitCode,0,`${name} exit`);remove(id);return output;
}
const buildFlags=['--builder',builder,'--load','--resource','memory=4g','--resource','memory-swap=4g','--resource','cpu-period=100000','--resource','cpu-quota=200000','--ulimit','nproc=256:256','--progress','plain','--label',label];
function build(context,name) {
  const iid=path.join(dir,`${name}.iid`),metadata=path.join(dir,`${name}-metadata.json`);
  console.log(`Building ${name} on hosted disposable resources`);
  run('docker',['buildx','build',...buildFlags,'--metadata-file',metadata,'--iidfile',iid,'-t',`${project}:${name}`,'-f',path.join(context,'Dockerfile'),context],{log:`${name}-build.log`,timeout:20*60_000});
  const id=fs.readFileSync(iid,'utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);
  const meta=JSON.parse(fs.readFileSync(metadata,'utf8'));
  assert(meta['buildx.build.ref'],'Native BuildKit reference required');
  const [historyBuilder,historyNode,historyId,...extra]=meta['buildx.build.ref'].split('/');
  assert.equal(historyBuilder,builder);assert(historyNode.startsWith(builder));assert(historyId && !extra.length);
  const resourceArgs=meta['buildx.build.provenance']?.invocation?.parameters?.args;
  assert.equal(resourceArgs?.memory,String(4*1024**3));assert.equal(resourceArgs?.memswap,String(4*1024**3));
  assert.equal(resourceArgs?.cpuperiod,'100000');assert.equal(resourceArgs?.cpuquota,'200000');assert.equal(resourceArgs?.ulimit,'nproc=256:256');
  const history=JSON.parse(docker('buildx','--builder',builder,'history','inspect','--format','json',historyId));
  assert.equal(history.Ref,historyId);assert.equal(history.Status,'completed');
  save(`${name}-history.json`,history);
  return id;
}
function database(body) {
  owned(report.target.web.id);owned(report.target.database.id);
  return JSON.parse(run('docker',['exec','-i',report.target.web.id,'node'],{input:databaseScript(body)}));
}
function databaseScript(body) {
  const script=`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error('Owned fixture query failed',e.constructor.name,e.code);process.exitCode=1}).finally(()=>p.$disconnect());`;
  new (require('node:vm').Script)(script);
  return script;
}
async function startProxy(web) {
  const state=owned(web), n=inspect('network',network.id);
  const backendAddress=state.NetworkSettings.Networks[network.name]?.IPAddress;
  save('web-network-startup.json',{id:state.Id,state:state.State,ports:state.NetworkSettings.Ports,portBindings:state.HostConfig.PortBindings,networks:state.NetworkSettings.Networks,network:{id:n.Id,internal:n.Internal,driver:n.Driver,peers:Object.keys(n.Containers??{})}});
  assert.equal(n.Internal,true);assert.equal(n.Id,network.id);assert.equal(n.Labels['mtg-isolated-qualification'],runId);
  assert(state.State.Running);assert.equal(Object.keys(state.NetworkSettings.Networks).length,1);
  assert.equal(state.NetworkSettings.Networks[network.name].NetworkID,network.id);
  assert.equal(require('node:net').isIP(backendAddress),4);
  const script=path.join(root,'.github/scripts/qualification-loopback-proxy.cjs');
  proxy=cp.spawn(process.execPath,[script,runId,web,backendAddress,network.id],{cwd:root,stdio:['ignore','pipe','pipe']});
  let stderr='';proxy.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);fs.writeFileSync(path.join(dir,'proxy-stderr.log'),stderr);});
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Owned proxy startup deadline')),10000);
    proxy.once('error',error=>{clearTimeout(timer);reject(error);});
    proxy.once('exit',code=>{clearTimeout(timer);reject(Error(`Owned proxy exited ${code}: ${stderr}`));});
    let output='';proxy.stdout.on('data',chunk=>{output+=chunk;assert(output.length<16000);if(output.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}}});
  });
  assert.equal(ready.pid,proxy.pid);assert.equal(ready.address,'127.0.0.1');assert.equal(ready.webId,web);assert.equal(ready.networkId,network.id);assert.equal(ready.backendAddress,backendAddress);assert.equal(ready.runId,runId);assert(ready.port>0 && ![13001,13011].includes(ready.port));
  save('proxy-startup.json',ready);
  return {baseURL:`http://127.0.0.1:${ready.port}`,hostedProxy:{pid:proxy.pid,backendAddress,networkId:network.id,scriptSHA256:hash(fs.readFileSync(script))}};
}
function snapshot() {
  return database(snapshotBody());
}
function snapshotBody() {
  const prefix='SELECT count(*)::int AS count,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),\'\')) AS digest FROM public."';
  return `const tables=await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");const result={};for(const {tablename} of tables){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unsafe fixture table');const rows=await p.$queryRawUnsafe(${JSON.stringify(prefix)}+tablename+${JSON.stringify('" t')});result[tablename]=rows[0];}return result;`;
}
async function main() {
  databaseScript(snapshotBody()); // Parse the exact generated read-only query before costly work.
  const endpoint=JSON.parse(docker('context','inspect',docker('context','show'),'--format','{{json .Endpoints.docker.Host}}'));
  assert.match(endpoint,/^unix:\/\/\//,'Local hosted Docker daemon only');
  const info=JSON.parse(docker('info','--format','{{json .}}'));
  assert.equal(info.OSType,'linux');assert(info.NCPU>=2);assert(info.MemTotal>=6*1024**3);assert(os.freemem()>=5*1024**3);
  initialContainers=docker('ps','-aq').split('\n').filter(Boolean).map(id=>inspect('container',id));
  assert(initialContainers.length<=1 && initialContainers.every(c=>c.Name.startsWith(`/buildx_buildkit_${builder}`)),'No pre-existing application resources');
  save('hosted-environment.json',{node:process.version,runnerEnvironment:process.env.RUNNER_ENVIRONMENT,runnerImage:process.env.ImageOS,runnerImageVersion:process.env.ImageVersion,dockerVersion:info.ServerVersion,cpus:info.NCPU,memoryBytes:info.MemTotal,freeBytes:os.freemem(),builder,buildxVersion:docker('buildx','version'),initialContainers:initialContainers.map(c=>({id:c.Id,name:c.Name,image:c.Image}))});
  assert(docker('buildx','build','--help').includes('--resource'),'Buildx must support RUN resource constraints');
  const expected=JSON.parse(run('node',['node_modules/tsx/dist/cli.mjs','-e',"process.stdout.write(JSON.stringify(require('./lib/review-build-provenance').reviewBuildManifest()))"]));
  const product=git('rev-parse',productHead);
  const sourceDifferences=git('diff','--name-only',product,'HEAD').split('\n').filter(Boolean);
  assert(sourceDifferences.length>0 && sourceDifferences.every(f=>f.startsWith('.github/') || transportFiles.includes(f)), 'temporary harness and target transport only');
  assert.equal(git('status','--porcelain'),'','clean source required');
  for(const file of Object.keys(expected.files)) {
    if(transportFiles.includes(file)) {
      const original=git('show',`${transportHead}:${file}`).replaceAll('refs/heads/codex/qualification-873874875-ci',branch);
      assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').trim(),original,file);
    } else assert.equal(git('hash-object',file),git('rev-parse',`${product}:${file}`),file);
  }
  save('source-manifest.json',expected);
  save('product-source-proof.json',{productHead:product,harnessHead:git('rev-parse','HEAD'),sourceDifferences,transportHead,transportFiles,digest:expected.digest,count:Object.keys(expected.files).length});
  report.gates.source=true;
  const probeDir=path.join(dir,'probe');fs.mkdirSync(probeDir,{recursive:true});
  fs.writeFileSync(path.join(probeDir,'Dockerfile'),'FROM node:22-alpine\nCOPY probe.cjs /probe.cjs\nRUN node /probe.cjs > /probe.json\n');
  fs.writeFileSync(path.join(probeDir,'probe.cjs'),`const fs=require('fs'),v8=require('v8');const read=n=>fs.readFileSync('/sys/fs/cgroup/'+n,'utf8').trim();console.log(JSON.stringify({memory:read('memory.max'),swap:read('memory.swap.max'),cpu:read('cpu.max'),pids:read('pids.max'),heap:v8.getHeapStatistics().heap_size_limit,node:process.version,nodeOptions:process.env.NODE_OPTIONS??null}));`);
  const probeImage=build(probeDir,'probe');
  const probe=JSON.parse(capture(probeImage,['cat','/probe.json'],'probe-read'));
  assert.equal(probe.memory,String(4*1024**3));assert.equal(probe.swap,'0');assert.equal(probe.cpu,'200000 100000');assert(probe.heap>=1536*1024**2 && probe.heap<4*1024**3);assert.equal(probe.nodeOptions,null);
  save('effective-build-resources.json',probe);report.gates.resources=true;
  const image=build(root,'canonical-final');report.image=image;save('qualification-progress.json',report);
  const outputScript=`const fs=require('fs'),crypto=require('crypto'),path=require('path');const files={};const h=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');function visit(p){for(const e of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const n=path.join(p,e.name);if(e.isDirectory())visit(n);else if(e.isFile())files[n]=h(n);else throw Error('Unexpected compiled symlink');}}visit('.next');const changed={};for(const f of ['lib/scanner-capacity.ts','lib/scan-destination-filter.ts','lib/review-build-provenance.ts','lib/trade-wishlist.ts'])changed[f]=h(f);console.log(JSON.stringify({manifest:JSON.parse(fs.readFileSync('build-source-manifest.json','utf8')),buildId:fs.readFileSync('.next/BUILD_ID','utf8').trim(),files,changed}));`;
  const compiled=JSON.parse(capture(image,['node','-e',outputScript],'image-proof'));
  assert.deepEqual(compiled.manifest,expected);assert(compiled.buildId);assert(compiled.files['.next/server/middleware.js']);assert(compiled.files['.next/server/middleware-manifest.json']);
  for(const [file,digest] of Object.entries(compiled.changed))assert.equal(digest,expected.files[file]);
  save('final-image-proof.json',{image,buildId:compiled.buildId,compiledFiles:compiled.files,changed:compiled.changed,manifestDigest:compiled.manifest.digest,sourceFiles:Object.keys(compiled.manifest.files).length});report.gates.canonicalFinalImage=true;
  network={name:`${project}-private`};network.id=docker('network','create','--internal','--driver','bridge','--label',label,'--label',`com.docker.compose.project=${project}`,network.name);
  const dbName=`acquisition_filter_${short}`;
  docker('pull','postgres:16-alpine');
  const db=create(['--name',`${project}-postgres`,'--network',network.name,'--network-alias','qualification-db','--memory','384m','--memory-swap','384m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=134217728','-e','POSTGRES_USER=fixture','-e','POSTGRES_PASSWORD=fixture-only','-e',`POSTGRES_DB=${dbName}`,'postgres:16-alpine']);
  docker('start',db);
  const deadline=Date.now()+60_000;
  while(true){const ready=cp.spawnSync('docker',['exec',db,'pg_isready','-U','fixture','-d',dbName],{encoding:'utf8'});if(ready.status===0)break;assert(Date.now()<deadline,'Owned PostgreSQL startup deadline');await sleep(500);}
  const web=create(['--name',`${project}-web`,'--network',network.name,'--memory','1024m','--memory-swap','1024m','--cpus','1','--pids-limit','256','--tmpfs','/app/.local-data:rw,size=33554432','-e',`DATABASE_URL=postgresql://fixture:fixture-only@qualification-db:5432/${dbName}?connection_limit=4`,'-e','RUN_SEED_ON_START=false','-e','WIPE_DB_ON_START=false','-e','MTG_LOCAL_PILOT_TEST=1','-e',`MTG_ISOLATED_QUALIFICATION_RUN=${runId}`,'-e',`ADMIN_USERNAME=ci-admin-${short}`,'-e',`SEED_ADMIN_PASSWORD=${crypto.randomUUID()}`,...['UPLOADS','IMPORTS','EXPORTS','BACKUPS'].flatMap(n=>['-e',`${n}_DATA_PATH=/app/.local-data/${n.toLowerCase()}`]),'-e','SCRYFALL_CONTAINER_DATA_PATH=/app/.local-data/scryfall','-e','NEXT_TELEMETRY_DISABLED=1',image]);
  docker('start',web);const transport=await startProxy(web),baseURL=transport.baseURL;
  report.target={runId,project,...transport,networkName:network.name,web:{id:web,name:`${project}-web`},database:{id:db,name:`${project}-postgres`,host:'qualification-db',databaseName:dbName}};
  const targetPath=path.join(dir,'target.json');save('target.json',report.target);
  const webDeadline=Date.now()+150_000;
  while(true){assert(owned(web).State.Running,'Owned web exited');try{const response=await fetch(`${baseURL}/login`,{signal:AbortSignal.timeout(3000)});if(response.status===200)break;}catch{}assert(Date.now()<webDeadline,'Owned web startup deadline');await sleep(1000);}
  run('node',['node_modules/tsx/dist/cli.mjs','-e',`require('./tests/ui/isolated-qualification-target').loadIsolatedQualificationTarget()`],{env:{MTG_ISOLATED_FIXTURE_MANIFEST:targetPath}});report.gates.isolatedTarget=true;
  const before=snapshot();save('database-before.json',before);
  const config=path.join(dir,'playwright.config.cjs');
  fs.writeFileSync(config,`module.exports=require('@playwright/test').defineConfig({testDir:${JSON.stringify(path.join(root,'tests/ui'))},fullyParallel:false,workers:1,retries:0,forbidOnly:true,timeout:120000,expect:{timeout:10000},reporter:[['list'],['json',{outputFile:${JSON.stringify(path.join(dir,'playwright.json'))}}]],outputDir:${JSON.stringify(path.join(dir,'playwright-results'))},use:{baseURL:${JSON.stringify(baseURL)},trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure'},projects:[{name:'chromium',use:{browserName:'chromium'}}]});\n`);
  run('node',['node_modules/@playwright/test/cli.js','test','--config',config,'tests/ui/trade-proposal-draft.spec.ts'],{log:'actual-browser.log',timeout:9*60_000,env:{MTG_LOCAL_PILOT_TEST:'1',MTG_ISOLATED_FIXTURE_MANIFEST:targetPath,PLAYWRIGHT_BASE_URL:baseURL}});
  const browser=JSON.parse(fs.readFileSync(path.join(dir,'playwright.json'),'utf8'));
  assert.equal(browser.stats.expected,1);assert.equal(browser.stats.unexpected,0);assert.equal(browser.stats.skipped,0);assert.equal(browser.stats.flaky,0);
  assert.deepEqual(snapshot(),before,'Browser synthetic-data cleanup/conservation mismatch');save('database-after.json',snapshot());report.gates.actualBrowser=true;
}
main().catch(error=>{report.status='FAILED';report.error=error.message;console.error(error.message);process.exitCode=1;}).finally(async()=>{
  if(proxy && proxy.exitCode===null && proxy.signalCode===null){
    const stopped=new Promise(resolve=>proxy.once('exit',resolve));proxy.kill('SIGTERM');
    await Promise.race([stopped,sleep(5000)]);
    if(proxy.exitCode===null && proxy.signalCode===null){proxy.kill('SIGKILL');await stopped;}
    save('proxy-cleanup.json',{pid:proxy.pid,exitCode:proxy.exitCode,signal:proxy.signalCode});
    if(proxy.exitCode!==0){report.cleanupError='Owned proxy did not exit cleanly';process.exitCode=1;}
  }
  if(fs.existsSync(path.join(root,'test-results')))fs.cpSync(path.join(root,'test-results'),path.join(dir,'scan-page-screenshots'),{recursive:true});
  for(const id of [...containers].reverse()){
    try{const c=owned(id);run('docker',['logs',id],{log:`owned-${c.Name.slice(1)}.log`});remove(id);}catch(error){report.cleanupError=error.message;process.exitCode=1;}
  }
  if(network){try{const n=inspect('network',network.id);assert.equal(n.Id,network.id);assert.equal(n.Labels?.['mtg-isolated-qualification'],runId);assert.equal(Object.keys(n.Containers??{}).length,0);docker('network','rm',network.id);}catch(error){report.cleanupError=error.message;process.exitCode=1;}}
  try{const remaining=docker('ps','-aq').split('\n').filter(Boolean).map(id=>inspect('container',id).Id).sort();assert.deepEqual(remaining,initialContainers.map(c=>c.Id).sort());report.gates.ownedCleanup=true;}catch(error){report.cleanupError=error.message;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();if(!process.exitCode)report.status='PASS';save('qualification-result.json',report);console.log(JSON.stringify(report));
});
