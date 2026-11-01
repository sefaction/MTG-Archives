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

// Compile complete production declarations, with real files and descriptors.
const source = fs.readFileSync(process.env.PHOTO_BOUNDED_READ_SOURCE ?? new URL("../lib/acquisition-files.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("acquisition-files.ts", source, ts.ScriptTarget.Latest, true);
const actual = ["filePath", "readChecked", "readAcquisitionPhotoBytes"].map(name => {
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, "Complete production declaration: " + name);
  return ts.transpileModule(declaration.getText(tree).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}).join("\n");
const MAX = 10 * 1024 * 1024;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture(options, check) {
  const parent = path.resolve(".local-data");
  await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, "bounded-photo-read-"));
  const directory = path.join(root, "acquisition-v1");
  await fsp.mkdir(directory);
  const id = randomUUID(), variant = options.variant ?? "raw";
  const file = path.join(directory, id + (variant === "raw" ? ".original" : ".preview.jpg"));
  const neighbor = path.join(directory, randomUUID() + ".original");
  const bytes = options.bytes ?? Buffer.from("synthetic immutable original");
  await fsp.writeFile(file, bytes);
  await fsp.writeFile(neighbor, "independent protected original");
  let opened = 0, closed = 0, readBytes = 0, reads = 0;
  const context = {
    AggregateError, Error, Buffer, constants, path, z, PHOTO_MAX_BYTES: MAX, photoDigest: digest,
    process: { env: { UPLOADS_DATA_PATH: root } }, mkdir: fsp.mkdir, realpath: fsp.realpath,
    lstat: async name => {
      const info = await fsp.lstat(name);
      if (name === file && options.afterStat) await options.afterStat(file);
      return info;
    },
    open: async (name, flags) => {
      assert.equal(name, file);
      assert.equal(flags, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const handle = await fsp.open(name, flags);
      opened++;
      return {
        // Retain old-source execution for a meaningful before/after comparison.
        readFile: async () => {
          if (options.afterRead) await options.afterRead(file, ++reads);
          const result = await handle.readFile(); readBytes += result.length; return result;
        },
        read: async (buffer, offset, length, position) => {
          const result = await handle.read(buffer, offset, Math.min(length, options.shortRead ?? length), position);
          readBytes += result.bytesRead;
          reads++;
          if (options.afterRead) await options.afterRead(file, reads);
          return result;
        },
        close: async () => { await handle.close(); closed++; if (options.closeError) throw options.closeError; },
      };
    },
  };
  const reader = vm.runInNewContext(actual + "\nreadAcquisitionPhotoBytes", context);
  try {
    await check({ read: expected => reader(id, variant, expected), bytes, file,
      counts: () => ({ opened, closed, readBytes, reads }) });
    assert.equal(opened, closed, "Every opened descriptor closes");
    assert.equal(await fsp.readFile(neighbor, "utf8"), "independent protected original");
  } finally {
    assert.ok(root.startsWith(parent + path.sep) && path.basename(root).startsWith("bounded-photo-read-"));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

for (const variant of ["raw", "preview"]) for (const withDigest of [false, true]) {
  test(`${variant} refuses growth after pathname stat (${withDigest ? "matching digest" : "no digest"})`, () => {
    const oversized = Buffer.alloc(MAX + 128 * 1024, 7);
    return fixture({ variant, afterStat: file => fsp.writeFile(file, oversized) }, async ({ read, counts, file }) => {
      await assert.rejects(read(withDigest ? digest(oversized) : undefined), /Photo file is unavailable/);
      assert.ok(counts().readBytes <= MAX + 1, "Read budget includes at most one overflow-detection byte");
      assert.equal((await fsp.stat(file)).size, oversized.length, "Refusal never rewrites the source");
    });
  });
}

test("growth during descriptor reads remains bounded", () => fixture({
  bytes: Buffer.alloc(64 * 1024, 9),
  afterRead: async (file, reads) => { if (reads === 1) await fsp.appendFile(file, Buffer.alloc(MAX, 8)); },
}, async ({ read, counts }) => {
  await assert.rejects(read(), /Photo file is unavailable/);
  assert.equal(counts().readBytes, MAX + 1);
}));

test("overflow and close failures preserve the primary refusal without borrowing a secondary code", () => {
  const closeError = Object.assign(Error("controlled close failure"), { code: "ENOENT" });
  return fixture({ afterStat: file => fsp.writeFile(file, Buffer.alloc(MAX + 1)), closeError }, async ({ read, counts }) => {
    await assert.rejects(read(), error => {
      assert.match(error.cause.message, /Photo file is unavailable/);
      assert.deepEqual(error.errors, [error.cause, closeError]);
      assert.equal(Object.hasOwn(error, "code"), false);
      return true;
    });
    assert.equal(counts().readBytes, MAX + 1);
  });
});

for (const size of [0, 1, 64 * 1024 + 13, MAX]) test(`ordinary ${size}-byte original retains exact bytes`, () =>
  fixture({ bytes: Buffer.alloc(size, 6) }, async ({ read, bytes }) => {
    assert.deepEqual(await read(digest(bytes)), bytes);
    assert.deepEqual(await read(), bytes);
  }));

test("short descriptor reads preserve order and digest", () => fixture({ shortRead: 7 }, async ({ read, bytes }) => {
  assert.deepEqual(await read(digest(bytes)), bytes);
}));

test("oversized pathname refuses before opening", () => fixture({ bytes: Buffer.alloc(MAX + 1) }, async ({ read, counts }) => {
  await assert.rejects(read(), /Photo file is unavailable/);
  assert.equal(counts().opened, 0);
}));

test("bounded bytes still require the supplied digest", () => fixture({}, async ({ read }) => {
  await assert.rejects(read("0".repeat(64)), /Photo integrity check failed/);
}));
