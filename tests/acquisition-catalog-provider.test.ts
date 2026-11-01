import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  acquisitionCatalogQueries,
  catalogQueryKey,
} from "../lib/acquisition-catalog-queries";
import {
  acquisitionCatalogProvider,
  fetchAcquisitionCatalogQuery,
} from "../lib/acquisition-catalog-provider";
import type {
  ScryfallCard,
  ScryfallClientError,
  ScryfallResult,
} from "../lib/scryfall";

const card = (number: number, set = "tst"): ScryfallCard => ({
  object: "card",
  id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  name: "Test Card",
  set,
  set_name: "Fixture",
  collector_number: set === "plst" ? "TST-1" : String(number),
  rarity: "common",
  lang: "en",
  cmc: 1,
  color_identity: [],
  digital: false,
});
const ok = <T>(data: T): ScryfallResult<T> => ({
  ok: true,
  data,
  correlationId: "test",
  requestsMade: 1,
});
const fail = (kind: ScryfallClientError["kind"]): ScryfallResult<never> => ({
  ok: false,
  error: {
    kind,
    message: "fixture",
    retryable: kind === "RATE_LIMITED",
    retryAfterMs: 15000,
  },
  correlationId: "test",
  requestsMade: 1,
});
type Provider = typeof acquisitionCatalogProvider;
const query = {
  kind: "printing" as const,
  set: "tst",
  number: "1",
  language: "en",
};
const signal = () => AbortSignal.timeout(5000);

test("unknown-set extraction works without a local catalog and does not cross orientations", () => {
  const extracted = acquisitionCatalogQueries([
    {
      rotationDegrees: 0,
      text: { title: ["Future Card"], footer: ["NEWSET EN", "C 00042"] },
    },
    {
      rotationDegrees: 180,
      text: { title: ["other"], footer: ["OTHER FR", "091/200"] },
    },
  ]);
  assert.deepEqual(extracted.printings, [
    { kind: "printing", set: "newset", number: "42", language: "en" },
    { kind: "printing", set: "other", number: "91", language: "fr" },
  ]);
  assert.equal(
    acquisitionCatalogQueries([
      { rotationDegrees: 0, text: { title: ["12", "?"], footer: [] } },
    ]).names.length,
    0,
  );
});

test("query identity normalizes typography but preserves printing suffixes and language", () => {
  assert.equal(
    catalogQueryKey(query),
    catalogQueryKey({ ...query, number: "0001" }),
  );
  assert.notEqual(
    catalogQueryKey(query),
    catalogQueryKey({ ...query, number: "1a" }),
  );
  assert.notEqual(
    catalogQueryKey(query),
    catalogQueryKey({ ...query, language: "fr" }),
  );
  assert.equal(
    catalogQueryKey({ kind: "name", name: "Test Card" }),
    catalogQueryKey({ kind: "name", name: "test card", fuzzy: false }),
  );
});

test("name lookups retire old negative cache identities without invalidating explicit printings", () => {
  const oldKey = (query: unknown) => createHash("sha256")
    .update(JSON.stringify({ version: 1, query })).digest("hex");
  assert.equal(catalogQueryKey(query), oldKey(query));
  const id = { kind: "id" as const, id: card(1).id };
  assert.equal(catalogQueryKey(id), oldKey(id));
  for (const fuzzy of [false, true]) {
    const name = { kind: "name" as const, name: "crashing boars", fuzzy };
    assert.notEqual(catalogQueryKey(name), oldKey(name));
  }
});

test("all printing pages are fetched, including a stamped counterpart missing from the installation", async () => {
  const calls: number[] = [];
  const provider: Provider = {
    card: async () => ok(card(1)),
    printings: async (name, page, language) => {
      assert.equal(name, "Test Card");
      assert.equal(language, "en");
      calls.push(page);
      return ok({
        object: "list",
        data: [card(page, page === 2 ? "plst" : "tst")],
        has_more: page === 1,
      });
    },
  };
  const result = await fetchAcquisitionCatalogQuery(query, signal(), provider);
  assert.equal(result.status, "FOUND");
  assert.equal(result.printingCoverage, "CHECKED");
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.cards.length, 2);
  assert.equal(result.requestsMade, 3);
  assert.equal(result.cards[1].set, "plst");
});

