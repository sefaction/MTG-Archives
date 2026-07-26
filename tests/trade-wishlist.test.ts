import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCompletedTradeWishlistMatches } from "../lib/trade-wishlist";

test("a completed trade matches each received card to the correct person-to-person wishlist", () => {
  assert.deepEqual(
    buildCompletedTradeWishlistMatches({
      proposerPlayerId: "alice",
      receiverPlayerId: "bob",
      offeredCardId: "alice-card",
      requestedCardId: "bob-card",
    }),
    [
      {
        ownerPlayerId: "bob",
        targetOwnerPlayerId: "alice",
        cardId: "alice-card",
      },
      {
        ownerPlayerId: "alice",
        targetOwnerPlayerId: "bob",
        cardId: "bob-card",
      },
    ],
  );
});

test("trade completion reconciles wishlist quantities in the inventory transaction", () => {
  const tradeActions = readFileSync("app/trades/actions.ts", "utf8");
  const wishlistHelper = readFileSync("lib/trade-wishlist.ts", "utf8");

  assert.match(tradeActions, /await fulfillCompletedTradeWishlists\(tx,/);
  assert.match(tradeActions, /revalidatePath\("\/wishlist"\)/);
  assert.match(wishlistHelper, /TradeWishlistStatus\.FULFILLED/);
  assert.match(wishlistHelper, /quantity: \{ decrement: 1 \}/);
  assert.match(
    wishlistHelper,
    /ownerUser: \{ playerId: match\.ownerPlayerId \}/,
  );
  assert.match(
    wishlistHelper,
    /targetOwnerPlayerId: match\.targetOwnerPlayerId/,
  );
});
