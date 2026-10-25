import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as ownedFixtureFiles from './ui/owned-fixture-files.ts';

// Execute the real catch/finally, replacing only the expensive optical/browser
// workflow with a controlled failure. Database and browser calls are adapters.
for (const file of [
  'acquisition-processing-recovery.spec.ts',
  'acquisition-quick-finish.spec.ts',
  'acquisition-stamp-visibility.spec.ts',
]) {
  const source = fs.readFileSync(new URL('./ui/' + file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (ts.isTryStatement(node) && node.finallyBlock &&
        /Block new authenticated polling|Browser cleanup unavailable/.test(node.finallyBlock.getText(tree))) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1, 'Bind exactly the actual workflow try/catch/finally');
  const statement = matches[0];
  const declaration = statement.parent.statements.find(node =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some(item =>
      item.name.getText(tree) === 'workflowFailures'));
  const code = ts.transpileModule(
    (declaration ? declaration.getText(tree) : '') + '\ntry { await workflow(); }' +
    source.slice(statement.tryBlock.end, statement.end),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const stamp = file.includes('stamp');
  const expected = stamp
    ? ['early-feedback', 'leave-review', 'write-report', 'acquisition-teardown', 'late-feedback']
    : ['early-feedback', 'unroute', 'leave-review', 'acquisition-teardown', 'late-feedback'];
  // Stamp's existing best-effort page navigation logs and swallows its error.
  const reportedSteps = expected.filter(step => !stamp || step !== 'leave-review');

  async function exercise(options = {}) {
    const { workflowFails = false, faults = new Map(), closed = false } = options;
    const primary = Object.hasOwn(options, 'primary') ? options.primary : new Error('workflow');
    const calls = [];
    let sweep = 0;
    function step(name) {
      calls.push(name);
      if (faults.has(name)) throw faults.get(name);
    }
    const context = {
      ...ownedFixtureFiles,
      AggregateError, console: { log() {} },
      workflow: async () => { if (workflowFails) throw primary; },
      tag: 'ui-controlled-review-00000000-0000-0000-0000-000000000000',
      printings: [{ id: 'owned-printing' }], cleanupCorrectionFixture: 'original-feedback',
      cancelAndCleanCorrectionFixture: () => 'owned-feedback:',
      page: { isClosed: () => closed, unrouteAll: async () => step('unroute'), goto: async () => step('leave-review') },
      process: { env: { MTG_ACQUISITION_STAMP_EDGE_REPORT: 'owned-report' } },
      started: 0, evidence: {}, writeFileSync: () => step('write-report'),
      database: body => step(body.startsWith('owned-feedback:')
        ? (++sweep === 1 ? 'early-feedback' : 'late-feedback') : 'acquisition-teardown'),
    };
    let error, threw = false;
    try { await vm.runInNewContext('(async()=>{' + code + '})()', context); }
    catch (caught) { threw = true; error = caught; }
    return { calls, error, threw };
  }

  for (const step of reportedSteps) test(`${file}: workflow failure survives ${step} failure`, async () => {
    const primary = new Error('original assertion');
    const secondary = new Error(step);
    const result = await exercise({ workflowFails: true, primary, faults: new Map([[step, secondary]]) });
    assert.deepEqual(result.calls, expected);
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors, [primary, secondary]);
  });
  for (const primary of [undefined, null, false, 0, '']) test(`${file}: preserves falsy workflow throw ${String(primary)}`, async () => {
    const secondary = new Error('cleanup');
    const faults = new Map([['acquisition-teardown', secondary]]);
    const result = await exercise({ workflowFails: true, primary, faults });
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors, [primary, secondary]);
  });
  for (const primary of [undefined, null, false, 0, '']) test(`${file}: healthy cleanup preserves exact falsy throw ${String(primary)}`, async () => {
    const result = await exercise({ workflowFails: true, primary });
    assert.deepEqual(result.calls, expected);
    assert.equal(result.threw, true);
    assert.equal(result.error, primary);
  });
  test(`${file}: retains ordered simultaneous workflow and cleanup failures`, async () => {
    const primary = new Error('workflow');
    const faults = new Map(reportedSteps.map((name, index) => [name, index % 2 ? undefined : new Error(name)]));
    const result = await exercise({ workflowFails: true, primary, faults });
    assert.deepEqual(result.calls, expected);
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors, [primary, ...faults.values()]);
  });
  test(`${file}: healthy cleanup rethrows the exact original error`, async () => {
    const primary = new Error('workflow');
    const result = await exercise({ workflowFails: true, primary });
    assert.deepEqual(result.calls, expected);
    assert.equal(result.threw, true);
    assert.equal(result.error, primary);
  });
  test(`${file}: cleanup-only errors have no invented workflow cause`, async () => {
    const secondary = new Error('cleanup');
    const result = await exercise({ faults: new Map([['early-feedback', secondary]]) });
    assert.deepEqual(result.calls, expected);
    assert.deepEqual(result.error.errors, [secondary]);
  });
  test(`${file}: healthy workflow and cleanup succeed`, async () => {
    const result = await exercise();
    assert.deepEqual(result.calls, expected);
    assert.equal(result.threw, false);
  });
  test(`${file}: closed page still attempts all non-browser cleanup`, async () => {
    const primary = new Error('workflow');
    const secondary = new Error('cleanup');
    const result = await exercise({ closed: true, workflowFails: true, primary, faults: new Map([['early-feedback', secondary]]) });
    assert.deepEqual(result.calls, expected.filter(name => !['unroute', 'leave-review'].includes(name)));
    assert.deepEqual(result.error.errors, [primary, secondary]);
  });
}
