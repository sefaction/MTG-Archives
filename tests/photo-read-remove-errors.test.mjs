import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import ts from "typescript";
import { z } from "zod";
const source = fs.readFileSync(new URL("../lib/acquisition-files.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
const actual = ["filePath", "readChecked", "readAcquisitionPhotoBytes", "photoTemporarySuffix",
  "photoTemporaryName", "findAcquisitionPhotoTemporaryFiles", "removeAcquisitionPhotoBytes"].map(name => {
  const n = tree.statements.find(n => (ts.isFunctionDeclaration(n) && n.name?.text === name) ||
    (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(tree) === name)));
  assert.ok(n, "Complete actual declaration " + name);
  return ts.transpileModule(n.getText(tree).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}).join("\n");
const digest = b => createHash("sha256").update(b).digest("hex");
const fault = code => Object.assign(Error("controlled photo handle failure"), { code });
const capture = async fn => { try { return { failed: false, value: await fn() }; } catch (error) { return { failed: true, error }; } };
async function fixture(fn, platform = "linux") {
  const parent = path.resolve(".local-data"); await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, "photo-handles-")), directory = path.join(root, "acquisition-v1");
  const id = randomUUID(), neighbor = randomUUID(), bytes = Buffer.from("owned synthetic original"), faults = new Map(), calls = [];
  const file = (id, variant) => path.join(directory, id + (variant === "raw" ? ".original" : ".preview.jpg"));
  await fsp.mkdir(directory);
  for (const key of [id, neighbor]) for (const variant of ["raw", "preview"]) await fsp.writeFile(file(key, variant), bytes);
  const step = stage => { calls.push(stage); if (faults.has(stage)) throw faults.get(stage); };
  const context = { AggregateError, Error, Buffer, path, z, constants, PHOTO_MAX_BYTES: 10 * 1024 * 1024, photoDigest: digest,
    process: { platform, env: { UPLOADS_DATA_PATH: root } }, mkdir: fsp.mkdir, lstat: fsp.lstat, realpath: fsp.realpath, opendir: fsp.opendir,
    open: async (p, flags) => {
      if (p === directory && flags === "r") {
        step("directory-open");
        // Host Windows adapts Linux control flow; Linux opens a real directory.
        const h = process.platform === "win32" ? null : await fsp.open(p, flags);
        return { sync: async () => { if (h) await h.sync(); step("sync"); }, close: async () => { if (h) await h.close(); step("directory-close"); } };
      }
      step("file-open"); assert.equal(flags, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const h = await fsp.open(p, flags);
      return { read: async (...args) => { const result = await h.read(...args); step("read"); return result; }, close: async () => { await h.close(); step("file-close"); } };
    }, unlink: async p => { step(p.endsWith(".original") ? "unlink-raw" : "unlink-preview"); await fsp.unlink(p); } };
  const api = vm.runInNewContext(actual + "\n({readAcquisitionPhotoBytes,removeAcquisitionPhotoBytes})", context);
  try { await fn({ api, id, bytes, faults, calls, file, directory });
    for (const variant of ["raw", "preview"]) assert.deepEqual(await fsp.readFile(file(neighbor, variant)), bytes);
  } finally { assert(root.startsWith(parent + path.sep) && path.basename(root).startsWith("photo-handles-")); await fsp.rm(root, { recursive: true, force: true }); }
}
for (const variant of ["raw", "preview"]) {
  test(variant + " read plus close failures retain cause order and original code", () => fixture(async ({ api, id, bytes, faults, calls, file }) => {
    const read = fault("EIO"), close = fault("EACCES"); faults.set("read", read); faults.set("file-close", close);
    const r = await capture(() => api.readAcquisitionPhotoBytes(id, variant, digest(bytes)));
    assert.deepEqual(r.error.errors, [read, close]); assert.equal(r.error.cause, read); assert.equal(r.error.code, "EIO");
    assert.deepEqual(calls, ["file-open", "read", "file-close"]); faults.clear();
    assert.deepEqual(await api.readAcquisitionPhotoBytes(id, variant, digest(bytes)), bytes);
    assert.deepEqual(await fsp.readFile(file(id, variant)), bytes);
  }));
  test(variant + " digest rejection is not hidden by close failure", () => fixture(async ({ api, id, faults }) => {
    const close = fault("EIO"); faults.set("file-close", close);
    const r = await capture(() => api.readAcquisitionPhotoBytes(id, variant, "0".repeat(64)));
    assert.match(r.error.cause.message, /Photo integrity check failed; restore the original/);
    assert.equal(r.error.errors[0], r.error.cause); assert.equal(r.error.errors[1], close); assert.equal(Object.hasOwn(r.error, "code"), false);
  }));
  test(variant + " ordinary read preserves exact bytes", () => fixture(async ({ api, id, bytes }) => {
    assert.deepEqual(await api.readAcquisitionPhotoBytes(id, variant, digest(bytes)), bytes);
  }));
}
for (const stage of ["read", "file-close"]) test("lone " + stage + " failure retains identity", () => fixture(async ({ api, id, faults, calls }) => {
  const error = fault("EIO"); faults.set(stage, error); const r = await capture(() => api.readAcquisitionPhotoBytes(id, "raw"));
  assert.equal(r.failed, true); assert.equal(r.error, error); assert(calls.includes("file-close"));
}));
for (const value of [undefined, null, false, 0]) test("falsy read cause " + String(value) + " survives close", () => fixture(async ({ api, id, faults }) => {
  const close = fault("EIO"); faults.set("read", value); faults.set("file-close", close);
  const r = await capture(() => api.readAcquisitionPhotoBytes(id, "raw")); assert.deepEqual(r.error.errors, [value, close]); assert.equal(r.error.cause, value);
  assert.equal(Object.hasOwn(r.error, "code"), false);
}));
test("ordinary digest rejection and unsafe metadata still block reads", () => fixture(async ({ api, id, file, calls }) => {
  const r = await capture(() => api.readAcquisitionPhotoBytes(id, "raw", "0".repeat(64)));
  assert.match(r.error.message, /Photo integrity check failed/); assert.equal(r.error instanceof AggregateError, false);
  await fsp.unlink(file(id, "raw")); await fsp.mkdir(file(id, "raw")); calls.length = 0;
  const unsafe = await capture(() => api.readAcquisitionPhotoBytes(id, "raw")); assert.match(unsafe.error.message, /Photo file is unavailable/); assert.deepEqual(calls, []);
}));
test("removal sync and close causes remain ordered with idempotent retry", () => fixture(async ({ api, id, faults, file, calls }) => {
  const sync = fault("ENOSPC"), close = fault("EIO"); faults.set("sync", sync); faults.set("directory-close", close);
  const r = await capture(() => api.removeAcquisitionPhotoBytes(id)); assert.deepEqual(r.error.errors, [sync, close]); assert.equal(r.error.cause, sync); assert.equal(r.error.code, "ENOSPC");
  assert.deepEqual(calls, ["unlink-raw", "unlink-preview", "directory-open", "sync", "directory-close"]);
  for (const v of ["raw", "preview"]) assert.equal(fs.existsSync(file(id, v)), false);
  faults.clear(); await api.removeAcquisitionPhotoBytes(id);
}));
for (const stage of ["directory-open", "sync", "directory-close"]) test("lone removal " + stage + " error retains identity", () => fixture(async ({ api, id, faults, calls }) => {
  const error = fault("EIO"); faults.set(stage, error); const r = await capture(() => api.removeAcquisitionPhotoBytes(id)); assert.equal(r.error, error);
  if (stage === "sync") assert(calls.includes("directory-close")); faults.clear(); await api.removeAcquisitionPhotoBytes(id);
}));
for (const value of [undefined, null, false, 0]) test("falsy removal sync cause " + String(value) + " survives close", () => fixture(async ({ api, id, faults }) => {
  const close = fault("EIO"); faults.set("sync", value); faults.set("directory-close", close);
  const r = await capture(() => api.removeAcquisitionPhotoBytes(id)); assert.deepEqual(r.error.errors, [value, close]); assert.equal(r.error.cause, value); assert.equal(Object.hasOwn(r.error, "code"), false);
}));
for (const platform of ["linux", "win32"]) test(platform + " normal removal and missing-file retry", () => fixture(async ({ api, id, calls }) => {
  await api.removeAcquisitionPhotoBytes(id); await api.removeAcquisitionPhotoBytes(id); assert.equal(calls.includes("directory-open"), platform !== "win32");
}, platform));

test("handle fixture executes actual temporary discovery and preserves unrelated names", () => fixture(async ({ api, id, bytes, file, directory }) => {
  const alias = path.join(directory, `${id}.${randomUUID()}.part`), unrelated = path.join(directory, `${randomUUID()}.${randomUUID()}.part`);
  await fsp.link(file(id, "raw"), alias); await fsp.writeFile(unrelated, bytes);
  await api.removeAcquisitionPhotoBytes(id);
  assert.equal(fs.existsSync(alias), false); assert.deepEqual(await fsp.readFile(unrelated), bytes);
}));
test("unsafe original and failed unlink preserve the other variant", () => fixture(async ({ api, id, faults, file, calls, bytes }) => {
  const error = fault("EACCES"); faults.set("unlink-raw", error); const r = await capture(() => api.removeAcquisitionPhotoBytes(id)); assert.equal(r.error, error);
  assert.deepEqual(await fsp.readFile(file(id, "preview")), bytes); faults.clear(); calls.length = 0;
  await fsp.unlink(file(id, "raw")); await fsp.mkdir(file(id, "raw"));
  const unsafe = await capture(() => api.removeAcquisitionPhotoBytes(id)); assert.match(unsafe.error.message, /Private photo file is unsafe/); assert.deepEqual(calls, []);
  assert.deepEqual(await fsp.readFile(file(id, "preview")), bytes);
}));
test("real Linux directory descriptor closes", { skip: process.platform === "win32" ? "Real descriptor checked in Linux image qualification" : false }, () => fixture(async ({ api, id, calls }) => {
  await api.removeAcquisitionPhotoBytes(id); assert(calls.includes("directory-close"));
}));
