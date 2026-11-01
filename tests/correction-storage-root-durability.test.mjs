import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(process.env.MTG_CORRECTION_FILES_SOURCE || new URL("../lib/acquisition-correction-files.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("correction-files.ts", source, ts.ScriptTarget.Latest, true);
const code = ["syncDirectory", "verifyCorrectionBlobDurability"].map(name => {
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, "Complete actual function " + name);
  return ts.transpileModule(declaration.getText(tree).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}).join("\n");
const root = path.resolve("owned-correction-root"), namespace = path.join(root, "correction-library-v1"), owner = path.join(namespace, "owner-hash");
const directories = [owner, namespace, root];
const error = code => Object.assign(Error("bounded correction barrier fault"), { code });
async function exercise(faults = new Map(), platform = "linux", readFailure = false) {
  const calls = [];
  const step = (directory, phase) => {
    const index = directories.indexOf(directory); assert.notEqual(index, -1, "Stay inside provisioned root");
    calls.push(`${index}:${phase}`);
    if (faults.has(`${index}:${phase}`)) throw faults.get(`${index}:${phase}`);
  };
  const verify = vm.runInNewContext(code + "\nverifyCorrectionBlobDurability", {
    path, AggregateError, process: { platform },
    readCorrectionBlob: async (...args) => { assert.deepEqual(args, ["owner", "digest", 71]); calls.push("read"); if (readFailure) throw readFailure; },
    ownerDirectory: async actual => { assert.equal(actual, "owner"); calls.push("owner"); return owner; },
    open: async (directory, mode) => {
      assert.equal(mode, "r"); step(directory, "open");
      return { sync: async () => step(directory, "sync"), close: async () => step(directory, "close") };
    },
  });
  let rejected = false, cause;
  try { await verify("owner", "digest", 71); } catch (failure) { rejected = true; cause = failure; }
  return { calls, rejected, cause };
}
const healthyCalls = ["read", "owner", ...directories.flatMap((_, i) => [`${i}:open`, `${i}:sync`, `${i}:close`])];
test("correction acknowledgement confirms leaf, namespace and provisioned root in order", async () => {
  const observed = await exercise(); assert.equal(observed.rejected, false); assert.deepEqual(observed.calls, healthyCalls);
});
for (let i = 0; i < directories.length; i++) for (const phase of ["open", "sync", "close"]) {
  test(`directory ${i} ${phase} failure refuses acknowledgement and still attempts other directories`, async () => {
    const cause = error("EIO"), observed = await exercise(new Map([[`${i}:${phase}`, cause]]));
    assert.equal(observed.rejected, true); assert.equal(observed.cause, cause);
    assert.deepEqual(observed.calls.filter(call => call.endsWith(":open")), ["0:open", "1:open", "2:open"]);
    if (phase !== "open") assert.ok(observed.calls.includes(`${i}:close`), "Always close an opened directory");
  });
}
test("multiple directory and descriptor failures preserve ordered causes and the primary code", async () => {
  const first = error("ENOSPC"), second = error("EACCES"), third = error("EIO");
  const observed = await exercise(new Map([["0:sync", first], ["1:open", second], ["2:sync", third], ["2:close", undefined]]));
  assert.equal(observed.rejected, true); assert.ok(observed.cause instanceof AggregateError);
  assert.equal(observed.cause.code, "ENOSPC"); assert.equal(observed.cause.cause, first);
  const [leaf, namespaceFailure, rootFailure] = observed.cause.errors;
  assert.equal(leaf, first); assert.equal(namespaceFailure, second); assert.ok(rootFailure instanceof AggregateError);
  assert.deepEqual(rootFailure.errors, [third, undefined]); assert.equal(rootFailure.cause, third);
  assert.deepEqual(observed.calls.filter(call => call.endsWith(":open")), ["0:open", "1:open", "2:open"]);
});
for (const first of [undefined, null, false, 0, ""]) test(`falsy primary ${String(first)} is retained ahead of a later directory error`, async () => {
  const later = error("EIO"), observed = await exercise(new Map([["0:open", first], ["2:close", later]]));
  assert.equal(observed.rejected, true); assert.ok(observed.cause instanceof AggregateError);
  assert.deepEqual(observed.cause.errors, [first, later]); assert.equal(observed.cause.cause, first);
  assert.equal(Object.hasOwn(observed.cause, "code"), false);
});
test("a lone falsy ancestor failure remains a rejection", async () => {
  const observed = await exercise(new Map([["2:close", undefined]])); assert.equal(observed.rejected, true); assert.equal(observed.cause, undefined);
});
test("an integrity/read failure precedes every directory barrier", async () => {
  const cause = error("INTEGRITY"), observed = await exercise(new Map(), "linux", cause);
  assert.equal(observed.rejected, true); assert.equal(observed.cause, cause); assert.deepEqual(observed.calls, ["read"]);
});
test("Windows keeps verified reads and its directory-descriptor no-op", async () => {
  const observed = await exercise(new Map(), "win32"); assert.equal(observed.rejected, false); assert.deepEqual(observed.calls, ["read", "owner"]);
});
