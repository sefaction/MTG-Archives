import { Prisma } from "@prisma/client";
import { lockAndReadInventoryCapacity } from "./inventory-capacity";
import { normalizeLocationSection } from "./inventory-locations";

export function scannerReservedSpace(input: { reserved: number | null; candidateCount: number;
  slotCount: number; committedCount: number }) {
  // Every retained card consumes space until explicitly committed. Excluding a
  // review candidate does not prove that the physical card left the destination.
  // The unconsumed part of an unfinished scanner target also stays allocated.
  return Math.max(0, Math.max(input.reserved ?? 0, input.candidateCount, input.slotCount) - input.committedCount);
}
/** Location lock shared with stock writes. Count both sections when the parent
 * has a tighter total limit; never substitute a stale placement snapshot. */
export async function readScannerCapacity(tx: Prisma.TransactionClient, input: {
  locationId: string; ownerPlayerId: string; section: string | null; excludeSessionId?: string;
}) {
  const capacity = await lockAndReadInventoryCapacity(tx, input);
  const sessions = await tx.acquisitionSession.findMany({ where: { locationId: input.locationId,
    ...(input.excludeSessionId ? { id: { not: input.excludeSessionId } } : {}) }, select: {
    section: true, scannerReserved: true, run: { select: { _count: { select: {
      candidates: true, slots: true,
    } }, candidates: { select: { receipt: { select: { candidateId: true } } } } } },
  } });
  let pendingTotal = 0, pendingSection = 0;
  for (const session of sessions) {
    const pending = scannerReservedSpace({ reserved: session.scannerReserved,
      candidateCount: session.run?._count.candidates ?? 0, slotCount: session.run?._count.slots ?? 0,
      committedCount: session.run?.candidates.filter(c => c.receipt).length ?? 0 });
    pendingTotal += pending;
    if (normalizeLocationSection(session.section) === capacity.section) pendingSection += pending;
  }
  const limits = [capacity.totalCapacity === null ? null : capacity.totalCapacity - capacity.totalQuantity - pendingTotal,
    capacity.sectionCapacity === null ? null : capacity.sectionCapacity - capacity.sectionQuantity - pendingSection]
    .filter((n): n is number => n !== null);
  return { ...capacity, pendingTotal, pendingSection,
    remaining: limits.length ? Math.max(0, Math.min(...limits)) : null };
}
