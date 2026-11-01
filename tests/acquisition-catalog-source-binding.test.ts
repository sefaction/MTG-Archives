import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  acquisitionCatalogFileDigest,
  inspectAcquisitionCatalogFile,
  readAcquisitionCatalogFile,
} from "../lib/acquisition-catalog-file";

async function fixture() {
  const root = path.join(process.cwd(), ".local-data");
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, "catalog-stream-binding-"));
  const file = path.join(folder, "source.jsonl.gz");
  const card = {
    object: "card", id: randomUUID(), name: "Card a", set: "tst",
    set_name: "Test", collector_number: "123a", rarity: "common",
    color_identity: [], lang: "en", digital: false, games: ["paper"],
  };
  const bytes = gzipSync(JSON.stringify(card) + "\n");
  await writeFile(file, bytes);
  return { file, folder, card, bytes };
}

test("catalogue stream verifies the bytes it parses against the inspected source", async () => {
  const f = await fixture();
  try {
    const source = await inspectAcquisitionCatalogFile(f.file);
    const rows = [];
    for await (const row of readAcquisitionCatalogFile(f.file, source)) rows.push(row);
    assert.deepEqual(rows, [f.card]);
    assert.equal(source.rows, 1);
  } finally {
    await unlink(f.file);
    await rmdir(f.folder);
  }
});

test("restoring the original path after parsing a different same-size source cannot validate the stream", async () => {
  const f = await fixture();
  let stream: ReturnType<typeof readAcquisitionCatalogFile> | undefined;
  try {
    const source = await inspectAcquisitionCatalogFile(f.file);
    let different: { bytes: Buffer; card: typeof f.card } | undefined;
    for (const suffix of "bcdefghijklmnopqrstuvwxyz") {
      const card = { ...f.card, name: "Card " + suffix };
      const bytes = gzipSync(JSON.stringify(card) + "\n");
      if (bytes.length === f.bytes.length) { different = { bytes, card }; break; }
    }
    assert.ok(different, "A different valid same-size gzip is required");
    await writeFile(f.file, different.bytes);
    stream = readAcquisitionCatalogFile(f.file, source);
    let rowsPublished = 0;
    const consume = async () => {
      try {
        const first = await stream!.next();
        if (!first.done) {
          rowsPublished++;
          assert.equal(first.value?.name, different!.card.name);
          // The old reader yields B, then an independent path check sees A.
          await writeFile(f.file, f.bytes);
        }
        await stream!.next();
      } finally { await writeFile(f.file, f.bytes); }
    };
    await assert.rejects(consume(), /Catalog source changed during read/);
    assert.equal(rowsPublished, 0, "Unverified rows cannot enter a committed import batch");
    assert.deepEqual(await acquisitionCatalogFileDigest(f.file), {
      digest: source.digest, bytes: source.bytes,
    });
  } finally {
    await stream?.return(undefined);
    await unlink(f.file);
    await rmdir(f.folder);
  }
});

test("an inspected import keeps parsing its verified bytes when the original file changes between batches", async () => {
  const f = await fixture();
  let stream: ReturnType<typeof readAcquisitionCatalogFile> | undefined;
  try {
    const second = { ...f.card, id: randomUUID(), name: "Second card" };
    await writeFile(f.file, gzipSync(JSON.stringify(f.card) + "\n" + JSON.stringify(second) + "\n"));
    const source = await inspectAcquisitionCatalogFile(f.file);
    stream = readAcquisitionCatalogFile(f.file, source);
    assert.deepEqual((await stream.next()).value, f.card);
    await writeFile(f.file, gzipSync(JSON.stringify({ ...second, name: "Changed source" }) + "\n"));
    assert.deepEqual((await stream.next()).value, second);
    assert.equal((await stream.next()).done, true);
  } finally {
    await stream?.return(undefined);
    await unlink(f.file);
    await rmdir(f.folder);
  }
});
