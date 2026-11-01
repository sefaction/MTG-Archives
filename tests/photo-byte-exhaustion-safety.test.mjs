import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/verify-photo-byte-exhaustion.mjs',import.meta.url));
function refuse(extra){
  const env={...process.env};
  delete env.MTG_BYTE_EXHAUSTION_TEST;delete env.MTG_LOCAL_PILOT_TEST;
  return spawnSync(process.execPath,[script],{env:{...env,...extra},encoding:'utf8',windowsHide:true,timeout:10000});
}
test('capacity-fill verifier refuses default invocation before any target access',()=>{
  const r=refuse({});assert.equal(r.status,1);assert.match(r.stderr,/Explicit byte-exhaustion opt-in required/);assert.equal(r.stdout,'');
});
test('capacity-fill verifier refuses a populated alternate path without changing it',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'byte-refusal-'));
  try{fs.writeFileSync(path.join(dir,'neighbor'),'keep');const r=refuse({MTG_BYTE_EXHAUSTION_TEST:'1',MTG_LOCAL_PILOT_TEST:'1',UPLOADS_DATA_PATH:dir});assert.equal(r.status,1);assert.match(r.stderr,/Only the disposable/);assert.deepEqual(fs.readdirSync(dir),['neighbor']);assert.equal(fs.readFileSync(path.join(dir,'neighbor'),'utf8'),'keep');}finally{fs.unlinkSync(path.join(dir,'neighbor'));fs.rmdirSync(dir);}
});
test('capacity-fill verifier refuses a non-fixture database URL without exposing it',()=>{
  const password='synthetic-secret-not-to-print';
  const r=refuse({MTG_BYTE_EXHAUSTION_TEST:'1',MTG_LOCAL_PILOT_TEST:'1',UPLOADS_DATA_PATH:'/byte-space',DATABASE_URL:'postgresql://fixture:'+password+'@example.invalid/actual'});
  assert.equal(r.status,1);assert.match(r.stderr,/Use only the inert fixture database URL/);assert.doesNotMatch(r.stderr,new RegExp(password));assert.equal(r.stdout,'');
});