test("a digital named-card result still enumerates all paper printings", async () => {
  for (const name of ["Krosan Vorine", "Crashing Boars"]) {
    const digital = { ...card(1), name, digital: true };
    const original = { ...card(2), name };
    const list = { ...card(3, "plst"), name };
    const pages: number[] = [];
    const provider: Provider = {
      card: async () => ok(digital),
      printings: async (requestedName, page, language) => {
        assert.equal(requestedName, name);
        assert.equal(language, "en");
        pages.push(page);
        return ok({ object: "list", data: [page === 1 ? original : list],
          has_more: page === 1, total_cards: 2 });
      },
    };
    const result = await fetchAcquisitionCatalogQuery({ kind: "name", name }, signal(), provider);
    assert.equal(result.status, "FOUND");
    assert.equal(result.printingCoverage, "CHECKED");
    assert.deepEqual(pages, [1, 2]);
    assert.deepEqual(result.cards.map(c => c.id), [original.id, list.id]);
    assert.equal(result.requestsMade, 3);
  }
});

test("digital-only names stay not found while paper enumeration failures remain errors", async () => {
  const provider: Provider = {
    card: async () => ok({ ...card(1), digital: true }),
    printings: async () => fail("NOT_FOUND"),
  };
  const name = { kind: "name" as const, name: "Test Card" };
  const missing = await fetchAcquisitionCatalogQuery(name, signal(), provider);
  assert.equal(missing.status, "NOT_FOUND");
  assert.equal(missing.requestsMade, 2);
  assert.deepEqual(missing.cards, []);
  const failed = await fetchAcquisitionCatalogQuery(name, signal(), {
    ...provider, printings: async () => fail("RATE_LIMITED"),
  });
  assert.equal(failed.status, "PROVIDER_ERROR");
  assert.equal(failed.errorKind, "RATE_LIMITED");
});

test("explicit digital identities remain unavailable and digital enumeration cannot establish paper coverage", async () => {
  let enumerated = false;
  const digital = { ...card(1), digital: true };
  const provider: Provider = {
    card: async () => ok(digital),
    printings: async () => { enumerated = true; return ok({ object: "list", data: [digital], has_more: false }); },
  };
  for (const identity of [query, { kind: "id" as const, id: digital.id }]) {
    assert.equal((await fetchAcquisitionCatalogQuery(identity, signal(), provider)).status, "NOT_FOUND");
  }
  assert.equal(enumerated, false);
  const result = await fetchAcquisitionCatalogQuery({ kind: "name", name: digital.name }, signal(), provider);
  assert.equal(result.status, "PROVIDER_ERROR");
  assert.equal(result.printingCoverage, "UNRESOLVED");
  assert.deepEqual(result.cards, []);
});

test("exact-name coverage accepts matching faces without accepting unrelated multi-face cards", async () => {
  const first = { ...card(1), name: "Island" };
  let paired = {
    ...card(2),
    name: "Island // Island",
    card_faces: [{ name: "Island" }, { name: "Island" }],
  } as ScryfallCard;
  const provider: Provider = {
    card: async () => ok(first),
    printings: async () =>
      ok({
        object: "list",
        data: [first, paired],
        has_more: false,
        total_cards: 2,
      }),
  };
  const result = await fetchAcquisitionCatalogQuery(query, signal(), provider);
  assert.equal(result.status, "FOUND");
  assert.equal(result.printingCoverage, "CHECKED");
  assert.equal(result.cards.length, 2);
  paired = {
    ...paired,
    card_faces: [{ name: "Mountain" }, { name: "Swamp" }],
  } as ScryfallCard;
  assert.equal(
    (await fetchAcquisitionCatalogQuery(query, signal(), provider)).errorKind,
    "INVALID_RESPONSE",
  );
});

