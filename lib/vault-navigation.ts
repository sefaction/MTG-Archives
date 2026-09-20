/** Exact physical-section navigation; existing text search remains independent. */
export function vaultSectionHref(
  locationId: string,
  section: string | null,
  query = "",
) {
  const params = new URLSearchParams(query);
  params.delete("location");
  params.delete("hasLocation");
  params.set("locationId", locationId);
  params.delete("page");
  params.delete("locationSection");
  params.delete("locationSectionMatch");
  if (section !== null) {
    params.set("locationSectionMatch", section === "" ? "empty" : "exact");
    if (section) params.set("locationSection", section);
  }
  return `/inventory?${params.toString()}`;
}
