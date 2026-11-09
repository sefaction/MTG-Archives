import assert from "node:assert/strict";
import test from "node:test";
import {collectorCardSchema, collectorDetail, collectorProgress, eligibleCollectorCard, type CollectorCard, type CollectorOwned} from "../lib/collector";
import {fetchCollectorCatalog} from "../lib/collector-catalog";
const card = (id: string, extra: Partial<CollectorCard> = {}): CollectorCard => ({id, oracle_id: "oracle", name: "Test Card", set: "tst", lang: "en", digital: false, games: ["paper"], layout: "normal", type_line: "Creature — Wizard", oversized: false, finishes: ["nonfoil", "foil"], ...extra});
const item = (id: string, extra: Partial<CollectorOwned> = {}): CollectorOwned => ({currentOwnerId: "me", quantity: 1, language: "EN", foilStatus: "NONFOIL", card: {scryfallId: id}, ...extra});
test("grouped identity collapses art and finish, variants retain both; duplicates cannot inflate", () => {
  const result = collectorProgress([card("a"), card("b")], [item("a", {quantity: 100}), item("a"), item("a", {foilStatus: "FOIL"}), item("b")], "me");
  assert.deepEqual(result.grouped, {owned: 1, total: 1, percent: 100});
  assert.deepEqual(result.variants, {owned: 3, total: 4, percent: 75});
});
test("tokens never change either numerator or denominator including double-faced and mixed faces", () => {
  const cards = [card("a"), card("t", {layout: "token"}), card("dt", {layout: "double_faced_token"}), card("f", {type_line: undefined, card_faces: [{type_line: "Token Creature — Human"}]})];
  assert.deepEqual(collectorProgress(cards, cards.map(c => item(c.id)), "me"), collectorProgress([card("a")], [item("a")], "me"));
});
test("only positive owned English inventory contributes regardless of quantity, reservations or deck location", () => {
  const owned = [item("a", {currentOwnerId: "other"}), item("a", {quantity: 0}), item("a", {language: "FR"})];
  assert.equal(collectorProgress([card("a")], owned, "me").grouped.owned, 0);
  // Location/reservation never filters the authoritative InventoryItem ownership.
  assert.equal(collectorProgress([card("a")], [item("a")], "me").grouped.owned, 1);
});
test("catalog scope excludes digital, foreign, oversized, emblems, art and helper cards", () => {
  for (const extra of [{digital: true}, {lang: "ja"}, {oversized: true}, {layout: "emblem"}, {layout: "art_series"}, {type_line: "Card"}, {games: ["arena"]}])
    assert.equal(eligibleCollectorCard(card("a", extra)), false);
});
test("multi-face, reversible and supplemental real cards remain eligible", () => {
  for (const layout of ["transform", "modal_dfc", "split", "adventure", "reversible_card"]) {
    const parsed = collectorCardSchema.parse(card("a", {layout, type_line: undefined, card_faces: [{type_line: "Creature — Wizard"}, {type_line: "Land"}]}));
    assert.equal(eligibleCollectorCard(parsed), true);
  }
  for (const type_line of ["Conspiracy", "Plane — Ravnica", "Scheme", "Vanguard", "Phenomenon"]) assert.ok(eligibleCollectorCard(card("a", {type_line})));
});
test("missing oracle falls back to exact full name and etched is an independent target", () => {
  const cards = [card("a", {oracle_id: undefined, finishes: ["etched"]}), card("b", {oracle_id: undefined, finishes: ["foil"]})];
  const result = collectorProgress(cards, [item("a", {foilStatus: "ETCHED"})], "me");
  assert.equal(result.grouped.total, 1); assert.equal(result.variants.total, 2); assert.equal(result.variants.owned, 1);
});
test("unknown printings and unsupported finishes do not fabricate ownership", () => {
  assert.equal(collectorProgress([card("a", {finishes: ["foil"]})], [item("a"), item("b")], "me").grouped.owned, 0);
});
test("set detail sums eligible owned copies across printings and finishes while preserving completion", () => {
  const cards = [
    card("a", {collector_number: "10"}), card("b", {collector_number: "2"}),
    card("c", {name: "Missing Card", oracle_id: undefined, finishes: ["etched"]}),
    card("t", {layout: "token"}),
  ];
  const owned = [
    item("a", {quantity: 2}), item("a", {quantity: 3}),
    item("a", {foilStatus: "FOIL", quantity: 4}), item("b", {quantity: 6}),
    item("c", {foilStatus: "ETCHED", language: "FR"}), item("c", {foilStatus: "ETCHED", currentOwnerId: "other"}),
    item("c"), item("t", {quantity: 200}),
  ];
  const grouped = collectorDetail(cards, owned, "me", {mode: "grouped", page: 1, missingOnly: false});
  assert.deepEqual(grouped.rows.map(row => [row.name, row.quantity]), [["Missing Card", 0], ["Test Card", 15]]);
  const variants = collectorDetail(cards, owned, "me", {mode: "variants", page: 1, missingOnly: false});
  assert.deepEqual(variants.rows.map(row => [row.id, row.collectorNumber, row.quantity]),
    [["c:etched", undefined, 0], ["b:foil", "2", 0], ["b:nonfoil", "2", 6], ["a:foil", "10", 4], ["a:nonfoil", "10", 5]]);
  assert.deepEqual({grouped: grouped.progress, variants: variants.progress}, collectorProgress(cards, owned, "me"));
});
test("missing-only set detail bounds pages and keeps the complete catalog denominator", () => {
  const cards = Array.from({length: 102}, (_, index) => card(String(index), {oracle_id: String(index), name: `Card ${index}`}));
  const owned = [item("0"), item("1")];
  const first = collectorDetail(cards, owned, "me", {mode: "grouped", page: 1, missingOnly: true});
  const last = collectorDetail(cards, owned, "me", {mode: "grouped", page: 1000, missingOnly: true});
  assert.equal(first.rows.length, 50);
  assert.equal(last.rows.length, 50);
  assert.equal(last.page, 2);
  assert.equal(last.matches, 100);
  assert.deepEqual(last.progress, {owned: 2, total: 102, percent: 1.9});
  assert.deepEqual([...first.rows, ...last.rows].map(row => row.name), cards.slice(2).map(row => row.name));
});
function provider(pages: unknown[]) { let n = 0; return async () => ({ok: true as const, data: pages[n++], correlationId: "test", requestsMade: 1}); }
const page = (cards: CollectorCard[], total = cards.length, more = false) => ({object: "list", data: cards, total_cards: total, has_more: more});
test("denominator requires every page and provider total, never follows next_page", async () => {
  const result = await fetchCollectorCatalog("tst", provider([{...page([card("a")], 2, true), next_page: "http://unsafe.invalid"}, page([card("b")], 2)]));
  assert.equal(result.cards.length, 2);
});
test("partial, changed, duplicate, foreign and malformed provider results reject completion", async () => {
  for (const pages of [[page([card("a")], 2)], [page([card("a")], 2, true), page([card("b")], 3)], [page([card("a")], 2, true), page([card("a")], 2)], [page([card("a", {set: "bad"})])], [page([card("a", {lang: "ja"})])], [{object: "list", data: [card("a")], has_more: false}]])
    await assert.rejects(fetchCollectorCatalog("tst", provider(pages)));
});
test("provider errors and cancellation leave completion unknown", async () => {
  await assert.rejects(fetchCollectorCatalog("tst", async () => ({ok: false as const, error: {kind: "NETWORK", message: "offline", retryable: true}, correlationId: "test", requestsMade: 1})));
  await assert.rejects(fetchCollectorCatalog("tst", provider([]), AbortSignal.abort()));
});
test("150000 copies retain distinct completion accounting", () => {
  const result = collectorProgress([card("a"), card("b", {oracle_id: "second"})], [item("a", {quantity: 150000})], "me");
  assert.equal(result.grouped.percent, 50); assert.equal(result.variants.percent, 25);
});

