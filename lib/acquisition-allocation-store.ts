import { Prisma } from "@prisma/client";

/** Allocation is global even when review/commit loads only one bounded page. */
export async function allocatedAcquisitionCandidates(tx: Prisma.TransactionClient, runId: string,
  target: number | null, physicalIds: string[]) {
  if (!physicalIds.length) return new Set<string>();
  const rows = await tx.$queryRaw<{physicalId: string}[]>(Prisma.sql`
    SELECT "physicalId" FROM (
      SELECT "physicalId", row_number() OVER (ORDER BY "acquisitionOrder", "spatialOrder", "physicalId" COLLATE "C") AS ordinal
      FROM "AcquisitionCandidate" WHERE "runId"=${runId} AND NOT excluded
    ) ranked WHERE "physicalId" IN (${Prisma.join(physicalIds)})
      ${target === null ? Prisma.empty : Prisma.sql`AND ordinal <= ${target}`}`);
  return new Set(rows.map(row => row.physicalId));
}
