import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,mkdirSync,chmodSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {load,dump} from 'js-yaml';
const require=createRequire(import.meta.url),dotenv=require('dotenv');
const script=readFileSync('scripts/repair-unraid-update-channel.sh','utf8');
const body=script.match(/normalizer=\$\(cat <<'NODE'\r?\n([\s\S]*?)\r?\nNODE\r?\n\)/)?.[1];
assert(body,'Test the exact helper shipped inside the operator repair');
const normalize=(mode,text)=>execFileSync(process.execPath,['-e',body,mode],{input:text,encoding:'utf8',cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
const web='ghcr.io/sefaction/mtg-archives-web:main',ocr='ghcr.io/sefaction/mtg-archives-recognition:main',visual='ghcr.io/sefaction/mtg-archives-visual:main';

test('installed literal/variable image pins become main without changing roles, credentials, storage, replicas or flags',()=>{
  const original={services:{
    web:{image:'ghcr.io/sefaction/mtg-archives-web@sha256:'+'a'.repeat(64),environment:{DATABASE_URL:'private-fixture',WIPE_DB_ON_START:'false'},ports:['13001:3000'],volumes:['/fixture/data:/data']},
    'acquisition-worker':{image:'${WEB_IMAGE}',command:['node','prepare'],deploy:{replicas:1}},
    'acquisition-catalog-worker':{image:'ghcr.io/sefaction/mtg-archives-web:sha-old'},
    'acquisition-model-init':{image:'${ACQUISITION_RECOGNITION_IMAGE:-ghcr.io/sefaction/mtg-archives-recognition:old}',profiles:['init']},
    'acquisition-recognition-worker':{image:'${ACQUISITION_RECOGNITION_IMAGE}',deploy:{replicas:6},volumes:['/existing/models:/models:ro'],networks:['private']},
    'acquisition-visual-worker':{image:'${ACQUISITION_VISUAL_IMAGE}',environment:{DATABASE_URL:'unchanged'},volumes:['/existing/index:/visual/index:ro']},
    'acquisition-printing-worker':{image:'ghcr.io/sefaction/mtg-archives-visual@sha256:'+'b'.repeat(64),mem_limit:'1g'},
    postgres:{image:'postgres:16-alpine',volumes:['/existing/postgres:/var/lib/postgresql/data']},
    maintenance:{image:'ghcr.io/sefaction/mtg-archives-web:old',profiles:['pricing-archive-maintenance'],restart:'no',environment:{ALLOW_ARCHIVE_DELETE:'0'}},
  },networks:{private:{internal:true}}};
  const after=load(normalize('compose',dump(original)));
  const expected=structuredClone(original);
  for(const key of ['web','acquisition-worker','acquisition-catalog-worker','maintenance'])expected.services[key].image=web;
  for(const key of ['acquisition-model-init','acquisition-recognition-worker'])expected.services[key].image=ocr;
  for(const key of ['acquisition-visual-worker','acquisition-printing-worker'])expected.services[key].image=visual;
  for(const [name,service] of Object.entries(expected.services))if(name!=='postgres')service.pull_policy='always';
  assert.deepEqual(after,expected);
  assert.deepEqual(load(normalize('compose',dump(after))),after,'Repair is repeatable');
});
test('environment repair removes duplicate old pins and preserves quoted credentials and unrelated values',()=>{
  const before='# private fixture\nDATABASE_URL="postgresql://private:keep@postgres/app"\nWEB_IMAGE=old\nexport WEB_IMAGE=older\nIMAGE_TAG=old\nACQUISITION_VISUAL_IMAGE=pinned\nPOSTGRES_DATA_PATH=/existing/data\nACQUISITION_VISUAL_MODELS_PATH=/existing/models\nUNRELATED="spaces # and = signs"\n';
  const text=normalize('env',before),parsed=dotenv.parse(text);
  assert.deepEqual(parsed,{...dotenv.parse(before),WEB_IMAGE:web,ACQUISITION_RECOGNITION_IMAGE:ocr,ACQUISITION_VISUAL_IMAGE:visual,IMAGE_TAG:'main'});
  assert.equal(text.match(/^WEB_IMAGE=/gm).length,1);
  assert.equal(normalize('env',text),text);
});
test('custom or missing application definitions fail before installed configuration is changed',()=>{
  for(const input of ['services: {}','services:\n  web:\n    image: example/custom:review'])
    assert.throws(()=>normalize('compose',input));
});
test('malformed private YAML cannot leak credentials through helper errors',()=>{
  const secret='private-fixture-secret-do-not-print';
  try{normalize('compose','services:\n  web:\n    environment: [PASSWORD='+secret+'\n');assert.fail('Malformed fixture should fail');}
  catch(error){assert.doesNotMatch(String(error.stderr),new RegExp(secret));assert.match(String(error.stderr),/Original files are unchanged/);}
});
test('normal flat and opted-in hybrid resolve to moving images with fresh-pull policy; explicit rollback remains possible',()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'mtg-update-channel-'));
  try{
    const base=readFileSync('docker-compose.unraid.flat.env.example','utf8');
    const assets='\nACQUISITION_MODELS_PATH=/fixture/models\nACQUISITION_VISUAL_INDEX_PATH=/fixture/index\nACQUISITION_VISUAL_MODELS_PATH=/fixture/visual-models\nACQUISITION_VISUAL_REFERENCES_PATH=/fixture/references\n';
    const envfile=path.join(folder,'fixture.env');writeFileSync(envfile,base+assets);
    // Remove inherited operator overrides; exercise the shipped channel itself.
    const env={...process.env,COMPOSE_PROFILES:''};
    for(const key of ['WEB_IMAGE','IMAGE_TAG','ACQUISITION_RECOGNITION_IMAGE','ACQUISITION_VISUAL_IMAGE'])delete env[key];
    const args=['compose','--env-file',envfile,'-f','docker-compose.unraid.flat.yml','-f','docker-compose.unraid.hybrid.yml','config','--format','json'];
    const config=JSON.parse(execFileSync('docker',args,{env,encoding:'utf8'}));
    for(const name of ['web','acquisition-worker','acquisition-catalog-worker','acquisition-model-init','acquisition-recognition-worker','acquisition-visual-worker','acquisition-printing-worker']){
      const svc=config.services[name];assert(svc);assert.match(svc.image,/:main$/);assert.equal(svc.pull_policy,'always');
    }
    const override={...env,WEB_IMAGE:'fixture-web:rollback',ACQUISITION_RECOGNITION_IMAGE:'fixture-ocr:rollback',ACQUISITION_VISUAL_IMAGE:'fixture-visual:rollback'};
    const rollback=JSON.parse(execFileSync('docker',args,{env:override,encoding:'utf8'}));
    assert.equal(rollback.services.web.image,'fixture-web:rollback');assert.equal(rollback.services['acquisition-recognition-worker'].image,'fixture-ocr:rollback');
    assert.equal(rollback.services['acquisition-printing-worker'].image,'fixture-visual:rollback');
    for(const name of Object.keys(config.services)){
      const prior={...config.services[name]},next={...rollback.services[name]};delete prior.image;delete next.image;
      assert.deepEqual(next,prior,'Image rollback leaves other configuration intact');
    }
  }finally{assert.equal(path.dirname(path.resolve(folder)),path.resolve(tmpdir()));assert.match(path.basename(folder),/^mtg-update-channel-/);rmSync(folder,{recursive:true,force:true});}
});

