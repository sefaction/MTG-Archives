import { inventoryFactLabels, type InventorySortFacts } from "./inventory-row-facts";
import { resolveInventoryVisibility } from "./visibility";
/** Load only the metadata needed by the requested non-card column, before paging. */
export async function enrichInventoryGroupsForFactSort(db: any, groups: any[], where: any, fields: string[], sort: string, publicOwners = false) {
  if (!groups.length || !["currentOwner", "sourceType", "effectiveVisibility"].includes(sort)) return groups;
  const by = [...new Set([...fields, ...(sort === "sourceType" ? ["sourceType"] : sort === "currentOwner" ? ["currentOwnerId"] : ["currentOwnerId", "locationId"])])];
  const parts: any[] = await db.inventoryItem.groupBy({ by, where, _count: { _all: true } });
  const ownerIds = [...new Set(parts.map(row => row.currentOwnerId).filter(Boolean))];
  const locationIds = [...new Set(parts.map(row => row.locationId).filter(Boolean))];
  const [players, users, locations] = await Promise.all([
    sort === "currentOwner" && !publicOwners ? db.player.findMany({ where: { id: { in: ownerIds } }, select: { id: true, displayName: true } }) : [],
    sort === "effectiveVisibility" || (sort === "currentOwner" && publicOwners) ? db.user.findMany({ where: { playerId: { in: ownerIds }, isActive: true },
      select: { playerId: true, publicDisplayName: true, displayName: true, inventoryDefaultVisibility: true }, orderBy: { createdAt: "asc" } }) : [],
    sort === "effectiveVisibility" ? db.inventoryLocation.findMany({ where: { id: { in: locationIds } }, select: { id: true, visibility: true } }) : [],
  ]);
  const names = new Map<string, string>(players.map((row: any) => [row.id, row.displayName]));
  const defaults = new Map<string, any>();
  for (const user of users) { if (!names.has(user.playerId)) names.set(user.playerId, user.publicDisplayName || user.displayName || "Public collection"); defaults.set(user.playerId, user.inventoryDefaultVisibility); }
  const visibility = new Map(locations.map((row: any) => [row.id, row.visibility]));
  const key = (row: any) => JSON.stringify(fields.map(field => row[field] ?? null));
  const factsByKey = new Map<string, InventorySortFacts>();
  for (const row of parts) {
    const facts: InventorySortFacts = factsByKey.get(key(row)) ?? { owners: [], sources: [], visibilities: [], publicOwners };
    if (sort === "currentOwner" && !facts.owners.some(owner => owner.id === row.currentOwnerId)) facts.owners.push({ id: row.currentOwnerId, name: names.get(row.currentOwnerId) ?? "Public collection" });
    if (sort === "sourceType" && !facts.sources.includes(row.sourceType)) facts.sources.push(row.sourceType);
    if (sort === "effectiveVisibility") { const value = resolveInventoryVisibility(defaults.get(row.currentOwnerId) ?? "PRIVATE", (visibility.get(row.locationId) ?? "INHERIT") as any); if (!facts.visibilities.includes(value)) facts.visibilities.push(value); }
    factsByKey.set(key(row), facts);
  }
  return groups.map(group => { const sortFacts = factsByKey.get(key(group))!; return { ...group, sortFacts, ...inventoryFactLabels(sortFacts) }; });
}
