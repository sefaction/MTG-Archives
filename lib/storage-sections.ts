export const VAULT_SECTION_CAPACITY = 85;
export const VAULT_SECTIONS = Array.from({ length: 6 }, (_, i) => `Sect ${i}`);

export type StorageSection = {
  name: string;
  quantity: number;
  capacity: number | null;
};
export type StorageLocation = {
  id: string;
  name: string;
  type?: string | null;
  ownerPlayerId?: string;
  sections: StorageSection[];
};

export function isVault(type?: string | null) {
  return type?.trim().toLowerCase() === "vault";
}

// Defaults are part of the Vault type, not placeholder inventory rows. Existing
// arbitrary names and unsectioned copies remain untouched.
export function storageSections(
  type: string | null | undefined,
  rows: { name: string; quantity: number }[],
): StorageSection[] {
  const counts = new Map<string, number>(
    isVault(type) ? VAULT_SECTIONS.map((name) => [name, 0]) : [],
  );
  for (const row of rows)
    counts.set(row.name, (counts.get(row.name) ?? 0) + row.quantity);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, quantity]) => ({
      name,
      quantity,
      capacity:
        isVault(type) && VAULT_SECTIONS.includes(name)
          ? VAULT_SECTION_CAPACITY
          : null,
    }));
}

export function spaceLabel(section: StorageSection) {
  if (section.capacity === null) return `${section.quantity} cards`;
  const room = section.capacity - section.quantity;
  return `${section.quantity} / ${section.capacity} cards · ${room < 0 ? `${-room} over capacity` : room === 0 ? "full" : `${room} spaces left`}`;
}

export function projectedSectionQuantity(
  current: number,
  incoming: number,
  alreadyThere = 0,
) {
  return current + Math.max(0, incoming - alreadyThere);
}
