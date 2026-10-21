import { Prisma, type PrismaClient } from "@prisma/client";
import type { StorageLocation } from "./storage-sections";
import { lockAndReadInventoryCapacity } from "./inventory-capacity";
import { normalizeLocationSection } from "./inventory-locations";
import { getStorageLocations } from "./storage-summary";
import { scannerCapacityDestination } from "./scanner-capacity-display";
import {settledScannerTransfer} from "./scanner-drain-policy";

export function scannerReservedSpace(input: { reserved: number | null; candidateCount: number;
  slotCount: number; committedCount: number }) {
  // Every retained card consumes space until explicitly committed. Excluding a
  // review candidate does not prove that the physical card left the destination.
  // The unconsumed part of an unfinished scanner target also stays allocated.
  return Math.max(0, Math.max(input.reserved ?? 0, input.candidateCount, input.slotCount) - input.committedCount);
}

/** Advisory list snapshot only. Start and commit still lock and recheck capacity.
 * The caller must constrain destinations to the viewer's existing access scope. */
export async function scannerCapacityDestinations(db: Pick<PrismaClient, "acquisitionSession" | "acquisitionCandidate">,
  destinations: StorageLocation[]) {
  if (!destinations.length) return destinations;
  const sessions = await db.acquisitionSession.findMany({ where: {
    locationId: { in: destinations.map(location => location.id) },
    OR: [{trashedAt: null, deletedAt: null}, {run: {scannerRuns: {some: {NOT: settledScannerTransfer}}}}],
  }, select: { locationId: true, section: true, scannerReserved: true, run: { select: { id: true,
    _count: { select: { candidates: true, slots: true } },
  } } } });
  const runIds = sessions.flatMap(session => session.run ? [session.run.id] : []);
  const receipts = runIds.length ? await db.acquisitionCandidate.groupBy({ by: ["runId"],
    where: { runId: { in: runIds }, receipt: { isNot: null } }, _count: { _all: true } }) : [];
  const committed = new Map(receipts.map(row => [row.runId, row._count._all]));
  const pending = new Map<string, Map<string | null, number>>();
  for (const session of sessions) {
    if (!session.locationId) continue;
    const quantity = scannerReservedSpace({ reserved: session.scannerReserved,
      candidateCount: session.run?._count.candidates ?? 0, slotCount: session.run?._count.slots ?? 0,
      committedCount: session.run ? committed.get(session.run.id) ?? 0 : 0 });
    const sections = pending.get(session.locationId) ?? new Map<string | null, number>();
    const section = normalizeLocationSection(session.section);
    sections.set(section, (sections.get(section) ?? 0) + quantity);
    pending.set(session.locationId, sections);
  }
  return destinations.map(destination => {
    const sections = [...(pending.get(destination.id) ?? [])].map(([section, quantity]) => ({ section, quantity }));
    const snapshot = scannerCapacityDestination(destination, sections, sections.reduce((sum, section) => sum + section.quantity, 0));
    // Pending-only custom names still consume parent room, but must not add new
    // ordinary options when the filter is off. Selected counted snapshots retain
    // their existing pending-only display behavior through the capacity endpoint.
    const names = new Set(destination.sections.map(section => section.name));
    return { ...snapshot, sections: snapshot.sections.filter(section => names.has(section.name)) };
  });
}
/** Location lock shared with stock writes. Count both sections when the parent
 * has a tighter total limit; never substitute a stale placement snapshot. */
export async function readScannerCapacity(tx: Prisma.TransactionClient, input: {
  locationId: string; ownerPlayerId: string; section: string | null; excludeSessionId?: string;
}) {
  const capacity = await lockAndReadInventoryCapacity(tx, input);
  const sessions = await tx.acquisitionSession.findMany({ where: { locationId: input.locationId,
    OR: [{trashedAt: null, deletedAt: null}, {run: {scannerRuns: {some: {NOT: settledScannerTransfer}}}}],
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
