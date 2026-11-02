type PhotoMatchSlot = {
  id: string;
  generation: number;
  photos: readonly {
    generation: number;
    ready: boolean;
    purgedAt?: unknown;
    digest: string;
    bytes: number;
  }[];
};

/** The caller supplies one authorized batch's complete progress, before UI
 * filtering/paging. A matching file is advisory evidence, not physical identity. */
export function acquisitionPhotoMatchCounts(slots: readonly PhotoMatchSlot[]) {
  const currentBySlot = new Map<string, string>();
  for (const slot of slots) {
    const photo = slot.photos.find(photo => photo.ready && !photo.purgedAt &&
      photo.generation === slot.generation);
    if (!photo || !/^[a-f0-9]{64}$/.test(photo.digest) ||
      !Number.isSafeInteger(photo.bytes) || photo.bytes < 1) continue;
    currentBySlot.set(slot.id, `${photo.digest}:${photo.bytes}`);
  }
  const counts = new Map<string, number>();
  for (const key of currentBySlot.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
  const matches = new Map<string, number>();
  for (const [id, key] of currentBySlot) {
    const count = counts.get(key)!;
    if (count > 1) matches.set(id, count);
  }
  return matches;
}
