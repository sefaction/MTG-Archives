import { Prisma } from "@prisma/client";
import { lockAndReadInventoryCapacity } from "./inventory-capacity";
import { normalizeLocationSection } from "./inventory-locations";
import { getStorageLocations } from "./storage-summary";
import { scannerCapacityDestination } from "./scanner-capacity-display";

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
  const pendingSections = new Map<string | null, number>();
  for (const session of sessions) {
    const pending = scannerReservedSpace({ reserved: session.scannerReserved,
      candidateCount: session.run?._count.candidates ?? 0, slotCount: session.run?._count.slots ?? 0,
      committedCount: session.run?.candidates.filter(c => c.receipt).length ?? 0 });
    pendingTotal += pending;
    const section = normalizeLocationSection(session.section);
    pendingSections.set(section, (pendingSections.get(section) ?? 0) + pending);
    if (section === capacity.section) pendingSection += pending;
  }
  const limits = [capacity.totalCapacity === null ? null : capacity.totalCapacity - capacity.totalQuantity - pendingTotal,
    capacity.sectionCapacity === null ? null : capacity.sectionCapacity - capacity.sectionQuantity - pendingSection]
    .filter((n): n is number => n !== null);
  return { ...capacity, pendingTotal, pendingSection,
    pendingSections: [...pendingSections].map(([section, quantity]) => ({ section, quantity })),
    remaining: limits.length ? Math.max(0, Math.min(...limits)) : null };
}

// The same authorized location lock covers fresh Inventory and every section's
// pending space. Only the display endpoint needs the full destination snapshot.
export async function readScannerCapacitySnapshot(tx: Prisma.TransactionClient,
  input: Parameters<typeof readScannerCapacity>[1]) {
  const capacity = await readScannerCapacity(tx, input);
  const location = await tx.inventoryLocation.findUniqueOrThrow({ where: { id: input.locationId } });
  const [destination] = await getStorageLocations(tx, [{ id: location.id, name: location.name,
    type: location.type, ownerPlayerId: location.ownerPlayerId, storageLayout: location.storageLayout }]);
  return { ...capacity, destination: scannerCapacityDestination(destination, capacity.pendingSections, capacity.pendingTotal) };
}
