import type { StorageLocation } from "./storage-sections";

// Preserve Inventory counts. Pending cards and the remaining logical target
// occupy separate held space, including cards in the unsectioned parent.
export function scannerCapacityDestination(destination: StorageLocation,
  pending: readonly { section: string | null; quantity: number }[], total: number): StorageLocation {
  const sections = new Map(pending.map(value => [value.section ?? "", value.quantity]));
  const known = new Set(destination.sections.map(section => section.name));
  return { ...destination, pendingQuantity: total,
    sections: [...destination.sections.map(section => ({ ...section, pendingQuantity: sections.get(section.name) ?? 0 })),
      ...[...sections].filter(([name, quantity]) => name && quantity > 0 && !known.has(name))
        .map(([name, pendingQuantity]) => ({ name, quantity: 0, capacity: null, pendingQuantity }))] };
}
