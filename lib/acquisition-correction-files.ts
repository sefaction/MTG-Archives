import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, realpath, lstat, open, link, unlink, opendir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PHOTO_MAX_BYTES, photoDigest } from "./acquisition-files";

export const CORRECTION_LIBRARY_DIRECTORY = "correction-library-v1";
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
async function ownerDirectory(ownerPlayerId: string) {
  z.string().min(1).max(200).parse(ownerPlayerId);
  const configured = process.env.UPLOADS_DATA_PATH;
  if (!configured || !path.isAbsolute(configured)) throw new Error("Private photo storage is not configured");
  await mkdir(configured, { recursive: true });
  const root = await realpath(configured);
  const owner = createHash("sha256").update(ownerPlayerId).digest("hex");
  let directory = root;
  for (const segment of [CORRECTION_LIBRARY_DIRECTORY, owner]) {
    directory = path.join(directory, segment);
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(directory) !== directory)
      throw new Error("Private photo correction directory is unsafe");
  }
  return directory;
}
async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  // Closing the directory must not replace the storage failure that led here.
  const failures: unknown[] = [];
  try { await handle.sync(); } catch (error) { failures.push(error); }
  try { await handle.close(); } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    const code = (failures[0] as NodeJS.ErrnoException | null)?.code;
    throw Object.assign(new AggregateError(failures, "Correction directory sync and close failed", { cause: failures[0] }),
      typeof code === "string" ? { code } : {});
  }
}
async function temporaryDirectory(ownerPlayerId: string) {
  const directory = path.join(await ownerDirectory(ownerPlayerId), "temporary");
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory)
    throw new Error("Private photo correction temporary directory is unsafe");
  return directory;
}
export async function readCorrectionBlob(ownerPlayerId: string, digest: string, expectedBytes: number) {
  digestSchema.parse(digest);
  z.number().int().min(1).max(PHOTO_MAX_BYTES).parse(expectedBytes);
  const file = path.join(await ownerDirectory(ownerPlayerId), `${digest}.original`);
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.size !== expectedBytes) throw new Error("Photo correction integrity check failed");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const failures: unknown[] = [];
  let bytes!: Buffer;
  try {
    // The pathname size can change after lstat. Bound descriptor reads by the
    // recorded size plus one detection byte, including across short reads.
    const buffer = Buffer.alloc(expectedBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== expectedBytes) throw new Error("Photo correction integrity check failed");
    bytes = buffer.subarray(0, total);
    if (photoDigest(bytes) !== digest) throw new Error("Photo correction integrity check failed");
  } catch (error) { failures.push(error); }
  // Closing must not hide a failed read or integrity check, or change the
  // storage code used by correction capture to classify a recoverable failure.
  try { await handle.close(); } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    const code = (failures[0] as NodeJS.ErrnoException | null)?.code;
    throw Object.assign(new AggregateError(failures, "Correction read and close failed", { cause: failures[0] }),
      typeof code === "string" ? { code } : {});
  }
  return bytes;
}

// An existing original may be left by a publication whose directory sync failed.
// Verify its bytes and repeat the durability barrier before releasing source pins.
export async function verifyCorrectionBlobDurability(ownerPlayerId: string, digest: string, expectedBytes: number) {
  await readCorrectionBlob(ownerPlayerId, digest, expectedBytes);
  await syncDirectory(await ownerDirectory(ownerPlayerId));
}

// Preparation is outside the database transaction. Only the current leased
// worker may invoke publish while holding the library owner/blob lock.
export async function prepareCorrectionBlob(ownerPlayerId: string, digest: string, bytes: Buffer, leaseToken: string) {
  digestSchema.parse(digest); z.string().uuid().parse(leaseToken);
  if (!bytes.length || bytes.length > PHOTO_MAX_BYTES || photoDigest(bytes) !== digest) throw new Error("Photo correction integrity check failed");
  const directory = await ownerDirectory(ownerPlayerId), file = path.join(directory, `${digest}.original`);
  const temporary = path.join(await temporaryDirectory(ownerPlayerId), `${digest}.${leaseToken}.${randomUUID()}.part`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
  } catch (error) {
    // A close failure must not skip removal of a partial copy or replace the
    // storage failure that tells the capture worker why it should retry.
    const failures: unknown[] = [error];
    try { await handle?.close(); } catch (failure) { failures.push(failure); }
    try { await unlink(temporary); } catch (failure) {
      if ((failure as NodeJS.ErrnoException | null)?.code !== "ENOENT") failures.push(failure);
    }
    if (failures.length === 1) throw error;
    const code = (error as NodeJS.ErrnoException | null)?.code;
    throw Object.assign(new AggregateError(failures, "Correction preparation and cleanup failed", { cause: error }),
      typeof code === "string" ? { code } : {});
  }
  return {
    async publish() {
      try { await link(temporary, file); }
      catch (error: any) { if (error.code !== "EEXIST") throw error; }
      await verifyCorrectionBlobDurability(ownerPlayerId, digest, bytes.length);
    },
    async cleanup() { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); },
  };
}

export async function removeCorrectionBlob(ownerPlayerId: string, digest: string) {
  digestSchema.parse(digest);
  const directory = await ownerDirectory(ownerPlayerId), file = path.join(directory, `${digest}.original`);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Private photo correction file is unsafe");
    await unlink(file); await syncDirectory(directory);
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
}

// Caller checks live leases before using this exact, validated basename.
export async function staleCorrectionTemporaries(ownerPlayerId: string, cutoff: Date) {
  const directory = await temporaryDirectory(ownerPlayerId), entries = await opendir(directory);
  const found: { name: string; leaseToken: string }[] = [];
  let inspected = 0;
  try {
    for await (const entry of entries) {
      if (++inspected > 200) break;
      const match = /^([a-f0-9]{64})\.([a-f0-9-]{36})\.([a-f0-9-]{36})\.part$/.exec(entry.name);
      if (!match) continue;
      z.string().uuid().parse(match[2]); z.string().uuid().parse(match[3]);
      const info = await lstat(path.join(directory, entry.name));
      if (info.isFile() && !info.isSymbolicLink() && info.mtime < cutoff) found.push({ name: entry.name, leaseToken: match[2] });
    }
  } finally { await entries.close().catch(error => { if (error.code !== "ERR_DIR_CLOSED") throw error; }); }
  return found;
}
export async function removeCorrectionTemporary(ownerPlayerId: string, name: string) {
  if (!/^[a-f0-9]{64}\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.part$/.test(name)) throw new Error("Private photo correction temporary is unsafe");
  const file = path.join(await temporaryDirectory(ownerPlayerId), name);
  try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error("Private photo correction temporary is unsafe"); await unlink(file); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
}
