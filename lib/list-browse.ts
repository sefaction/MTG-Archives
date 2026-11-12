export function normalizedListQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
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
export function pageList<T>(
  rows: readonly T[],
  requestedPage: number,
  size: number,
) {
  const pageSize = listPageSize(size);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(totalPages, listPage(requestedPage));
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    page,
    pageSize,
    totalPages,
    total: rows.length,
    from: rows.length ? start + 1 : 0,
    to: Math.min(rows.length, start + pageSize),
  };
}
