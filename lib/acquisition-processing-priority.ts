import { Prisma } from "@prisma/client";

// First results for an immutable input precede model/revision refreshes of that
// same input. Retakes have a new artifact and regain first-result priority.
// Derive this from durable evidence, independently for each processing stage.
export function acquisitionRefreshPriority(
  artifactId: Prisma.Sql, candidateId: Prisma.Sql, stage: Prisma.Sql,
) {
  return Prisma.sql`CASE WHEN EXISTS (
    SELECT 1 FROM "AcquisitionProcessingJob" previous
    WHERE previous."artifactId"=${artifactId} AND previous."candidateId"=${candidateId}
      AND previous.stage=${stage} AND previous.status='COMPLETE'
  ) THEN 1 ELSE 0 END`;
}
