import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  lstat,
  realpath,
  open,
  link,
  unlink,
  readFile,
  statfs,
  opendir,
} from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import { acquisitionPhotoMetadataSchema } from "./acquisition-store";

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MAX_PIXELS = 36000000;
export const PHOTO_RETENTION_DAYS_AFTER_COMMIT = 7;
export const photoDigest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const mediaTypes: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function inspectAcquisitionPhoto(
  bytes: Buffer,
  declaredType: string,
) {
  if (!bytes.length || bytes.length > PHOTO_MAX_BYTES)
    throw new Error("Use a photo smaller than 10 MB");
  if (!Object.values(mediaTypes).includes(declaredType))
    throw new Error(
      "Use JPEG, PNG or WebP. For HEIC, take a photo with the in-app camera or export as JPEG.",
    );
  const signature = bytes.subarray(0, 12);
  const format =
    signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
      ? "image/jpeg"
      : signature
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : signature.subarray(0, 4).toString() === "RIFF" &&
            signature.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : null;
  if (format !== declaredType)
    throw new Error("The file must be a JPEG, PNG or WebP matching its type");
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: PHOTO_MAX_PIXELS,
      failOn: "warning",
    }).metadata();
  } catch {
    throw new Error(
      "Photo cannot be read or exceeds 36 megapixels; choose a smaller JPEG",
    );
  }
  if (
    mediaTypes[metadata.format ?? ""] !== declaredType ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error(
      "The file must be a single JPEG, PNG or WebP photo matching its type",
    );
  return acquisitionPhotoMetadataSchema.parse({
    digest: photoDigest(bytes),
    bytes: bytes.length,
    mediaType: declaredType,
    width: metadata.width,
    height: metadata.height,
  });
}

async function filePath(id: string, variant: "raw" | "preview") {
  z.string().uuid().parse(id);
  const configured = process.env.UPLOADS_DATA_PATH;
  if (!configured || !path.isAbsolute(configured))
    throw new Error("Private photo storage is not configured");
  await mkdir(configured, { recursive: true });
  const root = await realpath(configured);
  const directory = path.join(root, "acquisition-v1");
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(directory)) !== directory
  )
    throw new Error("Private photo directory is unsafe");
  return {
    directory,
    file: path.join(
      directory,
      `${id}.${variant === "raw" ? "original" : "preview.jpg"}`,
    ),
  };
}
async function readChecked(file: string, digest?: string) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.size > PHOTO_MAX_BYTES)
    throw new Error("Photo file is unavailable");
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const failures: unknown[] = [];
  let bytes!: Buffer;
  try {
    bytes = await handle.readFile();
    if (digest && photoDigest(bytes) !== digest)
      throw new Error("Photo integrity check failed; restore the original");
  } catch (error) { failures.push(error); }
  try { await handle.close(); } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    const code = (failures[0] as NodeJS.ErrnoException | null)?.code;
    throw Object.assign(new AggregateError(failures, "Photo read and close failed", { cause: failures[0] }),
      typeof code === "string" ? { code } : {});
  }
  return bytes;
}
export async function readAcquisitionPhotoBytes(
  id: string,
  variant: "raw" | "preview",
  digest?: string,
) {
  return readChecked((await filePath(id, variant)).file, digest);
}
export async function writeAcquisitionPhotoBytes(
  id: string,
  bytes: Buffer,
  variant: "raw" | "preview",
  digest: string,
) {
  if (bytes.length > PHOTO_MAX_BYTES || photoDigest(bytes) !== digest)
    throw new Error("Photo integrity check failed");
  const { directory, file } = await filePath(id, variant);
  const failures: unknown[] = [];
  async function syncDirectory() {
    // A complete file may come from a publication whose directory sync failed.
    // Retry that durability barrier before acknowledging existing bytes too.
    if (process.platform === "win32") return;
    let dir;
    try {
      dir = await open(directory, "r");
      await dir.sync();
    } catch (error) { failures.push(error); }
    try { await dir?.close(); } catch (error) { failures.push(error); }
  }
  function finish() {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      const code = (failures[0] as NodeJS.ErrnoException | null)?.code;
      throw Object.assign(new AggregateError(failures, "Photo write and cleanup failed", { cause: failures[0] }),
        typeof code === "string" ? { code } : {});
    }
  }
  let existing = false;
  try {
    await readChecked(file, digest);
    existing = true;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    await syncDirectory();
    finish();
    return;
  }
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3 + bytes.length)
    throw new Error(
      "Photo storage needs at least 2 GB free; free space before retrying",
    );
  const temporary = path.join(directory, `${id}.${randomUUID()}.part`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, file);
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      await readChecked(file, digest);
    }
    await syncDirectory();
  } catch (error) {
    failures.push(error);
  } finally {
    // Closing an interrupted write must not skip partial-file cleanup or hide
    // the original storage failure behind a later cleanup error.
    try { await handle?.close(); } catch (error) { failures.push(error); }
    try { await unlink(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") failures.push(error);
    }
  }
  finish();
}
export async function canonicalizeAcquisitionPhoto(
  id: string,
  digest: string,
  signal: AbortSignal,
) {
  const bytes = await readAcquisitionPhotoBytes(id, "raw", digest);
  if (signal.aborted) throw new Error("Photo preparation aborted");
  const pipeline = sharp(bytes, {
    limitInputPixels: PHOTO_MAX_PIXELS,
    failOn: "warning",
  })
    .autoOrient()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 });
  const abort = () => pipeline.destroy(new Error("Photo preparation aborted"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    if (signal.aborted) throw new Error("Photo preparation aborted");
    const digest = photoDigest(result.data);
    await writeAcquisitionPhotoBytes(id, result.data, "preview", digest);
    return {
      version: 1,
      photoId: id,
      previewDigest: digest,
      width: result.info.width,
      height: result.info.height,
      bytes: result.data.length,
      execution: "CPU",
      pipeline: "sharp-0.35.4-orient-1600-v1",
    };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function readBoundedPhotoBody(request: Request) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > PHOTO_MAX_BYTES)
    throw new Error("Use a photo smaller than 10 MB");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Choose a photo");
  const chunks: Buffer[] = [];
  let total = 0;
  let pending: Buffer | undefined;
  let used = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > PHOTO_MAX_BYTES)
        throw new Error("Use a photo smaller than 10 MB");
      // Own and pack the bytes: retaining each incoming view can keep a much
      // larger backing buffer alive, even for empty or one-byte fragments.
      let offset = 0;
      while (offset < value.length) {
        pending ??= Buffer.allocUnsafe(64 * 1024);
        const count = Math.min(pending.length - used, value.length - offset);
        pending.set(value.subarray(offset, offset + count), used);
        used += count;
        offset += count;
        if (used === pending.length) {
          chunks.push(pending);
          pending = undefined;
          used = 0;
        }
      }
    }
    if (pending) chunks.push(pending.subarray(0, used));
    return Buffer.concat(chunks, total);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const photoTemporarySuffix = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.part$/i;
