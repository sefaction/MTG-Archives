import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { cancelAndCleanCorrectionFixture } from "./ui/correction-fixture";

const file = ts.createSourceFile("scanner-native.spec.ts", readFileSync("tests/ui/scanner-native.spec.ts", "utf8"), ts.ScriptTarget.Latest, true);
let cleanup: ts.TryStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isTryStatement(node) && node.finallyBlock?.getText(file).includes("const cleanupErrors") && node.finallyBlock.getText(file).includes("Owned fixture helper still running")) { cleanup = node; return; }
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(cleanup?.catchClause && cleanup.finallyBlock, "Execute the actual native fixture catch/finally");
const final = cleanup.finallyBlock.getText(file), caught = cleanup.catchClause.getText(file);
const compile = (body: string) => ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const names = ["database", "cancelAndCleanCorrectionFixture", "tag", "child", "writeFileSync", "helper", "process", "path", "agentId", "rmSync", "log", "setTimeout"];
const run = new AsyncFunction(...names, "primaryFailed", "primaryError", compile(final.slice(1, -1)));
const workflow = new AsyncFunction(...names, "injected", compile(`let primaryFailed=false;let primaryError;try{throw injected;} ${caught} finally ${final}`));
const tag = "ui-scanner-native-12345678-1234-1234-1234-123456789abc", agentId = "87654321-1234-1234-1234-123456789abc";
const order = ["early", "stop", "log", "forget", "spool", "legacy", "late"];

function fixture(failures: Record<string, unknown> = {}, live = false, owner = tag) {
  const seen: string[] = []; let sweeps = 0;
  const attempt = (name: string) => { seen.push(name); if (name in failures) throw failures[name]; };
  const database = (sql: string) => {
    assert.ok(sql.includes(JSON.stringify(owner)), "Keep the exact owned identifier in every database action");
    attempt(sql.includes("correctionLibraryAccount") ? (sweeps++ === 0 ? "early" : "late") : "legacy"); return "{}";
  };
  const child = { exitCode: null as number | null, signalCode: null, kill() { attempt("stop"); if (!live) this.exitCode = 0; }, once(_event: string, resolve: () => void) { resolve(); } };
  const write = (name: string) => { assert.equal(name, "test-results/scanner-native-helper.log"); attempt("log"); };
  const helper = (args: string[]) => { assert.deepEqual(args, ["forget", agentId]); attempt("forget"); };
  const local = path.resolve("test-results/unused-native-helper-root");
  const remove = (name: string, options: unknown) => { assert.equal(name, path.join(local, "MTGArchives", "ScannerAgent", agentId)); assert.deepEqual(options, { recursive: true, force: true }); attempt("spool"); };
  return { seen, args: [database, cancelAndCleanCorrectionFixture, owner, child, write, helper, { env: { LOCALAPPDATA: local } }, path, agentId, remove, "controlled log", () => 0] };
}

for (const step of ["early", "legacy", "late"]) test(`actual native cleanup attempts later actions after ${step} fails`, async () => {
  const cause = Error("controlled " + step), f = fixture({ [step]: cause });
  await assert.rejects(run(...f.args, false, undefined), error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === cause);
  assert.deepEqual(f.seen, order);
});
test("actual healthy native cleanup retains its original action order", async () => {
  const f = fixture(); await run(...f.args, false, undefined); assert.deepEqual(f.seen, order);
});
test("actual catch/finally preserves all primary and cleanup causes in order", async () => {
  const primary = Error("workflow"), early = Error("early"), legacy = Error("legacy"), late = Error("late"), f = fixture({ early, legacy, late });
  await assert.rejects(workflow(...f.args, primary), error => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, early, legacy, late]) === undefined);
  assert.deepEqual(f.seen, order);
});
test("successful cleanup preserves the original workflow failure identity", async () => {
  const primary = Error("workflow"), f = fixture(); await assert.rejects(workflow(...f.args, primary), error => error === primary); assert.deepEqual(f.seen, order);
});
test("invalid owner is refused before helper, database and file actions", async () => {
  const f = fixture({}, false, "real-owner"); await assert.rejects(run(...f.args, false, undefined), error => error instanceof AggregateError && error.errors.length === 1); assert.deepEqual(f.seen, []);
});
test("falsy workflow failures remain ahead of cleanup failures", async () => {
  for (const primary of [undefined, null, false, 0]) {
    const early = Error("early"), f = fixture({ early }); await assert.rejects(workflow(...f.args, primary), error => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, early]) === undefined); assert.deepEqual(f.seen, order);
  }
});
test("a live helper keeps its spool and legacy data while final cleanup is attempted", async () => {
  const f = fixture({}, true); await assert.rejects(run(...f.args, false, undefined), error => error instanceof AggregateError && error.errors.length === 1 && /still running; retain its spool/.test(error.errors[0].message)); assert.deepEqual(f.seen, ["early", "stop", "late"]);
});
test("the complete legacy helper, SQL and file-action block is unchanged", () => {
  const block = cleanup!.finallyBlock!.statements.find(node => ts.isTryStatement(node) && node.tryBlock.getText(file).includes("Owned fixture helper still running")) as ts.TryStatement;
  assert.ok(block);
  assert.equal(createHash("sha256").update(block.tryBlock.getText(file).replace(/\r\n/g, "\n")).digest("hex"), "8cc3300406fbb8e5741cbf698c2ea2fed92ff29d096d81cc971228032695cb96");
});