test("provider failure after a valid initial card keeps unresolved coverage and retry details", async () => {
  const provider: Provider = {
    card: async () => ok(card(1)),
    printings: async () => fail("RATE_LIMITED"),
  };
  const result = await fetchAcquisitionCatalogQuery(query, signal(), provider);
  assert.equal(result.status, "PROVIDER_ERROR");
  assert.equal(result.printingCoverage, "UNRESOLVED");
  assert.equal(result.cards.length, 1);
  assert.equal(result.errorKind, "RATE_LIMITED");
  assert.equal(result.retryAfterMs, 15000);
});

test("not-found metadata is different from failed enumeration of a known card", async () => {
  let searched = false;
  const missing: Provider = {
    card: async () => fail("NOT_FOUND"),
    printings: async () => {
      searched = true;
      return fail("NOT_FOUND");
    },
  };
  assert.equal(
    (await fetchAcquisitionCatalogQuery(query, signal(), missing)).status,
    "NOT_FOUND",
  );
  assert.equal(searched, false);
  const incomplete: Provider = { ...missing, card: async () => ok(card(1)) };
  assert.equal(
    (await fetchAcquisitionCatalogQuery(query, signal(), incomplete)).status,
    "PROVIDER_ERROR",
  );
});

test("repeated pages, unrelated cards and mismatched exact IDs cannot establish coverage", async () => {
  const repeated: Provider = {
    card: async () => ok(card(1)),
    printings: async () =>
      ok({ object: "list", data: [card(1)], has_more: true }),
  };
  assert.equal(
    (await fetchAcquisitionCatalogQuery(query, signal(), repeated)).errorKind,
    "INVALID_RESPONSE",
  );
  const unrelated: Provider = {
    ...repeated,
    printings: async () =>
      ok({
        object: "list",
        data: [{ ...card(2), name: "Different Card" }],
        has_more: false,
      }),
  };
  assert.equal(
    (await fetchAcquisitionCatalogQuery(query, signal(), unrelated))
      .printingCoverage,
    "UNRESOLVED",
  );
  assert.equal(
    (
      await fetchAcquisitionCatalogQuery(
        { kind: "id", id: card(2).id },
        signal(),
        repeated,
      )
    ).errorKind,
    "INVALID_RESPONSE",
  );
});

test("cancellation prevents a new provider request", async () => {
  let calls = 0;
  const provider: Provider = {
    card: async () => {
      calls++;
      return ok(card(1));
    },
    printings: async () => fail("NOT_FOUND"),
  };
  const cancelled = new AbortController();
  cancelled.abort();
  const result = await fetchAcquisitionCatalogQuery(
    query,
    cancelled.signal,
    provider,
  );
  assert.equal(calls, 0);
  assert.equal(result.errorKind, "TIMEOUT");
  assert.equal(result.printingCoverage, "UNRESOLVED");
});

test("advertised totals and original printing membership must agree before coverage is checked", async () => {
  const missing: Provider = {
    card: async () => ok(card(1)),
    printings: async () =>
      ok({ object: "list", data: [card(1)], has_more: false, total_cards: 2 }),
  };
  assert.equal(
    (await fetchAcquisitionCatalogQuery(query, signal(), missing))
      .printingCoverage,
    "UNRESOLVED",
  );
  const omittedOriginal: Provider = {
    ...missing,
    printings: async () =>
      ok({ object: "list", data: [card(2)], has_more: false, total_cards: 1 }),
  };
  assert.equal(
    (await fetchAcquisitionCatalogQuery(query, signal(), omittedOriginal))
      .errorKind,
    "INVALID_RESPONSE",
  );
});

test("punctuation-colliding search hits do not invalidate or enter exact-name paper coverage", async () => {
  const first = { ...card(1), name: "Rampant Growth" };
  const another = { ...card(2), name: first.name };
  const collision = { ...card(3), name: "Rampant, Growth" };
  const calls: number[] = [];
  const provider: Provider = {
    card: async () => ok(first),
    printings: async (_, page) => {
      calls.push(page);
      return ok({ object: "list", data: page === 1 ? [first, collision] : [another],
        has_more: page === 1, total_cards: 3 });
    },
  };
  const result = await fetchAcquisitionCatalogQuery({ kind: "name", name: first.name }, signal(), provider);
  assert.equal(result.status, "FOUND");
  assert.equal(result.printingCoverage, "CHECKED");
  assert.deepEqual(result.cards.map(c => c.id), [first.id, another.id]);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.requestsMade, 3);
});

