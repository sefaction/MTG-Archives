import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { constants } from "node:buffer";
import { StringDecoder } from "node:string_decoder";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parserStream } from "stream-json";
import pick from "stream-json/filters/pick.js";
import streamObject from "stream-json/streamers/stream-object.js";
import { extractMtgjsonIdentifierMappings } from "../lib/pricing-mtgjson";
import { readMtgjsonIdentifierMappings } from "../lib/pricing-identifier-stream";

// Explicit offline acceptance tool. Never downloads input or publishes mappings.
async function main() {
  const [file, expectedSha] = process.argv.slice(2);
  assert(file && /^[a-f0-9]{64}$/.test(expectedSha || ""), "Supply a pinned public file and its provider SHA256.");
  const started = Date.now(), digest = crypto.createHash("sha256"), expected = crypto.createHash("sha256");
  let bytes = 0, utf16Units = 0, cards = 0, mappings = 0, peakRss = process.memoryUsage().rss;
  const decoder = new StringDecoder("utf8"), seenCards = new Set<string>(), seenIds = new Set<string>();
  let phase = "reference";
  const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
  const progress = setInterval(() => console.error(JSON.stringify({phase,bytes,cards,mappings,...process.memoryUsage()})),5000);
  const signal = AbortSignal.timeout(180_000);
  try {
    // Separate whole-card assembly and unchanged legacy extraction provide the
    // reference, independently of the selective token projector under test.
    await pipeline(fs.createReadStream(file), new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length; digest.update(chunk); utf16Units += decoder.write(chunk).length; done(null, chunk);
    }}), parserStream({ streamValues: false }), pick.asStream({ filter: "data" }), streamObject.asStream(), new Writable({
      objectMode: true,
      write(item: { key: string; value: unknown }, _encoding, done) {
        try {
          assert(/^[a-f0-9-]{36}$/i.test(item.key), "Reference requires unique nonnumeric UUID entry keys.");
          assert(!seenCards.has(item.key), "Reference cannot silently change duplicate-key semantics.");
          seenCards.add(Buffer.from(item.key,"utf16le").toString("utf16le")); cards++;
          for (const row of extractMtgjsonIdentifierMappings({ [item.key]: item.value })) {
            if (seenIds.has(row.scryfallId)) continue;
            seenIds.add(Buffer.from(row.scryfallId,"utf16le").toString("utf16le")); mappings++; expected.update(JSON.stringify(row) + "\n");
          }
          done();
        } catch (error) { done(error as Error); }
      },
    }), { signal });
    utf16Units += decoder.end().length;
    assert.equal(digest.digest("hex"), expectedSha);
    const expectedMappingsSha = expected.digest("hex");
    seenCards.clear(); seenIds.clear();
    phase = "selective-projection";
    const actual = await readMtgjsonIdentifierMappings(fs.createReadStream(file), { signal });
    const actualDigest = crypto.createHash("sha256");
    for (const row of actual) actualDigest.update(JSON.stringify(row) + "\n");
    assert.equal(actual.length, mappings); assert.equal(actualDigest.digest("hex"), expectedMappingsSha);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    console.log(JSON.stringify({ status: "PASS_COMPLETE_OFFLINE_IDENTIFIER_PROJECTION", bytes, utf16Units, oldWholeStringLimit: constants.MAX_STRING_LENGTH, exceedsOldWholeStringLimit: utf16Units > constants.MAX_STRING_LENGTH, cards, mappings, mappingSha256: expectedMappingsSha, feedSha256: expectedSha, peakRss, durationMs: Date.now() - started, noAppOrJobWrites: true }));
  } finally { clearInterval(timer); clearInterval(progress); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
