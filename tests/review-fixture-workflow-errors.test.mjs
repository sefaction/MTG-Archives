import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { cleanupCorrectionFixture } from './ui/correction-fixture.ts';
import * as ownedFiles from './ui/owned-fixture-files.ts';

for (const name of ['capacity-handoff', 'correction-focus', 'save-focus']) {
  const file = `acquisition-${name}.spec.ts`;
  const source = fs.readFileSync(new URL('./ui/' + file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (ts.isTryStatement(node) && node.catchClause && node.finallyBlock &&
        node.catchClause.getText(tree).includes('primaryError = error')) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1, `${file}: bind actual outer workflow boundary`);
  const statement = matches[0];
  const declarations = statement.parent.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(item => ['primaryError', 'primaryFailed'].includes(item.name.getText(tree))));
  const code = ts.transpileModule(declarations.map(node => node.getText(tree)).join('\n') +
    '\ntry { await workflow(); }' + source.slice(statement.tryBlock.end, statement.end),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

  async function exercise(workflowFails, primary, cleanupFails) {
    const secondary = new Error('owned database cleanup');
    let attempted = 0, threw = false, error;
    const context = {
      ...ownedFiles, cleanupCorrectionFixture, AggregateError,
      tag: 'ui-review-fixture-00000000-0000-4000-8000-000000000000', printing: { id: 'owned-card' },
      before: {}, fingerprint: () => ({}), writeFileSync() {}, expect: () => ({ toEqual() {} }),
      test: { info: () => ({ outputPath: value => value }) }, releaseRead() {}, releasePost() {},
      page: { unrouteAll: async () => {}, goto: async () => {}, context: () => ({ clearCookies: async () => {} }) },
      workflow: async () => { if (workflowFails) throw primary; },
      database: () => { attempted++; if (cleanupFails) throw secondary; },
    };
    try { await vm.runInNewContext('(async()=>{' + code + '})()', context); }
    catch (caught) { threw = true; error = caught; }
    return { error, threw, secondary, attempted };
  }

  for (const primary of [new Error('original assertion'), undefined, null, false, 0, '']) {
    test(`${file}: preserves ${String(primary)} before cleanup failure`, async () => {
      const result = await exercise(true, primary, true);
      assert.equal(result.attempted, 1);
      assert.ok(result.error instanceof AggregateError);
      assert.deepEqual(Array.from(result.error.errors), [primary, result.secondary]);
    });
    test(`${file}: healthy cleanup preserves exact ${String(primary)} throw`, async () => {
      const result = await exercise(true, primary, false);
      assert.equal(result.attempted, 1);
      assert.equal(result.threw, true);
      assert.equal(result.error, primary);
    });
  }
  test(`${file}: cleanup-only failure has no invented workflow cause`, async () => {
    const result = await exercise(false, undefined, true);
    assert.equal(result.attempted, 1);
    assert.equal(result.threw, true);
    if (result.error instanceof AggregateError) assert.deepEqual(Array.from(result.error.errors), [result.secondary]);
    else assert.equal(result.error, result.secondary);
  });
  test(`${file}: healthy workflow and cleanup succeed`, async () => {
    const result = await exercise(false, undefined, false);
    assert.equal(result.attempted, 1);
    assert.equal(result.threw, false);
  });
}
