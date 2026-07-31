import assert from "node:assert/strict";
import test from "node:test";

import {
  asTradeProposalValidationError,
  initialTradeProposalActionState,
  TradeProposalValidationError,
  tradeProposalValidationState,
} from "../lib/trade-proposal";

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
