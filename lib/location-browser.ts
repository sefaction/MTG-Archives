export type BrowsableLocation = {
  id: string;
  name: string;
  path: string;
  parentLocationId?: string | null;
  type?: string | null;
};

export type LocationBrowseParams = {
  q?: string;
  parent?: string;
  page?: string;
  treePage?: string;
  edit?: string;
  selected?: string;
  panel?: string;
  view?: string;
};

export const LOCATION_PAGE_SIZE = 25;

function pageNumber(value: string | undefined, count: number) {
  const parsed = Number(value);
  return Math.min(
    Math.max(1, Math.ceil(count / LOCATION_PAGE_SIZE)),
    Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1,
  );
}

// Input MUST already be restricted to locations the viewer may manage.
// Keep the full hierarchy for paths/counts, but bound the rendered cards/tree.
export function browseLocations<T extends BrowsableLocation>(
  locations: T[],
  params: LocationBrowseParams,
) {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const children = new Map<string | null, T[]>();
  for (const location of locations) {
    const parent =
      location.parentLocationId && byId.has(location.parentLocationId)
        ? location.parentLocationId
        : null;
    const group = children.get(parent) ?? [];
    group.push(location);
    children.set(parent, group);
  }
  const parent = params.parent ? byId.get(params.parent) : undefined;
  const branchIds = new Set<string>();
  const queue = parent ? [parent] : [];
  for (let index = 0; index < queue.length; index++) {
    const location = queue[index];
    if (branchIds.has(location.id)) continue;
    branchIds.add(location.id);
    queue.push(...(children.get(location.id) ?? []));
  }
  const query = params.q?.trim().toLocaleLowerCase() ?? "";
  const matches = locations.filter(
    (location) =>
      (!params.parent || branchIds.has(location.id)) &&
      (!query ||
        `${location.path} ${location.type ?? ""}`
          .toLocaleLowerCase()
          .includes(query)),
  );
  const page = pageNumber(params.page, matches.length);
  const treeNodes =
    params.parent && !parent ? [] : (children.get(parent?.id ?? null) ?? []);
  const treePage = pageNumber(params.treePage, treeNodes.length);
  const breadcrumbs: T[] = [];
  const visited = new Set<string>();
  let current = parent;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    breadcrumbs.unshift(current);
    current = current.parentLocationId
      ? byId.get(current.parentLocationId)
      : undefined;
  }
  return {
    parent,
    breadcrumbs,
    page,
    treePage,
    total: matches.length,
    pages: Math.max(1, Math.ceil(matches.length / LOCATION_PAGE_SIZE)),
    treeTotal: treeNodes.length,
    treePages: Math.max(1, Math.ceil(treeNodes.length / LOCATION_PAGE_SIZE)),
    items: matches.slice(
      (page - 1) * LOCATION_PAGE_SIZE,
      page * LOCATION_PAGE_SIZE,
    ),
    treeItems: treeNodes.slice(
      (treePage - 1) * LOCATION_PAGE_SIZE,
      treePage * LOCATION_PAGE_SIZE,
    ),
  };
}

export function locationBrowseHref(
  params: LocationBrowseParams,
  changes: Partial<LocationBrowseParams> = {},
) {
  const next = { ...params, ...changes };
  const query = new URLSearchParams();
  for (const key of [
    "q",
    "parent",
    "page",
    "treePage",
    "edit",
    "selected",
    "panel",
    "view",
  ] as const) {
    if (next[key]) query.set(key, next[key]);
  }
  return `/locations${query.size ? `?${query}` : ""}#normal-locations`;
}

// The caller supplies only authorized locations. Explicit unknown selections
// stay empty rather than silently showing a different owner's/requested item.
export function selectedBrowseLocation<T extends BrowsableLocation>(
  locations: T[],
  browser: ReturnType<typeof browseLocations<T>>,
  params: LocationBrowseParams,
) {
  const id = params.selected || params.edit;
  return id
    ? locations.find((location) => location.id === id)
    : browser.items[0];
}
