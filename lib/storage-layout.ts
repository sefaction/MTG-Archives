export type StorageLayout = {
  capacity: number | null;
  sections: { name: string; capacity: number | null }[];
};
export const MAX_STORAGE_SECTIONS = 100;
export function defaultStorageLayout(type?: string | null): StorageLayout {
  return {
    capacity: null,
    sections:
      type?.trim().toLowerCase() === "vault"
        ? Array.from({ length: 6 }, (_, i) => ({
            name: `Sect ${i}`,
            capacity: 85,
          }))
        : [],
  };
}

// Strict write boundary: no coercion, duplicate/empty names or nonfinite counts.
export function validateStorageLayout(value: unknown): StorageLayout {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a storage layout.");
  const input = value as Record<string, unknown>;
  function capacity(value: unknown) {
    if (value === null) return null;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > 2147483647
    )
      throw new Error(
        "Capacity must be a whole number from 1 to 2,147,483,647, or left unset.",
      );
    return value;
  }
  if (
    !Array.isArray(input.sections) ||
    input.sections.length > MAX_STORAGE_SECTIONS
  )
    throw new Error(`Use at most ${MAX_STORAGE_SECTIONS} default sections.`);
  const names = new Set<string>();
  const sections = input.sections.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("Invalid section.");
    const section = row as Record<string, unknown>;
    if (
      typeof section.name !== "string" ||
      !section.name.trim() ||
      section.name.trim().length > 100
    )
      throw new Error("Each section needs a name of 1–100 characters.");
    const name = section.name.trim();
    const key = name.toLocaleLowerCase();
    if (names.has(key)) throw new Error("Section names must be unique.");
    names.add(key);
    return { name, capacity: capacity(section.capacity) };
  });
  return { capacity: capacity(input.capacity), sections };
}
export function readStorageLayout(
  value: unknown,
  type?: string | null,
): StorageLayout {
  return value == null
    ? defaultStorageLayout(type)
    : validateStorageLayout(value);
}
export function storageLayoutFromForm(fd: FormData): StorageLayout | undefined {
  const raw = fd.get("storageLayout");
  if (raw === null) return undefined;
  if (typeof raw !== "string" || raw.length > 25000)
    throw new Error("Invalid storage layout.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid storage layout.");
  }
  const layout = validateStorageLayout(value);
  if (fd.get("storageMode") === "sections" && !layout.sections.length)
    throw new Error(
      "Generate at least one section, or choose no capacity tracking.",
    );
  if (fd.get("storageMode") === "single" && layout.capacity === null)
    throw new Error(
      "Enter a location capacity, or choose no capacity tracking.",
    );
  return layout;
}

export function remainingStorageSpace(
  layout: StorageLayout,
  total: number,
  sections: { name: string; quantity: number; capacity: number | null }[],
) {
  const bounded = sections.filter((section) => section.capacity !== null);
  const sectionRoom = bounded.length
    ? bounded.reduce(
        (sum, section) =>
          sum + Math.max(0, section.capacity! - section.quantity),
        0,
      )
    : null;
  const totalRoom =
    layout.capacity === null ? null : Math.max(0, layout.capacity - total);
  return totalRoom === null
    ? sectionRoom
    : sectionRoom === null
      ? totalRoom
      : Math.min(totalRoom, sectionRoom);
}
