// #846: hosted-only, fixed ordinary route sequence; never attach to an installation.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cleanupOwnedContainers = require('./prisma-pool-cleanup.cjs');
const root = process.cwd();
assert.equal(process.platform, 'linux');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.GITHUB_REPOSITORY, 'sefaction/MTG-Archives');
assert(!process.env.DATABASE_URL && !process.env.PRICING_DATABASE_URL && !process.env.NODE_OPTIONS);
assert(!process.env.DOCKER_HOST || /^unix:\/\//.test(process.env.DOCKER_HOST));
const dir = path.join(root, '.local-data/prisma-pool');
fs.mkdirSync(dir, {recursive: true});
const runId = crypto.randomUUID(), project = `pool846-${runId.slice(0,8)}`;
const labelKey = 'mtg-pool-investigation', label = `${labelKey}=${runId}`;
const containers = [], images = [];
const report = {runId, status: 'RUNNING', startedAt: new Date().toISOString(), phases: [], failures: []};
const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
const receipts = [];
function run(exe, args, options = {}) {
  const start = Date.now();
  const r = cp.spawnSync(exe, args, {cwd: root, encoding: 'utf8', timeout: options.timeout ?? 60_000,
    maxBuffer: 64 * 1024 * 1024, input: options.input});
  // Commands contain only generated disposable credentials. Do not retain SQL/session tokens.
  receipts.push({exe, command: args[0], elapsedMs: Date.now() - start, exitCode: r.status, signal: r.signal});
  save('commands.json', receipts);
  if (options.log) fs.writeFileSync(path.join(dir, options.log), (r.stdout ?? '') + (r.stderr ?? ''));
  assert.equal(r.status, 0, `${exe} ${args[0]} failed (${r.status ?? r.error?.code}); ${options.log ?? (r.stderr ?? '').slice(-1500)}`);
  return (r.stdout ?? '').trim();
}
const docker = (...args) => run('docker', args);
const git = (...args) => run('git', args);
const inspect = (type, id) => JSON.parse(docker(type, 'inspect', id))[0];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function owned(id) {
  const c = inspect('container', id);
  assert.equal(c.Id, id); assert.equal(c.Config.Labels[labelKey], runId);
  assert(!c.Mounts.some(m => m.Type === 'bind'));
  assert.equal(Object.keys(c.HostConfig.PortBindings ?? {}).length, 0);
  return c;
}
function create(args) {
  const id = docker('create', '--label', label, ...args);
  assert.match(id, /^[a-f0-9]{64}$/); containers.push(id); owned(id); return id;
}
function remove(id) {
  owned(id); docker('rm', '-f', '-v', id); containers.splice(containers.indexOf(id), 1);
}
let network, database, initial = [];
const routes = ['/dashboard', '/inventory', '/locations', '/decks', '/trades', '/wishlist',
  '/notifications', '/public/inventory', '/api/inventory/list',
  '/api/inventory/filter-suggestions?kind=cardName&q=Fixture', '/api/notifications/summary', '/imports/scan', '/imports'];
const fixtureToken = crypto.randomBytes(32).toString('base64url');
const credentialHash = crypto.createHash('sha256').update('fixture-only-unusable-password').digest('hex');
const tokenHash = crypto.createHash('sha256').update(fixtureToken).digest('hex');
function sql(statement) {
  owned(database);
  return docker('exec', database, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'fixture', '-d', 'pool846', '-c', statement);
}
function execNode(web, script) {
  owned(web);
  return run('docker', ['exec', '-i', '-e', 'NODE_OPTIONS=', web, 'node'], {input: script});
}
function topology(web, image) {
  const w = owned(web), n = inspect('network', network);
  assert.equal(w.Image, image); assert(w.State.Running); assert.equal(w.RestartCount, 0);
  assert.equal(n.Id, network); assert.equal(n.Internal, true); assert.equal(n.Labels[labelKey], runId);
  assert.deepEqual(Object.keys(n.Containers).sort(), [database, web].sort());
  assert.equal(Object.keys(w.NetworkSettings.Networks).length, 1);
  assert.equal(w.NetworkSettings.Networks[`${project}-private`].NetworkID, network);
  const processes = JSON.parse(execNode(web, `const fs=require('fs'); console.log(JSON.stringify(fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).flatMap(pid=>{try{const command=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0');return [{pid:Number(pid),kind:command.join(' ').includes('next-server')?'web':command[0]?.endsWith('node')?'node':'other'}]}catch{return []}})));`));
  assert.equal(processes.filter(p => p.kind === 'web').length, 1, 'Exactly one next-server process');
  return {container: web, image, network, processes, restartCount: w.RestartCount};
}
function sample(web, name) {
  const w = owned(web), ip = w.NetworkSettings.Networks[`${project}-private`].IPAddress;
  assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/);
  return {name, at: Date.now(), states: JSON.parse(sql(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT state,count(*)::int AS count FROM pg_stat_activity WHERE backend_type='client backend' AND client_addr='${ip}'::inet GROUP BY state ORDER BY state)t`))};
}
function request(web, route, count = 1) {
  const script = `(async()=>{const r=await Promise.all(Array.from({length:${count}},async()=>{const x=await fetch('http://127.0.0.1:3000'+${JSON.stringify(route)},{headers:{cookie:'mtg_inventory_session=${fixtureToken}'},redirect:'manual',signal:AbortSignal.timeout(20000)});const b=await x.text();if(x.status!==200||b.includes('Internal Server Error'))throw Error('Route status '+x.status);return {status:x.status,bytes:Buffer.byteLength(b)}}));console.log(JSON.stringify(r))})().catch(e=>{console.error(e.name,e.message);process.exitCode=1});`;
  return JSON.parse(execNode(web, script));
}
async function phase(image, observed, name) {
  const url = 'postgresql://fixture:fixture-only@pool-db:5432/pool846?schema=public';
  const web = create(['--name', `${project}-${name}`, '--network', `${project}-private`,
    '--memory', '1024m', '--memory-swap', '1024m', '--cpus', '1', '--pids-limit', '256',
    '--tmpfs', '/app/.local-data:rw,size=67108864', '-e', `DATABASE_URL=${url}`,
    '-e', 'RUN_SEED_ON_START=false', '-e', 'WIPE_DB_ON_START=false', '-e', 'ADMIN_USERNAME=pool-fixture-admin',
    '-e', 'SEED_ADMIN_PASSWORD=fixture-only-random-not-production', '-e', 'NEXT_TELEMETRY_DISABLED=1',
    ...['UPLOADS','IMPORTS','EXPORTS','BACKUPS'].flatMap(key => ['-e', `${key}_DATA_PATH=/app/.local-data/${key.toLowerCase()}`]),
    '-e', 'SCRYFALL_CONTAINER_DATA_PATH=/app/.local-data/scryfall',
    ...(observed ? ['-e', 'NODE_OPTIONS=--require=/app/scripts/ci/prisma-pool-observer.cjs', '-e', 'MTG_POOL_OBSERVER=846', '-e', 'MTG_POOL_EVENTS=/app/.local-data/pool-events.jsonl'] : []), image]);
  const result = {name, image, observed, samples: [], requests: [], routes, poolURLParameters: {connection_limit: null, pool_timeout: null}};
  report.phases.push(result); save('report.json', report);
  docker('start', web);
  const deadline = Date.now() + 120_000;
  while (true) {
    const r = cp.spawnSync('docker', ['exec', '-e', 'NODE_OPTIONS=', web, 'node', '-e', "fetch('http://127.0.0.1:3000/login').then(r=>{if(r.status!==200)process.exitCode=1}).catch(()=>process.exitCode=1)"], {encoding:'utf8', timeout:10_000});
    if (r.status === 0) break;
    assert(owned(web).State.Running && Date.now() < deadline, 'Bounded web startup'); await sleep(500);
  }
  result.topology = topology(web, image);
  // Fixture writes use an isolated explicit client in a short-lived process, then disconnect.
  execNode(web, `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const u=await p.user.upsert({where:{username:'pool-fixture'},create:{username:'pool-fixture',displayName:'Pool Fixture',passwordHash:'fixture-only-unusable-password',player:{create:{name:'Pool Fixture',displayName:'Pool Fixture'}}},update:{}});await p.authSession.upsert({where:{tokenHash:'${tokenHash}'},create:{tokenHash:'${tokenHash}',credentialHash:'${credentialHash}',userId:u.id,expiresAt:new Date(Date.now()+3600000)},update:{}})})().catch(e=>{console.error(e.code);process.exitCode=1}).finally(()=>p.$disconnect());`);
  const poolProbe = execNode(web, `const os=require('os'),{PrismaClient}=require('@prisma/client');const p=new PrismaClient({log:[{level:'info',emit:'event'}]});let capacity=null;p.$on('info',e=>{const m=/Starting a postgresql pool with (\\d+) connections/.exec(e.message);if(m)capacity=Number(m[1])});p.$queryRawUnsafe('SELECT 1').then(()=>console.log(JSON.stringify({capacity,cpus:os.cpus().length,availableParallelism:os.availableParallelism()}))).finally(()=>p.$disconnect());`);
  result.effectiveDefaultPoolProbe = JSON.parse(poolProbe); assert(result.effectiveDefaultPoolProbe.capacity > 0);
  result.samples.push(sample(web, 'before'));
  for (let cycle = 1; cycle <= 3; cycle++) {
    for (const route of routes) {
      result.requests.push({cycle, route, responses: request(web, route)});
      result.samples.push(sample(web, `cycle${cycle}:${route}`)); save('report.json', report);
    }
    // Four concurrent ordinary reads, fixed routes; no synthetic sleeps or held transactions.
    result.requests.push({cycle, route: '/api/inventory/list', responses: request(web, '/api/inventory/list', 4)});
    result.samples.push(sample(web, `cycle${cycle}:burst`));
  }
  await sleep(1500); result.samples.push(sample(web, 'settled'));
  result.finalTopology = topology(web, image);
  assert.deepEqual(result.finalTopology.processes.filter(p=>p.kind==='web'), result.topology.processes.filter(p=>p.kind==='web'));
  if (observed) {
    result.events = JSON.parse(execNode(web, "const fs=require('fs');console.log(JSON.stringify(fs.readFileSync('/app/.local-data/pool-events.jsonl','utf8').trim().split('\\n').map(JSON.parse)));"));
    const webPids = result.topology.processes.filter(p => p.kind === 'web').map(p => p.pid);
    result.webClients = result.events.filter(e => e.event === 'client' && webPids.includes(e.pid));
    assert(result.webClients.length > 0, 'Observer must actually see the compiled web client');
  }
  run('docker', ['logs', web], {log: `${name}-web.log`});
  result.completedAt = new Date().toISOString(); save('report.json', report);
  remove(web);
  assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND client_addr IS NOT NULL"), '0', 'Removed web leaves no clients');
}
(async () => {
  try {
    const endpoint = JSON.parse(docker('context','inspect',docker('context','show'),'--format','{{json .Endpoints.docker.Host}}'));
    assert.match(endpoint, /^unix:\/\//);
    initial = docker('ps','-aq').split('\n').filter(Boolean).map(id => inspect('container',id).Id);
    assert(initial.every(id => inspect('container',id).Name.startsWith(`/buildx_buildkit_${process.env.QUALIFICATION_BUILDER}`)));
    const head = git('rev-parse', 'HEAD'); assert.equal(head, process.env.EXPECTED_SOURCE);
    assert.equal(git('status', '--porcelain'), '');
    report.source = {head, tree: git('rev-parse','HEAD^{tree}'), prismaBlob: git('rev-parse','HEAD:lib/prisma.ts'),
      baseline: 'f32ebffbec91d5488e7e3318510d446bdc3d80d7', dockerfile: git('rev-parse','HEAD:Dockerfile')};
    report.source.historicalPrismaBlob = git('rev-parse', `${report.source.baseline}:lib/prisma.ts`);
    report.source.unchangedFromHistoricalPrisma = report.source.prismaBlob === report.source.historicalPrismaBlob;
    report.source.measurement = 'Current exact source, with and without the forwarding observer';
    assert.equal(git('hash-object','lib/prisma.ts'), report.source.prismaBlob, 'Current source equals selected head');
    assert.equal(report.source.dockerfile, git('rev-parse', `${report.source.baseline}:Dockerfile`));

    const builder = process.env.QUALIFICATION_BUILDER; assert(builder);
    assert(docker('buildx','build','--help').includes('--resource'));
    run('docker', ['buildx','build','--builder',builder,'--load','--resource','memory=4g','--resource','memory-swap=4g',
      '--resource','cpu-period=100000','--resource','cpu-quota=200000','--ulimit','nproc=256:256','--progress','plain',
      '--label',label,'--iidfile',path.join(dir,'image.iid'),'--metadata-file',path.join(dir,'build-metadata.json'),'.'],
      {log:'build.log',timeout:20*60_000});
    const image = fs.readFileSync(path.join(dir,'image.iid'),'utf8').trim(); images.push(image);
    assert.match(image,/^sha256:[a-f0-9]{64}$/); assert.equal(inspect('image',image).Config.Labels[labelKey],runId);
    const buildMetadata=JSON.parse(fs.readFileSync(path.join(dir,'build-metadata.json'),'utf8'));
    const [historyBuilder,historyNode,historyId,...extra]=buildMetadata['buildx.build.ref'].split('/');
    assert.equal(historyBuilder,builder);assert(historyNode.startsWith(builder));assert(historyId && extra.length===0);
    const resourceArgs=buildMetadata['buildx.build.provenance']?.invocation?.parameters?.args;
    assert.equal(resourceArgs?.memory,String(4*1024**3));assert.equal(resourceArgs?.memswap,String(4*1024**3));
    assert.equal(resourceArgs?.cpuperiod,'100000');assert.equal(resourceArgs?.cpuquota,'200000');assert.equal(resourceArgs?.ulimit,'nproc=256:256');
    const history=JSON.parse(docker('buildx','--builder',builder,'history','inspect','--format','json',historyId));
    assert.equal(history.Ref,historyId);assert.equal(history.Status,'completed');save('build-history.json',history);
    report.image = image;
    // Save all compiled server file hashes and constructor-bearing chunks, never compiled source.
    const proof = create(['--network','none','--entrypoint','node',image,'-e', `const fs=require('fs'),c=require('crypto'),p=require('path');const hashes={},constructors=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(e.isFile()){const b=fs.readFileSync(f);hashes[f]=c.createHash('sha256').update(b).digest('hex');if(f.endsWith('.js')&&/new [^;\\n]{0,60}PrismaClient/.test(b.toString()))constructors.push(f)}}}walk('.next/server');console.log(JSON.stringify({hashes,constructors,manifest:JSON.parse(fs.readFileSync('build-source-manifest.json','utf8')),buildId:fs.readFileSync('.next/BUILD_ID','utf8').trim(),prismaHash:c.createHash('sha256').update(fs.readFileSync('lib/prisma.ts')).digest('hex'),versions:{next:require('next/package.json').version,prisma:require('@prisma/client/package.json').version}}));`]);
    const output = docker('start','-a',proof); assert.equal(owned(proof).State.ExitCode,0); remove(proof);
    const compiledProof = JSON.parse(output);
    assert.equal(compiledProof.prismaHash, crypto.createHash('sha256').update(fs.readFileSync('lib/prisma.ts')).digest('hex'), 'Image Prisma source equals exact checkout');
    for(const [name,digest] of Object.entries(compiledProof.manifest.files)) {
      assert(!path.isAbsolute(name) && !name.split('/').includes('..'));
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex'),digest,`Build input ${name}`);
    }
    save('compiled-proof.json',compiledProof);
    network = docker('network','create','--internal','--label',label,`${project}-private`);
    docker('pull','postgres:16-alpine');
    const postgresImage = inspect('image','postgres:16-alpine').Id;
    database = create(['--name',`${project}-db`,'--network',`${project}-private`,'--network-alias','pool-db',
      '--memory','384m','--memory-swap','384m','--cpus','1','--pids-limit','128',
      '--tmpfs','/var/lib/postgresql/data:rw,size=268435456','-e','POSTGRES_USER=fixture',
      '-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=pool846',postgresImage]);
    docker('start',database);
    assert.equal(owned(database).Image, postgresImage);
    const deadline=Date.now()+60_000;
    while(cp.spawnSync('docker',['exec',database,'pg_isready','-U','fixture','-d','pool846']).status!==0){assert(Date.now()<deadline);await sleep(500);}
    report.database={id:database,image:owned(database).Image,maxConnections:Number(sql('SHOW max_connections'))};
    assert.equal(report.database.maxConnections,100);
    await phase(image,false,'current-uninstrumented');
    await phase(image,true,'current-observed');
    assert.equal(git('hash-object','lib/prisma.ts'), report.source.prismaBlob, 'Measured source remains unchanged');
    assert.equal(git('status','--porcelain'), '');
    report.status='MEASURED';
  } catch(e) {report.status='FAILED';report.failures.push({name:e.name,message:e.message});process.exitCode=1;}
  finally {
    cleanupOwnedContainers(containers, {
      collect:id=>{owned(id);run('docker',['logs',id],{log:`cleanup-${id.slice(0,12)}.log`});},
      remove,
      failed:(error,phase,id)=>{report.failures.push({cleanup:error.message,phase,id});process.exitCode=1;},
    });
    if(network)try{const n=inspect('network',network);assert.equal(n.Id,network);assert.equal(n.Labels[labelKey],runId);assert.equal(Object.keys(n.Containers).length,0);docker('network','rm',network);}catch(e){report.failures.push({cleanup:e.message});process.exitCode=1;}
    for(const id of images)try{assert.equal(inspect('image',id).Config.Labels[labelKey],runId);docker('image','rm',id);}catch(e){report.failures.push({cleanup:e.message});process.exitCode=1;}
    try{assert.deepEqual(docker('ps','-aq').split('\n').filter(Boolean).map(id=>inspect('container',id).Id).sort(),initial.sort());report.cleanup=true;}catch(e){report.failures.push({cleanup:e.message});process.exitCode=1;}
    report.finishedAt=new Date().toISOString();save('report.json',report);console.log(JSON.stringify({status:report.status,failures:report.failures,cleanup:report.cleanup}));
  }
})();
