import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import { acquisitionCatalogCardSchema } from "./acquisition-catalog";

// Stream JSONL without buffering the full catalog, including a malformed giant
// line. This is an explicitly supplied maintenance file, not an upload endpoint.
export async function* readAcquisitionCatalogFile(file: string) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > 1024 ** 3
  )
    throw new Error("Use a regular catalog gzip smaller than 1 GiB");
  const source = createReadStream(file);
  const gunzip = createGunzip();
  source.on("error", (error) => gunzip.destroy(error));
  source.pipe(gunzip);
  const decoder = new StringDecoder("utf8");
  let pending = "",
    bytes = 0;
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
  } finally {
    source.destroy();
    gunzip.destroy();
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
  for await (const card of readAcquisitionCatalogFile(file)) {
    if (identities.has(card.id))
      throw new Error("Duplicate identity in catalog source");
    identities.add(card.id);
    if (++rows > 2000000) throw new Error("Catalog row limit exceeded");
  }
  if (!rows) throw new Error("Catalog is empty");
  return { ...source, rows };
}
