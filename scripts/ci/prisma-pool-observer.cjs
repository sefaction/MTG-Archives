// Test-only preload: observe construction without changing options, queries or lifetime.
const Module = require('node:module');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
if (process.env.MTG_POOL_OBSERVER !== '846' || !process.env.MTG_POOL_EVENTS) {
  throw new Error('Explicit disposable pool observer target required');
}
const write = event => fs.appendFileSync(process.env.MTG_POOL_EVENTS, JSON.stringify({
  at: Date.now(), pid: process.pid, ...event,
}) + '\n');
write({event: 'process', node: process.version, cpus: os.cpus().length,
  availableParallelism: os.availableParallelism(), production: process.env.NODE_ENV === 'production'});
const originalLoad = Module._load;
const wrappers = new WeakMap();
let constructions = 0;
Module._load = function(request, parent, isMain) {
  const exports = originalLoad.apply(this, arguments);
  if (request !== '@prisma/client') return exports;
  if (!wrappers.has(exports)) {
    const Constructor = exports.PrismaClient;
    const wrapped = new Proxy(Constructor, {
      construct(target, args, newTarget) {
        const client = Reflect.construct(target, args, newTarget === wrapped ? target : newTarget);
        const stack = new Error().stack.split('\n').slice(2);
        const modules = stack.flatMap(frame => {
          const match = /\/app\/(\.next\/server\/[^\s:)]+\.js):(\d+):(\d+)/.exec(frame);
          return match ? [{file:match[1],line:Number(match[2]),column:Number(match[3])}] : [];
        }).slice(0,5);
        write({event: 'client', ordinal: ++constructions, argumentCount: args.length, modules,
          callerHash: crypto.createHash('sha256').update(stack.join('\n')).digest('hex')});
        return client;
      },
    });
    wrappers.set(exports, new Proxy(exports, {get(target, key, receiver) {
      return key === 'PrismaClient' ? wrapped : Reflect.get(target, key, receiver);
    }}));
  }
  return wrappers.get(exports);
};
