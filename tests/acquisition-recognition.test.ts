import test from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionCollectorKey,
  createAcquisitionRecognitionIndex,
  proposeAcquisitionPrintings,
} from "../lib/acquisition-recognition";
const cards = [
  {
    id: "a",
    name: "Forest Guard",
    setCode: "abc",
    collectorNumber: "123a",
    lang: "en",
  },
  {
    id: "b",
    name: "Forest Guard",
    setCode: "abc",
    collectorNumber: "123",
    lang: "en",
  },
  {
    id: "c",
    name: "Forest Guard",
    setCode: "xyz",
    collectorNumber: "42",
    lang: "en",
  },
  {
    id: "d",
    name: "River Guard",
    setCode: "abc",
    collectorNumber: "234",
    lang: "en",
  },
  {
    id: "e",
    name: "Forest Guard",
    setCode: "abc",
    collectorNumber: "123a",
    lang: "fr",
    printedName: "Garde",
  },
  {
    id: "f",
    name: "Forest Guard",
    setCode: "abc",
    collectorNumber: "123a",
    lang: "en",
    digital: true,
  },
];
const index = createAcquisitionRecognitionIndex(cards);
test("old-frame collector text ranks a printing but power/toughness and artist text are not identifiers", () => {
  const result = proposeAcquisitionPrintings(index, {
    title: ["Forest Guard"],
    footer: ["Illus. Greg Staples", "2/3", "123/350"],
  });
  assert.deepEqual(result.evidence.collectors, ["123"]);
  assert.deepEqual(result.evidence.languages, []);
  assert.equal(result.proposals[0].card.id, "b");
  assert.equal(result.automaticAcceptance, false);
});
test("an unsupported printed language is a conflict rather than an English substitution", () => {
  const result = proposeAcquisitionPrintings(index, {
    title: ["River Guard"],
    footer: ["R 234", "ABC JA"],
  });
  assert.equal(result.status, "CONFLICT");
  assert(result.proposals[0].reasons.includes("LANGUAGE_CONTRADICTION"));
});
test("unique exact metadata confirms a suffix-preserving paper printing", () => {
  assert.equal(acquisitionCollectorKey("00123a"), "123a");
  const result = proposeAcquisitionPrintings(index, {
    title: ["Forest Guard"],
    footer: ["R 00123a", "ABC * EN"],
  });
  assert.equal(result.proposals[0].card.id, "a");
  assert.equal(result.automaticAcceptance, true);
  assert.equal(result.finish, "UNKNOWN");
  assert.equal(result.condition, "UNKNOWN");
  assert(!result.proposals.some((p) => p.card.id === "f"));
  assert(!result.proposals.some((p) => p.card.id === "e"));
  assert.equal(result.status, "STRONG_MATCH");
  assert(
    !result.proposals
      .find((p) => p.card.id === "b")
      ?.reasons.includes("SET_AND_COLLECTOR_TEXT"),
  );
});
test("contradicting title and printing evidence stays explicitly conflicted", () => {
  const result = proposeAcquisitionPrintings(index, {
    title: ["River Guard"],
    footer: ["123/300 R", "ABC * EN"],
  });
  assert.equal(result.status, "CONFLICT");
  assert(result.proposals[0].reasons.includes("TITLE_CONTRADICTION"));
  assert(result.proposals.some((p) => p.card.id === "d"));
});
test("name-only and missing-catalog evidence cannot establish printing uniqueness", () => {
  const result = proposeAcquisitionPrintings(index, {
    title: ["River Guard"],
    footer: [],
  });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.catalogCoverage, "NOT_ESTABLISHED");
  assert.equal(result.totalProposals, 1);
  assert.equal(
    proposeAcquisitionPrintings(index, {
      title: [],
      footer: ["R 777", "ABC EN"],
    }).status,
    "NO_MATCH",
  );
  const many = proposeAcquisitionPrintings(
    index,
    { title: ["Forest Guard"], footer: [] },
    1,
  );
  assert.equal(many.truncated, true);
  assert(many.totalProposals > many.proposals.length);
});
test("face aliases work and similar titles remain review-only", () => {
  const faces = createAcquisitionRecognitionIndex([
    {
      id: "x",
      name: "Front // Back",
      setCode: "abc",
      collectorNumber: "1",
      faceNames: ["Printed Back"],
    },
  ]);
  assert.equal(
    proposeAcquisitionPrintings(faces, { title: ["Printed Back"], footer: [] })
      .proposals[0].card.id,
    "x",
  );
  const fuzzy = proposeAcquisitionPrintings(index, {
    title: ["River Gvard"],
    footer: [],
  });
  assert.equal(fuzzy.automaticAcceptance, false);
  assert(fuzzy.proposals[0].reasons.includes("SIMILAR_TITLE_ONLY"));
});

