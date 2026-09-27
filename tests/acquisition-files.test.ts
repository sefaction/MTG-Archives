import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  inspectAcquisitionPhoto,
  photoDigest,
  writeAcquisitionPhotoBytes,
  readAcquisitionPhotoBytes,
  canonicalizeAcquisitionPhoto,
  readBoundedPhotoBody,
  PHOTO_MAX_BYTES,
} from "../lib/acquisition-files";

test("private photo bytes, format/size/path checks and canonical orientation", async () => {
  const parent = path.resolve(".local-data");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "acq-files-test-"));
  const old = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  try {
    const bytes = await sharp({
      create: { width: 80, height: 120, channels: 3, background: "#123456" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const metadata = await inspectAcquisitionPhoto(bytes, "image/jpeg");
    assert.equal(metadata.width, 80);
    await assert.rejects(
      inspectAcquisitionPhoto(bytes, "image/png"),
      /matching its type/,
    );
    await assert.rejects(
      inspectAcquisitionPhoto(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        "image/jpeg",
      ),
      /matching its type/,
    );
    await assert.rejects(inspectAcquisitionPhoto(bytes, "image/heic"), /HEIC/);
    await assert.rejects(
      inspectAcquisitionPhoto(Buffer.alloc(PHOTO_MAX_BYTES + 1), "image/jpeg"),
      /10 MB/,
    );
    await assert.rejects(readAcquisitionPhotoBytes("../outside", "raw"));
    const id = randomUUID();
    await Promise.all(
      [1, 2].map(() =>
        writeAcquisitionPhotoBytes(id, bytes, "raw", metadata.digest),
      ),
    );
    assert.deepEqual(
      await readAcquisitionPhotoBytes(id, "raw", metadata.digest),
      bytes,
    );
    const canonical = await canonicalizeAcquisitionPhoto(
      id,
      metadata.digest,
      new AbortController().signal,
    );
    assert.equal(canonical.width, 120);
    assert.equal(canonical.height, 80);
    const preview = await readAcquisitionPhotoBytes(
      id,
      "preview",
      canonical.previewDigest,
    );
    const clean = await sharp(preview).metadata();
    assert.equal(clean.exif, undefined);
    await writeFile(
      path.join(root, "acquisition-v1", `${id}.original`),
      Buffer.from("corruption"),
    );
    await assert.rejects(
      readAcquisitionPhotoBytes(id, "raw", metadata.digest),
      /integrity/,
    );
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: bytes,
    });
    assert.equal(
      photoDigest(await readBoundedPhotoBody(request)),
      metadata.digest,
    );
    await assert.rejects(
      readBoundedPhotoBody(
        new Request("http://localhost/upload", {
          method: "POST",
          body: bytes,
          headers: { "Content-Length": String(PHOTO_MAX_BYTES + 1) },
        }),
      ),
      /10 MB/,
    );
  } finally {
    if (old === undefined) delete process.env.UPLOADS_DATA_PATH;
    else process.env.UPLOADS_DATA_PATH = old;
    if (
      !root.startsWith(parent + path.sep) ||
      !path.basename(root).startsWith("acq-files-test-")
    )
      throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
