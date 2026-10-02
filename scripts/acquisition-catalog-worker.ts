import {catalogWorkerFailure,type CatalogWorkerPhase} from "../lib/acquisition-worker-diagnostics";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import {
  enqueueCatalogReconciliation,
  createCatalogReconciliationHandler,
} from "../lib/acquisition-catalog-reconciliation";
import { CATALOG_RECONCILIATION_STAGE } from "../lib/acquisition-catalog-status";
import { runAcquisitionJobsOnce } from "../lib/acquisition-jobs";
import { confirmStrongAcquisitionMatches } from "../lib/acquisition-auto-confirm";

const db = new PrismaClient();
let stopped = false;
let phase:CatalogWorkerPhase="ADMISSION";
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
async function main() {
  const workerId = `catalog-${randomUUID()}`;
  const reconcile = createCatalogReconciliationHandler(db);
  do {
    phase="ADMISSION";
    await enqueueCatalogReconciliation(db);
    phase="PROCESSING";
    const result = await runAcquisitionJobsOnce(
      db,
      { [CATALOG_RECONCILIATION_STAGE]: reconcile },
      workerId,
      { timeoutMs: 180000, leaseMs: 240000 },
    );
    phase="AUTO_CONFIRM";
    const confirmed = await confirmStrongAcquisitionMatches(db);
    if (result.claimed || confirmed)
      console.log(
        JSON.stringify({
          event: "catalog-reconciliation",
          ...result,
          confirmed,
        }),
      );
    if (!stopped && !process.argv.includes("--once"))
      await setTimeout(result.claimed ? 100 : 1000);
  } while (!stopped && !process.argv.includes("--once"));
}
main()
  .catch((error:unknown) => {
    console.error(JSON.stringify(catalogWorkerFailure(phase,error)));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
