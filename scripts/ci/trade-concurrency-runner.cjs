const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
assert.equal(process.platform,'linux');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_REPOSITORY,'sefaction/MTG-Archives');
assert(!process.env.DATABASE_URL && !process.env.PRICING_DATABASE_URL);
assert(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'));
const root = process.cwd(), out = path.join(root,'.local-data/trade-concurrency');
fs.mkdirSync(out,{recursive:true});
const runId = crypto.randomUUID(), label = `mtg-trade-concurrency=${runId}`;
const owned = [], evidence = {runId,head:process.env.EXPECTED_SOURCE_SHA,eventSha:process.env.GITHUB_SHA,commands:[],cleanup:[],status:'running'};
let network;
function run(exe,args,options={}) {
  const r = cp.spawnSync(exe,args,{encoding:'utf8',timeout:options.timeout ?? 120000,maxBuffer:16*1024*1024,...options});
  evidence.commands.push({exe,args:args.map(x=>/PASSWORD|DATABASE_URL/.test(x)?'<synthetic connection>':x),status:r.status,error:r.error?.code});
  fs.writeFileSync(path.join(out,`${evidence.commands.length}.log`),(r.stdout??'')+(r.stderr??''));
  if(r.status !== 0) throw new Error(`${exe} ${args[0]} failed: ${r.status}; see command log ${evidence.commands.length}`);
  return r.stdout.trim();
}
const docker=(...args)=>run('docker',args);
function inspect(kind,id) {return JSON.parse(docker(kind,'inspect',id))[0];}
function check(id) {const value=inspect('container',id);assert.equal(value.Id,id);assert.equal(value.Config.Labels['mtg-trade-concurrency'],runId);return value;}
function create(args) {const id=docker('create','--label',label,...args);assert.match(id,/^[a-f0-9]{64}$/);owned.push(id);check(id);return id;}
const sourceSha=run('git',['rev-parse','HEAD']);
assert.equal(sourceSha,process.env.EXPECTED_SOURCE_SHA);
assert.equal(run('git',['status','--porcelain']),'','clean source checkout required');
const endpoint=JSON.parse(docker('context','inspect',docker('context','show'),'--format','{{json .Endpoints.docker.Host}}'));
assert.match(endpoint,/^unix:\/\//,'selected Docker context must be local');
evidence.dockerEndpoint=endpoint;
const baseline='f32ebffbec91d5488e7e3318510d446bdc3d80d7';
const helperBaseline='b810f06a18f1e358b970bccf8093e4b1026eeb66';
const helperChanges=run('git',['diff','--name-only',helperBaseline,'HEAD','--','lib','prisma','package.json','package-lock.json','tsconfig.json']).split('\n').filter(Boolean);
assert(helperChanges.every(name=>name === 'lib/trade-proposal.ts'),'old-action control requires unchanged transfer helpers/schema/dependencies');
// The only permitted helper delta adds gift-content validation, which the old
// action does not import. Existing validation-state exports remain unchanged.
if(helperChanges.length) {
  const normalize=text=>text.replace(/\r\n/g,'\n').trim();
  const current=fs.readFileSync('lib/trade-proposal.ts','utf8').replace(/\nexport function hasTradeContents\(offeredCount: number, requestedCount: number\) \{\r?\n  return offeredCount > 0 \|\| requestedCount > 0;\r?\n\}\r?\n/,'\n');
  assert.equal(normalize(current),normalize(run('git',['show',`${helperBaseline}:lib/trade-proposal.ts`])),'baseline proposal helpers must be byte-equivalent after removing the added gift predicate');
}
fs.writeFileSync(path.join(out,'baseline-actions.ts'),run('git',['show',`${baseline}:app/trades/actions.ts`])+'\n');
evidence.sources = Object.fromEntries(['app/trades/actions.ts','scripts/ci/trade-concurrency.ts','scripts/ci/trade-concurrency-runner.cjs','prisma/schema.prisma'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex')]));
try {
  docker('pull','postgres:16'); docker('pull','node:22-bookworm');
  const pgImage=inspect('image','postgres:16').Id, nodeImage=inspect('image','node:22-bookworm').Id;
  evidence.images={pgImage,nodeImage};
  network=docker('network','create','--internal','--label',label,`trade-${runId}`);
  const net=inspect('network',network);assert.equal(net.Internal,true);assert.equal(net.Driver,'bridge');assert.equal(net.Scope,'local');assert.equal(net.Labels['mtg-trade-concurrency'],runId);
  const pg=create(['--network',network,'--network-alias','postgres','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_USER=ci','-e','POSTGRES_PASSWORD=synthetic','-e','POSTGRES_DB=trade_fixture',pgImage]);
  docker('start',pg);
  let ready=false;
  for(let i=0;i<30;i++) {const r=cp.spawnSync('docker',['exec',pg,'pg_isready','-U','ci','-d','trade_fixture'],{encoding:'utf8'});if(r.status===0){ready=true;break;}cp.spawnSync('sleep',['1']);}
  assert(ready,'owned PostgreSQL ready');
  const runTest=(mode)=>{
    // Source and installed dependencies only; never mount laptop/application data.
    const id=create(['--network',network,'--memory','768m','--cpus','2','--pids-limit','256','--mount',`type=bind,src=${root},dst=/source,readonly`,'--tmpfs','/tmp:rw,size=128m','-w','/source','-e','GITHUB_ACTIONS=true','-e','RUNNER_ENVIRONMENT=github-hosted','-e','MTG_TRADE_FIXTURE=1','-e',`SOURCE_SHA=${sourceSha}`,'-e','DATABASE_URL=postgresql://ci:synthetic@postgres:5432/trade_fixture?connection_limit=8','-e',`EXPECT_TRADE_DEFECT=${mode==='baseline'?'1':'0'}`,'-e',`TRADE_ACTION_SOURCE=/source/${mode==='baseline'?'.local-data/trade-concurrency/baseline-actions.ts':'app/trades/actions.ts'}`,'-e','TRADE_REPORT=/tmp/report.json',nodeImage,'sh','-c','./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx scripts/ci/trade-concurrency.ts']);
    const value=check(id); assert.equal(value.HostConfig.NetworkMode,network);assert(value.Mounts.every(m=>m.Type!=='bind'||m.RW===false));assert.deepEqual(value.HostConfig.PortBindings,{});
    let failure;
    try {docker('start','--attach',id);assert.equal(check(id).State.ExitCode,0);}catch(error){failure=error;}
    try {
      const logs=docker('logs',id);
      const report=logs.split('\n').find(line=>line.startsWith('TRADE_REPORT='));
      assert(report,'action report required');
      fs.writeFileSync(path.join(out,`${mode}-report.json`),JSON.stringify(JSON.parse(report.slice('TRADE_REPORT='.length)),null,2));
    }catch(error){failure ??=error;}
    evidence[mode]={container:id,exit:check(id).State.ExitCode};
    if(failure) throw failure;
  };
  runTest('baseline');
  if(process.env.TRADE_FIXED === '1') {
    // Recreate only this run's empty synthetic database; immutable owned target.
    check(pg);docker('exec',pg,'dropdb','-U','ci','trade_fixture');docker('exec',pg,'createdb','-U','ci','trade_fixture');
    runTest('fixed');
  }
  evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);process.exitCode=1;}
finally {
  for(const id of owned.reverse()) {try{check(id);docker('rm','-f','-v',id);assert.equal(docker('ps','-aq','--filter',`id=${id}`),'');evidence.cleanup.push({id,removed:true});}catch(error){evidence.cleanup.push({id,error:String(error)});process.exitCode=1;}}
  if(network){try{const n=inspect('network',network);assert.equal(n.Labels['mtg-trade-concurrency'],runId);assert.equal(Object.keys(n.Containers??{}).length,0);docker('network','rm',network);evidence.cleanup.push({network,removed:true});}catch(error){evidence.cleanup.push({network,error:String(error)});process.exitCode=1;}}
  fs.writeFileSync(path.join(out,'runner.json'),JSON.stringify(evidence,null,2));
}
