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

export class AcquisitionPhotoStorageLimitError extends Error {
  constructor(public readonly scope: "OWNER" | "BATCH", public readonly limitBytes: number) {
    super(`Photo storage limit reached (${limitBytes / GIB} GiB ${scope === "OWNER" ? "for this account" : "for this batch"}). Waiting scans are saved on the scanner computer. Cleanup checks completed and trashed batches every minute. If space remains full, ask an administrator to increase the scan-photo allowance.`);
  }
}

export function requireAcquisitionPhotoSpace(ownerBytes: number, batchBytes: number, incomingBytes: number,
  limits = acquisitionPhotoLimits()) {
  if (ownerBytes + incomingBytes > limits.owner)
    throw new AcquisitionPhotoStorageLimitError("OWNER", limits.owner);
  if (batchBytes + incomingBytes > limits.batch)
    throw new AcquisitionPhotoStorageLimitError("BATCH", limits.batch);
}
