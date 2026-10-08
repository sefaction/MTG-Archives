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
  try { await handle.sync(); } finally { await handle.close(); }
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
  try {
    const bytes = await handle.readFile();
    if (bytes.length !== expectedBytes || photoDigest(bytes) !== digest) throw new Error("Photo correction integrity check failed");
    return bytes;
  } finally { await handle.close(); }
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
    await handle?.close(); await unlink(temporary).catch(e => { if (e.code !== "ENOENT") throw e; }); throw error;
  }
  return {
    async publish() {
      try { await link(temporary, file); }
      catch (error: any) { if (error.code !== "EEXIST") throw error; }
      await readCorrectionBlob(ownerPlayerId, digest, bytes.length);
      await syncDirectory(directory);
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
