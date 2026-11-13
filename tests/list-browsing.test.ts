import assert from "node:assert/strict";
import test from "node:test";
import {
  filterDeckCards,
  readDeckCardFilters,
  deckToolContextHref,
} from "../lib/deck-card-browse";
import {
  readDeckLibraryBrowse,
  writeDeckLibraryField,
} from "../lib/deck-library-browse";
import { filterNamedRows, listPage, pageList } from "../lib/list-browse";

const rows = [
  {
    id: "a",
    cardName: "Éowyn, Shieldmaiden",
    section: "COMMANDER",
    quantity: 1,
    exactOwned: 1,
    otherOwned: 0,
    missing: 0,
    committedQuantity: 1,
    leaguePoolStatus: "IN_POOL" as const,
    card: {
      name: "Éowyn, Shieldmaiden",
      typeLine: "Legendary Creature — Human Knight",
    },
  },
  {
    id: "b",
    cardName: "Island Fish",
    section: "MAINBOARD",
    quantity: 2,
    exactOwned: 0,
    otherOwned: 2,
    missing: 2,
    committedQuantity: 0,
    leaguePoolStatus: "OTHER_PRINTING" as const,
    card: { name: "Island Fish", typeLine: "Creature — Island Fish" },
  },
  {
    id: "c",
    cardName: "Island",
    section: "SIDEBOARD",
    quantity: 7,
    exactOwned: 7,
    otherOwned: 0,
    missing: 0,
    committedQuantity: 0,
    leaguePoolStatus: "OUTSIDE_POOL" as const,
    card: { name: "Island", typeLine: "Basic Land — Island" },
  },
];
const all = { ownership: true, pool: true };
test("deck tool links preserve only deck browsing context", () => {
  const params = new URLSearchParams(
    "cardQ=Sol+Ring&cardType=Artifact&deckView=grid&token=private&seed=123",
  );
  assert.equal(
    deckToolContextHref("/decks/one/analysis", params),
    "/decks/one/analysis?cardQ=Sol+Ring&cardType=Artifact&deckView=grid",
  );
  assert.equal(
    deckToolContextHref("/decks/one", new URLSearchParams()),
    "/decks/one",
  );
});
function ids(query: string, capabilities = all) {
  return filterDeckCards(
    rows,
    readDeckCardFilters(new URLSearchParams(query), capabilities),
    capabilities,
  ).map((row) => row.id);
}

test("card filters combine name, section and actual card type without mutating rows or quantities", () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(ids("cardQ=éOWYN&cardSection=COMMANDER&cardType=Creature"), [
    "a",
  ]);
  assert.deepEqual(ids("cardType=Land"), ["c"]);
  assert.deepEqual(ids("cardQ=Island&cardSection=MAINBOARD"), ["b"]);
  assert.deepEqual(ids("cardType=Other"), []);
  const matched = filterDeckCards(
    rows,
    readDeckCardFilters(new URLSearchParams("cardQ=Island"), all),
    all,
  );
  assert.equal(
    matched.reduce((count, row) => count + row.quantity, 0),
    9,
  );
  assert.equal(matched[0], rows[1]);
  assert.equal(JSON.stringify(rows), before);
});

test("ownership and pool filters respect the capabilities of the current surface", () => {
  assert.deepEqual(ids("cardStatus=missing"), ["b"]);
  assert.deepEqual(ids("cardStatus=exact"), ["a", "c"]);
  assert.deepEqual(ids("cardStatus=other"), ["b"]);
  assert.deepEqual(ids("cardStatus=committed"), ["a"]);
  assert.deepEqual(ids("cardStatus=pool-outside"), ["c"]);
  assert.deepEqual(
    ids("cardStatus=pool-other", { ownership: false, pool: true }),
    ["b"],
  );
  assert.deepEqual(
    ids("cardStatus=missing", { ownership: false, pool: false }),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    ids("cardStatus=pool-exact", { ownership: true, pool: false }),
    ["a", "b", "c"],
  );
  const malicious = {
    query: "",
    section: "",
    type: "",
    status: "missing" as const,
  };
  assert.deepEqual(
    filterDeckCards(rows, malicious, { ownership: false, pool: false }),
    rows,
  );
});

