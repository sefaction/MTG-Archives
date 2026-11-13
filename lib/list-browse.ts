export function normalizedListQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Only for routes with single-valued fields; repeated multi-select filters stay intact elsewhere. */
export function canonicalBrowseQuery(params: Record<string, unknown>) {
  if (!Object.values(params).some(Array.isArray)) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (typeof value === "string") query.append(key, value);
  return query.toString();
}
export function filterNamedRows<T extends { name: string }>(
  rows: readonly T[],
  query: string,
): T[] {
  const needle = normalizedListQuery(query);
  return rows.filter((row) => normalizedListQuery(row.name).includes(needle));
}

export const listPageSizes = [10, 25, 50, 100] as const;
export function listPageSize(value: unknown, fallback = 25) {
  const parsed = Number(value);
  return listPageSizes.includes(parsed as (typeof listPageSizes)[number])
    ? parsed
    : fallback;
}
export function listPage(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
export function listPageInfo(
  total: number,
  requestedPage: number,
  size: number,
) {
  const pageSize = listPageSize(size);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, listPage(requestedPage));
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    totalPages,
    total,
    from: total ? start + 1 : 0,
    to: Math.min(total, start + pageSize),
  };
}
export function pageList<T>(
  rows: readonly T[],
  requestedPage: number,
  size: number,
) {
  const info = listPageInfo(rows.length, requestedPage, size);
  const start = (info.page - 1) * info.pageSize;
  return { items: rows.slice(start, start + info.pageSize), ...info };
}
