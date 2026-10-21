import assert from "node:assert/strict";
import test from "node:test";
import { snapshotTradeDeck, parseTradeDeckIds, normalizeDeckReceipt, type DeckTradeSource } from "../lib/deck-trade-policy";

function source(count = 2): DeckTradeSource {
  return {
    deck: { id: "deck", ownerUserId: "user", name: "Original deck", description: "Keep the list",
      format: "COMMANDER", visibility: "PRIVATE", folderId: "sender-folder", bannerZoom: 100,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02") },
    ownerPlayerId: "owner", leagueLinked: false, effectiveVisibility: "PRIVATE", tagIds: ["tag-b", "tag-a"],
    location: { id: "location", ownerPlayerId: "owner", deckId: "deck", kind: "DECK", systemManaged: true,
      active: true, normalizedName: "deck:deck", name: "Deck: Original deck" },
    cards: Array.from({ length: count }, (_, index) => ({ id: `entry-${index}`, deckId: "deck", cardId: `card-${index}`,
      cardName: `Card ${index}`, section: "MAINBOARD", quantity: 2, notes: `List note ${index}` })),
    stock: Array.from({ length: count }, (_, index) => ({ id: `lot-${index}`, cardId: `card-${index}`, quantity: 1,
      currentOwnerId: "owner", originalOpenerId: "original-opener", locationId: "location", locationSection: null,
      acquiredFromPullId: "pull", roundId: "round", sourceType: "PULL", foilStatus: "NONFOIL", foil: false,
      condition: "NM", language: "EN", notes: "Physical note", card: { name: `Card ${index}`, scryfallId: `printing-${index}` } })),
  } as unknown as DeckTradeSource;
}

test("whole deck snapshot preserves more than 50 lots and complete list-only Maybeboard", () => {
  const input = source(110);
  input.cards.push({ ...input.cards[0], id: "maybe-only", cardId: "not-committed", section: "MAYBEBOARD", quantity: 3 });
  const { snapshot } = snapshotTradeDeck(input);
  assert.equal(snapshot.stock.length, 110);
  assert.equal(snapshot.cards.length, 111);
  assert.equal(snapshot.stock.reduce((sum, row) => sum + Number(row.quantity), 0), 110);
  assert.equal(snapshot.cards.find(row => row.id === "maybe-only")?.quantity, 3);
  assert.equal(snapshot.deck.id, "deck");
  assert.equal(snapshot.location?.id, "location");
  assert.equal(snapshot.stock[0].originalOpenerId, "original-opener");
  assert.equal(snapshot.stock[0].acquiredFromPullId, "pull");
});

test("snapshot ordering is deterministic, detached and excludes relation secrets and audit history", () => {
  const input = source();
  const original = snapshotTradeDeck(input);
  input.cards.reverse(); input.stock.reverse(); input.tagIds.reverse();
  assert.equal(snapshotTradeDeck(input).digest, original.digest);
  Object.assign(input.deck, { ownerUser: { passwordHash: "do-not-export" } });
  Object.assign(input.stock[0], { auditLogs: [{ oldValue: "do-not-export" }], card: { ...input.stock[0].card, privateRelation: "do-not-export" } });
  assert.equal(snapshotTradeDeck(input).digest, original.digest);
  assert.doesNotMatch(JSON.stringify(snapshotTradeDeck(input).snapshot), /do-not-export/);
  input.deck.name = "Changed later"; input.stock[0].notes = "Changed physical note";
  assert.equal(original.snapshot.deck.name, "Original deck");
  assert.equal(original.snapshot.stock[0].notes, "Physical note");
});

test("review digest binds list, stock, location, organization and original metadata independently", () => {
  const original = snapshotTradeDeck(source()).digest;
  const edits: ((input: DeckTradeSource) => void)[] = [
    input => { input.deck.name = "Changed"; }, input => { input.deck.visibility = "PUBLIC"; },
    input => { input.effectiveVisibility = "PUBLIC"; },
    input => { input.cards[0].quantity++; }, input => { input.cards[0].notes = "new note"; },
    input => { input.stock[0].quantity++; }, input => { input.stock[0].condition = "LP"; },
    input => { input.stock[0].language = "FR"; }, input => { input.stock[0].notes = "new physical note"; },
    input => { input.stock[0].roundId = "other-round"; }, input => { input.location!.name = "Changed location"; },
    input => { input.tagIds.push("tag-c"); }, input => { input.deck.folderId = "other-folder"; },
  ];
  for (const edit of edits) { const input = source(); edit(input); assert.notEqual(snapshotTradeDeck(input).digest, original); }
});

test("physical Maybeboard and same-printing ambiguity block; unrelated list-only rows remain", () => {
  for (const mode of ["known", "scryfall", "unresolved-name"] as const) {
    const input = source();
    input.cards.push({ ...input.cards[0], id: "maybe", section: "MAYBEBOARD",
      cardId: mode === "known" ? "card-0" : null, scryfallId: mode === "scryfall" ? "printing-0" : null });
    assert.throws(() => snapshotTradeDeck(input), /Maybeboard/);
    input.stock[0].quantity = 0;
    assert.equal(snapshotTradeDeck(input).snapshot.stock.find(row => row.id === "lot-0")?.quantity, 0);
  }
});

test("every League link and inconsistent source graph is refused", () => {
  const bad: ((input: DeckTradeSource) => void)[] = [
    input => { input.leagueLinked = true; }, input => { input.location!.ownerPlayerId = "foreign"; },
    input => { input.location!.deckId = "other-deck"; }, input => { input.location!.kind = "NORMAL"; },
    input => { input.stock[0].currentOwnerId = "foreign"; }, input => { input.stock[0].locationId = "other-location"; },
    input => { input.stock[0].quantity = -1; }, input => { input.cards[0].deckId = "other-deck"; },
    input => { input.stock.push(input.stock[0]); }, input => { input.cards.push(input.cards[0]); },
  ];
  for (const edit of bad) { const input = source(); edit(input); assert.throws(() => snapshotTradeDeck(input)); }
  const listOnly = source(0); listOnly.location = null;
  assert.equal(snapshotTradeDeck(listOnly).snapshot.location, null);
});

test("multiple whole-deck selections and explicit recipient settings reject malformed input", () => {
  assert.deepEqual(parseTradeDeckIds('["deck-a","deck-b"]'), ["deck-a", "deck-b"]);
  assert.deepEqual(parseTradeDeckIds(null), []);
  for (const value of ['{}', '["deck"," deck "]', '[null]', 'invalid']) assert.throws(() => parseTradeDeckIds(value));
  assert.deepEqual(normalizeDeckReceipt({ visibility: "PRIVATE", folderId: " folder ", tagIds: ["tag"] }),
    { visibility: "PRIVATE", folderId: "folder", tagIds: ["tag"] });
  assert.deepEqual(normalizeDeckReceipt({ visibility: "PUBLIC" }), { visibility: "PUBLIC", folderId: null, tagIds: [] });
  assert.throws(() => normalizeDeckReceipt({ visibility: "INHERIT" }), /confirm visibility/);
  assert.throws(() => normalizeDeckReceipt({ visibility: "PRIVATE", folderId: 42 }), /folder/);
  assert.throws(() => normalizeDeckReceipt({ visibility: "PRIVATE", tagIds: ["a", "a"] }), /tag selections/);
});
