import assert from "node:assert/strict";
import test from "node:test";
import { loadServerActions } from "./helpers/server-actions";

const printingActions = ["changeWishlistDeckCardPrinting",
  "switchWishlistDeckCardToOwnedPrinting", "switchWishlistDeckCardToCheapestPrinting"];

function fixture(options: {
  league?: boolean; linkedAfterPreflight?: boolean; frozen?: boolean;
  owner?: string; currentOwner?: string; admin?: boolean; reserved?: boolean;
} = {}) {
  const events: string[] = [];
  const row = { id: "row", deckId: "deck", section: "MAINBOARD", quantity: 2 };
  const deck = { id: "deck", name: "Commander", ownerUserId: options.owner ?? "user",
    format: "COMMANDER", ownerUser: { playerId: "player" },
    commanderLeagueDeck: options.league ? { id: "league-deck",
      submissions: options.frozen ? [{ id: "submission" }] : [],
      league: { members: [] } } : null };
  const tx = {
    $executeRaw: async () => { events.push("owner-lock"); },
    $queryRaw: async () => { events.push("deck-lock"); },
    deck: { findUnique: async () => ({ ...deck, ownerUserId: options.currentOwner ?? deck.ownerUserId }) },
    tradeDeckBundle: { findFirst: async () => options.reserved ? { id: "trade" } : null },
    commanderLeagueDeck: { findUnique: async ({ where }: any) => {
      assert.equal(where.archiveDeckId, "deck"); events.push("league-recheck");
      return options.league || options.linkedAfterPreflight ? { id: "league-deck" } : null;
    } },
    deckCard: {
      findFirst: async ({ where }: any) => { events.push("read-card"); return where.id?.not ? null : row; },
      update: async (input: any) => { events.push("write-card"); return input; },
    },
    card: { findUnique: async () => ({ id: "printing", scryfallId: "sf", oracleId: "oracle", name: "Card" }) },
    inventoryItem: { findFirst: async () => { events.push("read-stock"); return null; } },
  };
  const db = { deck: { findUnique: async () => deck },
    $transaction: async (callback: any) => { events.push("transaction"); return callback(tx); } };
  const dependencies = {
    "@/lib/prisma": { prisma: db },
    "@/lib/auth": { requireLogin: async () => ({ id: "user", playerId: "player" }),
      getAccessScope: async () => ({ mode: options.admin ? "admin" : "personal" }) },
    "next/cache": { revalidatePath: () => { events.push("revalidate"); } },
    "@/lib/deck-optimization": { buildDeckOptimizationPreview: async () => {
      events.push("preview"); return { rows: [{ deckCardId: "row", willChange: true,
        proposed: { cardId: "printing" } }] };
    } },
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries({ deckId: "deck", deckCardId: "row", cardId: "printing",
    inventoryItemId: "stock", quantity: "1" })) fd.set(key, value);
  return { events, fd, actions: loadServerActions("app/wishlist/actions.ts", dependencies),
    commit: loadServerActions("app/decks/actions.ts", dependencies).commitDeckCardToDeck };
}

for (const name of printingActions) {
  for (const admin of [false, true]) {
    test(`${name} rejects direct League requests even in ${admin ? "admin" : "owner"} mode`, async () => {
      const f = fixture({ league: true, admin });
      await assert.rejects(f.actions[name](f.fd), /League decks are not part/);
      assert.deepEqual(f.events, []);
    });
  }
  test(`${name} rejects a League link added after preflight under the deck lock`, async () => {
    const f = fixture({ linkedAfterPreflight: true });
    await assert.rejects(f.actions[name](f.fd), /League decks are not part/);
    assert.deepEqual(f.events.filter(event => event !== "preview"),
      ["transaction", "owner-lock", "deck-lock", "league-recheck"]);
  });
  test(`${name} still changes an ordinary Commander deck`, async () => {
    const f = fixture();
    await f.actions[name](f.fd);
    assert.ok(f.events.indexOf("deck-lock") < f.events.indexOf("league-recheck"));
    assert.ok(f.events.indexOf("league-recheck") < f.events.indexOf("write-card"));
    assert.equal(f.events.filter(event => event === "write-card").length, 1);
  });
  for (const options of [{ owner: "other" }, { currentOwner: "new-owner" }, { reserved: true }]) {
    test(`${name} retains permission/transfer/trade refusal ${JSON.stringify(options)}`, async () => {
      const f = fixture(options);
      await assert.rejects(f.actions[name](f.fd), /own decks|ownership changed|reserved/);
      assert.ok(!f.events.includes("write-card"));
    });
  }
}

for (const frozen of [false, true]) {
  test(`Wishlist commitment rejects ${frozen ? "frozen" : "unfrozen"} League decks before inventory access`, async () => {
    const f = fixture({ league: true, frozen });
    await assert.rejects(f.commit(f.fd), /League deck/);
    assert.deepEqual(f.events, []);
  });
}
test("Wishlist commitment rechecks a stale League target after locking, before stock access", async () => {
  const f = fixture({ linkedAfterPreflight: true });
  await assert.rejects(f.commit(f.fd), /League decks/);
  assert.deepEqual(f.events, ["transaction", "owner-lock", "deck-lock", "league-recheck"]);
});
test("ordinary Commander commitment still reaches its existing inventory validation", async () => {
  const f = fixture();
  await assert.rejects(f.commit(f.fd), /Available inventory copy not found/);
  assert.ok(f.events.includes("read-stock"));
});
