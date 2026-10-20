import { sectionRoom, type StorageLocation, type StorageSection } from "./storage-sections";

export function scanParentRoom(location: StorageLocation) {
  return location.capacity == null ? null :
    location.capacity - (location.quantity ?? 0) - (location.pendingQuantity ?? 0);
}

export function scanSectionHasRoom(location: StorageLocation, section: StorageSection) {
  return section.capacity !== null && (sectionRoom(section, scanParentRoom(location)) ?? 0) > 0;
}

// A section-configured location (for example a Vault) can have no overall limit.
// Do not sum section capacities or subtract the pending batch quantity again.
export function scanLocationHasRoom(location: StorageLocation) {
  return (scanParentRoom(location) ?? 0) > 0 ||
    location.sections.some(section => !!section.name && scanSectionHasRoom(location, section));
}
