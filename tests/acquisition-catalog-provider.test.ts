import assert from "node:assert/strict";
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
