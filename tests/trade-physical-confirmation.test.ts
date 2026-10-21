import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { InventoryLocationKind, TradeStatus } from "@prisma/client";

// Execute the actual action and validator without connecting to the shared app,
// database, notification workers or inventory. Completion remains a spy here;
// the existing lifecycle browser test covers the real atomic transfer.
const source = readFileSync("app/trades/actions.ts", "utf8");
const tree = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["assertTradeDestinationLocation", "confirmPhysicalTrade"]);
const functions = tree.statements.filter(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ""),
);
assert.equal(functions.length, names.size);
const code = ts.transpileModule(
  functions.map((node) => node.getText(tree).replace(/^export\s+/, "")).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture(side = "proposer", overrides: Record<string, unknown> = {}, confirmationCount = 1) {
  const trade = {
    id: "trade",
    status: TradeStatus.ACCEPTED_PENDING_EXCHANGE,
    proposerPlayerId: "proposer",
    receiverPlayerId: "receiver",
    proposerCommittedAt: null,
    receiverCommittedAt: null,
    // Prior/stale saved values must never substitute for this submission.
    proposerDestinationLocationId: "previous-choice",
    receiverDestinationLocationId: "previous-choice",
    ...overrides,
  };
  const locations = [
    { id: "chosen", ownerPlayerId: side, active: true, kind: InventoryLocationKind.NORMAL, systemManaged: false },
    { id: "inactive", ownerPlayerId: side, active: false, kind: InventoryLocationKind.NORMAL, systemManaged: false },
    { id: "foreign", ownerPlayerId: "another-owner", active: true, kind: InventoryLocationKind.NORMAL, systemManaged: false },
    { id: "managed", ownerPlayerId: side, active: true, kind: InventoryLocationKind.NORMAL, systemManaged: true },
    { id: "deck", ownerPlayerId: side, active: true, kind: InventoryLocationKind.DECK, systemManaged: false },
  ];
  const updates: any[] = [], events: any[] = [], completions: any[] = [], queries: any[] = [];
  let transactions = 0;
  const tx = { trade: { updateMany: async (query: any) => { updates.push(query); return { count: confirmationCount }; } } };
  const context = vm.createContext({
    FormData, Date, TradeStatus, InventoryLocationKind,
    physicalStatuses: [TradeStatus.ACCEPTED_PENDING_EXCHANGE, TradeStatus.PARTIALLY_COMMITTED],
    requireLogin: async () => ({ id: "actor", playerId: side, displayName: side }),
    getAccessScope: async () => ({ mode: side === "admin" ? "admin" : "owner" }),
    loadTradeForAction: async () => trade,
    prisma: {
      inventoryLocation: { findFirst: async ({ where }: any) => {
        queries.push(where);
        return locations.find((location) => Object.entries(where).every(
          ([key, value]) => location[key as keyof typeof location] === value,
        )) ?? null;
      } },
      $transaction: async (callback: (db: unknown) => Promise<unknown>) => { transactions++; return callback(tx); },
    },
    recordTradeEvent: async (_tx: unknown, event: unknown) => { events.push(event); },
    completeTradeIfReady: async (...args: unknown[]) => { completions.push(args); },
    revalidatePath: () => {},
  });
  vm.runInContext(code, context);
  return {
    updates, events, completions, queries,
    get transactions() { return transactions; },
    submit: async (destination?: string, force = false) => {
      const form = new FormData();
      form.set("tradeId", trade.id);
      if (destination !== undefined) form.set("destinationLocationId", destination);
      if (force) { form.set("forceComplete", "1"); form.set("reason", "Explicit admin override"); }
      await context.confirmPhysicalTrade(form);
    },
  };
}

for (const side of ["proposer", "receiver"]) {
  for (const destination of [undefined, "", " ", "missing", "inactive", "foreign", "managed", "deck"]) {
    test(`${side} rejects destination ${JSON.stringify(destination)} before confirmation or completion`, async () => {
      const f = fixture(side, { [side === "proposer" ? "receiverCommittedAt" : "proposerCommittedAt"]: new Date() });
      await assert.rejects(f.submit(destination), /Choose (a destination|an active normal) location/);
      assert.equal(f.transactions, 0);
      assert.equal(f.updates.length, 0);
      assert.equal(f.events.length, 0);
      assert.equal(f.completions.length, 0);
    });
  }
  for (const otherConfirmed of [false, true]) {
    test(`${side} honors explicit eligible selection; other participant confirmed=${otherConfirmed}`, async () => {
      const f = fixture(side, otherConfirmed ? { [side === "proposer" ? "receiverCommittedAt" : "proposerCommittedAt"]: new Date() } : {});
      await f.submit("chosen");
      assert.equal(f.transactions, 1);
      assert.equal(f.updates.length, 1);
      assert.equal(f.updates[0].data[`${side}DestinationLocationId`], "chosen");
      assert.ok(f.updates[0].data[`${side}CommittedAt`] instanceof Date);
      assert.equal(f.updates[0].data.status, TradeStatus.PARTIALLY_COMMITTED);
      assert.deepEqual(Array.from(f.updates[0].where.status.in), [TradeStatus.ACCEPTED_PENDING_EXCHANGE, TradeStatus.PARTIALLY_COMMITTED]);
      assert.equal(f.updates[0].where[`${side}CommittedAt`], null);
      assert.equal(f.events[0].eventType, `${side}_confirmed_physical_exchange`);
      assert.equal(Boolean(f.events[0].notification), !otherConfirmed);
      assert.deepEqual(f.completions[0], ["trade", "actor"]);
      assert.equal(f.queries[0].ownerPlayerId, side);
    });
  }
  test(`${side} cannot repeat physical confirmation`, async () => {
    const f = fixture(side, { [`${side}CommittedAt`]: new Date() });
    await assert.rejects(f.submit("chosen"), /already confirmed/);
    assert.equal(f.transactions, 0);
    assert.equal(f.completions.length, 0);
  });
  test(`${side} rejects a stale confirmation without an event or completion`, async () => {
    const f = fixture(side, {}, 0);
    await assert.rejects(f.submit("chosen"), /already confirmed or is no longer awaiting/);
    assert.equal(f.events.length, 0);
    assert.equal(f.completions.length, 0);
  });
}

test("nonparticipant cannot confirm even with an explicit location", async () => {
  const f = fixture("observer");
  await assert.rejects(f.submit("chosen"), /Only trade participants/);
  assert.equal(f.transactions, 0);
});

test("completed trade cannot be confirmed", async () => {
  const f = fixture("proposer", { status: TradeStatus.COMPLETED });
  await assert.rejects(f.submit("chosen"), /not awaiting physical confirmation/);
  assert.equal(f.transactions, 0);
});

test("explicit reasoned admin force-complete retains its separate authorization path", async () => {
  const f = fixture("admin");
  await f.submit(undefined, true);
  assert.equal(f.updates.length, 0);
  assert.equal(f.events[0].eventType, "admin_force_complete");
  assert.deepEqual(f.completions[0], ["trade", "actor", true]);
});
