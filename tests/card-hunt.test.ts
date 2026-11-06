import assert from "node:assert/strict";
import test from "node:test";
import {planCardHunt, type HuntStock, type HuntRequest} from "../lib/card-hunt";

function stock(id: string, name = "Sol Ring", box = "A", extra: Partial<HuntStock> = {}): HuntStock {
  return {id, name, ownerId: "owner", quantity: 1, reserved: 0, cardId: name,
    oracleId: name, setCode: "one", collectorNumber: "1", finish: "NONFOIL", language: "EN", condition: "NM",
    location: {id: box, name: `Box ${box}`, section: "2", ownerId: "owner", active: true, isDeck: false}, ...extra};
}
function plan(items: HuntStock[], requests: HuntRequest[] = [{id: "request", name: "Sol Ring", quantity: 1}], mode: "boxes" | "preferences" = "preferences", finish: "ANY" | "FOIL" = "ANY") {
  return planCardHunt({ownerId: "owner", stock: items, requests, mode, finish});
}

test("three needed cards share one box and retain sections", () => {
  const requests = ["A", "B", "C"].map(name => ({id: name, name, quantity: 1}));
  const result = plan(requests.map(request => stock(request.id, request.name)), requests);
  assert.equal(result.boxes.length, 1); assert.equal(result.planned, 3);
  assert.ok(result.boxes[0].picks.every(pick => pick.section === "2"));
});
test("default honors chosen foil before fewer boxes; optimize may compromise visibly", () => {
  const requests = ["A", "B"].map(name => ({id: name, name, quantity: 1, cardId: name}));
  const items = [stock("a", "A", "shared"), stock("b", "B", "shared"),
    stock("af", "A", "foilA", {finish: "FOIL"}), stock("bf", "B", "foilB", {finish: "FOIL"})];
  const preferred = plan(items, requests, "preferences", "FOIL");
  assert.equal(preferred.boxes.length, 2);
  assert.ok(preferred.boxes.every(box => box.picks.every(pick => pick.finish === "FOIL" && !pick.finishCompromise)));
  const optimized = plan(items, requests, "boxes", "FOIL");
  assert.equal(optimized.boxes.length, 1); assert.equal(optimized.boxes[0].id, "shared");
  assert.ok(optimized.boxes[0].picks.every(pick => pick.finishCompromise));
});
test("requested printing wins in default, alternatives may reduce boxes in optimization", () => {
  const requests = ["A", "B"].map(name => ({id: name, name, quantity: 1, cardId: `${name}-preferred`, oracleId: name}));
  const items = [stock("a", "A", "shared"), stock("b", "B", "shared"),
    stock("ap", "A", "preferredA", {cardId: "A-preferred"}), stock("bp", "B", "preferredB", {cardId: "B-preferred"})];
  assert.equal(plan(items, requests).boxes.length, 2);
  const result = plan(items, requests, "boxes");
  assert.equal(result.boxes.length, 1);
  assert.ok(result.boxes[0].picks.every(pick => pick.alternatePrinting));
});
test("other decks never supply copies, alternatives or shortage fallback", () => {
  const items = [stock("storage"), stock("deck", "Sol Ring", "other", {cardId: "foil-other", finish: "FOIL",
    location: {id: "other", name: "Other deck", ownerId: "owner", section: null, active: true, isDeck: true}})];
  const result = plan(items, [{id: "r", name: "Sol Ring", quantity: 3, cardId: "Sol Ring"}], "boxes", "FOIL");
  assert.equal(result.planned, 1); assert.equal(result.shortage, 2);
  assert.equal(result.lines[0].alternativeCount, 0);
  assert.equal(result.boxes[0].picks[0].inventoryItemId, "storage");
});
test("foreign inventory, foreign storage and inactive locations never participate", () => {
  const base = stock("base");
  const result = plan([stock("foreign", "Sol Ring", "B", {ownerId: "other"}),
    {...base, id: "foreign-location", location: {...base.location!, ownerId: "other"}},
    {...base, id: "inactive", location: {...base.location!, active: false}}]);
  assert.equal(result.planned, 0); assert.equal(result.shortage, 1);
});
test("active reservations reduce quantities and do not become suggestions", () => {
  const result = plan([stock("partial", "Sol Ring", "A", {quantity: 5, reserved: 3}),
    stock("full", "Sol Ring", "B", {quantity: 2, reserved: 2, cardId: "alternate"})],
    [{id: "r", name: "Sol Ring", quantity: 4, cardId: "Sol Ring"}]);
  assert.equal(result.planned, 2); assert.equal(result.shortage, 2); assert.equal(result.lines[0].alternativeCount, 0);
});
test("same stored copies cannot satisfy duplicate request lines twice", () => {
  for (const mode of ["preferences", "boxes"] as const) {
    const result = plan([stock("shared", "Sol Ring", "A", {quantity: 3})],
      [{id: "1", name: "Sol Ring", quantity: 2}, {id: "2", name: "Sol Ring", quantity: 2}], mode);
    assert.equal(result.planned, 3); assert.equal(result.shortage, 1);
    assert.equal(result.boxes.flatMap(box => box.picks).reduce((sum, pick) => sum + pick.quantity, 0), 3);
  }
});
test("already committed copies reduce source-deck requirements without another pull", () => {
  const result = plan([stock("s", "Sol Ring", "A", {quantity: 2})], [{id: "r", name: "Sol Ring", quantity: 3, alreadyInDeck: 2}]);
  assert.equal(result.alreadyInDeck, 2); assert.equal(result.planned, 1); assert.equal(result.shortage, 0);
});
test("list set/number and explicit finish define preferences with clear fallback", () => {
  const result = plan([stock("exact"), stock("foil", "Sol Ring", "B", {finish: "FOIL", setCode: "two"})],
    [{id: "r", name: "Sol Ring", quantity: 2, setCode: "one", collectorNumber: "1", finish: "FOIL"}]);
  assert.equal(result.planned, 2);
  assert.equal(result.boxes.find(box => box.id === "B")!.picks[0].alternatePrinting, true);
  assert.equal(result.boxes.find(box => box.id === "A")!.picks[0].finishCompromise, true);
});
test("oracle identity prevents different cards with same name from substituting", () => {
  const result = plan([stock("wrong", "Sol Ring", "A", {oracleId: "different"})],
    [{id: "r", name: "Sol Ring", oracleId: "expected", quantity: 1}]);
  assert.equal(result.planned, 0);
});
test("unassigned storage remains visible and source objects are not mutated", () => {
  const items = [stock("unassigned", "Sol Ring", "A", {location: null})];
  const requests = [{id: "r", name: "Sol Ring", quantity: 1}];
  const before = JSON.stringify({items, requests});
  const result = plan(items, requests);
  assert.equal(result.boxes[0].name, "Unassigned location");
  assert.equal(JSON.stringify({items, requests}), before);
});
test("stable result ignores inventory order and rejects duplicate identities/invalid amounts", () => {
  const items = [stock("b", "Sol Ring", "B"), stock("a", "Sol Ring", "A")];
  assert.deepEqual(plan(items), plan([...items].reverse()));
  assert.throws(() => plan([items[0], items[0]]), /Duplicate storage identity/);
  assert.throws(() => plan(items, [{id: "r", name: "Sol Ring", quantity: Infinity}]), /whole quantity/);
});
test("150000 copies, hundreds of boxes, uneven holdings conserve all demand and stock", () => {
  const requests = Array.from({length: 100}, (_, i) => ({id: `r${i}`, name: `Card ${i}`, quantity: 20}));
  const items = Array.from({length: 3000}, (_, i) => stock(`s${i}`, `Card ${i % 100}`, `box${i % 300}`,
    {quantity: 50, reserved: i % 3 === 0 ? 2 : 0}));
  const result = plan(items, requests, "boxes");
  assert.equal(result.planned, 2000); assert.equal(result.shortage, 0);
  for (const item of items) {
    const used = result.boxes.flatMap(box => box.picks).filter(pick => pick.inventoryItemId === item.id).reduce((sum, pick) => sum + pick.quantity, 0);
    assert.ok(used <= item.quantity - item.reserved);
  }
});
