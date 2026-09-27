import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  inspectAcquisitionCatalogFile,
  readAcquisitionCatalogFile,
} from "../lib/acquisition-catalog-file";
test("catalog file streams UTF-8 JSONL and rejects duplicate identities, truncation and oversized lines", async () => {
  const root = path.join(process.cwd(), ".local-data");
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, "acquisition-catalog-test-"));
  const file = path.join(folder, "cards.jsonl.gz");
  const card = {
    object: "card",
    id: randomUUID(),
    name: "Card \u00e9",
    set: "tst",
    set_name: "Test",
    collector_number: "123a",
    rarity: "common",
    cmc: 0,
    color_identity: [],
    lang: "fr",
  };
  try {
    await writeFile(file, gzipSync(JSON.stringify(card) + "\n"));
    const source = await inspectAcquisitionCatalogFile(file);
    assert.equal(source.rows, 1);
    const records = [];
    for await (const row of readAcquisitionCatalogFile(file)) records.push(row);
    assert.deepEqual(records, [card]);
    await writeFile(
      file,
      gzipSync(JSON.stringify(card) + "\n" + JSON.stringify(card) + "\n"),
    );
    await assert.rejects(
      inspectAcquisitionCatalogFile(file),
      /Duplicate identity/,
    );
    await writeFile(file, gzipSync(JSON.stringify(card)).subarray(0, 30));
    await assert.rejects(inspectAcquisitionCatalogFile(file));
    await writeFile(file, gzipSync("x".repeat(1024 ** 2 + 1)));
    await assert.rejects(inspectAcquisitionCatalogFile(file), /1 MiB/);
  } finally {
    await unlink(file);
    await rmdir(folder);
  }
});
