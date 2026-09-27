import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  beginAcquisitionCatalog,
  applyAcquisitionCatalogBatch,
  finishAcquisitionCatalog,
} from "../lib/acquisition-catalog";
import {
  inspectAcquisitionCatalogFile,
  readAcquisitionCatalogFile,
  acquisitionCatalogFileDigest,
} from "../lib/acquisition-catalog-file";

// First release is an explicit LOCAL operator job. A production/admin-web
// scheduler is not implicitly enabled by adding this script.
const args = process.argv.slice(2);
function arg(name: string) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error(`Required ${name}`);
  return args[i + 1];
}
const dbUrl = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname)
)
  throw new Error(
    "Catalog import requires the local opt-in and a loopback database",
  );
const db = new PrismaClient();
const actor = { userId: arg("--admin-user-id"), adminMode: true };
const report = (data: unknown) =>
  console.log(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
async function main() {
  const file = arg("--file");
  const metadata = z
    .object({
      type: z.literal("default_cards"),
      updated_at: z.string().datetime({ offset: true }),
      jsonl_download_uri: z.string().url(),
      compressed_size: z.number().int().positive(),
    })
    .parse(JSON.parse(await readFile(arg("--metadata"), "utf8")));
  const url = new URL(metadata.jsonl_download_uri);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "data.scryfall.io" ||
    !url.pathname.endsWith(".jsonl.gz")
  )
    throw new Error("Use official Scryfall JSONL gzip metadata");
  const source = await inspectAcquisitionCatalogFile(file);
  if (source.bytes !== metadata.compressed_size)
    throw new Error("Catalog byte count differs from metadata");
  let run = await beginAcquisitionCatalog(db, actor, {
    sourceDigest: source.digest,
    sourceType: "scryfall-default-jsonl-gzip-v1",
    sourceUpdatedAt: metadata.updated_at,
    sourceBytes: source.bytes,
    expectedRows: source.rows,
  });
  report({
    event: "catalog-start",
    id: run.id,
    expectedRows: run.expectedRows,
    processedRows: run.processedRows,
    status: run.status,
  });
  if (run.status === "COMPLETE") return;
  const started = Date.now();
  let row = 0,
    offset = 0;
  let batch: unknown[] = [];
  try {
    for await (const card of readAcquisitionCatalogFile(file)) {
      if (row++ < run.processedRows) continue;
      if (!batch.length) offset = row - 1;
      batch.push(card);
      if (batch.length === 128) {
        const result = await applyAcquisitionCatalogBatch(
          db,
          actor,
          run.id,
          offset,
          batch,
        );
        batch = [];
        // The loop's skip cursor stays at the initial saved position. Returned
        // progress is only for reporting, not for skipping unread rows.
        if (result.run.processedRows % 2048 === 0)
          report({
            event: "catalog-progress",
            rows: result.run.processedRows,
            elapsedMs: Date.now() - started,
          });
      }
    }
    if (batch.length)
      await applyAcquisitionCatalogBatch(db, actor, run.id, offset, batch);
    const after = await acquisitionCatalogFileDigest(file);
    if (
      after.bytes !== source.bytes ||
      after.digest !== source.digest ||
      row !== source.rows
    )
      throw new Error("Catalog source changed during import");
    run = await finishAcquisitionCatalog(db, actor, run.id, after.digest);
    report({
      event: "catalog-complete",
      ...run,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    await db.acquisitionCatalogRefresh.updateMany({
      where: { id: run.id, status: { not: "COMPLETE" } },
      data: { status: "FAILED", errorCode: "IMPORT_INTERRUPTED" },
    });
    throw error;
  }
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
