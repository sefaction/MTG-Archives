const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const source = fs.readFileSync(path.join(__dirname, 'trade-concurrency.ts'), 'utf8');
  const tree = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'barrier');
  assert(fn, 'Exercise the actual action-harness barrier');
  let expire;
  const observations = [];
  const context = vm.createContext({observations, scenario:'regression',
    setTimeout: callback => { expire = callback; return 1; },
    clearTimeout: () => { expire = undefined; },
  });
  vm.runInContext(ts.transpileModule(fn.getText(tree), {
    compilerOptions:{target:ts.ScriptTarget.ES2022},
  }).outputText, context);
  return {gate:context.barrier('controlled-read'), observations, expire:() => {
    assert(expire, 'First arrival armed the deadline'); expire();
  }};
}

test('actual barrier accepts two reads arriving before release', async () => {
  const f = fixture();
  await Promise.all([f.gate(), f.gate()]);
  assert.equal(f.observations.length, 1);
  assert.equal(f.observations[0].arrivals, 2);
  assert.equal(f.observations[0].timeout, false);
});

test('actual barrier never classifies a late second arrival as an overlap', async () => {
  const f = fixture();
  const first = f.gate();
  f.expire();
  await first;
  await f.gate();
  assert.equal(f.observations.length, 2);
  assert.equal(f.observations[0].timeout, true);
  assert.equal(f.observations[1].arrivals, 2);
  assert.equal(f.observations[1].timeout, true);
  assert.equal(f.observations.some(o => o.arrivals === 2 && !o.timeout), false);
});
