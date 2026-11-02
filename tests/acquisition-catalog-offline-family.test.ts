import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  offlineCatalogIdentity, offlineCatalogKey, offlineCatalogName,
  mergeOfflineCatalogMembers, offlineCatalogFamilySchema,
  offlineCatalogManifestSchema, offlineCatalogPrintingKey,
} from "../lib/acquisition-catalog-offline-family";

function card(name = "Forest") {
  return { object: "card", id: randomUUID(), name, set: "tst", set_name: "Test",
    collector_number: "12a", rarity: "common", color_identity: [], lang: "en",
    digital: false, games: ["paper"], prices: { usd: "1.00" } };
}

test("offline family keys preserve punctuation and source/generation identity", () => {
  const source = "a".repeat(64), generation = randomUUID();
  assert.equal(offlineCatalogName("ＦＯＲＥＳＴ"), "forest");
  const key = offlineCatalogKey("family", source, generation, "Forest");
  assert.equal(key, offlineCatalogKey("family", source, generation, "FOREST"));
  assert.notEqual(key, offlineCatalogKey("family", "b".repeat(64), generation, "Forest"));
  assert.notEqual(key, offlineCatalogKey("family", source, randomUUID(), "Forest"));
  assert.notEqual(offlineCatalogKey("family", source, generation, "Rampant Growth"),
    offlineCatalogKey("family", source, generation, "Rampant, Growth"));
  assert.throws(() => offlineCatalogKey("manifest", source, generation));
});

test("printing locators preserve suffixes and printed-origin prefixes while accepting zero padding", () => {
  const source = "a".repeat(64), generation = randomUUID();
  assert.equal(offlineCatalogPrintingKey(source, generation, "TST", "0012a"),
    offlineCatalogPrintingKey(source, generation, "tst", "12A"));
  assert.notEqual(offlineCatalogPrintingKey(source, generation, "plst", "KLD-172"),
    offlineCatalogPrintingKey(source, generation, "plst", "172"));
  assert.notEqual(offlineCatalogPrintingKey(source, generation, "tst", "12a"),
    offlineCatalogPrintingKey(source, generation, "tst", "12b"));
});

test("a source marker cannot advertise coverage with missing rows or contradictory counts", () => {
  const source = { version: 1, generation: randomUUID(), refreshId: randomUUID(), sourceDigest: "a".repeat(64),
    sourceType: "scryfall-default-jsonl-gzip-v1", sourceUpdatedAt: new Date().toISOString(),
    sourceBytes: "100", expectedRows: 3, preparedRows: 2, englishPaperRows: 2, verified: false };
  assert.equal(offlineCatalogManifestSchema.safeParse(source).success, true);
  assert.equal(offlineCatalogManifestSchema.safeParse({ ...source, verified: true }).success, false);
  assert.equal(offlineCatalogManifestSchema.safeParse({ ...source, englishPaperRows: 3 }).success, false);
  assert.equal(offlineCatalogManifestSchema.safeParse({ ...source, preparedRows: 3, verified: true }).success, true);
  assert.equal(offlineCatalogManifestSchema.safeParse({ ...source, sourceBytes: String(1024 ** 3 + 1) }).success, false);
});

test("English paper identity includes full and face names without inferring foreign or digital coverage", () => {
  const raw = { ...card("Island // Island"), card_faces: [{ name: "Island" }, { name: "Island" }] };
  assert.deepEqual(offlineCatalogIdentity(raw)?.names, ["Island // Island", "Island"]);
  assert.equal(offlineCatalogIdentity({ ...raw, lang: "fr" }), null);
  assert.equal(offlineCatalogIdentity({ ...raw, digital: true }), null);
  assert.equal(offlineCatalogIdentity({ ...raw, games: ["arena"] }), null);
  assert.throws(() => offlineCatalogIdentity({ ...raw, games: undefined }));
  assert.throws(() => offlineCatalogIdentity({ ...raw, card_faces: [{ printed_name: "Island" }] }));
});

test("family identity tolerates price refresh but detects changed printing semantics", () => {
  const raw = card(); const first = offlineCatalogIdentity(raw)!;
  assert.equal(offlineCatalogIdentity({ ...raw, prices: { usd: "99.00" }, oracle_text: "Updated rules" })?.identity, first.identity);
  for (const change of [{ name: "Other" }, { set: "new" }, { collector_number: "12b" }, { card_faces: [{ name: "Other face" }] }])
    assert.notEqual(offlineCatalogIdentity({ ...raw, ...change })?.identity, first.identity);
});

test("resumed members are idempotent and contradictory or duplicate coverage is rejected", () => {
  const first = offlineCatalogIdentity(card())!, second = offlineCatalogIdentity(card())!;
  const members = [first, second].map(({ id, identity }) => ({ id, identity }));
  assert.deepEqual(mergeOfflineCatalogMembers(members, [members[0]]),
    [...members].sort((a, b) => a.id.localeCompare(b.id)));
  assert.throws(() => mergeOfflineCatalogMembers(members, [{ ...members[0], identity: "f".repeat(64) }]));
  assert.equal(offlineCatalogFamilySchema.safeParse({ version: 1, sourceDigest: "a".repeat(64),
    generation: randomUUID(), name: "Forest", members: [members[0], members[0]] }).success, false);
});
