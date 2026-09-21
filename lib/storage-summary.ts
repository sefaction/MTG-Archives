import type { PrismaClient } from "@prisma/client";
import { storageSections, type StorageLocation } from "./storage-sections";
import { readStorageLayout } from "./storage-layout";

// Call only with locations already constrained to the viewer's access scope.
export async function getStorageLocations(
  prisma: PrismaClient,
  locations: {
    id: string;
    name: string;
    path?: string;
    type?: string | null;
    ownerPlayerId?: string;
    storageLayout?: unknown;
  }[],
): Promise<StorageLocation[]> {
  if (!locations.length) return [];
  const rows = await prisma.inventoryItem.groupBy({
    by: ["locationId", "locationSection"],
    where: {
      locationId: { in: locations.map((l) => l.id) },
      quantity: { gt: 0 },
    },
    _sum: { quantity: true },
  });
  const groups = new Map<string, { name: string; quantity: number }[]>();
  for (const row of rows) {
    if (!row.locationId) continue;
    const group = groups.get(row.locationId) ?? [];
    group.push({
      name: row.locationSection ?? "",
      quantity: row._sum.quantity ?? 0,
    });
    groups.set(row.locationId, group);
  }
  return locations.map((location) => ({
    ...location,
    name: location.path ?? location.name,
    capacity: readStorageLayout(location.storageLayout, location.type).capacity,
    defaultSectionNames: readStorageLayout(
      location.storageLayout,
      location.type,
    ).sections.map((section) => section.name),
    quantity: (groups.get(location.id) ?? []).reduce(
      (sum, row) => sum + row.quantity,
      0,
    ),
    sections: storageSections(
      location.type,
      groups.get(location.id) ?? [],
      location.storageLayout,
    ),
  }));
}
