import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const correctionRestoreTables = ["CorrectionBackupGuard", "CorrectionCaptureOutbox",
  "CorrectionLibraryAccount", "CorrectionDeletionTombstone", "CorrectionExample",
  "CorrectionReviewEvent", "CorrectionEvidence", "CorrectionRetentionPin"] as const;
type Row = Record<string, any>;
type Digest = { rows: number; digest: string };
type Rule = { table: string; id: string; times: string[]; oldKeySHA256?: string };
export type CorrectionRestoreEvidence = {
  version: 1;
  projection: "postgresql-jsonb-md5-v1";
  tables: Record<string, Digest>;
  rules: Rule[];
};
export type TimeWindow = { started: number; finished: number };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const transient: Record<string, string[]> = { CorrectionBackupGuard: ["releasedAt"], CorrectionCaptureOutbox: ["availableAt", "updatedAt"],
  CorrectionLibraryAccount: [], CorrectionExample: ["updatedAt"], CorrectionRetentionPin: ["releasedAt"] };
const identifier = (table: string) => { assert.ok((correctionRestoreTables as readonly string[]).includes(table)); return `public."${table}"`; };
function inWindow(value: unknown, window: TimeWindow) {
  const millis = typeof value === "string" ? Date.parse(value) : NaN;
  assert.ok(Number.isFinite(millis) && millis >= window.started && millis <= window.finished,
    "Lifecycle timestamp must belong to this actual operation");
  return millis;
}
async function tables(db: PrismaClient) {
  const present = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  return correctionRestoreTables.filter(table => present.some(row => row.tablename === table));
}
export async function readCorrectionGuards(db: PrismaClient): Promise<Row[] | undefined> {
  if (!(await tables(db)).includes("CorrectionBackupGuard")) return undefined;
  return (await db.$queryRawUnsafe<{ row: Row }[]>(`SELECT to_jsonb(t) AS row FROM public."CorrectionBackupGuard" t ORDER BY id`)).map(value => value.row);
}
/** Existing guards retain every field. Exactly one new released identity is
 * permitted; the archive must subsequently restore that same full row. */
export function verifyCorrectionBackupCapture(before: Row[] | undefined, after: Row[] | undefined, window: TimeWindow) {
  if (!before) { assert.equal(after, undefined); return null; }
  assert.ok(after);
  const old = new Set(before.map(row => row.id));
  const added = after.filter(row => !old.has(row.id));
  assert.equal(added.length, 1, "Backup must create exactly one guard");
  assert.deepEqual(after.filter(row => old.has(row.id)), before, "Existing backup guards changed");
  assert.equal(after.length, before.length + 1);
  const guard = added[0]; assert.equal(typeof guard.id, "string");
  const created = inWindow(guard.createdAt, window), released = inWindow(guard.releasedAt, window);
  assert.ok(released >= created, "Backup must release its completed guard");
  return guard.id as string;
}
export function assertCorrectionEvidence(evidence: CorrectionRestoreEvidence) {
  assert.ok(evidence?.version === 1 && evidence.projection === "postgresql-jsonb-md5-v1",
    "Capture predates correction lifecycle evidence; create a fresh qualified capture");
  for (const [table, value] of Object.entries(evidence.tables)) {
    identifier(table); assert.ok(Number.isSafeInteger(value.rows) && value.rows >= 0); assert.match(value.digest, /^[a-f0-9]{32}$/);
  }
  const seen = new Set<string>();
  for (const rule of evidence.rules) {
    assert.ok(rule.table in evidence.tables && rule.table in transient);
    assert.equal(typeof rule.id, "string"); assert.ok(rule.id.length > 0);
    assert.deepEqual(rule.times, transient[rule.table]);
    const key = JSON.stringify([rule.table, rule.id]); assert.ok(!seen.has(key)); seen.add(key);
    if (rule.table === "CorrectionLibraryAccount") assert.match(rule.oldKeySHA256!, /^[a-f0-9]{64}$/);
    else assert.equal(rule.oldKeySHA256, undefined);
  }
}
// PostgreSQL hashes each complete JSONB row before aggregating its small digest.
// Private payloads and future columns are covered without loading them into Node.
async function digest(db: PrismaClient, table: string, expression = "to_jsonb(t)", where = "true", parameters: unknown[] = []): Promise<Digest> {
  const [value] = await db.$queryRawUnsafe<Digest[]>(`SELECT count(*)::int AS rows,
    md5(coalesce(string_agg(hash,'' ORDER BY hash),'')) AS digest FROM
    (SELECT md5((${expression})::text) AS hash FROM ${identifier(table)} t WHERE ${where}) records`, ...parameters);
  return value;
}
const removal = (photoField: string) => `EXISTS(SELECT 1 FROM public."CorrectionDeletionTombstone" d
  WHERE d."ownerPlayerId"=t."ownerPlayerId" AND d."sourcePhotoId"=t."${photoField}")`;
