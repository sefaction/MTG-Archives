import assert from "node:assert/strict";
import test from "node:test";
import { tradeActionFeedback } from "../lib/trade-action-feedback";
import { DeckTradeValidationError } from "../lib/deck-trade-policy";
import { DeckTradeWriteError } from "../lib/deck-write-fence";

test("participant feedback explains expected stale consent and organization rejections", () => {
  for (const error of [new DeckTradeValidationError("Choose a folder from your own deck library."),
    new DeckTradeWriteError("This whole deck is reserved in an active trade."),
    new Error("A traded deck changed. Cancel this offer and review its contents again."),
    new Error("This trade is not awaiting physical confirmation.")]) {
    assert.deepEqual(tradeActionFeedback(error), { status: "error", message: error.message });
  }
});

test("unexpected database/framework failures are rethrown with their identity intact", () => {
  for (const error of [new Error("Connection closed"), new TypeError("Malformed query"), { digest: "NEXT_REDIRECT" }]) {
    assert.throws(() => tradeActionFeedback(error), value => value === error);
  }
});
