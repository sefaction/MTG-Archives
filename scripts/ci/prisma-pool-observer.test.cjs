const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./prisma-pool-observer.cjs'), 'utf8');
test('observer preserves constructors, options, subclass identity and methods without retaining instances or sensitive inputs', () => {
  const events = [], calls = [];
  class Client { constructor(...args) {calls.push(args);} method() {return this;} }
  const exports = {PrismaClient: Client, Prisma: {version:'fixture'}};
  const mod = {_load: request => request === '@prisma/client' ? exports : 'ordinary module'};
  const context = {process:{pid:11, version:'v22', env:{MTG_POOL_OBSERVER:'846', MTG_POOL_EVENTS:'/fixture', NODE_ENV:'production'}},
    require: name => ({'node:module':mod,'node:fs':{appendFileSync:(_p,s)=>events.push(JSON.parse(s))},
      'node:crypto':require('node:crypto'),'node:os':require('node:os')})[name]};
  vm.runInNewContext(source, context);
  const first = mod._load('@prisma/client'), second = mod._load('@prisma/client');
  assert.equal(first, second); assert.equal(first.Prisma, exports.Prisma);
  const options = {datasources:{db:{url:'sensitive-fixture-only'}},log:[]};
  const client = new first.PrismaClient(options);
  assert.equal(calls[0][0], options); assert.equal(client.method(), client); assert(client instanceof Client);
  class Derived extends first.PrismaClient {}
  assert(new Derived() instanceof Derived);
  assert.equal(mod._load('ordinary'), 'ordinary module');
  assert.equal(events.filter(e=>e.event==='client').length,2);
  assert(!JSON.stringify(events).includes('sensitive-fixture-only'));
  assert.equal(events[1].argumentCount,1);
});
test('observer refuses implicit targets', () => {
  assert.throws(()=>vm.runInNewContext(source,{require,process:{env:{}}}),/Explicit disposable/);
});