function photoTemporaryName(name: string, id: string) {
  return name.startsWith(`${id}.`) && photoTemporarySuffix.test(name.slice(id.length + 1));
}

/** One streaming discovery per selected purge batch, retaining only its IDs.
 * Callers still hold/recheck their normal expiry, pin and session authority. */
export async function findAcquisitionPhotoTemporaryFiles(ids: readonly string[]) {
  const selected = new Map<string, string[]>();
  for (const id of ids) selected.set(z.string().uuid().parse(id), []);
  if (!selected.size) return selected;
  const { directory } = await filePath(ids[0], "raw");
  for await (const entry of await opendir(directory, { bufferSize: 256 })) {
    const id = entry.name.slice(0, 36), names = selected.get(id);
    if (names && photoTemporaryName(entry.name, id)) names.push(entry.name);
  }
  return selected;
}

/** Exact UUID-named originals/previews and writer temporaries only. Missing bytes mean a prior interrupted purge
 * already removed them. Never traverse a directory or follow a file symlink. */
export async function removeAcquisitionPhotoBytes(id: string, temporaryFiles?: readonly string[]) {
  for (const variant of ["raw", "preview"] as const) {
    const { file } = await filePath(id, variant);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("Private photo file is unsafe");
      await unlink(file);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const { directory } = await filePath(id, "raw");
  const temporary = temporaryFiles ?? (await findAcquisitionPhotoTemporaryFiles([id])).get(id)!;
  for (const name of temporary) {
    if (!photoTemporaryName(name, id)) throw new Error("Private photo temporary is unsafe");
    const file = path.join(directory, name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Private photo file is unsafe");
      await unlink(file);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (process.platform !== "win32") {
    const handle = await open(directory, "r");
    const failures: unknown[] = [];
    try { await handle.sync(); } catch (error) { failures.push(error); }
    try { await handle.close(); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      const code = (failures[0] as NodeJS.ErrnoException | null)?.code;
      throw Object.assign(new AggregateError(failures, "Photo removal directory sync and close failed", { cause: failures[0] }),
        typeof code === "string" ? { code } : {});
    }
  }
}
