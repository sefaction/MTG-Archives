import { Prisma } from "@prisma/client";
import { normalizeLocationSection } from "./inventory-locations";
import { readStorageLayout } from "./storage-layout";

/** Lock all destinations before capacity reads; retain locks through stock writes.
 * Call within a retrying transaction. Deadlocks/serialization failures roll back
 * the whole operation; the caller must not retry only the final stock insert.
 */
export async function lockInventoryDestinations(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  if (
    typeof (tx as unknown as { $transaction?: unknown }).$transaction ===
    "function"
  )
    throw new Error("Capacity coordination requires a transaction client");
  const sorted = [...new Set(ids)].sort();
  if (
    !sorted.length ||
    sorted.length > 100 ||
    sorted.some((id) => !id || id.length > 200)
  )
    throw new Error("Choose between one and 100 destinations");
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM "InventoryLocation" WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE
  `);
  if (rows.length !== sorted.length) throw new Error("Destination unavailable");
}

/** Fresh direct occupancy after the caller takes location locks. Does not grant
 * authorization or reserve stock; candidate/session checks belong to acquisition.
 */
export async function lockAndReadInventoryCapacity(
  tx: Prisma.TransactionClient,
  input: { locationId: string; ownerPlayerId: string; section: string | null },
) {
  await lockInventoryDestinations(tx, [input.locationId]);
  const location = await tx.inventoryLocation.findUnique({
    where: { id: input.locationId },
  });
  if (
    !location ||
    !location.active ||
    location.ownerPlayerId !== input.ownerPlayerId ||
    location.kind !== "NORMAL" ||
    location.systemManaged
  )
    throw new Error("Destination unavailable");
  const section = normalizeLocationSection(input.section);
  const layout = readStorageLayout(location.storageLayout, location.type);
  // A row physically in the destination consumes space even if legacy ownership
  // metadata is inconsistent. Children are separate destinations, not occupancy.
  const [total, selected] = await Promise.all([
    tx.inventoryItem.aggregate({
      where: { locationId: location.id, quantity: { gt: 0 } },
      _sum: { quantity: true },
    }),
    tx.inventoryItem.aggregate({
      where: {
        locationId: location.id,
        locationSection: section,
        quantity: { gt: 0 },
      },
      _sum: { quantity: true },
    }),
  ]);
  const totalQuantity = total._sum.quantity ?? 0,
    sectionQuantity = selected._sum.quantity ?? 0;
  const sectionCapacity =
    layout.sections.find((s) => s.name === section)?.capacity ?? null;
  const limits = [
    layout.capacity === null ? null : layout.capacity - totalQuantity,
    sectionCapacity === null ? null : sectionCapacity - sectionQuantity,
  ].filter((n): n is number => n !== null);
  return {
    locationId: location.id,
    ownerPlayerId: location.ownerPlayerId,
    name: location.name,
    section,
    revision: location.capacityRevision,
    totalQuantity,
    sectionQuantity,
    totalCapacity: layout.capacity,
    sectionCapacity,
    remaining: limits.length ? Math.max(0, Math.min(...limits)) : null,
  };
}
