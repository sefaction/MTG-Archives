import { Prisma } from "@prisma/client";

/** finishScannerRun persists an outcome only after every reported original is
 * durable. A saved error outcome also finishes transfer; it is not evidence of
 * a physical count or permission to resume feeding. Missing outcomes remain
 * uncertain and must keep their recovery/admission fence. */
export function scannerTransferIsSettled(run: {status: string; outcome: unknown}) {
  return ["DRAINED", "CANCELLED_BEFORE_START"].includes(run.status) || run.status === "ERROR" && !!run.outcome;
}
export const settledScannerTransfer = {OR: [
  {status: {in: ["DRAINED", "CANCELLED_BEFORE_START"]}},
  {status: "ERROR", outcome: {not: Prisma.AnyNull}},
]} satisfies Prisma.ScannerRunWhereInput;
export const cancelledSettledScannerTransfer = {
  ...settledScannerTransfer, acquisitionRun: {session: {cancelledAt: {not: null}}},
} satisfies Prisma.ScannerRunWhereInput;
