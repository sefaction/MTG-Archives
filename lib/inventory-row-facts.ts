import { resolveInventoryVisibility } from "./visibility";
import type { DefaultCollectionVisibility } from "@prisma/client";
export type InventorySortFacts = { owners: Array<{ id: string; name: string }>; sources: string[]; visibilities: DefaultCollectionVisibility[]; publicOwners?: boolean };
const sourceNames: Record<string, string> = { ACQUISITION: "Scan", CSV_PULL_IMPORT: "Import", PULL: "Legacy", TRADE: "Trade", MANUAL: "Manual add", CORRECTION: "Correction", PRIZE: "Prize", OTHER: "Other" };
export const inventorySourceLabel = (value?: string | null) => sourceNames[value ?? ""] ?? "Unknown";
export function mergeInventoryFacts(left: InventorySortFacts, right: InventorySortFacts): InventorySortFacts {
  return { owners: [...new Map([...left.owners, ...right.owners].map(owner => [owner.id, owner])).values()],
    sources: [...new Set([...left.sources, ...right.sources])], visibilities: [...new Set([...left.visibilities, ...right.visibilities])], publicOwners: left.publicOwners };
}
export function inventoryFactLabels(facts: InventorySortFacts) {
  return { currentOwner: facts.owners.length === 1 ? facts.owners[0].name : facts.publicOwners ? "Public collections" : "Multiple owners",
    sourceTypeLabel: facts.sources.length === 1 ? inventorySourceLabel(facts.sources[0]) : "Mixed",
    effectiveVisibility: facts.visibilities.length === 1 ? facts.visibilities[0] : "MIXED" as const };
}
export function inventoryRowFacts(items: any[], defaults: Record<string, DefaultCollectionVisibility>) {
  let facts: InventorySortFacts = { owners: [], sources: [], visibilities: [] };
  for (const item of items) {
    const parts = item.locationBreakdown ?? [{ sourceType: item.sourceType, locationVisibility: item.location?.visibility }];
    facts = mergeInventoryFacts(facts, { owners: [{ id: item.currentOwnerId, name: item.currentOwner?.displayName ?? "Unknown" }],
      sources: parts.map((part: any) => part.sourceType ?? item.sourceType), visibilities: parts.map((part: any) => resolveInventoryVisibility(defaults[item.currentOwnerId] ?? "PRIVATE", part.locationVisibility ?? "INHERIT")) });
  }
  return inventoryFactLabels(facts);
}
