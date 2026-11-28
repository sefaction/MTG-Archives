import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  tokenFace,
  tokenPairIdentity,
  artCardIdentity,
  pairedSourceFingerprint,
  pairedSheetKey,
  pairedMetadataHash,
} from "../lib/paired-scan-policy";
const card = (name: string) => ({
  id: randomUUID(),
  scryfallId: randomUUID(),
  name,
  layout: "token",
  typeLine: "Token Creature - " + name,
  setCode: "tst",
  collectorNumber: "1",
  cardFaces: null,
  imageUri: null,
});

test("operator pairing binds immutable capture provenance and exact source bytes", () => {
  const photos = ["FRONT", "BACK"].map((side) => ({
    id: randomUUID(),
    side,
    generation: 1,
    digest: "b".repeat(64),
    ready: true,
    purgedAt: null,
    sourceMetadata: { side: "UNKNOWN", artifactId: randomUUID() },
    captureSlotId: randomUUID(),
    captureGeneration: 1,
  }));
  const evidence = {
    version: 1,
    kind: "OPERATOR_PAIR",
    operatorUserId: "owner",
    requestKey: randomUUID(),
    reason: "Checked physical item",
    confirmedAt: new Date().toISOString(),
    sources: photos.map((p) => ({
      photoId: p.id,
      digest: p.digest,
      side: p.side,
      captureSlotId: p.captureSlotId,
      captureGeneration: p.captureGeneration,
      metadataHash: pairedMetadataHash(p.sourceMetadata),
    })),
  };
  const original = pairedSourceFingerprint("TOKEN", 1, evidence, photos);
  assert.equal(
    pairedSourceFingerprint("TOKEN", 1, evidence, [...photos].reverse()),
    original,
  );
  for (const override of [
    { digest: "c".repeat(64) },
    { captureSlotId: randomUUID() },
    { captureGeneration: 2 },
    { sourceMetadata: { side: "BACK" } },
    { purgedAt: new Date() },
  ])
    assert.throws(() =>
      pairedSourceFingerprint("TOKEN", 1, evidence, [
        { ...photos[0], ...override },
        photos[1],
      ]),
    );
});
test("token identity is a multiset of exact face printings, independent of feed direction and names", () => {
  const a = tokenFace(card("Treasure"), 0),
    b = tokenFace(card("Goblin"), 0),
    c = tokenFace(card("Goblin"), 0);
  assert.deepEqual(tokenPairIdentity(a, b), tokenPairIdentity(b, a));
  assert.equal(tokenPairIdentity(a, b).name, "Goblin // Treasure");
  assert.notEqual(tokenPairIdentity(a, b).key, tokenPairIdentity(a, c).key);
  assert.notEqual(tokenPairIdentity(a, a).key, tokenPairIdentity(a, b).key);
  assert.throws(() =>
    tokenFace({ ...card("Advertising"), layout: "normal" }, 0),
  );
  assert.throws(() => tokenFace({ ...card("Goblin"), scryfallId: null }, 0));
});
test("art variants remain art cards and distinguish stamp evidence without treating the stamp as foil or List", () => {
  const a = {
    ...card("Island"),
    layout: "art_series",
    cardFaces: [
      { name: "Island", type_line: "Card" },
      { name: "Island", type_line: "Card" },
    ],
  };
  assert.notEqual(
    artCardIdentity(a, "GOLD_SIGNATURE").key,
    artCardIdentity(a, "UNSTAMPED").key,
  );
  assert.notEqual(
    artCardIdentity(a, "GOLD_SIGNATURE").key,
    artCardIdentity(a, "GOLD_PLANESWALKER").key,
  );
  assert.throws(() => artCardIdentity({ ...a, layout: "normal" }, "UNSTAMPED"));
  assert.throws(() => artCardIdentity(a, "UNKNOWN"));
});
test("pair source binds exact sides, current generation, execution and native sheet, never adjacency", () => {
  const evidence = {
    version: 1 as const,
    kind: "SCANNER_SHEET",
    runId: randomUUID(),
    executionId: randomUUID(),
    documentNumber: 0,
    paperCount: 3,
  };
  const p = (side: string) => ({
    id: randomUUID(),
    side,
    generation: 1,
    digest: "a".repeat(64),
    ready: true,
    purgedAt: null,
    sourceMetadata: {
      runId: evidence.runId,
      executionId: evidence.executionId,
      side,
      sheet: { version: 1, documentNumber: 0, paperCount: 3 },
    },
  });
  const a = p("FRONT"),
    b = p("BACK");
  assert.equal(
    pairedSourceFingerprint("TOKEN", 1, evidence, [a, b]),
    pairedSourceFingerprint("TOKEN", 1, evidence, [b, a]),
  );
  assert.throws(() => pairedSourceFingerprint("TOKEN", 1, evidence, [a]));
  assert.throws(() =>
    pairedSourceFingerprint("TOKEN", 1, evidence, [a, { ...b, generation: 2 }]),
  );
  assert.throws(() =>
    pairedSourceFingerprint("TOKEN", 1, evidence, [a, { ...b, ready: false }]),
  );
  assert.throws(() =>
    pairedSourceFingerprint("TOKEN", 1, evidence, [
      a,
      {
        ...b,
        sourceMetadata: { ...b.sourceMetadata, executionId: randomUUID() },
      },
    ]),
  );
  assert.notEqual(
    pairedSheetKey(evidence),
    pairedSheetKey({ ...evidence, executionId: randomUUID() }),
  );
});
