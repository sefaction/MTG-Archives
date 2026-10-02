import { Prisma, type PrismaClient } from "@prisma/client";
import { claimAcquisitionJobs } from "../lib/acquisition-jobs";
import {traceFixtureClaim, type FixtureClaimTrace} from "./acquisition-claim-trace";

export type FixtureClaimDiagnostic = {
  callerStartedAt: Date;
  callerFinishedAt: Date;
  databaseClock: Date;
  effectiveClaimAt: Date;
  claimTrace: FixtureClaimTrace;
  rows: unknown;
};
type ExpectedClaim = {
  candidateId: string;
  onEmpty?: (diagnostic: FixtureClaimDiagnostic) => void;
};
async function snapshot(db: PrismaClient, candidateId: string, stages: string[]) {
  try {
    // Explicit scalar allowlist: no originals, provider input/output, card
    // metadata, account names, credentials or raw lease token enter the log.
    return await db.$queryRaw`
      SELECT j.id, j.stage, j.status, j.attempts, j."maxAttempts", j."availableAt",
        j."createdAt", j."updatedAt", j."candidateRevision", j."leaseExpiresAt",
        (j."leaseToken" IS NOT NULL) AS "leasePresent",
        c.revision AS "currentRevision", c.excluded,
        (c.review IS NOT NULL) AS reviewed,
        EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id) AS committed,
        s.phase, p.active AS "ownerActive", u."isActive" AS "creatorActive",
        u."forcePasswordChange", clock_timestamp() AS "snapshotDatabaseClock",
        COUNT(*) OVER()::integer AS "matchingJobs"
      FROM "AcquisitionProcessingJob" j
      JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
      JOIN "AcquisitionRun" r ON r.id=j."runId"
      JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      JOIN "Player" p ON p.id=s."ownerPlayerId"
      JOIN "User" u ON u.id=s."createdByUserId"
      WHERE j."candidateId"=${candidateId} AND j.stage IN (${Prisma.join(stages)})
      ORDER BY j."createdAt" DESC, j.id DESC LIMIT 32`;
  } catch {
    // Diagnostic failure must not alter the original claim result or hide its
    // acceptance failure. Do not dump a Prisma error containing query values.
    return { unavailable: true };
  }
}
// Tests run on Windows against Linux PostgreSQL. Use the database's observed
// clock for immediate fixture claims, avoiding a cross-clock availability race.
// PostgreSQL rounds timestamp(3) defaults; JS truncates sub-millisecond dates.
// Allow that one millisecond only in fixtures so an immediately inserted job
// cannot appear to be in the future because of this precision difference.
// The real queue, lease CAS and handler remain unchanged.
export async function claimFixtureJobs(
  db: PrismaClient,
  options: Parameters<typeof claimAcquisitionJobs>[1],
  expected?: ExpectedClaim,
) {
  const callerStartedAt = new Date();
  const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const effectiveClaimAt = new Date(clock.now.getTime() + 1);
  const observed = expected ? traceFixtureClaim(db) : null;
  const result = await claimAcquisitionJobs(observed?.client ?? db, options, effectiveClaimAt);
  if (expected && result.length === 0) {
    const diagnostic = {
      callerStartedAt, callerFinishedAt: new Date(), databaseClock: clock.now,
      effectiveClaimAt, claimTrace: observed!.trace,
      rows: await snapshot(db, expected.candidateId, options.stages),
    };
    if (expected.onEmpty) expected.onEmpty(diagnostic);
    else console.error(`ACQUISITION_EXPECTED_CLAIM_EMPTY ${JSON.stringify(diagnostic)}`);
  }
  return result;
}
