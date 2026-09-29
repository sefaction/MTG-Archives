import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";
import { runAcquisitionJobsOnce } from "../lib/acquisition-jobs";
import {
  enqueueReadyVisual,
  retrieveAcquisitionVisual,
} from "../lib/acquisition-visual-worker";
import { VISUAL_STAGE } from "../lib/acquisition-visual";

const db = new PrismaClient();
const program = "/app/tools/acquisition-runtime/visual.py";
const native = new AcquisitionNativeStream("python", [program, "--stream"]);
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
      "Use the isolated Linux visual runtime with privilege separation",
    );
  const descriptor = z
    .object({
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      referenceCount: z.number(),
    })
    .parse(
      await runAcquisitionNativeProcess(
        "python",
        [program, "--describe"],
        Buffer.alloc(0),
        AbortSignal.timeout(30000),
      ),
    );
  const workerId = `visual-${randomUUID()}`;
  console.log(
    JSON.stringify({
      event: "visual-ready",
      model: descriptor.digest,
      references: descriptor.referenceCount,
    }),
  );
  do {
    await enqueueReadyVisual(db, descriptor.digest);
    const result = await runAcquisitionJobsOnce(
      db,
      {
        [VISUAL_STAGE]: (job, signal) =>
          retrieveAcquisitionVisual(db, job, signal, descriptor.digest, native),
      },
      workerId,
      { timeoutMs: 120000, leaseMs: 180000 },
    );
    if (result.claimed)
      console.log(JSON.stringify({ event: "visual-stage", ...result }));
    if (!stopped && !process.argv.includes("--once"))
      await setTimeout(result.claimed ? 100 : 1000);
  } while (!stopped && !process.argv.includes("--once"));
}
main()
  .catch(() => {
    console.error(
      "Visual worker stopped; inspect local index/model/database availability",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    native.close();
    return db.$disconnect();
  });