test('operator shell preserves files on check/rejection, restores a partial write, and respects another owner',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'mtg-channel-operator-'));
  const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const shellPath=value=>process.platform==='win32'?value.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()):value;
  const bin=path.join(root,'bin');mkdirSync(bin);
  function executable(name,body){const file=path.join(bin,name);writeFileSync(file,body);chmodSync(file,0o755);}
  executable('hostname','#!/bin/sh\nprintf "Horoserve\\n"\n');
  const fake=path.join(root,'docker.cjs');
  writeFileSync(fake,`const fs=require('node:fs'),cp=require('node:child_process'),yaml=require(${JSON.stringify(require.resolve('js-yaml'))});
const args=process.argv.slice(2);
if(args[0]==='image')process.exit(0);
if(args[0]==='run'){const i=args.indexOf('-e');process.stdout.write(cp.execFileSync(process.execPath,['-e',args[i+1],args[i+2]],{input:fs.readFileSync(0),cwd:process.env.MTG_CHANNEL_TEST_CWD}));process.exit(0);}
if(args[0]==='compose'){if(process.env.MTG_CHANNEL_REJECT==='1')process.exit(7);const file=args[args.indexOf('-f')+1],doc=yaml.load(fs.readFileSync(file,'utf8'));if(args.includes('--images'))console.log([...new Set(Object.values(doc.services).map(s=>s.image))].join('\\n'));process.exit(0);}
process.exit(90);`);
  executable('docker',`#!/bin/sh\nexec ${quote(process.execPath.replaceAll('\\','/'))} ${quote(fake.replaceAll('\\','/'))} "$@"\n`);
  executable('mv',`#!/bin/sh\nif [ "\${MTG_CHANNEL_FAIL_WRITE:-0}" = 1 ] && [ "$2" = .env ]; then exit 8; fi\nexec /usr/bin/mv "$@"\n`);
  const before='services:\n  web:\n    image: ghcr.io/sefaction/mtg-archives-web@sha256:'+ 'a'.repeat(64)+'\n    volumes: ["/existing/data:/data"]\n    deploy: {replicas: 6}\n';
  const envBefore='WEB_IMAGE=old\nDATABASE_URL=fixture-secret\nUPLOADS_DATA_PATH=/existing/data\n';
  function run(name,mode,extra={}){
    const project=path.join(root,name);mkdirSync(project);writeFileSync(path.join(project,'compose.yaml'),before);writeFileSync(path.join(project,'.env'),envBefore);
    const local=path.join(root,name+'.sh');
    assert(script.includes('project=/boot/config/plugins/compose.manager/projects/mtg-archives'));
    writeFileSync(local,script.replace('project=/boot/config/plugins/compose.manager/projects/mtg-archives','project='+quote(shellPath(project))));
    if(extra.other){mkdirSync(path.join(project,'.codex-deploy.lock'));writeFileSync(path.join(project,'.codex-deploy.lock','owner'),'fixture-other-owner\n');}
    let failed=false;
    try{execFileSync(shell,['-c','PATH='+quote(shellPath(bin))+':"$PATH"; export PATH; sh '+quote(shellPath(local))+' '+mode],{
      env:{...process.env,MTG_CHANNEL_TEST_CWD:process.cwd(),MTG_CHANNEL_REJECT:extra.reject?'1':'0',MTG_CHANNEL_FAIL_WRITE:extra.failWrite?'1':'0'},encoding:'utf8',stdio:['pipe','pipe','pipe']});}
    catch{failed=true;}
    if(extra.reject||extra.failWrite||extra.other)assert(failed);else assert(!failed);
    if(mode==='--check'||failed){assert.equal(readFileSync(path.join(project,'compose.yaml'),'utf8'),before);assert.equal(readFileSync(path.join(project,'.env'),'utf8'),envBefore);}
    else{const updated=load(readFileSync(path.join(project,'compose.yaml'),'utf8'));assert.equal(updated.services.web.image,web);assert.equal(updated.services.web.deploy.replicas,6);assert.equal(dotenv.parse(readFileSync(path.join(project,'.env'),'utf8')).DATABASE_URL,'fixture-secret');}
    if(extra.other)assert.equal(readFileSync(path.join(project,'.codex-deploy.lock','owner'),'utf8'),'fixture-other-owner\n');
    else{assert(!existsSync(path.join(project,'.codex-deploy.lock')));const backups=readdirSync(project).filter(n=>n.startsWith('main-channel-backup.'));assert.equal(backups.length,1);assert.equal(readFileSync(path.join(project,backups[0],'compose.yaml'),'utf8'),before);}
  }
  try{run('check','--check');run('apply','--apply');run('reject','--apply',{reject:true});run('partial','--apply',{failWrite:true});run('other','--apply',{other:true});}
  finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));assert.match(path.basename(root),/^mtg-channel-operator-/);rmSync(root,{recursive:true,force:true});}
});
