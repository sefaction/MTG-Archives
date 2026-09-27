import { confirmStrongAcquisitionMatches } from "../lib/acquisition-auto-confirm";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";
import {
  enqueueReadyRecognition,
  loadAcquisitionRecognitionSnapshot,
  recognizeAcquisitionPhoto,
  RECOGNITION_STAGE,
} from "../lib/acquisition-recognition-worker";
import { runAcquisitionJobsOnce } from "../lib/acquisition-jobs";
const db = new PrismaClient();
const nativeWorker = new AcquisitionNativeStream("python", [
  "/app/tools/acquisition-runtime/recognize.py",
  "--stream",
]);
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
async function main() {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw new Error(
      "Use the isolated Linux runtime with native privilege separation",
    );
  const descriptor = z
    .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(
      await runAcquisitionNativeProcess(
        "python",
        ["/app/tools/acquisition-runtime/recognize.py", "--describe"],
        Buffer.alloc(0),
        AbortSignal.timeout(30000),
      ),
    );
  const snapshot = await loadAcquisitionRecognitionSnapshot(db);
  const workerId = `recognition-${randomUUID()}`;
  console.log(
    JSON.stringify({
      event: "recognition-ready",
      model: descriptor.digest,
      catalog: snapshot.digest,
      cards: snapshot.index.cards,
    }),
  );
  do {
    await enqueueReadyRecognition(db, snapshot.digest, descriptor.digest);
    const result = await runAcquisitionJobsOnce(
      db,
      {
        [RECOGNITION_STAGE]: (job, signal) =>
          recognizeAcquisitionPhoto(
            job,
            signal,
            snapshot,
            descriptor.digest,
            nativeWorker,
          ),
      },
      workerId,
      { timeoutMs: 45000, leaseMs: 90000 },
    );
    const confirmed = await confirmStrongAcquisitionMatches(db);
    if (confirmed)
      console.log(
        JSON.stringify({ event: "recognition-confirmed", count: confirmed }),
      );
    if (result.claimed)
      console.log(JSON.stringify({ event: "recognition-stage", ...result }));
    if (!stopped && !process.argv.includes("--once"))
      await setTimeout(result.claimed ? 100 : 1000);
  } while (!stopped && !process.argv.includes("--once"));
}
main()
  .catch(() => {
    console.error(
      "Recognition worker stopped; inspect local catalog/models/database availability",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    nativeWorker.close();
    return db.$disconnect();
  });