test("unsupported card-query values default safely and names keep spaces while typing", () => {
  const filters = readDeckCardFilters(
    new URLSearchParams(
      "cardSection=SIDEBOARD&cardType=bad&cardStatus=bad&cardQ=Sol+",
    ),
    all,
    ["COMMANDER", "MAINBOARD"],
  );
  assert.deepEqual(filters, {
    query: "Sol ",
    section: "",
    type: "",
    status: "all",
  });
});

test("library URL state round-trips all filters, view and sorting while retaining unrelated parameters", () => {
  const params = new URLSearchParams("other=kept&page=4");
  writeDeckLibraryField(params, "search", "Sol Ring ");
  writeDeckLibraryField(params, "includedTags", ["one", "two"]);
  writeDeckLibraryField(params, "excludedTags", ["three"]);
  writeDeckLibraryField(params, "includedBrackets", ["2", "4"]);
  writeDeckLibraryField(params, "excludedBrackets", ["5"]);
  writeDeckLibraryField(params, "folder", "folder-id");
  writeDeckLibraryField(params, "sort", "name");
  writeDeckLibraryField(params, "direction", "asc");
  writeDeckLibraryField(params, "view", "cards");
  writeDeckLibraryField(params, "pageSize", 50);
  writeDeckLibraryField(params, "page", 2);
  assert.equal(params.get("other"), "kept");
  assert.deepEqual(readDeckLibraryBrowse(params), {
    search: "Sol Ring ",
    folder: "folder-id",
    includedTags: ["one", "two"],
    excludedTags: ["three"],
    includedBrackets: ["2", "4"],
    excludedBrackets: ["5"],
    sort: "name",
    direction: "asc",
    view: "cards",
    pageSize: 50,
    page: 2,
  });
  writeDeckLibraryField(params, "search", "");
  assert.equal(params.has("q"), false);
  assert.equal(params.has("page"), false);
  assert.deepEqual(params.getAll("tag"), ["one", "two"]);
});

test("invalid library query values are bounded without broadening the underlying authorized data", () => {
  const state = readDeckLibraryBrowse(
    new URLSearchParams(
      "sort=bad&sortDir=bad&view=bad&page=-1&pageSize=999999&bracket=9&bracket=3&tag=a&tag=a",
    ),
  );
  assert.equal(state.sort, "updated");
  assert.equal(state.direction, "desc");
  assert.equal(state.view, "table");
  assert.equal(state.page, 1);
  assert.equal(state.pageSize, 25);
  assert.deepEqual(state.includedTags, ["a"]);
  assert.deepEqual(state.includedBrackets, ["3"]);
});

test("paging narrows only displayed rows and keeps the complete ordered results intact", () => {
  const data = Array.from({ length: 103 }, (_, index) => ({
    name: `Card ${index}`,
    value: index,
  }));
  const before = JSON.stringify(data);
  const second = pageList(data, 2, 25);
  assert.equal(second.from, 26);
  assert.equal(second.to, 50);
  assert.equal(second.total, 103);
  assert.deepEqual(
    second.items.map((row) => row.value),
    Array.from({ length: 25 }, (_, index) => index + 25),
  );
  assert.equal(pageList(data, 99999, 25).page, 5);
  assert.deepEqual(pageList([], 999, 25), {
    items: [],
    page: 1,
    pageSize: 25,
    totalPages: 1,
    total: 0,
    from: 0,
    to: 0,
  });
  assert.equal(listPage(Infinity), 1);
  assert.equal(listPage(1.5), 1);
  assert.deepEqual(filterNamedRows(data, "card 102"), [data[102]]);
  assert.equal(JSON.stringify(data), before);
});
