import type { PrismaClient } from "@prisma/client";
import { settledScannerTransfer } from "./scanner-drain-policy";

/** Read-only guard shared by maintenance preflight and post-pause capture.
 * A transport error without its durable finish outcome remains uncertain. */
export async function assertSettledScannerTransfers(
  db: Pick<PrismaClient, "scannerRun">,
) {
  if (await db.scannerRun.count({ where: { NOT: settledScannerTransfer } }))
    throw Error("Drain or cancel scanner runs before maintenance capture");
}
