import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, readFile, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { photoDigest, writeAcquisitionPhotoBytes, removeAcquisitionPhotoBytes } from "../lib/acquisition-files";
import { prepareCorrectionBlob, readCorrectionBlob, removeCorrectionBlob } from "../lib/acquisition-correction-files";
async function fixture(work: (root: string) => Promise<void>) {
  await mkdir(path.resolve(".local-data"), { recursive: true });
  const root = await mkdtemp(path.resolve(".local-data/correction-files-")), previous = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  try { await work(root); }
  finally { if (previous === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = previous; await rm(root, { recursive: true, force: true }); }
}
test("a published library original survives batch deletion and stays isolated by owner", async () => fixture(async () => {
  const bytes = Buffer.from("synthetic independent original"), digest = photoDigest(bytes), photo = randomUUID();
  await writeAcquisitionPhotoBytes(photo, bytes, "raw", digest);
  const staged = await prepareCorrectionBlob("owner-a", digest, bytes, randomUUID());
  try {
    await assert.rejects(readCorrectionBlob("owner-a", digest, bytes.length), /ENOENT/);
    await staged.publish();
    await removeAcquisitionPhotoBytes(photo);
    assert.deepEqual(await readCorrectionBlob("owner-a", digest, bytes.length), bytes);
    await assert.rejects(readCorrectionBlob("owner-b", digest, bytes.length), /ENOENT/);
    const duplicate = await prepareCorrectionBlob("owner-a", digest, bytes, randomUUID());
    try { await duplicate.publish(); } finally { await duplicate.cleanup(); }
    assert.deepEqual(await readCorrectionBlob("owner-a", digest, bytes.length), bytes);
    await removeCorrectionBlob("owner-a", digest); await removeCorrectionBlob("owner-a", digest);
    await assert.rejects(readCorrectionBlob("owner-a", digest, bytes.length), /ENOENT/);
  } finally { await staged.cleanup(); }
}));
test("corruption, wrong digest/size and unsafe identifiers never become verified originals", async () => fixture(async root => {
  const bytes = Buffer.from("synthetic original"), digest = photoDigest(bytes), owner = "owner";
  await assert.rejects(prepareCorrectionBlob(owner, "a".repeat(64), bytes, randomUUID()), /integrity/);
  await assert.rejects(prepareCorrectionBlob(owner, "../outside", bytes, randomUUID()));
  const staged = await prepareCorrectionBlob(owner, digest, bytes, randomUUID());
  try {
    await staged.publish();
    await assert.rejects(readCorrectionBlob(owner, digest, bytes.length + 1), /integrity/);
    const file = path.join(root, "correction-library-v1", createHash("sha256").update(owner).digest("hex"), `${digest}.original`);
    await writeFile(file, Buffer.alloc(bytes.length, 120));
    assert.equal((await readFile(file)).length, bytes.length);
    await assert.rejects(readCorrectionBlob(owner, digest, bytes.length), /integrity/);
    const retry = await prepareCorrectionBlob(owner, digest, bytes, randomUUID());
    try { await assert.rejects(retry.publish(), /integrity/); } finally { await retry.cleanup(); }
  } finally { await staged.cleanup(); }
}));
test("a linked library namespace cannot redirect copies into another directory", async () => fixture(async root => {
  const other = path.join(root, "owned-other-directory"); await mkdir(other);
  await symlink(other, path.join(root, "correction-library-v1"), process.platform === "win32" ? "junction" : "dir");
  const bytes = Buffer.from("synthetic original"), digest = photoDigest(bytes);
  await assert.rejects(prepareCorrectionBlob("owner", digest, bytes, randomUUID()), /unsafe/);
}));
