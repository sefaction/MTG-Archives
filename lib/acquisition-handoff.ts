import { Prisma } from "@prisma/client";

// Eligibility stays with each stage. Share the bounded window across ready
// runs before a historical run can consume it; claims keep their
// existing durable turn, lease and authorization fences.
export function acquisitionHandoffQuery(stage: string, eligible: Prisma.Sql) {
  return Prisma.sql`
    WITH ready AS (${eligible}), ranked AS (
      SELECT id, "runId", "createdAt",
        ROW_NUMBER() OVER (PARTITION BY "runId" ORDER BY "createdAt", id) AS position
      FROM ready
    )
    SELECT q.id FROM ranked q
    LEFT JOIN "AcquisitionProcessingTurn" t ON t."runId"=q."runId" AND t.stage=${stage}
    ORDER BY q.position, COALESCE(t."lastClaimedAt", TIMESTAMP '1970-01-01'),
      q."createdAt", q.id LIMIT 32`;
}
