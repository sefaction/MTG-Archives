import { INVENTORY_SORT_FIELDS } from "../lib/inventory-sort";

export function inventorySortHref(
  pathname: "/inventory" | "/public/inventory",
  query: string,
  field: string,
  direction: "asc" | "desc" | false,
) {
  if (!(INVENTORY_SORT_FIELDS as readonly string[]).includes(field))
    throw new Error("Unsupported inventory sort field");
  const params = new URLSearchParams(query);
  if (direction) {
    params.set("sort", field);
    params.set("sortDir", direction);
  } else {
    params.delete("sort");
    params.delete("sortDir");
  }
  params.delete("page");
  return `${pathname}?${params.toString()}`;
}

