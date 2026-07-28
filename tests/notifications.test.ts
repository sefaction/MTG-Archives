import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNotification, safeNotificationHref } from "../lib/notifications";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260728180000_notifications_phase_1/migration.sql",
  "utf8",
);
const nav = readFileSync("components/Nav.tsx", "utf8");
const bell = readFileSync("components/NotificationBell.tsx", "utf8");
const page = readFileSync("app/notifications/page.tsx", "utf8");
const actions = readFileSync("app/notifications/actions.ts", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const summaryRoute = readFileSync(
  "app/api/notifications/summary/route.ts",
  "utf8",
);

test("notification schema stores durable recipient and unread state", () => {
  assert.match(schema, /model Notification \{/);
  assert.match(schema, /recipientUserId String/);
  assert.match(schema, /readAt\s+DateTime\?/);
  assert.match(schema, /@@unique\(\[recipientUserId, sourceType, sourceId\]\)/);
  assert.match(schema, /@@index\(\[recipientUserId, readAt, createdAt\]\)/);
  assert.match(migration, /CREATE TABLE "Notification"/);
  assert.match(migration, /ON DELETE CASCADE/);
});

test("notification deep links stay inside the application", () => {
  assert.equal(
    safeNotificationHref("/trades?view=active"),
    "/trades?view=active",
  );
  assert.equal(safeNotificationHref("https://example.com"), null);
  assert.equal(safeNotificationHref("//example.com"), null);
  assert.equal(safeNotificationHref(""), null);
});

test("notification creation deduplicates durable source events", async () => {
  const calls: unknown[] = [];
  const store = {
    notification: {
      upsert: async (args: unknown) => {
        calls.push(args);
        return { id: "notification-1" };
      },
      create: async () => {
        throw new Error("Expected a source-backed notification to use upsert.");
      },
    },
  };

  await createNotification(
    {
      recipientUserId: "user-1",
      type: "trade.proposed",
      category: "trades",
      title: "Trade proposal received",
      href: "/trades?view=active",
      sourceType: "trade_event",
      sourceId: "event-1",
    },
    store as never,
  );

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /recipientUserId_sourceType_sourceId/);
});

test("notification UI exposes a quiet header count and browser-tab count", () => {
  assert.match(nav, /<NotificationBell/);
  assert.match(nav, /getUnreadNotificationCount/);
  assert.match(bell, /aria-label={`Notifications, \$\{unreadCount\} unread`}/);
  assert.match(bell, /\(\$\{unreadCount\}\) \$\{appName\}/);
  assert.match(bell, /60_000/);
  assert.match(bell, /document\.visibilityState/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /getUnreadNotificationCount/);
  assert.doesNotMatch(bell, /Notification\.requestPermission/);
});

test("notification history and read actions are user scoped", () => {
  assert.match(page, /Mark all read/);
  assert.match(page, /markNotificationRead/);
  assert.match(page, /openNotification/);
  assert.match(actions, /recipientUserId: user\.id/);
  assert.match(actions, /safeNotificationHref\(notification\.href\)/);
  assert.match(summaryRoute, /getCurrentUser/);
  assert.match(summaryRoute, /Cache-Control.*no-store/);
});
