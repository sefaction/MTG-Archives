import type { PrismaClient } from "@prisma/client";
import { claimAcquisitionJobs } from "../lib/acquisition-jobs";

// Tests run on Windows against Linux PostgreSQL. Use the database's observed
// clock for immediate fixture claims, avoiding a cross-clock availability race.
// PostgreSQL rounds timestamp(3) defaults; JS truncates sub-millisecond dates.
// Allow that one millisecond only in fixtures so an immediately inserted job
// cannot appear to be in the future because of this precision difference.
// The real queue, lease CAS and handler remain unchanged.
export async function claimFixtureJobs(
  db: PrismaClient,
  options: Parameters<typeof claimAcquisitionJobs>[1],
) {
  const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return claimAcquisitionJobs(db, options, new Date(clock.now.getTime() + 1));
}
