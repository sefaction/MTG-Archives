import test from "node:test";
import assert from "node:assert/strict";
import { TradeStatus } from "@prisma/client";
import {
  assertCanAcceptTrade,
  assertCanCancelTrade,
  assertCanCounterTrade,
  assertCanDeclineTrade,
  isTerminalTradeStatus,
} from "../lib/trade-policy";

const base = {
  proposerOwnerId: "owner-a",
  recipientOwnerId: "owner-b",
  status: TradeStatus.PROPOSED,
};

test("proposer cannot accept their own proposal", () => {
  assert.throws(
    () => assertCanAcceptTrade({ ...base, actorOwnerId: "owner-a" }),
    /Only the receiver/,
  );
});

test("recipient can accept or decline a proposed trade", () => {
  assert.doesNotThrow(() =>
    assertCanAcceptTrade({ ...base, actorOwnerId: "owner-b" }),
  );
  assert.doesNotThrow(() =>
    assertCanDeclineTrade({ ...base, actorOwnerId: "owner-b" }),
  );
});

test("recipient can counter by reversing the original participants", () => {
  assert.doesNotThrow(() =>
    assertCanCounterTrade({
      ...base,
      actorOwnerId: "owner-b",
      counterProposerOwnerId: "owner-b",
      counterRecipientOwnerId: "owner-a",
    }),
  );
  assert.throws(
    () =>
      assertCanCounterTrade({
        ...base,
        actorOwnerId: "owner-a",
        counterProposerOwnerId: "owner-a",
        counterRecipientOwnerId: "owner-b",
      }),
    /Only the receiver/,
  );
  assert.throws(
    () =>
      assertCanCounterTrade({
        ...base,
        actorOwnerId: "owner-b",
        counterProposerOwnerId: "owner-b",
        counterRecipientOwnerId: "owner-c",
      }),
    /must reverse/,
  );
});

test("only proposer can cancel a non-terminal proposal unless admin", () => {
  assert.doesNotThrow(() =>
    assertCanCancelTrade({ ...base, actorOwnerId: "owner-a" }),
  );
  assert.throws(
    () => assertCanCancelTrade({ ...base, actorOwnerId: "owner-b" }),
    /Only the proposer/,
  );
  assert.doesNotThrow(() =>
    assertCanCancelTrade({ ...base, actorOwnerId: "owner-b", isAdmin: true }),
  );
});

test("terminal trades cannot be actioned again", () => {
  assert.equal(isTerminalTradeStatus(TradeStatus.COMPLETED), true);
  assert.throws(
    () =>
      assertCanCancelTrade({
        ...base,
        actorOwnerId: "owner-a",
        status: TradeStatus.COMPLETED,
      }),
    /no longer/,
  );
});
