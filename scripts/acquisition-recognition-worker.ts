import {recognitionWorkerFailure,type RecognitionWorkerPhase} from "../lib/acquisition-worker-diagnostics";
import { REFERENCE_REFINEMENT_STAGE } from "../lib/acquisition-reference-lineage";
import { enqueueReadyReferenceRefinement } from "../lib/acquisition-reference-jobs";
import { currentAcquisitionReferenceInput, recognizeAcquisitionReferenceRefinement } from "../lib/acquisition-reference-worker";
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
let phase: RecognitionWorkerPhase = "PRIVILEGES";
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
  phase = "DESCRIBE_MODEL";
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
  phase = "LOAD_CATALOG";
  let snapshot = await loadAcquisitionRecognitionSnapshot(db);
  let snapshotAt=Date.now();
  const refinementEnabled=process.env.ACQUISITION_REFERENCE_REFINEMENT_ENABLED==="1";
  const workerId = `recognition-${randomUUID()}`;
  phase = "PREPARE_NATIVE";
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
    phase = "PREPARE_NATIVE";
    await nativeWorker.prepare(descriptor.digest, AbortSignal.timeout(30000));
    if (stopped) break;
    if(refinementEnabled&&Date.now()-snapshotAt>30000){phase="REFRESH_CATALOG";snapshot=await loadAcquisitionRecognitionSnapshot(db,snapshot);snapshotAt=Date.now();}
    phase = "ADMISSION";
    await enqueueReadyRecognition(db, snapshot.digest, descriptor.digest);
    if(refinementEnabled){phase="REFERENCE_ADMISSION";await enqueueReadyReferenceRefinement(db,descriptor.digest,snapshot.digest);}
    phase = "PROCESSING";
    const result = await runAcquisitionJobsOnce(
      db,
      {
        ...(refinementEnabled?{[REFERENCE_REFINEMENT_STAGE]:async(job:Parameters<typeof recognizeAcquisitionReferenceRefinement>[1],signal:AbortSignal)=>{
          const input=currentAcquisitionReferenceInput(job.input);
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
    if (!stopped && !process.argv.includes("--once")) {
      phase = "IDLE_WAIT";
      await setTimeout(result.claimed ? 100 : 1000);
    }
  } while (!stopped && !process.argv.includes("--once"));
}
main()
  .catch((error: unknown) => {
    console.error(JSON.stringify(recognitionWorkerFailure(phase,error)));
    process.exitCode = 1;
  })
  .finally(async () => {
    try { nativeWorker.close(); } catch (error) {
      console.error(JSON.stringify(recognitionWorkerFailure("SHUTDOWN_NATIVE",error)));
      process.exitCode = 1;
    }
    try { await db.$disconnect(); } catch (error) {
      console.error(JSON.stringify(recognitionWorkerFailure("SHUTDOWN_DATABASE",error)));
      process.exitCode = 1;
    }
  });
