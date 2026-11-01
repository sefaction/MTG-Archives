import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controlledReviewTarget, verifyControlledReviewTarget} from './ui/controlled-review-target';
test('controlled fixtures bind only to explicitly known local review applications',()=>{
  assert.deepEqual(controlledReviewTarget('mtg-archives-web-1'),{container:'mtg-archives-web-1',baseURL:'http://127.0.0.1:13001',project:'mtg-archives'});
  assert.deepEqual(controlledReviewTarget('mtg-anchor-qualification-web-1'),{container:'mtg-anchor-qualification-web-1',baseURL:'http://127.0.0.1:13011',project:'mtg-anchor-qualification'});
  assert.deepEqual(controlledReviewTarget('mtg-reload308-qualification-web'),{container:'mtg-reload308-qualification-web',baseURL:'http://127.0.0.1:23001',project:'mtg-reload308-qualification'});
});

function fixture(endpoint = 'npipe:////./pipe/docker_engine') {
  const target = controlledReviewTarget('mtg-reload308-qualification-web');
  const web = {id:'a'.repeat(64), name:`/${target.container}`, running:true, project:target.project,
    ports:{'3000/tcp':[{HostIp:'127.0.0.1',HostPort:'23001'}]}};
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    if(args[0] === 'context') return args[1] === 'show' ? 'desktop-linux' : JSON.stringify(endpoint);
    assert.deepEqual(args.slice(0,4), ['container','inspect',target.container,'--format']);
    assert.ok(!args[4].includes('.Env'), 'inspection must not request environment or credentials');
    return JSON.stringify(web);
  };
  return {target, web, calls, run};
}

test('verified target returns the immutable ID using only narrow read-only inspections', () => {
  const f = fixture();
  assert.equal(verifyControlledReviewTarget(f.target, f.run, ''), f.web.id);
  assert.equal(f.calls.length, 3);
});

for (const [name, alter] of [
  ['wrong port', (f: ReturnType<typeof fixture>) => { f.web.ports['3000/tcp'][0].HostPort = '13001'; }],
  ['public IP', (f: ReturnType<typeof fixture>) => { f.web.ports['3000/tcp'][0].HostIp = '0.0.0.0'; }],
  ['different loopback IP', (f: ReturnType<typeof fixture>) => { f.web.ports['3000/tcp'][0].HostIp = '127.0.0.2'; }],
  ['missing binding', (f: ReturnType<typeof fixture>) => { f.web.ports['3000/tcp'] = []; }],
  ['additional binding', (f: ReturnType<typeof fixture>) => { f.web.ports['3000/tcp'].push({HostIp:'::',HostPort:'23001'}); }],
  ['wrong project', (f: ReturnType<typeof fixture>) => { f.web.project = 'another-project'; }],
  ['wrong name', (f: ReturnType<typeof fixture>) => { f.web.name = '/replacement'; }],
  ['invalid ID', (f: ReturnType<typeof fixture>) => { f.web.id = 'short-id'; }],
  ['stopped container', (f: ReturnType<typeof fixture>) => { f.web.running = false; }],
] as const) test(`verification rejects ${name}`, () => {
  const f = fixture(); alter(f);
  assert.throws(() => verifyControlledReviewTarget(f.target, f.run, ''), /Controlled review/);
});

for (const endpoint of ['npipe:////other-host/pipe/docker_engine','npipe://other-host/pipe/docker_engine',
  'unix://other-host/var/run/docker.sock','unix:////other-host/var/run/docker.sock','unix://relative.sock','tcp://127.0.0.1:2375','ssh://host']) {
  test(`verification rejects nonlocal endpoint ${endpoint} as override and context`, () => {
    const f = fixture();
    assert.throws(() => verifyControlledReviewTarget(f.target, f.run, endpoint), /local Docker/);
    assert.equal(f.calls.length, 0);
    const remote = fixture(endpoint);
    assert.throws(() => verifyControlledReviewTarget(remote.target, remote.run, ''), /local Docker/);
    assert.ok(remote.calls.every(args => args[0] === 'context'));
  });
}

for (const endpoint of ['npipe:////./pipe/docker_engine','npipe://localhost/pipe/docker_engine','unix:///var/run/docker.sock'])
  test(`verification accepts matching local context and override ${endpoint}`, () => {
    const f = fixture(endpoint);
    assert.equal(verifyControlledReviewTarget(f.target, f.run, endpoint), f.web.id);
  });

test('local override cannot silently point to a different engine from the inspected context', () => {
  const f = fixture();
  assert.throws(() => verifyControlledReviewTarget(f.target, f.run, 'npipe:////./pipe/other_engine'), /must match/);
  assert.ok(f.calls.every(args => args[0] === 'context'));
});

test('changing a known target URL or project fails before inspecting Docker', () => {
  const f = fixture();
  assert.throws(() => verifyControlledReviewTarget({...f.target, baseURL:'http://example.com:23001'}, f.run, ''), /changed/);
  assert.throws(() => verifyControlledReviewTarget({...f.target, project:'other'}, f.run, ''), /changed/);
  assert.equal(f.calls.length, 0);
});
test('unknown or remote fixture targets are rejected before data operations',()=>{
  for(const value of ['production-web-1','mtg-archives-web-2','http://example.com','ssh://host','', '../mtg-archives-web-1',
    'mtg-reload308-qualification-web-1','mtg-desktop-test-20261021-web-1','http://127.0.0.1:23001'])assert.throws(()=>controlledReviewTarget(value),/supported local/);
});
