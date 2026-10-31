import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Execute the real catch/finally around a controlled workflow; callers retain
// their existing browser/database/filesystem adapters and cleanup fault matrix.
export function compileWorkflowCleanup(source, tree, block, synchronous = false) {
  const statement = block.parent;
  assert.ok(ts.isTryStatement(statement));
  const declaration = statement.parent.statements.find(node =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some(item =>
      item.name.getText(tree) === 'workflowFailures'));
  return ts.transpileModule((declaration ? declaration.getText(tree) : '') +
    '\ntry { ' + (synchronous ? '' : 'await ') + 'workflow(); }' +
    source.slice(statement.tryBlock.end, statement.end),
    {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
}

export function registerWorkflowControls(name, exercise, allFaults) {
  for (const primary of [new Error('original workflow'), undefined, null, false, 0, '']) {
    test(`${name}: workflow cause precedes cleanup failure ${String(primary)}`, async () => {
      const normal = await exercise();
      const result = await exercise(['early-feedback'], {workflowFails: true, primary});
      assert.deepEqual(result.calls, normal.calls);
      assert.ok(result.error instanceof AggregateError);
      assert.deepEqual(result.error.errors, [primary, ...result.failures]);
    });
    test(`${name}: healthy cleanup preserves exact workflow throw ${String(primary)}`, async () => {
      const normal = await exercise();
      const result = await exercise([], {workflowFails: true, primary});
      assert.deepEqual(result.calls, normal.calls);
      assert.equal(result.threw, true);
      assert.equal(result.error, primary);
    });
  }
  test(`${name}: original cause precedes every ordered cleanup failure`, async () => {
    const primary = new Error('original workflow');
    const result = await exercise(allFaults, {workflowFails: true, primary});
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors, [primary, ...result.failures]);
    assert.ok(result.calls.includes('late-feedback') || result.calls.includes('late-3'));
  });
}