test("strong matches require strict titles and unambiguous set, number, language and catalog identity", () => {
  const evidence = { title: ["Forest Guard"], footer: ["R 123a", "ABC EN"] };
  for (const input of [
    { ...evidence, title: ["X Forest Guard"] },
    { ...evidence, title: ["Forest Guard", "River Guard"] },
    { ...evidence, title: ["Forest Gvard"] },
    { ...evidence, title: [] },
    { ...evidence, footer: ["R 123a", "ABC EN", "XYZ EN"] },
    { ...evidence, footer: ["R 123a", "R 123", "ABC EN"] },
    { ...evidence, footer: ["R 123a", "ABC EN", "ABC FR"] },
  ])
    assert.equal(
      proposeAcquisitionPrintings(index, input).automaticAcceptance,
      false,
    );
  const duplicates = createAcquisitionRecognitionIndex([
    ...cards,
    { ...cards[0], id: "duplicate" },
  ]);
  assert.equal(
    proposeAcquisitionPrintings(duplicates, evidence, 1).automaticAcceptance,
    false,
  );
});

test("a stamped reprint shares printed footer identity and prevents original auto-confirmation", () => {
  const original = {
    id: "original",
    name: "Timberland Ancient",
    setCode: "mom",
    collectorNumber: "210",
    lang: "en",
  };
  const stamped = {
    ...original,
    id: "stamped",
    setCode: "plst",
    collectorNumber: "MOM-210",
  };
  const input = { title: ["Timberland Ancient"], footer: ["C 0210", "MOM EN"] };
  for (const records of [[original, stamped], [stamped]]) {
    const result = proposeAcquisitionPrintings(
      createAcquisitionRecognitionIndex(records),
      input,
    );
    assert.equal(result.automaticAcceptance, false);
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert(result.proposals.some((p) => p.card.id === "stamped"));
    assert(
      result.proposals.every((p) => p.reasons.includes("STAMP_UNVERIFIED")),
    );
  }
});

test("printed-origin aliases preserve suffix and language distinctions", () => {
  const result = proposeAcquisitionPrintings(
    createAcquisitionRecognitionIndex([
      {
        id: "suffix",
        name: "Forest Guard",
        setCode: "plst",
        collectorNumber: "ABC-00123a",
        lang: "en",
      },
      {
        id: "other",
        name: "Forest Guard",
        setCode: "plst",
        collectorNumber: "ABC-123",
        lang: "en",
      },
      {
        id: "translated",
        name: "Forest Guard",
        setCode: "plst",
        collectorNumber: "ABC-123a",
        lang: "fr",
      },
    ]),
    { title: ["Forest Guard"], footer: ["R 123a", "ABC EN"] },
  );
  assert.equal(result.automaticAcceptance, false);
  assert.deepEqual(
    result.proposals
      .filter((p) => p.reasons.includes("SET_AND_COLLECTOR_TEXT"))
      .map((p) => p.card.id),
    ["suffix"],
  );
});
