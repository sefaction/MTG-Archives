import test from "node:test";
import assert from "node:assert/strict";
import fs, { constants } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod";

function actualFunctions(file, names) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return names.map(name => {
    const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert.ok(fn, "Exercise the complete actual " + name + " function");
    return ts.transpileModule(fn.getText(tree).replace(/^export\s+/, ""), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }).join("\n");
}
const reader = actualFunctions("../lib/acquisition-correction-files.ts", ["ownerDirectory", "readCorrectionBlob"]);
const worker = actualFunctions("../lib/acquisition-correction-worker.ts", ["runCorrectionCaptureOnce"]);
const digestOf = bytes => createHash("sha256").update(bytes).digest("hex");
const fault = code => Object.assign(new Error("controlled correction read failure"), { code });
const capture = async work => {
  try { return { failed: false, value: await work() }; }
  catch (error) { return { failed: true, error }; }
};

async function fixture(work, original = Buffer.from("immutable synthetic correction original")) {
  const parent = path.resolve(".local-data");
  await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, "correction-read-"));
  const owner = "synthetic-owner", bytes = original, digest = digestOf(bytes);
  const directory = path.join(root, "correction-library-v1", digestOf(owner));
  const file = path.join(directory, digest + ".original");
  const neighbor = path.join(root, "independent.original"), neighborBytes = Buffer.from("protected peer");
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(file, bytes);
  await fsp.writeFile(neighbor, neighborBytes);
  const faults = new Map(), calls = [], hooks = {};
  let closed = 0, consumed = 0;
  const reads = [];
  const step = stage => { calls.push(stage); if (faults.has(stage)) throw faults.get(stage); };
  const api = vm.runInNewContext(reader + "\nreadCorrectionBlob", {
    AggregateError, Error, Buffer, Object, constants, createHash, path, z,
    PHOTO_MAX_BYTES: 10 * 1024 * 1024, CORRECTION_LIBRARY_DIRECTORY: "correction-library-v1",
    digestSchema: z.string().regex(/^[a-f0-9]{64}$/), photoDigest: digestOf,
    process: { env: { UPLOADS_DATA_PATH: root } }, mkdir: fsp.mkdir, realpath: fsp.realpath, lstat: fsp.lstat,
    open: async (target, flags) => {
      step("open");
      assert.equal(target, file);
      assert.equal(flags, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const handle = await fsp.open(target, flags);
      return {
        readFile: async () => { await hooks.beforeRead?.(); const data = await handle.readFile(); consumed += data.length; step("read"); return data; },
        read: async (buffer, offset, length, position) => {
          await hooks.beforeRead?.();
          reads.push({ offset, length, position, allocation: buffer.length });
          const result = await handle.read(buffer, offset, Math.min(length, hooks.chunkSize ?? length), position);
          consumed += result.bytesRead; step("read"); return result;
        },
        close: async () => { await handle.close(); closed++; step("close"); },
      };
    },
  });
  try {
    await work({ api, owner, bytes, digest, file, directory, root, faults, calls, hooks, reads, consumed: () => consumed, closed: () => closed });
    assert.deepEqual(await fsp.readFile(neighbor), neighborBytes);
  } finally {
    assert(root.startsWith(parent + path.sep) && path.basename(root).startsWith("correction-read-"));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

for (const fragmented of [false, true]) test("growth after the size check consumes only expected bytes plus one" + (fragmented ? " with short reads" : ""), () => fixture(async f => {
  if (fragmented) f.hooks.chunkSize = 3;
  f.hooks.beforeRead = async () => {
    delete f.hooks.beforeRead;
    await fsp.appendFile(f.file, Buffer.alloc(1024 * 1024, 120));
  };
  await assert.rejects(f.api(f.owner, f.digest, f.bytes.length), /Photo correction integrity check failed/);
  assert.equal(f.consumed(), f.bytes.length + 1);
  assert.equal(f.closed(), 1);
  assert.ok(f.reads.length > 0);
  for (const read of f.reads) {
    assert.equal(read.allocation, f.bytes.length + 1);
    assert.ok(read.length <= read.allocation - read.offset);
    assert.equal(read.position, null);
  }
  assert.equal((await fsp.stat(f.file)).size, f.bytes.length + 1024 * 1024);
}));

test("short reads preserve every byte and require EOF before accepting a correction", () => fixture(async f => {
  f.hooks.chunkSize = 3;
  const result = await f.api(f.owner, f.digest, f.bytes.length);
  assert.deepEqual(result, f.bytes);
  assert.equal(f.consumed(), f.bytes.length);
  assert.equal(f.closed(), 1);
}));

test("an overgrown correction and close failure preserve integrity as the primary cause", () => fixture(async f => {
  f.hooks.beforeRead = async () => { delete f.hooks.beforeRead; await fsp.appendFile(f.file, Buffer.from("extra")); };
  const close = fault("ENOENT"); f.faults.set("close", close);
  const r = await capture(() => f.api(f.owner, f.digest, f.bytes.length));
  assert.equal(r.failed, true); assert.ok(r.error instanceof AggregateError);
  assert.match(r.error.cause.message, /Photo correction integrity check failed/);
  assert.deepEqual(r.error.errors, [r.error.cause, close]);
  assert.equal(Object.hasOwn(r.error, "code"), false);
  assert.equal(f.consumed(), f.bytes.length + 1); assert.equal(f.closed(), 1);
}));

test("the full 10 MiB original is accepted byte for byte", () => fixture(async f => {
  assert.deepEqual(await f.api(f.owner, f.digest, f.bytes.length), f.bytes);
  assert.equal(f.consumed(), 10 * 1024 * 1024);
  assert.equal(f.closed(), 1);
}, Buffer.alloc(10 * 1024 * 1024, 123)));

test("the recorded size rejects zero and over-limit inputs before opening", () => fixture(async f => {
  for (const size of [0, -1, 1.5, 10 * 1024 * 1024 + 1]) await assert.rejects(f.api(f.owner, f.digest, size));
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await fsp.readFile(f.file), f.bytes);
}));

test("capture refuses an overgrown correction without completing preservation or releasing source pins", () => fixture(async f => {
  f.hooks.beforeRead = async () => { delete f.hooks.beforeRead; await fsp.appendFile(f.file, Buffer.alloc(1024)); };
  const claim = { blob: { ownerPlayerId: f.owner, digest: f.digest, bytes: f.bytes.length } }, failures = [];
  const run = vm.runInNewContext(worker + "\nrunCorrectionCaptureOnce", {
    claimCorrectionCapture: async () => claim, readCorrectionBlob: f.api,
    failCorrectionCapture: async (_db, actual, code) => { assert.equal(actual, claim); failures.push(code); },
    completeCorrectionCapture: async () => assert.fail("Integrity failure cannot release preservation pins"),
    prepareCorrectionBlob: async () => assert.fail("Corruption cannot trigger replacement"),
  });
  const result = await run({ correctionRetentionPin: { findMany: async () => assert.fail("Corruption is not a missing source") } });
  assert.equal(result.failed, 1); assert.equal(result.preserved, 0);
  assert.deepEqual(failures, ["ORIGINAL_COPY_FAILED"]);
  assert.equal(f.consumed(), f.bytes.length + 1); assert.equal(f.closed(), 1);
}));

test("correction read and close failures retain ordered causes and primary code", () => fixture(async f => {
  const read = fault("EACCES"), close = fault("EIO");
  f.faults.set("read", read); f.faults.set("close", close);
  const r = await capture(() => f.api(f.owner, f.digest, f.bytes.length));
  assert.equal(r.failed, true);
  assert.ok(r.error instanceof AggregateError);
  assert.deepEqual(r.error.errors, [read, close]);
  assert.equal(r.error.cause, read); assert.equal(r.error.code, "EACCES");
  assert.deepEqual(f.calls, ["open", "read", "close"]); assert.equal(f.closed(), 1);
  assert.deepEqual(await fsp.readFile(f.file), f.bytes);
  f.faults.clear();
  assert.deepEqual(await f.api(f.owner, f.digest, f.bytes.length), f.bytes);
}));

for (const stage of ["open", "read", "close"]) test("lone correction " + stage + " failure retains exact identity", () => fixture(async f => {
  const original = fault("EIO"); f.faults.set(stage, original);
  const r = await capture(() => f.api(f.owner, f.digest, f.bytes.length));
  assert.equal(r.failed, true); assert.equal(r.error, original);
  assert.equal(f.closed(), stage === "open" ? 0 : 1);
}));

for (const value of [undefined, null, false, 0, ""]) {
  for (const combined of [false, true]) test("falsy correction read " + String(value) + (combined ? " plus close" : " alone"), () => fixture(async f => {
    f.faults.set("read", value); const close = fault("ENOENT");
    if (combined) f.faults.set("close", close);
    const r = await capture(() => f.api(f.owner, f.digest, f.bytes.length));
    assert.equal(r.failed, true); assert.equal(f.closed(), 1);
    if (!combined) assert.equal(r.error, value);
    else {
      assert.deepEqual(r.error.errors, [value, close]); assert.equal(r.error.cause, value);
      assert.equal(Object.hasOwn(r.error, "code"), false);
    }
  }));
}

for (const kind of ["digest", "length"]) test(kind + " integrity rejection survives close failure", () => fixture(async f => {
  if (kind === "digest") await fsp.writeFile(f.file, Buffer.alloc(f.bytes.length, 120));
  // Change length after the real metadata check, before the real handle read.
  else f.hooks.beforeRead = () => fsp.truncate(f.file, 3);
  const close = fault("ENOENT"); f.faults.set("close", close);
  const r = await capture(() => f.api(f.owner, f.digest, f.bytes.length));
  assert.equal(r.failed, true); assert.ok(r.error instanceof AggregateError);
  assert.match(r.error.cause.message, /Photo correction integrity check failed/);
  assert.deepEqual(r.error.errors, [r.error.cause, close]);
  assert.equal(Object.hasOwn(r.error, "code"), false); assert.equal(f.closed(), 1);
}));

test("normal, missing-owner, metadata and symlink protections remain", () => fixture(async f => {
  assert.deepEqual(await f.api(f.owner, f.digest, f.bytes.length), f.bytes);
  await assert.rejects(f.api(f.owner, f.digest, f.bytes.length + 1), /integrity/);
  await assert.rejects(f.api("other-owner", f.digest, f.bytes.length), { code: "ENOENT" });
  await assert.rejects(f.api(f.owner, "../outside", f.bytes.length));
  await fsp.unlink(f.file);
  // A Windows directory junction needs no file-symlink privilege. Both forms
  // must be refused by the same actual private-original metadata guard.
  await fsp.symlink(process.platform === "win32" ? f.root : path.join(f.root, "independent.original"),
    f.file, process.platform === "win32" ? "junction" : "file");
  await assert.rejects(f.api(f.owner, f.digest, Buffer.byteLength("protected peer")), /integrity/);
}));

for (const closeCode of ["EIO", "ENOENT"]) test("capture keeps read classification when close reports " + closeCode, () => fixture(async f => {
  f.faults.set("read", fault("EACCES")); f.faults.set("close", fault(closeCode));
  const claim = { blob: { ownerPlayerId: f.owner, digest: f.digest, bytes: f.bytes.length } };
  const failures = [];
  const run = vm.runInNewContext(worker + "\nrunCorrectionCaptureOnce", {
    claimCorrectionCapture: async () => claim, readCorrectionBlob: f.api,
    failCorrectionCapture: async (_db, actual, code) => { assert.equal(actual, claim); failures.push(code); },
    completeCorrectionCapture: async () => { assert.fail("Failed reads cannot acknowledge preservation"); },
    prepareCorrectionBlob: async () => { assert.fail("An existing unreadable original cannot be overwritten"); },
  });
  const result = await run({ correctionRetentionPin: { findMany: async () => {
    assert.fail("A secondary ENOENT must not turn a failed read into a missing original");
  } } });
  assert.equal(result.claimed, 1); assert.equal(result.failed, 1); assert.equal(result.preserved, 0);
  assert.deepEqual(failures, ["EACCES"]);
  assert.deepEqual(await fsp.readFile(f.file), f.bytes);
}));
