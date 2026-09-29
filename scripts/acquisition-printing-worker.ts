import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";
import { runAcquisitionJobsOnce } from "../lib/acquisition-jobs";
import { enqueueReadyPrinting, observeAcquisitionPrinting } from "../lib/acquisition-printing-worker";
import { PRINTING_STAGE } from "../lib/acquisition-printing";

const db = new PrismaClient();
const program = "/app/tools/acquisition-runtime/printing_worker.py";
const native = new AcquisitionNativeStream("python", [program, "--stream"], 10 * 1024 * 1024 + 65536);
let stopped = false;
process.on("SIGTERM", ()=>{stopped = true;});
process.on("SIGINT", ()=>{stopped = true;});
async function main() {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw new Error("Use the isolated Linux printing runtime with privilege separation");
  const descriptor = z.object({digest: z.string().regex(/^[a-f0-9]{64}$/)}).parse(
    await runAcquisitionNativeProcess("python", [program, "--describe"], Buffer.alloc(0), AbortSignal.timeout(30000)));
  const workerId = `printing-${randomUUID()}`;
  console.log(JSON.stringify({event: "printing-ready", model: descriptor.digest}));
  do {
    await enqueueReadyPrinting(db, descriptor.digest);
    const result = await runAcquisitionJobsOnce(db, {
      [PRINTING_STAGE]: (job, signal)=>observeAcquisitionPrinting(db, job, signal, descriptor.digest, native),
    }, workerId, {timeoutMs: 120000, leaseMs: 180000});
    if (result.claimed) console.log(JSON.stringify({event: "printing-stage", ...result}));
    if (!stopped && !process.argv.includes("--once")) await setTimeout(result.claimed ? 100 : 1000);
  } while (!stopped && !process.argv.includes("--once"));
}
main().catch(()=>{
  console.error("Printing worker stopped; inspect local reference/database availability");
  process.exitCode = 1;
}).finally(()=>{native.close(); return db.$disconnect();});
