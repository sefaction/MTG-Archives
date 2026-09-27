import { purgeCommittedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
import { PrismaClient } from "@prisma/client";
import { runAcquisitionJobsOnce } from "../lib/acquisition-jobs";
import { canonicalizeAcquisitionPhoto } from "../lib/acquisition-files";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
const db = new PrismaClient();
const workerId = `photo-${randomUUID()}`;
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
async function main() {
  let nextCleanup = 0;
  do {
    if (Date.now() >= nextCleanup) {
      nextCleanup = Date.now() + 60000;
      const cleanup = await purgeCommittedAcquisitionPhotos(db);
      if (cleanup.purged || cleanup.failed)
        console.log(
          JSON.stringify({ event: "acquisition-photo-expiry", ...cleanup }),
        );
    }
    const result = await runAcquisitionJobsOnce(
      db,
      {
        "photo-canonical-v1": async (job, signal) => {
          const input = z
            .object({
              photoId: z.string().uuid(),
              digest: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .passthrough()
            .parse(job.input);
          return canonicalizeAcquisitionPhoto(
            input.photoId,
            input.digest,
            signal,
          );
        },
      },
      workerId,
    );
    if (result.claimed)
      console.log(JSON.stringify({ event: "acquisition-stage", ...result }));
    if (!process.argv.includes("--once") && !stopped)
      await setTimeout(result.claimed ? 100 : 1000);
  } while (!stopped && !process.argv.includes("--once"));
}
main()
  .catch(() => {
    console.error(
      "Acquisition worker stopped; inspect service/database availability",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
