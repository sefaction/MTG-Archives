import assert from "node:assert/strict";
import test from "node:test";

import {
  asTradeProposalValidationError,
  initialTradeProposalActionState,
  hasTradeContents,
  TradeProposalValidationError,
  tradeProposalValidationState,
} from "../lib/trade-proposal";

test("gifts may have either side empty, but an empty trade is invalid", () => {
  assert.equal(hasTradeContents(1, 0), true);
  assert.equal(hasTradeContents(0, 1), true);
  assert.equal(hasTradeContents(2, 3), true);
  assert.equal(hasTradeContents(0, 0), false);
});

test("trade proposal state starts without feedback", () => {
  assert.deepEqual(initialTradeProposalActionState, {
    status: "idle",
    message: "",
  });
});

test("known proposal validation errors preserve their message for the form", () => {
  const error = asTradeProposalValidationError(
    new Error(
      "One or more selected quantities are already reserved or unavailable.",
    ),
  );

  assert.ok(error instanceof TradeProposalValidationError);
  assert.deepEqual(tradeProposalValidationState(error), {
    status: "error",
    message:
      "One or more selected quantities are already reserved or unavailable.",
  });
});

test("unexpected errors are not converted into inline validation feedback", () => {
  assert.equal(
    tradeProposalValidationState(new Error("Database unavailable.")),
    null,
  );
});
