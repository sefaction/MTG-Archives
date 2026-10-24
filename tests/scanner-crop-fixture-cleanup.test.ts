import test from "node:test";
import assert from "node:assert/strict";
import { scannerCropCleanupSource } from "../scripts/ci/scanner-crop-cleanup-source";

const source = scannerCropCleanupSource();
const uuid = "11111111-1111-4111-8111-111111111111", tag = `ui-scanner-${uuid}`;
function fixture(failures: Record<number, unknown> = {}) {
  const seen: string[] = [];
  const cleanup = source.cleanup(sql => {
    assert.ok(sql.includes(JSON.stringify(tag)), "Every action retains the exact owner");
    seen.push(sql.includes("correctionLibraryAccount") ? "sweep" : "legacy");
    if (seen.length in failures) throw failures[seen.length];
    return "{}";
  });
  return { seen, cleanup };
}
const order = ["sweep", "legacy", "sweep"];
for (const step of [1, 2, 3]) test(`actual crop cleanup attempts independent actions after failure ${step}`, () => {
  const cause = Error(`step ${step}`), f = fixture({ [step]: cause });
  assert.throws(() => f.cleanup(tag), (e: unknown) => e instanceof AggregateError && assert.deepEqual(e.errors, [cause]) === undefined);
  assert.deepEqual(f.seen, order);
});
test("actual crop cleanup preserves healthy order and successful replay", () => {
  const f = fixture(); f.cleanup(tag); f.cleanup(tag); assert.deepEqual(f.seen, [...order, ...order]);
});
test("all cleanup causes including falsy values retain their order and identity", () => {
  for (const causes of [[Error("early"), Error("legacy"), Error("late")], [undefined, null, false], [0, "", undefined]]) {
    const f = fixture(Object.fromEntries(causes.map((v, i) => [i + 1, v])));
    assert.throws(() => f.cleanup(tag), (e: unknown) => e instanceof AggregateError && assert.deepEqual(e.errors, causes) === undefined);
    assert.deepEqual(f.seen, order);
  }
});
test("invalid owner refuses before any database action", () => {
  const f = fixture(); assert.throws(() => f.cleanup("real-owner"), AggregateError); assert.deepEqual(f.seen, []);
});
test("actual optical fixture wrapper preserves workflow causes before cleanup causes", async () => {
  for (const primary of [Error("workflow"), undefined, null, false, 0, ""]) {
    const early = Error("early"), late = Error("late"), f = fixture({ 1: early, 3: late });
    await assert.rejects(source.workflow(f.cleanup, () => uuid)({}, async owner => { owner.needsCleanup = true; throw primary; }),
      (e: unknown) => e instanceof AggregateError && assert.deepEqual(e.errors, [primary, early, late]) === undefined);
    assert.deepEqual(f.seen, order);
  }
});
test("successful cleanup preserves the original thrown workflow value", async () => {
  for (const primary of [Error("workflow"), undefined, null, false, 0, ""]) {
    const f = fixture(); let thrown = false;
    try { await source.workflow(f.cleanup, () => uuid)({}, async owner => { owner.needsCleanup = true; throw primary; }); }
    catch (error) { thrown = true; assert.equal(error, primary); }
    assert.equal(thrown, true); assert.deepEqual(f.seen, order);
  }
});
test("unstarted fixture preserves the existing no-cleanup guard", async () => {
  const f = fixture(), primary = Error("before first write");
  await assert.rejects(source.workflow(f.cleanup, () => uuid)({}, async () => { throw primary; }), e => e === primary);
  assert.deepEqual(f.seen, []);
});
test("successful original wrapper returns after all original cleanup actions", async () => {
  const f = fixture(); await source.workflow(f.cleanup, () => uuid)({}, async owner => { owner.needsCleanup = true; }); assert.deepEqual(f.seen, order);
});
