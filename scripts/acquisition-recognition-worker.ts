import { REFERENCE_REFINEMENT_STAGE, acquisitionReferenceLineageInputSchema } from "../lib/acquisition-reference-lineage";
import { enqueueReadyReferenceRefinement } from "../lib/acquisition-reference-jobs";
import { recognizeAcquisitionReferenceRefinement } from "../lib/acquisition-reference-worker";
import { CATALOG_RESOLVER_VERSION } from "../lib/acquisition-catalog-status";
import { acquisitionRecognitionVersion } from "../lib/acquisition-recognition-worker";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";
import { observeNativeFailure } from "../lib/acquisition-native-failure";
import {
  enqueueReadyRecognition,
  loadAcquisitionRecognitionSnapshot,
  recognizeAcquisitionPhoto,
  RECOGNITION_STAGE,
} from "../lib/acquisition-recognition-worker";
import { runAcquisitionJobsOnce } from "../lib/acquisition-jobs";
const db = new PrismaClient();
const observeFailure = observeNativeFailure("recognition");
const nativeWorker = new AcquisitionNativeStream("python", [
  "/app/tools/acquisition-runtime/recognize.py",
  "--stream",
  "--prepare",
], undefined, observeFailure);
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
        observeFailure,
      ),
    );
  let snapshot = await loadAcquisitionRecognitionSnapshot(db);
  let snapshotAt=Date.now();
  const refinementEnabled=process.env.ACQUISITION_REFERENCE_REFINEMENT_ENABLED==="1";
  const workerId = `recognition-${randomUUID()}`;
  await nativeWorker.prepare(descriptor.digest, AbortSignal.timeout(30000));
  console.log(
    JSON.stringify({
      event: "recognition-ready",
      model: descriptor.digest,
      catalog: snapshot.digest,
      cards: snapshot.index.cards,
    }),
  );
  do {
    // Initialize models before acquiring a photo's existing processing lease.
    // A killed native process must prepare again before claiming another job.
    await nativeWorker.prepare(descriptor.digest, AbortSignal.timeout(30000));
    if (stopped) break;
    if(refinementEnabled&&Date.now()-snapshotAt>30000){snapshot=await loadAcquisitionRecognitionSnapshot(db);snapshotAt=Date.now();}
    await enqueueReadyRecognition(db, snapshot.digest, descriptor.digest);
    if(refinementEnabled)await enqueueReadyReferenceRefinement(db,descriptor.digest,snapshot.digest);
    const result = await runAcquisitionJobsOnce(
      db,
      {
        ...(refinementEnabled?{[REFERENCE_REFINEMENT_STAGE]:async(job:Parameters<typeof recognizeAcquisitionReferenceRefinement>[1],signal:AbortSignal)=>{
          const input=acquisitionReferenceLineageInputSchema.parse(job.input);
          return recognizeAcquisitionReferenceRefinement(db,job,signal,snapshot,{model:descriptor.digest,catalog:snapshot.digest,
            primaryVersion:acquisitionRecognitionVersion(snapshot.digest,descriptor.digest),referenceModel:input.referenceModel,
            catalogResolver:CATALOG_RESOLVER_VERSION},nativeWorker);
        }}:{}),
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
