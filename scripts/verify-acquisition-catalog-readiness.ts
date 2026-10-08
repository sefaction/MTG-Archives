import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { enqueueCatalogReconciliation } from "../lib/acquisition-catalog-reconciliation";
import { CATALOG_RECONCILIATION_STAGE, CATALOG_RESOLVER_VERSION } from "../lib/acquisition-catalog-status";

// Only called by the disposable PostgreSQL acquisition verifier. The real
// selector is captured before admission, so this probe cannot create leases.
export async function verifyCatalogReadiness(db: PrismaClient, source: ClaimedAcquisitionJob) {
  let query: Prisma.Sql | undefined;
  await enqueueCatalogReconciliation({ $queryRaw: async (sql: Prisma.Sql) => {
    query = sql; return [];
  }} as unknown as PrismaClient, new Date(), false);
  assert(query);
  const selection = query;
  const select = () => db.$queryRaw<{id: string}[]>(selection);
  const before = await select();
  assert(before.some(row => row.id === source.id), "current recognition source is ready");
  const prefix = "readiness-probe-" + randomUUID();
  const sourceBefore = await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: source.id}});
  const candidateBefore = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: source.candidateId}});
  const stockBefore = await db.inventoryItem.aggregate({_count: {_all: true}, _sum: {quantity: true}});
  try {
    // Unrelated stored source IDs must never suppress current work. Large,
    // distinct synthetic evidence exercises PostgreSQL's toasted JSON path.
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "AcquisitionProcessingJob"
        (id,"runId","artifactId","candidateId","candidateRevision",stage,"versionKey",input,status,output,"createdAt","updatedAt")
      SELECT gen_random_uuid()::text,${source.runId},${source.artifactId},${source.candidateId},${source.candidateRevision},${CATALOG_RECONCILIATION_STAGE},
        ${prefix} || g::text,
        jsonb_build_object('recognitionJobId',gen_random_uuid()::text,'resolverVersion',${CATALOG_RESOLVER_VERSION}),
        'COMPLETE'::"AcquisitionJobStatus",
        jsonb_build_object('catalog',jsonb_build_object('status','UNREADABLE'), 'syntheticEvidence',
          (SELECT string_agg(md5(g::text || ':' || n::text),'') FROM generate_series(1,128) n)),
        now()-interval '3 days',now()
      FROM generate_series(1,4096) g
    `);
    await db.$executeRawUnsafe('ANALYZE "AcquisitionProcessingJob"');
    assert.deepEqual(await select(), before, "unrelated evidence preserves ordered ready sources");
    const plan = await db.$queryRawUnsafe<Array<{"QUERY PLAN": Array<{Plan: unknown}>}>>(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + selection.text, ...selection.values);
    const nodes: Record<string, unknown>[] = [];
    function visit(node: unknown) {
      const value = node as Record<string, unknown>; nodes.push(value);
      for (const child of (value.Plans as unknown[] | undefined) ?? []) visit(child);
    }
    visit(plan[0]["QUERY PLAN"][0].Plan);
    assert(nodes.some(node => node["Index Name"] === "AcquisitionProcessingJob_source_reference_idx"
      && String(node["Index Cond"]).includes("recognitionJobId")),
      "accumulated evidence must use indexed source matching, not repeated full evidence scans");
    const matching = await db.acquisitionProcessingJob.create({data: {
      runId: source.runId, artifactId: source.artifactId, candidateId: source.candidateId,
      candidateRevision: source.candidateRevision, stage: CATALOG_RECONCILIATION_STAGE,
      versionKey: prefix + "matching", status: "COMPLETE", createdAt: new Date(Date.now()-3*86400000),
      input: {recognitionJobId: source.id, resolverVersion: CATALOG_RESOLVER_VERSION},
      output: {catalog: {status: "UNREADABLE"}},
    }});
    assert(!(await select()).some(row => row.id === source.id), "matching unreadable result suppresses retry");
    await db.acquisitionProcessingJob.update({where: {id: matching.id}, data: {output: {catalog: {status: "RESOLVED"}}}});
    assert.deepEqual(await select(), before, "expired resolved result permits reconciliation");
    await db.acquisitionProcessingJob.update({where: {id: matching.id}, data: {createdAt: new Date()}});
    assert(!(await select()).some(row => row.id === source.id), "recent resolved result suppresses retry");
    await db.acquisitionProcessingJob.update({where: {id: matching.id}, data: {
      input: {recognitionJobId: source.id, resolverVersion: "obsolete-readiness-probe"}}});
    assert.deepEqual(await select(), before, "obsolete resolver does not suppress current work");
    await db.acquisitionProcessingJob.update({where: {id: matching.id}, data: {
      status: "PENDING", createdAt: new Date(Date.now()-3*86400000),
      input: {recognitionJobId: source.id, resolverVersion: CATALOG_RESOLVER_VERSION}}});
    assert(!(await select()).some(row => row.id === source.id), "pending matching result suppresses duplicate admission");
    assert.deepEqual(await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: source.id}}), sourceBefore);
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where: {id: source.candidateId}}), candidateBefore);
    assert.deepEqual(await db.inventoryItem.aggregate({_count: {_all: true}, _sum: {quantity: true}}), stockBefore);
    console.log("PASS: catalog source-reference index, complete synthetic evidence, ordered eligibility and suppression windows");
  } finally {
    await db.acquisitionProcessingJob.deleteMany({where: {runId: source.runId, versionKey: {startsWith: prefix}}});
  }
}
