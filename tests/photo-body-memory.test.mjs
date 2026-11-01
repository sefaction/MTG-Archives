import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/acquisition-files.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("acquisition-files.ts", source, ts.ScriptTarget.Latest, true);
const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "readBoundedPhotoBody");
assert.ok(declaration);
const actual = ts.transpileModule(declaration.getText(tree).replace(/^export\s+/, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const MAX = 10 * 1024 * 1024;

function setup(values, options = {}) {
  let retained = 0, fragments = 0, canceled = 0, released = 0, reads = 0;
  const observedBuffer = new Proxy(Buffer, { get(target, key) {
    if (key === "concat") return (chunks, total) => {
      retained = [...new Set(chunks.map(chunk => chunk.buffer))].reduce((sum, buffer) => sum + buffer.byteLength, 0);
      fragments = chunks.length;
      return Buffer.concat(chunks, total);
    };
    return Reflect.get(target, key);
  } });
  const reader = {
    async read() {
      if (options.failure) throw options.failure;
      reads++;
      return values.length ? { value: values.shift(), done: false } : { done: true };
    },
    async cancel() { canceled++; if (options.cancelFailure) throw options.cancelFailure; },
    releaseLock() { released++; },
  };
  const read = vm.runInNewContext(actual + "\nreadBoundedPhotoBody", { Buffer: observedBuffer, PHOTO_MAX_BYTES: MAX });
  return { read: () => read({ headers: new Headers(options.headers), body: { getReader: () => reader } }),
    counts: () => ({ retained, fragments, canceled, released, reads }) };
}

test("small slices do not retain their large upstream backing buffers", async () => {
  const values = Array.from({ length: 64 }, (_, i) => {
    const backing = new Uint8Array(64 * 1024);
    backing[17] = i;
    return backing.subarray(17, 18);
  });
  const fixture = setup(values);
  assert.deepEqual(await fixture.read(), Buffer.from(Array.from({ length: 64 }, (_, i) => i)));
  assert.ok(fixture.counts().retained <= 64 * 1024, "only owned payload storage is retained");
});

test("empty stream chunks retain no backing buffers or fragment entries", async () => {
  const fixture = setup(Array.from({ length: 64 }, () => new Uint8Array(65536).subarray(0, 0)));
  assert.deepEqual(await fixture.read(), Buffer.alloc(0));
  assert.equal(fixture.counts().fragments, 0);
});

test("one-byte stream fragments are packed into bounded owned chunks", async () => {
  const fixture = setup(Array.from({ length: 65539 }, (_, i) => Uint8Array.of(i % 251)));
  const bytes = await fixture.read();
  assert.deepEqual(bytes, Buffer.from(Array.from({ length: 65539 }, (_, i) => i % 251)));
  assert.equal(fixture.counts().fragments, 2);
  assert.ok(fixture.counts().retained <= 2 * 65536);
  assert.equal(fixture.counts().canceled, 1);
  assert.equal(fixture.counts().released, 1);
});

for (const size of [0, 1, 65536, MAX]) test(`ordinary ${size}-byte body keeps exact bytes`, async () => {
  const bytes = Buffer.alloc(size, 71);
  assert.deepEqual(await setup([bytes]).read(), bytes);
});

test("overflow refuses before reading another chunk and still releases the reader", async () => {
  const fixture = setup([Buffer.alloc(MAX), Uint8Array.of(1), Uint8Array.of(2)]);
  await assert.rejects(fixture.read(), /10 MB/);
  assert.equal(fixture.counts().reads, 2);
  assert.equal(fixture.counts().released, 1);
});

test("read failure survives cancellation failure with lock released", async () => {
  const failure = Error("controlled read failure");
  const fixture = setup([], { failure, cancelFailure: Error("controlled cancel failure") });
  await assert.rejects(fixture.read(), error => error === failure);
  assert.equal(fixture.counts().released, 1);
});

test("declared oversized body refuses without consuming it", async () => {
  const fixture = setup([], { headers: { "content-length": String(MAX + 1) } });
  await assert.rejects(fixture.read(), /10 MB/);
  assert.equal(fixture.counts().reads, 0);
});

test("real Request stream preserves mixed fragments and releases its lock", async () => {
  const chunks = [Uint8Array.of(1, 2), new Uint8Array(0), Buffer.alloc(65536, 3), Uint8Array.of(4)];
  const expected = Buffer.concat(chunks);
  const stream = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } });
  const request = new Request("http://localhost/upload", { method: "POST", body: stream, duplex: "half" });
  const read = vm.runInNewContext(actual + "\nreadBoundedPhotoBody", { Buffer, PHOTO_MAX_BYTES: MAX });
  assert.deepEqual(await read(request), expected);
  assert.equal(request.body.locked, false);
});
