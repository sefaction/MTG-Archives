import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("./ui/acquisition-live-recovery.spec.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("live-recovery.ts", source, ts.ScriptTarget.Latest, true);
let cleanup;
function visit(node) {
  if (ts.isTryStatement(node) && node.finallyBlock?.getText(tree).includes("Block new authenticated polling")) cleanup = node.finallyBlock;
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(cleanup, "Exercise the actual live-recovery fixture's outer cleanup");
const code = ts.transpileModule(cleanup.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function exercise(faults = []) {
  const calls = [], failures = [];
  let sweep = 0, running = false;
  const step = name => {
    calls.push(name);
    if (faults.includes(name)) { const error = new Error(name); failures.push(error); throw error; }
  };
  const context = {
    tag: "ui-recovery-00000000-0000-0000-0000-000000000000", worker: "owned-ocr-worker", stopped: true,
    timer: {}, report: {}, console, AggregateError,
    cancelAndCleanCorrectionFixture: owner => "owned-feedback-sweep:" + owner,
    clearInterval: () => step("stop-sampling"),
    docker: (action, name) => { assert.equal(action, "start"); assert.equal(name, "owned-ocr-worker"); step("restore-worker"); running = true; },
    saveReport: () => step("write-report"),
    database: body => step(body.startsWith("owned-feedback-sweep:") ? (++sweep === 1 ? "early-feedback" : "late-feedback") : "acquisition-teardown"),
  };
  let error;
  try { vm.runInNewContext(code, context); } catch (caught) { error = caught; }
  return { calls, running, failures, error };
}

for (const fault of ["early-feedback", "write-report", "acquisition-teardown", "late-feedback"]) {
  test(`live recovery attempts owned worker restoration and all cleanup after ${fault} fails`, () => {
    const result = exercise([fault]);
    assert.ok(result.running, "An early feedback error must not leave the OCR worker stopped");
    assert.deepEqual(result.calls, ["early-feedback", "stop-sampling", "restore-worker", "write-report", "acquisition-teardown", "late-feedback"]);
    assert.ok(result.error, "A cleanup failure remains a failure");
  });
}
test("live recovery retains multiple cleanup failures while attempting worker recovery", () => {
  const result = exercise(["early-feedback", "restore-worker", "write-report", "acquisition-teardown", "late-feedback"]);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, result.failures);
  assert.equal(result.calls.length, 6);
});
test("live recovery normal cleanup restores the worker and completes both feedback sweeps", () => {
  const result = exercise();
  assert.equal(result.error, undefined);
  assert.ok(result.running);
  assert.equal(result.calls.length, 6);
});
