import { Prisma } from "@prisma/client";
import { acquisitionRefreshPriority } from "./acquisition-processing-priority";

// Eligibility stays with each stage. Apply the same first-result policy before
// the bounded admission window, so old refreshes cannot hide new source rows.
// Share admission across owners, then prioritize and rotate their own runs.
export function acquisitionHandoffQuery(stage: string, eligible: Prisma.Sql) {
  const priority = acquisitionRefreshPriority(Prisma.sql`source."artifactId"`,
    Prisma.sql`source."candidateId"`, Prisma.sql`${stage}`);
  return Prisma.sql`
    WITH ready AS (${eligible}), classified AS (
      SELECT ready.*, ${priority} AS "refreshPriority",
        COALESCE(s."ownerPlayerId", ready."runId") AS "ownerPlayerId",
        COALESCE(t."lastClaimedAt", TIMESTAMP '1970-01-01') AS "runTurn"
      FROM ready
      LEFT JOIN "AcquisitionProcessingJob" source ON source.id=ready.id
      LEFT JOIN "AcquisitionRun" r ON r.id=ready."runId"
      LEFT JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      LEFT JOIN "AcquisitionProcessingTurn" t ON t."runId"=ready."runId" AND t.stage=${stage}
    ), ranked AS (
      SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c."runId"
        ORDER BY c."refreshPriority", c."createdAt", c.id) AS position
      FROM classified c
    ), shared AS (
      SELECT q.*, ROW_NUMBER() OVER (PARTITION BY q."ownerPlayerId"
        ORDER BY q."refreshPriority", q.position, q."runTurn", q."createdAt", q.id) AS "ownerPosition"
      FROM ranked q
    )
    SELECT q.id FROM shared q
    ORDER BY q."ownerPosition", q."runTurn", q."createdAt", q.id LIMIT 32`;
}
