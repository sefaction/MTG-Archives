import { prisma } from "../lib/prisma";
import {
  runOnePriceImportJob,
  updatePriceWorkerHeartbeat,
} from "../lib/price-import-jobs";
import { pathToFileURL } from "node:url";

const workerId = `price-worker-${process.pid}`;
const pollMs = Number(process.env.PRICE_WORKER_POLL_INTERVAL_MS || 5000);
const heartbeatMs = Number(process.env.PRICE_WORKER_HEARTBEAT_INTERVAL_MS || 15000);

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startPriceWorker() {
  console.info(`[price-worker] started ${workerId}`);
  console.info("[price-worker] polling for queued jobs");
  let lastHeartbeatAt = 0;
  while (true) {
    if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
      await updatePriceWorkerHeartbeat(workerId);
      lastHeartbeatAt = Date.now();
    }
    const job = await runOnePriceImportJob(workerId).catch((error) => {
      console.error("[price-worker] job failed", error);
      return null;
    });
    if (job) {
      await updatePriceWorkerHeartbeat(workerId);
      lastHeartbeatAt = Date.now();
    }
    if (!job) await sleep(pollMs);
  }
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] || "").href;

if (isDirectRun && process.env.PRICE_WORKER_TEST_MODE !== "true") {
  startPriceWorker()
    .catch((error) => {
      console.error("[price-worker] fatal", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (process.exitCode) await prisma.$disconnect();
    });
}
