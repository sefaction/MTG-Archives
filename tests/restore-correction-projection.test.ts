import assert from "node:assert/strict";
import test from "node:test";
import { assertCorrectionEvidence, verifyCorrectionBackupCapture, type CorrectionRestoreEvidence } from "../scripts/restore-correction-projection";

const old = "2026-10-22T10:00:00.000Z", created = "2026-10-23T10:00:00.100Z", released = "2026-10-23T10:00:00.200Z";
const window = { started: Date.parse("2026-10-23T10:00:00.000Z"), finished: Date.parse("2026-10-23T10:00:01.000Z") };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const before = [{ id: "completed", createdAt: old, releasedAt: old, future: { must: "survive" } },
  { id: "interrupted", createdAt: old, releasedAt: null, future: { must: "survive" } }];
const after = [...before, { id: "new", createdAt: created, releasedAt: released, future: { must: "survive" } }];

test("capture permits one completed guard and preserves all old fields, even future columns", () => {
  assert.equal(verifyCorrectionBackupCapture(before, after, window), "new");
  for (const mutate of [
    (rows: typeof after) => rows.pop(),
    (rows: typeof after) => rows.push({ ...rows[2], id: "unexpected" }),
    (rows: typeof after) => { rows[0].releasedAt = released; },
    (rows: typeof after) => { rows[0].future.must = "changed"; },
    (rows: typeof after) => { rows[2].releasedAt = null; },
    (rows: typeof after) => { rows[2].createdAt = old; },
    (rows: typeof after) => { rows[2].releasedAt = created; rows[2].createdAt = released; },
  ]) { const changed = clone(after); mutate(changed); assert.throws(() => verifyCorrectionBackupCapture(before, changed, window)); }
});

test("source predating correction tables cannot acquire an unexplained guard", () => {
  assert.equal(verifyCorrectionBackupCapture(undefined, undefined, window), null);
  assert.throws(() => verifyCorrectionBackupCapture(undefined, after, window));
});

test("legacy or malformed evidence cannot authorize field omission", () => {
  const valid: CorrectionRestoreEvidence = { version: 1, projection: "postgresql-jsonb-md5-v1",
    tables: { CorrectionLibraryAccount: { rows: 1, digest: "a".repeat(32) } },
    rules: [{ table: "CorrectionLibraryAccount", id: "owner", times: [], oldKeySHA256: "b".repeat(64) }] };
  assertCorrectionEvidence(valid);
  assert.throws(() => assertCorrectionEvidence(undefined as any), /fresh qualified capture/);
  for (const mutate of [
    (value: any) => { delete value.projection; },
    (value: any) => { value.rules[0].times = ["reservedBytes"]; },
    (value: any) => { value.rules.push(clone(value.rules[0])); },
    (value: any) => { value.tables.PrivateUnknown = { rows: 1, digest: "a".repeat(32) }; },
    (value: any) => { value.tables.CorrectionLibraryAccount.rows = -1; },
    (value: any) => { value.rules[0].oldKeySHA256 = "not-a-key-hash"; },
  ]) { const changed = clone(valid); mutate(changed); assert.throws(() => assertCorrectionEvidence(changed)); }
});
