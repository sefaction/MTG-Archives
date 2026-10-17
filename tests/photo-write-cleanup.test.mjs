import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/acquisition-files.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("acquisition-files.ts", source, ts.ScriptTarget.Latest, true);
const names = ["filePath", "readChecked", "writeAcquisitionPhotoBytes"];
const actual = names.map(name => {
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, "Exercise complete actual function: " + name);
  return ts.transpileModule(node.getText(tree).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}).join("\n");
const digestOf = data => createHash("sha256").update(data).digest("hex");
const fault = code => Object.assign(Error("bounded original-write control"), { code });

async function exercise(faults = new Map(), { existing = false, retry = false, variant = "raw", directoryControl = false, platform = process.platform } = {}) {
  await fsp.mkdir(path.join(process.cwd(), ".local-data"), { recursive: true });
  const root = await fsp.mkdtemp(path.join(process.cwd(), ".local-data/photo-write-"));
  const id = randomUUID(), neighbor = path.join(root, "neighbor.original");
  const bytes = Buffer.from("synthetic protected original");
  const directory = path.join(root, "acquisition-v1");
  const file = path.join(directory, id + (variant === "raw" ? ".original" : ".preview.jpg"));
  await fsp.mkdir(directory);
  await fsp.writeFile(neighbor, "independent original");
  if (existing) await fsp.writeFile(file, bytes);
  const calls = [];
  let failed = false, error, failEnabled = true;
  const step = name => {
    calls.push(name);
    if (failEnabled && faults.has(name)) throw faults.get(name);
  };
  const context = {
    AggregateError, Error, Buffer, constants, path, z, randomUUID,
    PHOTO_MAX_BYTES: 10 * 1024 * 1024, photoDigest: digestOf,
    process: { platform, env: { UPLOADS_DATA_PATH: root } },
    mkdir: fsp.mkdir, lstat: fsp.lstat, realpath: fsp.realpath, statfs: fsp.statfs,
    open: async (name, flags, mode) => {
      if (directoryControl && name === directory && flags === "r") {
        step("directory-open");
        // Windows has no directory fsync; this adapter exercises Linux control flow
        // there. Linux runs use and close a real directory descriptor.
        const handle = process.platform === "win32" ? null : await fsp.open(name, flags, mode);
        return {
          sync: async () => { if (handle) await handle.sync(); step("directory-sync"); },
          close: async () => { if (handle) await handle.close(); step("directory-close"); },
        };
      }
      if (flags !== "wx") return fsp.open(name, flags, mode);
      step("open"); assert.equal(mode, 0o600);
      const handle = await fsp.open(name, flags, mode);
      return {
        writeFile: async data => {
          if (failEnabled && faults.has("write")) {
            calls.push("write"); await handle.writeFile(data.subarray(0, 3)); throw faults.get("write");
          }
          step("write"); await handle.writeFile(data);
        },
        sync: async () => { step("sync"); await handle.sync(); },
        close: async () => { await handle.close(); step("close"); },
      };
    },
    link: async (from, to) => { step("link"); return fsp.link(from, to); },
    unlink: async name => {
      calls.push("unlink");
      if (failEnabled && faults.has("unlink")) {
        const cause = faults.get("unlink");
        if (cause?.code === "ENOENT") await fsp.unlink(name).catch(e => { if (e.code !== "ENOENT") throw e; });
        throw cause;
      }
      return fsp.unlink(name);
    },
  };
  const writer = vm.runInNewContext(actual + "\nwriteAcquisitionPhotoBytes", context);
  try {
    try { await writer(id, bytes, variant, digestOf(bytes)); }
    catch (cause) { failed = true; error = cause; }
    const parts = (await fsp.readdir(directory)).filter(n => n.endsWith(".part"));
    const published = fs.existsSync(file);
    if (published) assert.deepEqual(await fsp.readFile(file), bytes);
    assert.equal(await fsp.readFile(neighbor, "utf8"), "independent original");
    if (retry) {
      failEnabled = false;
      await writer(id, bytes, variant, digestOf(bytes));
      assert.deepEqual(await fsp.readFile(file), bytes);
      assert.equal(await fsp.readFile(neighbor, "utf8"), "independent original");
      assert.equal((await fsp.readdir(directory)).filter(n => n.endsWith(".part")).length, parts.length);
    }
    return { failed, error, calls, parts, published };
  } finally {
    const parent = path.resolve(".local-data");
    assert.ok(root.startsWith(parent + path.sep) && path.basename(root).startsWith("photo-write-"), "Owned fixture cleanup stays inside its namespace");
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("original write failure attempts partial unlink even after close fails", async () => {
  const write = fault("ENOSPC"), close = fault("EIO");
  const r = await exercise(new Map([["write", write], ["close", close]]));
  assert.deepEqual(r.calls, ["open", "write", "close", "unlink"]);
  assert.deepEqual(r.parts, []); assert.equal(r.published, false);
  assert.ok(r.error instanceof AggregateError);
  assert.deepEqual(r.error.errors, [write, close]); assert.equal(r.error.cause, write);
  assert.equal(r.error.code, "ENOSPC");
});
test("link and temporary cleanup failures retain both causes and primary code", async () => {
  const link = fault("ENOSPC"), unlink = fault("EACCES");
  const r = await exercise(new Map([["link", link], ["unlink", unlink]]));
  assert.ok(r.error instanceof AggregateError);
  assert.deepEqual(r.error.errors, [link, unlink]); assert.equal(r.error.cause, link);
  assert.equal(r.error.code, "ENOSPC"); assert.equal(r.parts.length, 1);
  assert.equal(r.published, false);
});
for (const stage of ["open", "write", "sync", "link"]) {
  test("lone " + stage + " failure retains identity without publishing an original", async () => {
    const original = fault("EIO"), r = await exercise(new Map([[stage, original]]));
    assert.equal(r.failed, true); assert.equal(r.error, original);
    assert.deepEqual(r.parts, []); assert.equal(r.published, false);
  });
}
test("write, close and unlink failures remain ordered", async () => {
  const causes = [fault("ENOSPC"), fault("EIO"), fault("EACCES")];
  const r = await exercise(new Map([["write", causes[0]], ["close", causes[1]], ["unlink", causes[2]]]));
  assert.deepEqual(r.calls, ["open", "write", "close", "unlink"]);
  assert.deepEqual(r.error.errors, causes); assert.equal(r.error.code, "ENOSPC");
  assert.equal(r.parts.length, 1); assert.equal(r.published, false);
});
test("a disappearing temporary preserves the original failure", async () => {
  const write = fault("ENOSPC"), r = await exercise(new Map([["write", write], ["unlink", fault("ENOENT")]]));
  assert.equal(r.error, write); assert.deepEqual(r.parts, []);
});
test("a lone cleanup failure preserves a complete immutable original for retry", async () => {
  const unlink = fault("EACCES"), r = await exercise(new Map([["unlink", unlink]]), { retry: true });
  assert.equal(r.error, unlink); assert.equal(r.published, true);
  assert.equal(r.parts.length, 1);
});
for (const variant of ["raw", "preview"]) {
  test("successful " + variant + " publication and existing-file retry preserve bytes", async () => {
    const r = await exercise(new Map(), { variant, retry: true });
    assert.equal(r.failed, false); assert.equal(r.published, true); assert.deepEqual(r.parts, []);
    assert.deepEqual(r.calls, ["open", "write", "sync", "close", "link", "unlink"]);
    const existing = await exercise(new Map([["open", fault("EIO")]]), { variant, existing: true });
    assert.equal(existing.failed, false); assert.deepEqual(existing.calls, []);
  });
}


for (const value of [undefined, null, false, 0]) {
  test("falsy primary failure " + String(value) + " is preserved with independent cleanup", async () => {
    const r = await exercise(new Map([["write", value]]));
    assert.equal(r.failed, true); assert.equal(r.error, value);
    assert.deepEqual(r.parts, []); assert.equal(r.published, false);
  });
}
test("repeated close failures do not skip partial cleanup", async () => {
  const close = fault("EIO"), r = await exercise(new Map([["close", close]]));
  assert.deepEqual(r.calls, ["open", "write", "sync", "close", "close", "unlink"]);
  assert.deepEqual(r.error.errors, [close, close]); assert.equal(r.error.cause, close);
  assert.equal(r.error.code, "EIO"); assert.deepEqual(r.parts, []); assert.equal(r.published, false);
});

for (const variant of ["raw", "preview"]) {
  test(variant + " directory sync and close faults retain ordered causes and immutable retry", async () => {
    const sync = fault("ENOSPC"), close = fault("EIO");
    const r = await exercise(new Map([["directory-sync", sync], ["directory-close", close]]),
      { variant, directoryControl: true, platform: "linux", retry: true });
    assert.equal(r.failed, true); assert.ok(r.error instanceof AggregateError);
    assert.deepEqual(r.error.errors, [sync, close]); assert.equal(r.error.cause, sync);
    assert.equal(r.error.code, "ENOSPC"); assert.equal(r.published, true); assert.deepEqual(r.parts, []);
    assert.deepEqual(r.calls, ["open", "write", "sync", "close", "link", "directory-open", "directory-sync", "directory-close", "unlink"]);
  });
}
test("directory sync, close and temporary unlink failures retain all three causes", async () => {
  const causes = [fault("ENOSPC"), fault("EIO"), fault("EACCES")];
  const r = await exercise(new Map([["directory-sync", causes[0]], ["directory-close", causes[1]], ["unlink", causes[2]]]),
    { directoryControl: true, platform: "linux", retry: true });
  assert.deepEqual(r.error.errors, causes); assert.equal(r.error.cause, causes[0]); assert.equal(r.error.code, "ENOSPC");
  assert.equal(r.published, true); assert.equal(r.parts.length, 1);
});
for (const stage of ["directory-open", "directory-sync", "directory-close"]) {
  test("lone " + stage + " fault retains exact identity and cleans temporary", async () => {
    const error = fault("EIO");
    const r = await exercise(new Map([[stage, error]]), { directoryControl: true, platform: "linux", retry: true });
    assert.equal(r.failed, true); assert.equal(r.error, error); assert.deepEqual(r.parts, []); assert.equal(r.published, true);
    if (stage === "directory-sync") assert.ok(r.calls.includes("directory-close"));
  });
}
for (const value of [undefined, null, false, 0]) {
  test("falsy directory sync cause " + String(value) + " survives a second failure", async () => {
    const close = fault("EIO");
    const r = await exercise(new Map([["directory-sync", value], ["directory-close", close]]), { directoryControl: true, platform: "linux" });
    assert.deepEqual(r.error.errors, [value, close]); assert.equal(r.error.cause, value);
    assert.equal(Object.hasOwn(r.error, "code"), false); assert.deepEqual(r.parts, []);
  });
}
test("Windows publication skips directory sync while preserving immutable bytes", async () => {
  const r = await exercise(new Map([["directory-open", fault("EIO")]]), { directoryControl: true, platform: "win32", retry: true });
  assert.equal(r.failed, false); assert.equal(r.published, true); assert.deepEqual(r.parts, []);
  assert.equal(r.calls.includes("directory-open"), false);
});
test("real Linux directory descriptor publication succeeds", { skip: process.platform === "win32" ? "Real Linux descriptor exercised in Linux image qualification" : false }, async () => {
  const r = await exercise(new Map(), { directoryControl: true, platform: "linux", retry: true });
  assert.equal(r.failed, false); assert.deepEqual(r.parts, []); assert.ok(r.calls.includes("directory-close"));
});