const restoreTime = "verified-restore-transaction-time";
function normalized(fields: string[]) {
  return `to_jsonb(t)||jsonb_build_object(${fields.flatMap(field => [`'${field}'`, `'${field === "displayKey" ? "verified-rotated-display-key" : restoreTime}'`]).join(",")})`;
}
export async function captureCorrectionRestoreEvidence(db: PrismaClient, capturedGuardId: string | null): Promise<CorrectionRestoreEvidence> {
  const present = await tables(db), rules: Rule[] = [], result: Record<string, Digest> = {};
  const removals = present.includes("CorrectionDeletionTombstone") && present.includes("CorrectionExample");
  for (const table of present) {
    let expression = "to_jsonb(t)", where = "true", changed = "false", parameters: unknown[] = [];
    if (table === "CorrectionBackupGuard") {
      if (capturedGuardId !== null) {
        const rows = await db.$queryRawUnsafe<Row[]>(`SELECT id FROM ${identifier(table)} WHERE id=$1 AND "releasedAt" IS NOT NULL`, capturedGuardId);
        assert.equal(rows.length, 1, "Completed capture guard identity must exist");
      }
      changed = `t."releasedAt" IS NULL OR t.id=$1`; parameters = [capturedGuardId];
      expression = `CASE WHEN ${changed} THEN ${normalized(transient[table])} ELSE to_jsonb(t) END`;
    }
    if (table === "CorrectionCaptureOutbox") {
      changed = `t.status='RUNNING'`;
      expression = `CASE WHEN ${changed} THEN ${normalized(transient[table])}||jsonb_build_object(
        'status','PENDING','leaseToken',NULL,'leaseExpiresAt',NULL,'errorCode','RESTORE_INTERRUPTED') ELSE to_jsonb(t) END`;
    }
    if (table === "CorrectionLibraryAccount") {
      expression = normalized(["displayKey"]); changed = "true";
      if (removals) {
        const sums = ["CorrectionEvidence", "CorrectionReviewEvent", "CorrectionExample"].map(name =>
          `(SELECT coalesce(sum(e."${name === "CorrectionExample" ? "metadataBytes" : "bytes"}"),0)
          FROM ${identifier(name)} e WHERE e."ownerPlayerId"=t."ownerPlayerId" AND NOT EXISTS
          (SELECT 1 FROM public."CorrectionDeletionTombstone" d WHERE d."ownerPlayerId"=e."ownerPlayerId" AND d."sourcePhotoId"=e."sourcePhotoId"))`);
        expression += `||jsonb_build_object('evidenceBytes',${sums.join("+")})`;
      }
    }
    if (removals && table === "CorrectionExample") {
      changed = removal("sourcePhotoId");
      expression = `CASE WHEN ${changed} THEN ${normalized(transient[table])}||jsonb_build_object('deletedAt',
        (SELECT d."deletedAt" FROM public."CorrectionDeletionTombstone" d WHERE d."ownerPlayerId"=t."ownerPlayerId" AND d."sourcePhotoId"=t."sourcePhotoId"),
        'label',NULL,'sourceMetadata',NULL,'metadataBytes',0,'firstEvidenceId',NULL,'labelState','REMOVED') ELSE to_jsonb(t) END`;
    }
    if (removals && ["CorrectionReviewEvent", "CorrectionEvidence"].includes(table)) where = `NOT ${removal("sourcePhotoId")}`;
    if (removals && table === "CorrectionRetentionPin") {
      changed = `t."releasedAt" IS NULL AND ${removal("photoId")}`;
      expression = `CASE WHEN ${changed} THEN ${normalized(transient[table])} ELSE to_jsonb(t) END`;
    }
    result[table] = await digest(db, table, expression, where, parameters);
    if (table in transient) {
      const account = table === "CorrectionLibraryAccount";
      const records = await db.$queryRawUnsafe<Row[]>(`SELECT t."${account ? "ownerPlayerId" : "id"}" AS id${account ? ',t."displayKey"' : ""}
        FROM ${identifier(table)} t WHERE ${changed} ORDER BY 1`, ...parameters);
      for (const row of records) rules.push({ table, id: row.id, times: transient[table], ...(account ? { oldKeySHA256: sha(row.displayKey) } : {}) });
    }
  }
  const evidence = { version: 1 as const, projection: "postgresql-jsonb-md5-v1" as const, tables: result, rules };
  assertCorrectionEvidence(evidence); return evidence;
}

export async function verifyRestoredCorrections(db: PrismaClient, evidence: CorrectionRestoreEvidence, window: TimeWindow) {
  assertCorrectionEvidence(evidence);
  assert.deepEqual((await tables(db)).slice().sort(), Object.keys(evidence.tables).sort(), "Correction tables changed");
  const times = new Set<number>(), keys = new Set<string>();
  for (const table of Object.keys(evidence.tables)) {
    const rules = evidence.rules.filter(rule => rule.table === table), account = table === "CorrectionLibraryAccount";
    const ids = rules.map(rule => rule.id), fields = account ? ["displayKey"] : transient[table] || [];
    if (rules.length) {
      const rows = await db.$queryRawUnsafe<Row[]>(`SELECT t."${account ? "ownerPlayerId" : "id"}" AS id,
        ${fields.map(field => `to_jsonb(t)->>'${field}' AS "${field}"`).join(",")}
        FROM ${identifier(table)} t WHERE t."${account ? "ownerPlayerId" : "id"}"=ANY($1::text[])`, ids);
      assert.equal(rows.length, rules.length, "Every captured lifecycle identity must restore exactly once");
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const rule of rules) {
        const row = byId.get(rule.id); assert.ok(row);
        for (const field of rule.times) times.add(inWindow(row[field], window));
        if (account) {
          assert.match(row.displayKey, /^[a-f0-9]{64}$/);
          assert.notEqual(sha(row.displayKey), rule.oldKeySHA256, "Display credential must rotate");
          assert.ok(!keys.has(row.displayKey), "Restored display credentials must remain distinct"); keys.add(row.displayKey);
        }
      }
    }
    const expression = rules.length ? `CASE WHEN t."${account ? "ownerPlayerId" : "id"}"=ANY($1::text[])
      THEN ${normalized(fields)} ELSE to_jsonb(t) END` : "to_jsonb(t)";
    assert.deepEqual(await digest(db, table, expression, "true", rules.length ? [ids] : []), evidence.tables[table],
      `${table}: every unchanged field and row must match`);
  }
  assert.ok(times.size <= 1, "Every correction fence timestamp must share the restore transaction");
}
