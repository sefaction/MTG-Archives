import type { Prisma } from "@prisma/client";
import { ScannerRunConflict } from "./scanner-errors";

type Tx = Prisma.TransactionClient;
export async function lockScannerSeries(tx: Tx, rootId: string, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scanner-series-v1:${rootId}`}, 0))`;
  const root = await tx.scannerRun.findUnique({ where: { id: rootId }, include: { acquisitionRun: { include: { session: true } } } });
  if (!root || root.seriesRootId !== root.id || root.acquisitionRun.session.createdByUserId !== userId)
    throw new ScannerRunConflict("Scanner series is unavailable");
  const latest = await tx.scannerRun.findFirstOrThrow({ where: { seriesRootId: root.id },
    orderBy: [{ seriesOrdinal: "desc" }, { segment: "desc" }] });
  return { root, latest };
}
export function requireRunningScannerSeries(stoppedAt: Date | null) {
  if (stoppedAt) throw new ScannerRunConflict("This scanner series was stopped. Start a new series explicitly to scan more cards.");
}
