/** Selection is scoped to the currently loaded, displayed order, never unseen pages. */
export function selectInventoryRows(
  rows: { id: string; sourceItemIds?: string[] }[],
  current: ReadonlySet<string>,
  targetId: string,
  anchorId: string | null,
  options: { range?: boolean; additive?: boolean },
) {
  const target = rows.findIndex((row) => row.id === targetId);
  if (target < 0) return { ids: new Set(current), anchorId };
  const anchor = rows.findIndex((row) => row.id === anchorId);
  const idsFor = (row: (typeof rows)[number]) =>
    row.sourceItemIds?.length ? row.sourceItemIds : [row.id];
  const ids = new Set(options.additive ? current : []);
  if (options.range && anchor >= 0) {
    rows
      .slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
      .flatMap(idsFor)
      .forEach((id) => ids.add(id));
    return { ids, anchorId };
  }
  const targetIds = idsFor(rows[target]);
  const remove = options.additive && targetIds.every((id) => current.has(id));
  targetIds.forEach((id) => (remove ? ids.delete(id) : ids.add(id)));
  return { ids, anchorId: targetId };
}
