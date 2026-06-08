import assert from "node:assert/strict";
import test from "node:test";

import {
  inventoryAuditAction,
  recordInventoryAuditMany,
} from "../lib/inventory-audit";
import { inventoryAuditSummary } from "../components/InventoryAuditTrail";

test("bulk inventory audit helper batches createMany entries with standardized actions", async () => {
  const createManyCalls: any[] = [];
  await recordInventoryAuditMany({
    tx: {
      inventoryAuditLog: {
        createMany: async ({ data }: any) => {
          createManyCalls.push(data);
          return { count: data.length };
        },
      },
    } as any,
    batchSize: 2,
    entries: [
      {
        inventoryItemId: "item-1",
        changedByUserId: "user-1",
        action: inventoryAuditAction.bulkCommittedToDeck,
        beforeJson: {},
        afterJson: {},
      },
      {
        inventoryItemId: "item-2",
        changedByUserId: "user-1",
        action: inventoryAuditAction.bulkCommittedToDeck,
        beforeJson: {},
        afterJson: {},
      },
      {
        inventoryItemId: "item-3",
        changedByUserId: "user-1",
        action: inventoryAuditAction.bulkCommittedToDeck,
        beforeJson: {},
        afterJson: {},
      },
    ],
  });

  assert.equal(createManyCalls.length, 2);
  assert.deepEqual(
    createManyCalls.flat().map((entry) => entry.changeType),
    [
      inventoryAuditAction.bulkCommittedToDeck,
      inventoryAuditAction.bulkCommittedToDeck,
      inventoryAuditAction.bulkCommittedToDeck,
    ],
  );
});

test("inventory audit summaries describe deck commitment and return movements", () => {
  assert.equal(
    inventoryAuditSummary({
      id: "audit-1",
      createdAt: new Date(0).toISOString(),
      changedBy: "Brian",
      changeType: inventoryAuditAction.committedToDeck,
      beforeJson: {},
      afterJson: {
        cardName: "Sol Ring",
        quantityMoved: 1,
        sourceLocationName: "Box-0001",
        destinationLocationName: "Deck: Queen Marchesa",
      },
    }),
    "Brian committed 1 Sol Ring from Box-0001 to Deck: Queen Marchesa.",
  );

  assert.equal(
    inventoryAuditSummary({
      id: "audit-2",
      createdAt: new Date(0).toISOString(),
      changedBy: "Brian",
      changeType: inventoryAuditAction.returnedFromDeck,
      beforeJson: {},
      afterJson: {
        cardName: "Sol Ring",
        quantityMoved: 1,
        sourceLocationName: "Deck: Queen Marchesa",
        destinationLocationName: "Box-0001",
      },
    }),
    "Brian returned 1 Sol Ring from Deck: Queen Marchesa to Box-0001.",
  );
});
