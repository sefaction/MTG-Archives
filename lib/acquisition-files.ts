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
  try {
    const bytes = await handle.readFile();
    if (digest && photoDigest(bytes) !== digest)
      throw new Error("Photo integrity check failed; restore the original");
    return bytes;
  } finally {
    await handle.close();
  }
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
  try {
    await readChecked(file, digest);
    return;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
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
    // Sync the directory on Linux (the Docker runtime). Windows may not support it.
    if (process.platform !== "win32") {
      const dir = await open(directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
  } finally {
    await handle?.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
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
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > PHOTO_MAX_BYTES)
        throw new Error("Use a photo smaller than 10 MB");
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Exact UUID-named files only. Missing bytes mean a prior interrupted purge
 * already removed them. Never traverse a directory or follow a file symlink. */
export async function removeAcquisitionPhotoBytes(id: string) {
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
  if (process.platform !== "win32") {
    const { directory } = await filePath(id, "raw"),
      handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
