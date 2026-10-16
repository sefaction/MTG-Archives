import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { cleanupCorrectionProgressFixture } from "./ui/correction-progress-fixture";

const owners = ["ui-library-progress-12345678-1234-1234-1234-123456789abc", "ui-library-progress-abcdefab-1234-1234-1234-123456789abc"];
const order = ["release", "auth0", "auth1", "browser", "library0", "user0", "player0", "library1", "user1", "player1"];
function fixture(failures: Record<string, unknown> = {}, closed = false) {
  const seen: string[] = [];
  const step = (key: string) => { seen.push(key); if (Object.hasOwn(failures, key)) throw failures[key]; };
  return {
    seen,
    release: () => step("release"),
    page: { isClosed: () => closed, unrouteAll: async () => step("browser") },
    database: (body: string) => {
      const owner = JSON.parse(body.match(/^const n=(.*?);/)![1]);
      const index = owners.indexOf(owner);
      assert.ok(index >= 0, "Only exact created fixture owners may be passed to the database");
      const kind = body.includes("correctionRetentionPin") ? "library" : body.includes("p.authSession.") ? "auth" : body.includes("p.user.") ? "user" : body.includes("p.player.") ? "player" : "unknown";
      assert.notEqual(kind, "unknown");
      step(kind + index);
    },
  };
}
for (const key of order) test("progress cleanup attempts every later owner/resource after " + key + " failure", async () => {
  const cause = new Error(key), f = fixture({ [key]: cause });
  await assert.rejects(cleanupCorrectionProgressFixture({ ...f, owners, primaryFailed: false }), (error: unknown) => error instanceof AggregateError && assert.deepEqual(error.errors, [cause]) === undefined);
  assert.deepEqual(f.seen, order);
});

test("primary and all cleanup causes preserve exact identities and order", async () => {
  const primary = new Error("workflow"), causes = Object.fromEntries(order.map(key => [key, new Error(key)])), f = fixture(causes);
  await assert.rejects(cleanupCorrectionProgressFixture({ ...f, owners, primaryFailed: true, primaryError: primary }), (error: unknown) => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, ...order.map(key => causes[key])]) === undefined);
  assert.deepEqual(f.seen, order);
});

const source = ts.createSourceFile("fixture.ts", readFileSync("tests/ui/correction-library-progress.spec.ts", "utf8"), ts.ScriptTarget.Latest, true);
const workflows: ts.TryStatement[] = [];
function visit(node: ts.Node) {
  if (ts.isTryStatement(node) && node.finallyBlock && node.tryBlock.getText(source).includes("p.player.create(")) workflows.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(workflows.length, 2);
for (const [index, workflow] of workflows.entries()) test("actual progress catch/finally retains falsy workflow failures and cleanup errors in scenario " + index, async () => {
  assert.ok(workflow.catchClause && workflow.finallyBlock);
  const code = "let primaryFailed=false,primaryError;try{throw injected;}" + workflow.catchClause!.getText(source) + "finally" + workflow.finallyBlock!.getText(source);
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const actual = new AsyncFunction("owners", "owner", "page", "database", "resume", "release", "cleanupCorrectionProgressFixture", "injected", compiled);
  for (const primary of [undefined, null, false, 0, new Error("workflow")]) {
    const browser = new Error("browser"), f = fixture({ browser });
    await assert.rejects(actual(owners, owners[0], f.page, f.database, f.release, f.release, cleanupCorrectionProgressFixture, primary), (error: unknown) => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, browser]) === undefined);
    assert.deepEqual(f.seen, index === 0 ? ["release", "auth0", "browser", "library0", "user0", "player0"] : order);
  }
});

test("invalid owner cannot reach the database or prevent a later valid owner cleanup", async () => {
  const f = fixture();
  await assert.rejects(cleanupCorrectionProgressFixture({ ...f, owners: ["real-owner", owners[1]], primaryFailed: false }), (error: unknown) => error instanceof AggregateError && error.errors.length === 4 && error.errors.every((e: Error) => e.message === "Invalid progress fixture"));
  assert.deepEqual(f.seen, ["release", "auth1", "browser", "library1", "user1", "player1"]);
});

test("closed page skips route drain while database resources remain independent", async () => {
  const f = fixture({}, true);
  await cleanupCorrectionProgressFixture({ ...f, owners, primaryFailed: false });
  assert.deepEqual(f.seen, order.filter(key => key !== "browser"));
});

test("healthy owner teardown releases the pause and fences users before draining routes", async () => {
  const f = fixture();
  await cleanupCorrectionProgressFixture({ ...f, owners, primaryFailed: false });
  assert.deepEqual(f.seen, order);
});

