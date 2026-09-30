import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, realpath, lstat, open, link, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scannerCanonical } from "./scanner-run-protocol";

// Outside the database and disposable image. A rolled-back unclaimed database
// cannot authorize a second START after its durable claim marker was written.
async function directory() {
  const configured = process.env.UPLOADS_DATA_PATH;
  if (!configured || !path.isAbsolute(configured)) throw new Error("Private scanner storage unavailable");
  await mkdir(configured, { recursive: true });
  const root = await realpath(configured), dir = path.join(root, "scanner-control-v1");
  await mkdir(dir, { recursive: true });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(dir) !== dir)
    throw new Error("Private scanner storage unavailable");
  return dir;
}
async function read(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("Scanner control evidence unavailable");
  const input = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { return JSON.parse(await input.readFile("utf8")); } finally { await input.close(); }
}
async function writeOnce(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.pending`, output = await open(temporary, "wx", 0o600);
  try { await output.writeFile(JSON.stringify(value)); await output.sync(); } finally { await output.close(); }
  let created = false;
  try {
    try { await link(temporary, file); created = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (process.platform !== "win32") {
      const dir = await open(path.dirname(file), "r");
      try { await dir.sync(); } finally { await dir.close(); }
    }
    return { created, actual: await read(file) };
  } finally { await unlink(temporary); }
}
export async function scannerSiteEpoch(): Promise<string> {
  const file = path.join(await directory(), "site-epoch.json");
  let value: unknown;
  try { value = await read(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    value = (await writeOnce(file, { version: 1, epoch: randomUUID() })).actual;
  }
  return z.object({ version: z.literal(1), epoch: z.string().uuid() }).strict().parse(value).epoch;
}
export async function persistScannerStartMarker(runId: string, epoch: string, executionId: string) {
  for (const id of [runId, epoch, executionId]) z.string().uuid().parse(id);
  const desired = { version: 1, runId, epoch, executionId };
  const result = await writeOnce(path.join(await directory(), `${runId}.start.json`), desired);
  if (scannerCanonical(result.actual) !== scannerCanonical(desired)) throw new Error("Scanner start evidence needs reconciliation");
  return result.created;
}
export async function scannerStartMarkerExists(runId: string) {
  z.string().uuid().parse(runId);
  try { await read(path.join(await directory(), `${runId}.start.json`)); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
