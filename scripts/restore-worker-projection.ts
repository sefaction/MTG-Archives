import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export type RestoreWorkerEvidence = {
  version: 1;
  jobs: { runningIds: string[]; rows: number; digest: string };
  lookups: { runningIds: string[]; rows: number; digest: string };
};

// Full JSON rows preserve every field, including future schema additions.
// Only originally RUNNING rows undergo the defined restore transformation.
async function projected(db: PrismaClient, table: "AcquisitionProcessingJob" | "AcquisitionCatalogLookup", runningIds?: string[]) {
  const jobs = table === "AcquisitionProcessingJob";
  const records = await db.$queryRawUnsafe<Array<{ row: Record<string, any> }>>(`SELECT to_jsonb(t) AS row FROM public."${table}" t ORDER BY ${jobs ? "id" : "key"}`);
  const ids = runningIds ?? records.filter(({ row }) => row.status === "RUNNING").map(({ row }) => row[jobs ? "id" : "key"] as string);
  const running = new Set(ids);
  const hash = createHash("sha256");
  for (const { row } of records) {
    if (running.has(row[jobs ? "id" : "key"])) {
      const status = jobs && row.attempts >= row.maxAttempts ? "FAILED" : "PENDING";
      if (runningIds) {
        assert.equal(row.status, status);
        assert.equal(row.leaseToken, null);
        assert.equal(row.leaseExpiresAt, null);
        assert.ok(row.updatedAt);
        if (jobs) {
          assert.equal(row.errorCode, "RESTORE_INTERRUPTED");
          assert.equal(row.availableAt, row.updatedAt);
        } else assert.equal(row.expiresAt, null);
      }
      row.status = status;
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      row.updatedAt = "restore-transaction-time";
      if (jobs) { row.errorCode = "RESTORE_INTERRUPTED"; row.availableAt = "restore-transaction-time"; }
      else row.expiresAt = null;
    }
    hash.update(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).update("\n");
  }
  assert.equal(ids.filter(id => records.some(({ row }) => row[jobs ? "id" : "key"] === id)).length, ids.length);
  return { runningIds: ids, rows: records.length, digest: hash.digest("hex") };
}

export async function captureRestoreWorkers(db: PrismaClient): Promise<RestoreWorkerEvidence> {
  return { version: 1, jobs: await projected(db, "AcquisitionProcessingJob"), lookups: await projected(db, "AcquisitionCatalogLookup") };
}

export async function verifyRestoredWorkers(db: PrismaClient, evidence: RestoreWorkerEvidence) {
  assert.equal(evidence.version, 1);
  assert.deepEqual(await projected(db, "AcquisitionProcessingJob", evidence.jobs.runningIds), evidence.jobs);
  assert.deepEqual(await projected(db, "AcquisitionCatalogLookup", evidence.lookups.runningIds), evidence.lookups);
}