test("memorabilia paper sets remain in directory; actual cards decide eligibility", async () => {
  const {eligibleCollectorSets} = await import("../lib/collector-catalog");
  assert.deepEqual(eligibleCollectorSets([
    {code: "ced", name: "Collector Edition", digital: false, set_type: "memorabilia"},
    {code: "30a", name: "30th Anniversary", digital: false, set_type: "memorabilia"},
    {code: "tok", name: "Tokens", digital: false, set_type: "token"},
    {code: "dig", name: "Digital", digital: true, set_type: "expansion"},
  ]).map(set => set.code), ["ced", "30a"]);
});
test("navigation cancels abandoned catalog work and queued sets proceed within concurrency bound", async () => {
  const {createCollectorCatalogLoader} = await import("../lib/collector-catalog");
  let active = 0, maximum = 0;
  const starts: string[] = [];
  const loader = createCollectorCatalogLoader(async (set, _provider, signal) => {
    active++; maximum = Math.max(maximum, active); starts.push(set);
    try {
      await new Promise<void>((resolve, reject) => {
        if (set === "new") {resolve(); return;}
        signal!.addEventListener("abort", () => reject(Error("cancelled")), {once: true});
      });
      return {cards: [card("a")], checkedAt: "2026-11-07T00:00:00Z"};
    } finally {active--;}
  });
  const controllers = Array.from({length: 3}, () => new AbortController());
  const old = controllers.map((controller, i) => loader(`old${i}`, controller.signal).catch(() => null));
  await new Promise(resolve => setImmediate(resolve));
  const next = loader("new");
  controllers.forEach(controller => controller.abort());
  await Promise.all(old); assert.equal((await next).cards.length, 1);
  assert.equal(maximum, 3); assert.deepEqual(starts, ["old0", "old1", "old2", "new"]);
});
test("one departing subscriber does not abort another owner using same public catalog", async () => {
  const {createCollectorCatalogLoader} = await import("../lib/collector-catalog");
  let complete!: () => void;
  const loader = createCollectorCatalogLoader(async (_set, _provider, signal) => {
    await new Promise<void>(resolve => {complete = resolve;});
    assert.equal(signal!.aborted, false);
    return {cards: [card("a")], checkedAt: "2026-11-07T00:00:00Z"};
  });
  const controller = new AbortController();
  const first = loader("tst", controller.signal).catch(() => null);
  const second = loader("tst");
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); complete();
  assert.equal(await first, null); assert.equal((await second).cards.length, 1);
});

test("Collector has a required client-manifest contract", async () => {
  const {CLIENT_MANIFEST_CONTRACTS} = await import("../lib/build-client-manifests");
  assert.deepEqual(CLIENT_MANIFEST_CONTRACTS["/collector/page"], ["CollectorView"]);
});
