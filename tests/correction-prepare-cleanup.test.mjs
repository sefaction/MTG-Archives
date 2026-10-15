import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import ts from "typescript";

function actualFunction(file, name) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, "Exercise the complete actual " + name + " function");
  return ts.transpileModule(fn.getText(tree).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const prepare = actualFunction("../lib/acquisition-correction-files.ts", "prepareCorrectionBlob");
const capture = actualFunction("../lib/acquisition-correction-worker.ts", "runCorrectionCaptureOnce");
const digestOf = bytes => createHash("sha256").update(bytes).digest("hex");
const fault = code => Object.assign(Error("bounded storage control"), { code });

async function exercise(faults = new Map(), publish = false) {
  const root = await fsp.mkdtemp(path.join(process.cwd(), ".local-data/correction-prepare-"));
  const directory = path.join(root, "owner"), temporary = path.join(directory, "temporary");
  await fsp.mkdir(temporary, { recursive: true });
  const source = path.join(root, "source.original"), neighbor = path.join(root, "neighbor.original");
  const bytes = Buffer.from("synthetic protected source original"), digest = digestOf(bytes);
  await fsp.writeFile(source, bytes);
  await fsp.writeFile(neighbor, "independent neighbor");
  const calls = [];
  const step = name => { calls.push(name); if (faults.has(name)) throw faults.get(name); };
  let result, failed = false, error;
  const context = {
    AggregateError, Error, Buffer, randomUUID, path, PHOTO_MAX_BYTES: 10 * 1024 * 1024,
    digestSchema: z.string().regex(/^[a-f0-9]{64}$/), z, photoDigest: digestOf,
    ownerDirectory: async () => directory, temporaryDirectory: async () => temporary,
    open: async (file, flags, mode) => {
      step("open");
      assert.equal(flags, "wx"); assert.equal(mode, 0o600);
      const handle = await fsp.open(file, flags, mode);
      return {
        writeFile: async data => {
          if (faults.has("write")) {
            calls.push("write"); await handle.writeFile(data.subarray(0, 3)); throw faults.get("write");
          }
          step("write"); await handle.writeFile(data);
        },
        sync: async () => { step("sync"); await handle.sync(); },
        close: async () => { await handle.close(); step("close"); },
      };
    },
    unlink: async file => {
      calls.push("unlink");
      if (faults.has("unlink")) {
        const error = faults.get("unlink");
        if (error?.code === "ENOENT") await fsp.unlink(file).catch(e => { if (e.code !== "ENOENT") throw e; });
        throw error;
      }
      return fsp.unlink(file);
    },
    link: fsp.link, syncDirectory: async () => { calls.push("directory-sync"); },
    readCorrectionBlob: async (_owner, expected, length) => {
      const data = await fsp.readFile(path.join(directory, expected + ".original"));
      assert.equal(data.length, length); assert.equal(digestOf(data), expected); return data;
    },
  };
  try {
    try {
      result = await vm.runInNewContext(prepare + "\nprepareCorrectionBlob('owner', digest, bytes, lease)",
        { ...context, digest, bytes, lease: randomUUID() });
      if (publish) { await result.publish(); await result.publish(); await result.cleanup(); }
    } catch (cause) { failed = true; error = cause; }
    const parts = await fsp.readdir(temporary);
    assert.deepEqual(await fsp.readFile(source), bytes);
    assert.equal(await fsp.readFile(neighbor, "utf8"), "independent neighbor");
    return { calls, failed, error, parts, published: fs.existsSync(path.join(directory, digest + ".original")) };
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("partial-copy failure still attempts unlink after handle close fails", async () => {
  const write = fault("ENOSPC"), close = fault("EIO");
  const result = await exercise(new Map([["write", write], ["close", close]]));
  assert.deepEqual(result.calls, ["open", "write", "close", "unlink"]);
  assert.deepEqual(result.parts, []);
  assert.equal(result.failed, true);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, [write, close]);
  assert.equal(result.error.cause, write); assert.equal(result.error.code, "ENOSPC");
});

test("all preparation and cleanup failures remain in order with original storage classification", async () => {
  const failures = [fault("ENOSPC"), fault("EIO"), fault("EACCES")];
  const result = await exercise(new Map([["write", failures[0]], ["close", failures[1]], ["unlink", failures[2]]]));
  assert.equal(result.parts.length, 1, "An actual failed unlink leaves an explicit recoverable temporary");
  assert.deepEqual(result.calls, ["open", "write", "close", "unlink"]);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, failures);
  assert.equal(result.error.cause, failures[0]); assert.equal(result.error.code, "ENOSPC");
});

for (const stage of ["open", "write", "sync"]) {
  test("lone " + stage + " failure retains identity and removes its partial copy", async () => {
    const original = fault(stage === "write" ? "ENOSPC" : "EIO");
    const result = await exercise(new Map([[stage, original]]));
    assert.equal(result.failed, true); assert.equal(result.error, original);
    assert.deepEqual(result.parts, []); assert.equal(result.published, false);
    assert.ok(result.calls.includes("unlink"));
  });
}

test("a lone close error is retained when its retry and unlink also fail", async () => {
  const close = fault("EIO"), unlink = fault("EACCES");
  const result = await exercise(new Map([["close", close], ["unlink", unlink]]));
  assert.deepEqual(result.calls, ["open", "write", "sync", "close", "close", "unlink"]);
  assert.ok(result.error instanceof AggregateError);
  assert.deepEqual(result.error.errors, [close, close, unlink]);
  assert.equal(result.error.code, "EIO");
});

test("a disappearing temporary is harmless while the original error stays intact", async () => {
  const write = fault("ENOSPC"), result = await exercise(new Map([["write", write], ["unlink", fault("ENOENT")]]));
  assert.equal(result.error, write); assert.deepEqual(result.parts, []);
});

test("actual capture retains the original ENOSPC retry code after combined preparation failures", async () => {
  const prepared = await exercise(new Map([["write", fault("ENOSPC")], ["close", fault("EIO")]]));
  let recorded;
  const bytes = Buffer.from("source"), claim = { id: "owned-claim", leaseToken: randomUUID(),
    blob: { id: "owned-blob", ownerPlayerId: "owner", digest: digestOf(bytes), bytes: bytes.length } };
  const output = await vm.runInNewContext(capture + "\nrunCorrectionCaptureOnce(db)", {
    claimCorrectionCapture: async () => claim,
    readCorrectionBlob: async () => { throw fault("ENOENT"); },
    readAcquisitionPhotoBytes: async () => bytes,
    prepareCorrectionBlob: async () => { throw prepared.error; },
    completeCorrectionCapture: async () => { throw Error("Failed preparation must never publish"); },
    failCorrectionCapture: async (_db, same, code) => { assert.equal(same, claim); recorded = code; },
    db: { correctionRetentionPin: { findMany: async () => [{ photoId: "owned-source" }] } },
    Error,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(output)), { claimed: 1, preserved: 0, failed: 1 });
  assert.equal(recorded, "ENOSPC");
});

test("successful prepare, duplicate immutable publish and cleanup remain intact", async () => {
  const result = await exercise(new Map(), true);
  assert.equal(result.failed, false); assert.equal(result.published, true);
  assert.deepEqual(result.parts, []);
  assert.deepEqual(result.calls, ["open", "write", "sync", "close", "directory-sync", "directory-sync", "unlink"]);
});

