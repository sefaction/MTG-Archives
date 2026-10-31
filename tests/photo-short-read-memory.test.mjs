import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = fs.readFileSync(process.env.PHOTO_SHORT_READ_SOURCE ?? new URL("../lib/acquisition-files.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("acquisition-files.ts", source, ts.ScriptTarget.Latest, true);
const actual = ["photoDigest", "filePath", "readChecked", "readAcquisitionPhotoBytes"].map(name => {
  const declaration = tree.statements.find(node =>
    (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === name)));
  assert.ok(declaration, "Complete production declaration: " + name);
  return ts.transpileModule(declaration.getText(tree).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}).join("\n");
const MAX = 10 * 1024 * 1024;
const CHUNK = 64 * 1024;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture(options, check) {
  const parent = path.resolve(".local-data");
  await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, "short-read-memory-"));
  const directory = path.join(root, "acquisition-v1");
  await fsp.mkdir(directory);
  const id = randomUUID(), variant = options.variant ?? "raw";
  const file = path.join(directory, id + (variant === "raw" ? ".original" : ".preview.jpg"));
  const neighbor = path.join(directory, randomUUID() + ".original");
  const bytes = Buffer.from(Array.from({ length: options.size ?? 377 }, (_, i) => i % 251));
  await fsp.writeFile(file, bytes);
  await fsp.writeFile(neighbor, "independent protected original");
  let opened = 0, closed = 0, reads = 0, consumed = 0, retained = 0, chunks = 0, concatenated = false;
  const observedBuffer = new Proxy(Buffer, { get(target, key) {
    if (key === "concat") return (values, total) => {
      concatenated = true;
      chunks = values.length;
      retained = [...new Set(values.map(value => value.buffer))].reduce((sum, value) => sum + value.byteLength, 0);
      return Buffer.concat(values, total);
    };
    return Reflect.get(target, key);
  } });
  const read = vm.runInNewContext(actual + "\nreadAcquisitionPhotoBytes", {
    Buffer: observedBuffer, AggregateError, Error, createHash, constants, path, z, PHOTO_MAX_BYTES: MAX,
    process: { env: { UPLOADS_DATA_PATH: root } }, mkdir: fsp.mkdir, realpath: fsp.realpath, lstat: fsp.lstat,
    open: async (name, flags) => {
      assert.equal(name, file);
      assert.equal(flags, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const handle = await fsp.open(name, flags);
      opened++;
      return {
        read: async (buffer, offset, length, position) => {
          reads++;
          if (reads === options.readFailureAt) throw options.readError;
          const result = await handle.read(buffer, offset, Math.min(length, options.shortRead ?? 1), position);
          consumed += result.bytesRead;
          return result;
        },
        close: async () => {
          await handle.close();
          closed++;
          if (options.closeError) throw options.closeError;
        },
      };
    },
  });
  try {
    await check({ read: expected => read(id, variant, expected), bytes,
      counts: () => ({ opened, closed, reads, consumed, retained, chunks, concatenated }) });
    assert.deepEqual(await fsp.readFile(file), bytes, "Read leaves source bytes intact");
    assert.equal(await fsp.readFile(neighbor, "utf8"), "independent protected original");
  } finally {
    assert.equal(opened, closed, "Every real descriptor closes before retiring the fixture");
    assert.ok(root.startsWith(parent + path.sep) && path.basename(root).startsWith("short-read-memory-"));
    assert.equal((await fsp.lstat(root)).isSymbolicLink(), false);
    assert.equal(await fsp.realpath(root), root);
    await fsp.rm(root, { recursive: true, force: true });
  }
}

for (const variant of ["raw", "preview"]) for (const withDigest of [false, true]) {
  test(`small one-byte ${variant} reads retain bounded backing storage (${withDigest ? "digest" : "no digest"})`, () =>
    fixture({ variant }, async ({ read, bytes, counts }) => {
      assert.deepEqual(await read(withDigest ? digest(bytes) : undefined), bytes);
      const observed = counts();
      assert.equal(observed.consumed, bytes.length);
      assert.equal(observed.reads, bytes.length + 1, "Real one-byte reads followed by EOF");
      assert.equal(observed.concatenated, true);
      assert.ok(observed.retained <= CHUNK, "A small payload retains at most one owned chunk");
      assert.ok(observed.chunks <= 1, "Short fragments do not become retained array entries");
    }));

  test(`chunk-boundary ${variant} reads preserve bytes with bounded backing (${withDigest ? "digest" : "no digest"})`, () =>
    fixture({ variant, size: CHUNK + 13, shortRead: 4093 }, async ({ read, bytes, counts }) => {
      assert.deepEqual(await read(withDigest ? digest(bytes) : undefined), bytes);
      assert.equal(counts().consumed, bytes.length);
      assert.ok(counts().retained <= 2 * CHUNK, "Two payload chunks bound retained backing across partial reads");
      assert.ok(counts().chunks <= 2);
    }));
}

test("one-byte reads across a complete chunk keep exact order and digest", () =>
  fixture({ size: CHUNK + 3 }, async ({ read, bytes, counts }) => {
    assert.deepEqual(await read(digest(bytes)), bytes);
    assert.equal(counts().reads, bytes.length + 1);
    assert.equal(counts().consumed, bytes.length);
    assert.ok(counts().retained <= 2 * CHUNK);
    assert.ok(counts().chunks <= 2);
  }));

for (const alsoClose of [false, true]) test(`partial short-read failure retains its primary cause (${alsoClose ? "close failure" : "successful close"})`, () => {
  const readError = Object.assign(Error("controlled partial read failure"), { code: "EIO" });
  const closeError = alsoClose ? Object.assign(Error("controlled close failure"), { code: "ENOENT" }) : undefined;
  return fixture({ shortRead: 7, readFailureAt: 3, readError, closeError }, async ({ read, counts }) => {
    await assert.rejects(read(), error => {
      if (alsoClose) {
        assert.deepEqual(error.errors, [readError, closeError]);
        assert.equal(error.cause, readError);
        assert.equal(error.code, "EIO");
      } else assert.equal(error, readError);
      return true;
    });
    assert.equal(counts().consumed, 14);
    assert.equal(counts().concatenated, false);
  });
});

test("short-read digest mismatch precedes close failure without borrowing its code", () => {
  const closeError = Object.assign(Error("controlled close failure"), { code: "ENOENT" });
  return fixture({ shortRead: 7, closeError }, async ({ read, counts }) => {
    await assert.rejects(read("0".repeat(64)), error => {
      assert.match(error.cause.message, /Photo integrity check failed/);
      assert.deepEqual(error.errors, [error.cause, closeError]);
      assert.equal(Object.hasOwn(error, "code"), false);
      return true;
    });
    assert.equal(counts().consumed, 377);
  });
});
