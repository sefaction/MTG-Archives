import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildDiscordWebhookPayload,
  buildTradeAnnouncementPayload,
  enqueueTradeAnnouncementDeliveries,
  tradeAnnouncementDestinationKey,
} from "../lib/webhook-delivery";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260804120000_trade_announcement_webhooks/migration.sql",
  "utf8",
);
const adminPage = readFileSync(
  "app/admin/notifications/trade-announcements/page.tsx",
  "utf8",
);
const tradeActions = readFileSync("app/trades/actions.ts", "utf8");

function announcementPayload() {
  return buildTradeAnnouncementPayload({
    tradeId: "trade-1",
    proposerName: "John-Mark",
    receiverName: "Heather",
    offeredCards: [
      {
        name: "Alpharael, Stonechosen",
        quantity: 1,
        setCode: "TLA",
        collectorNumber: "1",
        imageUrl: "https://cards.example.test/alpharael.jpg",
      },
    ],
    requestedCards: [
      {
        name: "Astarion's Thirst",
        quantity: 2,
        setCode: "CLB",
        collectorNumber: "114",
        imageUrl: "https://cards.example.test/astarion.jpg",
      },
    ],
    createdAt: new Date("2026-08-04T12:00:00.000Z"),
  });
}

test("completed trade payload contains bounded presentation data without private inventory fields", () => {
  const payload = announcementPayload();
  assert.equal(payload.event, "trade.completed");
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /John-Mark/);
  assert.match(serialized, /Astarion's Thirst/);
  assert.match(serialized, /cards\.example\.test/);
  assert.doesNotMatch(
    serialized,
    /ownerId|location|condition|price|notes|recipientUserId/,
  );
});

test("Discord trade announcements include both sides and exact-printing images", () => {
  const discord = buildDiscordWebhookPayload(announcementPayload());
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  const serialized = JSON.stringify(discord);
  assert.match(serialized, /Trade completed/);
  assert.match(serialized, /John-Mark sent/);
  assert.match(serialized, /Heather sent/);
  assert.match(serialized, /TLA #1/);
  assert.match(serialized, /alpharael\.jpg/);
  assert.match(serialized, /astarion\.jpg/);
});

test("trade announcements enqueue once per enabled global endpoint", async () => {
  const jobs: unknown[] = [];
  const store = {
    tradeAnnouncementWebhookEndpoint: {
      findMany: async () => [{ id: "endpoint-1" }, { id: "endpoint-2" }],
    },
    notificationDeliveryJob: {
      upsert: async (args: unknown) => {
        jobs.push(args);
        return { id: `job-${jobs.length}` };
      },
    },
  };
  await enqueueTradeAnnouncementDeliveries(
    {
      tradeId: "trade-1",
      proposerName: "Proposer",
      receiverName: "Recipient",
      offeredCards: [],
      requestedCards: [],
      createdAt: new Date("2026-08-04T12:00:00.000Z"),
    },
    store as never,
  );
  assert.equal(jobs.length, 2);
  assert.match(JSON.stringify(jobs[0]), /"sourceType":"trade.completed"/);
  assert.match(
    JSON.stringify(jobs[0]),
    new RegExp(tradeAnnouncementDestinationKey("endpoint-1")),
  );
  assert.doesNotMatch(JSON.stringify(jobs), /notificationId":"/);
});

test("admin trade announcements are schema-backed and require admin mode", () => {
  assert.match(schema, /model TradeAnnouncementWebhookEndpoint \{/);
  assert.match(schema, /notificationId\s+String\?/);
  assert.match(migration, /ALTER COLUMN "notificationId" DROP NOT NULL/);
  assert.match(migration, /CREATE TABLE "TradeAnnouncementWebhookEndpoint"/);
  assert.match(adminPage, /requireAdminMode/);
  assert.match(adminPage, /Trade announcements/);
  assert.match(adminPage, /Send test/);
  assert.match(tradeActions, /enqueueTradeAnnouncementDeliveries/);
});
