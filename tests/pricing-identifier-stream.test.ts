import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readMtgjsonIdentifierMappings, fetchMtgjsonIdentifierMappings } from "../lib/pricing-identifier-stream";
import { extractMtgjsonIdentifierMappings } from "../lib/pricing-mtgjson";

function chunks(text: string, size = 7) {
  const bytes = Buffer.from(text);
  return Readable.from((function* () { for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size); })());
}
test("stream projection matches the existing extractor, including duplicate keys/order and fallback", async () => {
  const documents = [
    '{"meta":{"date":"x"},"data":{"a":{"uuid":" u ","identifiers":{"scryfallId":" s "}},"b":{"scryfallId":"fallback"},"c":{"identifiers":{"scryfallId":" s "}},"d":null}}',
    '{"2":{"scryfallId":"same"},"1":{"scryfallId":"same"},"x":{"uuid":"","scryfallId":" x "}}',
    '{"data":{"a":{"scryfallId":"old"},"a":{"uuid":"new","scryfallId":"last"},"b":{"scryfallId":"last"}}}',
    '{"a":{"uuid":"one","uuid":{},"scryfallId":"s","identifiers":{"scryfallId":"nested"},"identifiers":null},"data":[]}',
    '{"data":{"x":{"scryfallId":"old"}},"data":{"y":{"scryfallId":"new"}}}',
    '{"data":{"x":{"scryfallId":"ignored"}},"data":null,"z":{"scryfallId":"fallback"}}',
    '{"data":{"uuid":{"uuid":"u","scryfallId":"s"},"identifiers":{"scryfallId":"i"},"__proto__":{"scryfallId":"p"}}}',
    '{"data":{"é😀":{"uuid":"u\\\\\\\"\\u00e9","identifiers":{"scryfallId":"終😀"}},"b":{"identifiers":{"scryfallId":"x","scryfallId":false},"scryfallId":"fallback"}}}',
    '{"data":{"a":{"identifiers":[{"scryfallId":"bad"}],"scryfallId":"good","irrelevant":{"deep":[null,true,false,-1.2e3]}}}}',
    '[]', 'null', '123', '"text"', '{"data":{}}', '{}',
  ];
  for (const text of documents) for (const size of [1, 7, 8192]) {
    assert.deepEqual(await readMtgjsonIdentifierMappings(chunks(text, size)), extractMtgjsonIdentifierMappings(JSON.parse(text)), text);
  }
});

test("ignored large strings stream without packed allocation", async () => {
  const source = Readable.from((async function* () {
    yield '{"data":{"a":{"text":"';
    for (let i = 0; i < 256; i++) yield "x".repeat(65536);
    yield '","identifiers":{"scryfallId":"s"}}}}';
  })());
  assert.deepEqual(await readMtgjsonIdentifierMappings(source), [{ mtgjsonUuid: "a", scryfallId: "s" }]);
});

test("reject malformed or truncated suffix before returning mappings and destroy the source", async () => {
  for (const text of ['{"data":{"a":{"scryfallId":"s"}}', '{"data":{"a":{"scryfallId":"s"}}}garbage', '{"data":{}} {}', '{"data":{"a":{"scryfallId":"s"},}}']) {
    const source = chunks(text);
    await assert.rejects(readMtgjsonIdentifierMappings(source));
    assert.equal(source.destroyed, true);
  }
});

test("abort, input failure, excessive identity text and nesting close the stream", async () => {
  const abort = new AbortController(); abort.abort();
  const source = chunks('{"data":{}}');
  await assert.rejects(readMtgjsonIdentifierMappings(source, { signal: abort.signal }), { name: "AbortError" });
  assert(source.destroyed);
  const broken = Readable.from((async function* () { yield '{"data":'; throw new Error("fixture disconnect"); })());
  await assert.rejects(readMtgjsonIdentifierMappings(broken), /fixture disconnect/);
  assert(broken.destroyed);
  await assert.rejects(readMtgjsonIdentifierMappings(chunks(JSON.stringify({ data: { a: { scryfallId: "x".repeat(65537) } } }))), /text limit/);
  await assert.rejects(readMtgjsonIdentifierMappings(chunks('['.repeat(129) + ']'.repeat(129))), /nesting limit/);
});

test("HTTP reader never calls whole-body json and cancels unsuccessful bodies", async () => {
  const original = globalThis.fetch;
  let cancelled = false, jsonCalls = 0;
  try {
    globalThis.fetch = async () => {
      const response = new Response('{"data":{"a":{"scryfallId":"s"}}}');
      response.json = async () => { jsonCalls++; throw new RangeError("Cannot create a string longer than 0x1fffffe8 characters"); };
      return response;
    };
    assert.deepEqual(await fetchMtgjsonIdentifierMappings("https://fixture.invalid"), [{ mtgjsonUuid: "a", scryfallId: "s" }]);
    assert.equal(jsonCalls, 0);
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503, statusText: "Unavailable" });
    await assert.rejects(fetchMtgjsonIdentifierMappings("https://fixture.invalid"), /HTTP 503 Unavailable/);
    assert(cancelled);
  } finally { globalThis.fetch = original; }
});

test("escaped unpaired surrogate identities survive detached UTF-16 storage", async () => {
  const document = JSON.stringify({ data: { [String.fromCharCode(0xd800)]: { uuid: String.fromCharCode(0xdc00), identifiers: { scryfallId: "s" + String.fromCharCode(0xd801) } } } });
  assert.deepEqual(await readMtgjsonIdentifierMappings(chunks(document, 1)), extractMtgjsonIdentifierMappings(JSON.parse(document)));
});

test("deterministic mixed-shape documents retain legacy selection semantics", async () => {
  let seed = 176867;
  const next = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const variants: unknown[] = [null, 0, true, [], "not-a-card", {}, { uuid: " u ", scryfallId: " s " }, { uuid: "", identifiers: { scryfallId: "s" }, scryfallId: "fallback" }, { identifiers: [], scryfallId: "array-fallback" }, { uuid: {}, identifiers: { scryfallId: 1 }, scryfallId: "fallback" }];
  for (let i = 0; i < 128; i++) {
    const cards = Object.fromEntries(["2", "1", "a", "b", "__proto__", "uuid", "identifiers"].map(key => [key, variants[next(variants.length)]]));
    const payload = next(2) ? { data: cards, extra: variants[next(variants.length)] } : { ...cards, data: variants[next(variants.length)] };
    const document = JSON.stringify(payload);
    assert.deepEqual(await readMtgjsonIdentifierMappings(chunks(document, 1 + next(31))), extractMtgjsonIdentifierMappings(JSON.parse(document)));
  }
});
