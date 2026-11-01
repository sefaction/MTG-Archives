import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, open, unlink, rmdir, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import { acquisitionCatalogCardSchema } from "./acquisition-catalog";

type CatalogFileIdentity = { digest: string; bytes: number };

// Capture compressed bytes into one privately owned descriptor before yielding
// records. Checking the source path again later cannot identify the bytes that
// the parser consumed, and import batches may already have committed by then.
async function captureCatalogFile(file: string, expected: CatalogFileIdentity) {
  if (!/^[a-f0-9]{64}$/.test(expected.digest) ||
      !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > 1024 ** 3)
    throw new Error("Invalid expected catalog source identity");
  const folder = await mkdtemp(path.join(tmpdir(), "mtg-catalog-source-"));
  const captured = path.join(folder, "source.gz");
  let handle: FileHandle | undefined;
  let created = false;
  const cleanup = async () => {
    const failures: unknown[] = [];
    if (handle) {
      const current = handle; handle = undefined;
      try { await current.close(); } catch (error) { failures.push(error); }
    }
    if (created) {
      try { await unlink(captured); } catch (error) { failures.push(error); }
    }
    try { await rmdir(folder); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Catalog source snapshot cleanup failed");
  };
  try {
    handle = await open(captured, "wx+", 0o600);
    created = true;
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(file)) {
      const data = chunk as Buffer;
      bytes += data.length;
      if (bytes > expected.bytes || bytes > 1024 ** 3)
        throw new Error("Catalog source changed during read");
      hash.update(data);
      for (let offset = 0; offset < data.length;) {
        const written = await handle.write(data, offset, data.length - offset, null);
        if (written.bytesWritten < 1) throw new Error("Catalog source snapshot write made no progress");
        offset += written.bytesWritten;
      }
    }
    if (bytes !== expected.bytes || hash.digest("hex") !== expected.digest)
      throw new Error("Catalog source changed during read");
    return { handle, cleanup };
  } catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Catalog source capture and cleanup failed"); }
    throw error;
  }
}

// Stream JSONL without buffering the full catalog, including a malformed giant
// line. Bound imports parse the same verified compressed snapshot, using at
// most 1 GiB temporary disk rather than an unbounded in-memory catalog.
export async function* readAcquisitionCatalogFile(file: string, expected?: CatalogFileIdentity) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > 1024 ** 3
  )
    throw new Error("Use a regular catalog gzip smaller than 1 GiB");
  const snapshot = expected ? await captureCatalogFile(file, expected) : undefined;
  const source = snapshot
    ? snapshot.handle.createReadStream({ start: 0, autoClose: false })
    : createReadStream(file);
  const gunzip = createGunzip();
  source.on("error", (error) => gunzip.destroy(error));
  source.pipe(gunzip);
  const decoder = new StringDecoder("utf8");
  let pending = "",
    bytes = 0;
  let failed = false;
  let failure: unknown;
  try {
    for await (const chunk of gunzip) {
      bytes += chunk.length;
      if (bytes > 4 * 1024 ** 3)
        throw new Error("Expanded catalog exceeds 4 GiB");
      pending += decoder.write(chunk);
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.length > 1024 ** 2)
          throw new Error("Catalog record exceeds 1 MiB");
        if (line.trim())
          yield acquisitionCatalogCardSchema.parse(JSON.parse(line));
      }
      if (pending.length > 1024 ** 2)
        throw new Error("Catalog record exceeds 1 MiB");
    }
    pending += decoder.end();
    if (pending.trim())
      yield acquisitionCatalogCardSchema.parse(JSON.parse(pending));
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    source.destroy();
    gunzip.destroy();
    if (snapshot) {
      try { await snapshot.cleanup(); }
      catch (cleanupError) {
        if (failed)
          throw new AggregateError([failure, cleanupError], "Catalog parsing and snapshot cleanup failed");
        throw cleanupError;
      }
    }
  }
}
export async function acquisitionCatalogFileDigest(file: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > 1024 ** 3) throw new Error("Catalog file exceeds 1 GiB");
    hash.update(chunk);
  }
  return { digest: hash.digest("hex"), bytes };
}
export async function inspectAcquisitionCatalogFile(file: string) {
  const source = await acquisitionCatalogFileDigest(file);
  let rows = 0;
  const identities = new Set<string>();
  for await (const card of readAcquisitionCatalogFile(file, source)) {
    if (identities.has(card.id))
      throw new Error("Duplicate identity in catalog source");
    identities.add(card.id);
    if (++rows > 2000000) throw new Error("Catalog row limit exceeded");
  }
  if (!rows) throw new Error("Catalog is empty");
  return { ...source, rows };
}
