import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditRun, deliver, sessionInstruction } from './transport.mjs';

async function fixture(t, count = 2) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mtg-scanner-transport-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ids = [];
  const events = [];
  await writeFile(path.join(root, 'run.json'), JSON.stringify({version: 1, request: {runId: randomUUID()}}));
  for (let i = 0; i < count; i++) {
    const id = randomUUID(); ids.push(id);
    const bytes = Buffer.from(`original-${i}`);
    const a = { id, sequence: i + 1, fileName: `${id}.png`, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(path.join(root, `${id}.png`), bytes);
    await writeFile(path.join(root, `${id}.json`), JSON.stringify(a));
    events.push({sequence: events.length + 1, kind: 'ImageReceived', evidence: a});
  }
  events.push({sequence: events.length + 1, kind: 'AcquisitionCompleted'});
  await writeFile(path.join(root, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));
  return {root, ids, plan: {baseUrl: 'http://127.0.0.1:13001', sessionId: randomUUID(),
    operatorReconciledPhysicalFronts: true, physicalFronts: [ids[0]]}};
}
test('lost upload ACK replays same slot/key/generation; overscan remains intact', async t => {
  const {root, ids, plan} = await fixture(t);
  const slot = randomUUID(), photo = randomUUID();
  const uploadUrls = [];
  let loseAck = true;
  const fetcher = async (url, init) => {
    if (url.pathname.endsWith('/photos')) {
      uploadUrls.push(url.toString());
      if (loseAck) { loseAck = false; throw new Error('ACK lost after server write'); }
      return {ok:true,json:async()=>({id:photo,ready:true,digest:createHash('sha256').update(init.body).digest('hex')})};
    }
    return {ok:true,json:async()=>init.method === 'POST' ? {slot:{id:slot,generation:loseAck?0:1}} : {id:plan.sessionId}};
  };
  await assert.rejects(deliver(root, plan, 'private-cookie', fetcher), /ACK lost/);
  const result = await deliver(root, plan, 'private-cookie', fetcher);
  assert.equal(uploadUrls[0], uploadUrls[1]);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.retainedUnmappedArtifacts, 1);
  assert.equal((await auditRun(root)).artifacts.length, 2);
  assert.equal((await readFile(path.join(root, `${ids[1]}.png`))).toString(), 'original-1');
  await assert.rejects(deliver(root, {...plan, sessionId:randomUUID()}, 'cookie', fetcher), /identity conflict/);
});
test('capacity refusal retains every artifact and produces no fake receipt', async t => {
  const {root, plan} = await fixture(t);
  await assert.rejects(deliver(root, plan, 'cookie', async (_, init) => init.method === 'POST'
    ? {ok:false,status:409} : {ok:true,json:async()=>({id:plan.sessionId})}), /rejected/);
  assert.equal((await auditRun(root)).artifacts.length, 2);
});
test('audit rejects corruption and reports interrupted unpublished image', async t => {
  const {root, ids} = await fixture(t);
  await writeFile(path.join(root, 'interrupted.pending.png'), 'partial');
  assert.deepEqual((await auditRun(root)).unjournaled, ['interrupted.pending.png']);
  await writeFile(path.join(root, `${ids[0]}.png`), 'corrupted');
  await assert.rejects(auditRun(root), /integrity/);
});
test('remote targets and unreconciled physical identity are rejected before HTTP', async t => {
  const {root, plan} = await fixture(t);
  const never = () => { throw new Error('must not call HTTP'); };
  await assert.rejects(deliver(root, {...plan,baseUrl:'http://192.168.1.2'},'cookie',never), /restricted/);
  await assert.rejects(deliver(root, {...plan,operatorReconciledPhysicalFronts:false},'cookie',never), /reconciliation/);
});
test('server target instruction preserves unlimited/remaining state and refuses full/stale capture', async () => {
  const id=randomUUID();
  const result=value=>async()=>({ok:true,json:async()=>({id,phase:'CAPTURING',destinationCurrent:true,availableSlots:value,revision:4})});
  assert.equal((await sessionInstruction('http://127.0.0.1:13001',id,'cookie',result(72))).sessionPhysicalTarget,72);
  assert.equal((await sessionInstruction('http://127.0.0.1:13001',id,'cookie',result(null))).sessionPhysicalTarget,null);
  await assert.rejects(sessionInstruction('http://127.0.0.1:13001',id,'cookie',result(0)),/no available/);
});
