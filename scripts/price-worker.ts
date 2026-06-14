import { prisma } from "../lib/prisma";
import { runOnePriceImportJob } from "../lib/price-import-jobs";

const workerId = `price-worker-${process.pid}`;
const pollMs = Number(process.env.PRICE_WORKER_POLL_INTERVAL_MS || 5000);

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.info(`[price-worker] started ${workerId}`);
  while (true) {
    const job = await runOnePriceImportJob(workerId).catch((error) => {
      console.error("[price-worker] job failed", error);
      return null;
    });
    if (!job) await sleep(pollMs);
  }
}

main()
  .catch((error) => {
    console.error("[price-worker] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.exitCode) await prisma.$disconnect();
  });
