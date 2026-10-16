import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const file = ts.createSourceFile("fixture.ts", readFileSync("tests/ui/correction-original-retry.spec.ts", "utf8"), ts.ScriptTarget.Latest, true);
let statement: ts.TryStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isTryStatement(node) && node.finallyBlock) statement = node;
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(statement?.finallyBlock && statement.catchClause);
const body = statement.finallyBlock.getText(file).slice(1, -1);
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const actualFinally = new AsyncFunction("page", "database", "owner", "primaryError", "primaryFailed", compile(body));
const run = (page: unknown, database: unknown, owner: string, primaryError: unknown) => actualFinally(page, database, owner, primaryError, primaryError !== undefined);
const owner = "ui-original-retry-12345678-1234-1234-1234-123456789abc";
const order = ["auth", "browser", "user", "player"];

function fixture(failures: Record<string, Error> = {}, closed = false) {
  const seen: string[] = [];
  const page = { isClosed: () => closed, unrouteAll: async () => { seen.push("browser"); if (failures.browser) throw failures.browser; } };
  const database = (sql: string) => {
    const id = JSON.parse(sql.match(/^const n=(.*?);/)![1]);
    assert.equal(id, owner);
    const kind = sql.includes("p.authSession.") ? "auth" : sql.includes("p.user.") ? "user" : sql.includes("p.player.") ? "player" : "unknown";
    assert.notEqual(kind, "unknown");
    seen.push(kind);
    if (failures[kind]) throw failures[kind];
    return "";
  };
  return { page, database, seen };
}

for (const step of order) test("actual original-retry finally attempts later resources after " + step + " failure", async () => {
  const cause = new Error("controlled " + step), f = fixture({ [step]: cause });
  await assert.rejects(run(f.page, f.database, owner, undefined), (error: unknown) => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === cause);
  assert.deepEqual(f.seen, order);
});

test("all original and cleanup causes retain identity and order", async () => {
  const primary = new Error("controlled primary"), causes = Object.fromEntries(order.map(step => [step, new Error("controlled " + step)])), f = fixture(causes);
  await assert.rejects(run(f.page, f.database, owner, primary), (error: unknown) => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, ...order.map(step => causes[step])]) === undefined);
  assert.deepEqual(f.seen, order);
});

test("actual catch preserves the workflow failure while finally still attempts teardown", async () => {
  const primary = new Error("controlled workflow"), browser = new Error("controlled browser"), f = fixture({ browser });
  const code = "let primaryFailed = false;let primaryError;try{throw injected;} " + statement!.catchClause!.getText(file) + " finally " + statement!.finallyBlock!.getText(file);
  const actual = new AsyncFunction("page", "database", "owner", "injected", compile(code));
  await assert.rejects(actual(f.page, f.database, owner, primary), (error: unknown) => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, browser]) === undefined);
  assert.deepEqual(f.seen, order);
});

test("closed-page cleanup skips route drain but retires all owned database identities", async () => {
  const f = fixture({}, true);
  await run(f.page, f.database, owner, undefined);
  assert.deepEqual(f.seen, ["auth", "user", "player"]);
});

test("invalid owner prevents every database mutation while browser cleanup is attempted", async () => {
  const f = fixture();
  await assert.rejects(run(f.page, f.database, "real-owner", undefined), (error: unknown) => error instanceof AggregateError && error.errors.length === 3 && error.errors.every((cause: Error) => cause.message === "Invalid fixture"));
  assert.deepEqual(f.seen, ["browser"]);
});

test("healthy teardown completes all four resources", async () => {
  const f = fixture();
  await run(f.page, f.database, owner, undefined);
  assert.deepEqual(f.seen, order);
});


test("falsy workflow causes are retained together with later browser cleanup failure", async () => {
  const source = "let primaryFailed = false;let primaryError;try{throw injected;} " + statement!.catchClause!.getText(file) + " finally " + statement!.finallyBlock!.getText(file);
  const actual = new AsyncFunction("page", "database", "owner", "injected", compile(source));
  for (const primary of [undefined, null, false, 0]) {
    const browser = new Error("controlled browser"), f = fixture({browser});
    await assert.rejects(actual(f.page, f.database, owner, primary), (error: unknown) => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, browser]) === undefined);
    assert.deepEqual(f.seen, order);
  }
});