test("a punctuation-colliding face remains a different card while exact matching faces remain eligible", async () => {
  const first = { ...card(1), name: "Test Card" };
  const exact = { ...card(2), name: "Test Card // Other", card_faces: [{ name: first.name }, { name: "Other" }] };
  const collision = { ...card(3), name: "Test, Card // Other", card_faces: [{ name: "Test, Card" }, { name: "Other" }] };
  const result = await fetchAcquisitionCatalogQuery(query, signal(), {
    card: async () => ok(first),
    printings: async () => ok({ object: "list", data: [first, exact, collision], has_more: false, total_cards: 3 }),
  });
  assert.equal(result.status, "FOUND");
  assert.equal(result.printingCoverage, "CHECKED");
  assert.deepEqual(result.cards.map(c => c.id), [first.id, exact.id]);
});

test("excluded punctuation collisions still count toward pagination totals and duplicate detection", async () => {
  const first = card(1), collision = { ...card(2), name: "Test, Card" };
  const result = await fetchAcquisitionCatalogQuery(query, signal(), {
    card: async () => ok(first),
    printings: async (_, page) => ok({ object: "list", data: page === 1 ? [first, collision] : [collision],
      has_more: page === 1, total_cards: 3 }),
  });
  assert.equal(result.errorKind, "INVALID_RESPONSE");
  assert.equal(result.printingCoverage, "UNRESOLVED");
  assert.deepEqual(result.cards.map(c => c.id), [first.id]);
});

test("name collisions cannot hide missing advertised results or an absent original printing", async () => {
  const first = card(1), collision = { ...card(2), name: "Test, Card" };
  for (const data of [[first, collision], [collision]]) {
    const result = await fetchAcquisitionCatalogQuery(query, signal(), {
      card: async () => ok(first),
      printings: async () => ok({ object: "list", data, has_more: false, total_cards: 3 }),
    });
    assert.equal(result.errorKind, "INVALID_RESPONSE");
    assert.equal(result.printingCoverage, "UNRESOLVED");
  }
  const substituted = await fetchAcquisitionCatalogQuery(query, signal(), {
    card: async () => ok(first),
    printings: async () => ok({ object: "list", data: [{ ...collision, id: first.id }], has_more: false, total_cards: 1 }),
  });
  assert.equal(substituted.errorKind, "INVALID_RESPONSE");
  assert.equal(substituted.printingCoverage, "UNRESOLVED");
});

test("punctuation exclusions never bypass language, paper or card-schema validation", async () => {
  const first = card(1);
  for (const change of [{ lang: "fr" }, { digital: true }, { id: "invalid" }]) {
    const result = await fetchAcquisitionCatalogQuery(query, signal(), {
      card: async () => ok(first),
      printings: async () => ok({ object: "list", data: [first, { ...card(2), name: "Test, Card", ...change }], has_more: false, total_cards: 2 }),
    });
    assert.equal(result.errorKind, "INVALID_RESPONSE");
    assert.equal(result.printingCoverage, "UNRESOLVED");
  }
});

test("a digital named identity with only another card's punctuation collision does not become found", async () => {
  const first = { ...card(1), digital: true };
  const result = await fetchAcquisitionCatalogQuery({ kind: "name", name: first.name }, signal(), {
    card: async () => ok(first),
    printings: async () => ok({ object: "list", data: [{ ...card(2), name: "Test, Card" }], has_more: false, total_cards: 1 }),
  });
  assert.equal(result.status, "NOT_FOUND");
  assert.equal(result.printingCoverage, "UNRESOLVED");
  assert.deepEqual(result.cards, []);
});
