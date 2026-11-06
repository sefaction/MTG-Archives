const GIB = 1024 ** 3;

function configuredLimit(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === "") return fallback * GIB;
  const gib = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(gib) || gib < 1 || gib > 1048576)
    throw new Error(`${name} must be a positive whole number of GiB (at most 1048576)`);
  return gib * GIB;
}

export function acquisitionPhotoLimits(env: Record<string, string | undefined> = process.env) {
  return {
    owner: configuredLimit(env.ACQUISITION_PHOTO_OWNER_LIMIT_GIB, 4, "ACQUISITION_PHOTO_OWNER_LIMIT_GIB"),
    batch: configuredLimit(env.ACQUISITION_PHOTO_BATCH_LIMIT_GIB, 1, "ACQUISITION_PHOTO_BATCH_LIMIT_GIB"),
  };
}

// Legacy names retained only for the existing safe pressure-cleanup policy.
// These are cleanup watermarks, never upload admission or saved-image caps.
