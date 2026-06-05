import test from "node:test";
import assert from "node:assert/strict";
import { TradeStatus } from "@prisma/client";
import {
  assertCanAcceptTrade,
  assertCanCancelTrade,
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
