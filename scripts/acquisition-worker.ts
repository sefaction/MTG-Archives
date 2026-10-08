import { purgeCommittedAcquisitionPhotos, purgeTrashedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
import { purgeAcquisitionPhotosUnderPressure } from "../lib/acquisition-photo-pressure";
import { runCorrectionCaptureOnce, releasePreservedCorrectionPins, collectDeletedCorrectionBlobs,
  cleanCorrectionTemporaries } from "../lib/acquisition-correction-worker";
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
    try {
      const capture = await runCorrectionCaptureOnce(db);
      if (capture.claimed) console.log(JSON.stringify({ event: "correction-original-capture", ...capture }));
    } catch {
      console.error("Correction original capture needs attention; sources remain pinned for retry");
    }
    if (Date.now() >= nextCleanup) {
      nextCleanup = Date.now() + 60000;
      try {
        await releasePreservedCorrectionPins(db);
        await collectDeletedCorrectionBlobs(db);
        await cleanCorrectionTemporaries(db);
      } catch {
        console.error("Correction library maintenance needs attention; ordinary processing will continue");
      }
      const cleanup = await purgeCommittedAcquisitionPhotos(db);
      const trash = await purgeTrashedAcquisitionPhotos(db);
      const pressure = await purgeAcquisitionPhotosUnderPressure(db);
      if (pressure.expired || pressure.purged || pressure.failed)
        console.log(JSON.stringify({event: "acquisition-photo-pressure", ...pressure}));
      if (trash.expired || trash.purged || trash.failed)
        console.log(JSON.stringify({event: "acquisition-trash-expiry", ...trash}));
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
