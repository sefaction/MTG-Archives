import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TradeWishlistStatus } from "@prisma/client";
import {
  notificationCategoryEnabled,
  TRADE_NOTIFICATION_CATEGORY,
} from "../lib/notification-preferences";
import { recordTradeEvent } from "../lib/trade-notifications";
import {
  processHourlyWishlistDigests,
  startOfUtcHour,
} from "../lib/wishlist-notification-digests";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260728190000_notification_trade_events_and_digests/migration.sql",
  "utf8",
);
const tradeActions = readFileSync("app/trades/actions.ts", "utf8");
const publicInventoryActions = readFileSync(
  "app/public/inventory/actions.ts",
  "utf8",
);
const settingsPage = readFileSync("app/settings/page.tsx", "utf8");
const worker = readFileSync("scripts/notification-worker.ts", "utf8");

test("notification preferences default on and honor explicit opt-out", async () => {
  const defaultStore = {
    notificationPreference: {
      findUnique: async () => null,
    },
  };
  assert.equal(
    await notificationCategoryEnabled(
      "user-1",
      TRADE_NOTIFICATION_CATEGORY,
      defaultStore as never,
    ),
    true,
  );

  const disabledStore = {
    notificationPreference: {
      findUnique: async () => ({ inAppEnabled: false }),
    },
  };
  assert.equal(
    await notificationCategoryEnabled(
      "user-1",
      TRADE_NOTIFICATION_CATEGORY,
      disabledStore as never,
    ),
    false,
  );
});

test("trade events notify enabled recipients and skip opted-out recipients", async () => {
  const notifications: unknown[] = [];
  const store = {
    tradeEvent: {
      create: async () => ({ id: "event-1" }),
    },
    user: {
      findMany: async () => [
        { id: "user-enabled", notificationPreferences: [] },
        {
          id: "user-disabled",
          notificationPreferences: [{ inAppEnabled: false }],
        },
      ],
    },
    notification: {
      upsert: async (args: unknown) => {
        notifications.push(args);
        return { id: "notification-1" };
      },
    },
    notificationPreference: {},
  };

  await recordTradeEvent(store as never, {
    tradeId: "trade-1",
    eventType: "proposed",
    actorUserId: "actor-1",
    actorPlayerId: "player-1",
    message: "Trade proposed.",
    notification: {
      type: "trade.proposed",
      title: "New trade",
      recipientPlayerIds: ["player-2"],
    },
  });

  assert.equal(notifications.length, 1);
  assert.match(JSON.stringify(notifications[0]), /user-enabled/);
  assert.match(JSON.stringify(notifications[0]), /trade_event/);
});

test("wishlist digests group a completed UTC hour into one notification", async () => {
  const notifications: unknown[] = [];
  const processedIds: string[] = [];
  const pending = [
    {
      id: "activity-1",
      actorUserId: "wishlister-1",
      targetOwnerPlayerId: "owner-player",
      tradeWishlistItemId: "wishlist-1",
      cardName: "Sol Ring",
      quantityAdded: 1,
      processedAt: null,
      createdAt: new Date("2026-07-28T12:10:00.000Z"),
      actorUser: { displayName: "Brian", username: "brian" },
      tradeWishlistItem: { status: TradeWishlistStatus.OPEN },
    },
    {
      id: "activity-2",
      actorUserId: "wishlister-1",
      targetOwnerPlayerId: "owner-player",
      tradeWishlistItemId: "wishlist-2",
      cardName: "Arcane Signet",
      quantityAdded: 2,
      processedAt: null,
      createdAt: new Date("2026-07-28T12:45:00.000Z"),
      actorUser: { displayName: "Brian", username: "brian" },
      tradeWishlistItem: { status: TradeWishlistStatus.OPEN },
    },
  ];
  const tx = {
    user: {
      findMany: async () => [{ id: "owner-user", notificationPreferences: [] }],
    },
    notification: {
      upsert: async (args: unknown) => {
        notifications.push(args);
        return { id: "digest-1" };
      },
    },
    tradeWishlistNotificationActivity: {
      updateMany: async (args: { where: { id: { in: string[] } } }) => {
        processedIds.push(...args.where.id.in);
        return { count: args.where.id.in.length };
      },
    },
  };
  const store = {
    tradeWishlistNotificationActivity: {
      findMany: async () => pending,
    },
    $transaction: async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
  };

  const result = await processHourlyWishlistDigests(
    new Date("2026-07-28T13:05:00.000Z"),
    store as never,
  );

  assert.equal(result.groupsProcessed, 1);
  assert.equal(result.activitiesProcessed, 2);
  assert.equal(notifications.length, 1);
  assert.deepEqual(processedIds, ["activity-1", "activity-2"]);
  assert.match(JSON.stringify(notifications[0]), /3 new wishlist requests/);
  assert.match(JSON.stringify(notifications[0]), /wishlist_digest/);
});

test("wishlist hour boundaries use UTC and never include the active hour", () => {
  assert.equal(
    startOfUtcHour(new Date("2026-07-28T13:59:59.999Z")).toISOString(),
    "2026-07-28T13:00:00.000Z",
  );
});

test("phase two schema, actions, settings, and worker are wired", () => {
  assert.match(schema, /model NotificationPreference \{/);
  assert.match(schema, /model TradeWishlistNotificationActivity \{/);
  assert.match(migration, /CREATE TABLE "NotificationPreference"/);
  assert.match(
    publicInventoryActions,
    /recordTradeWishlistNotificationActivity/,
  );
  assert.match(publicInventoryActions, /prisma\.\$transaction/);
  assert.match(tradeActions, /recordTradeEvent/);
  assert.match(tradeActions, /type: "trade\.proposed"/);
  assert.match(tradeActions, /type: "trade\.countered"/);
  assert.match(tradeActions, /type: "trade\.completed"/);
  assert.match(settingsPage, /name="tradeNotifications"/);
  assert.match(settingsPage, /name="wishlistDigestNotifications"/);
  assert.match(worker, /processHourlyWishlistDigests/);
  assert.match(worker, /NOTIFICATION_WORKER_INTERVAL_MS/);
});
