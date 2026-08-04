import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NotificationDeliveryStatus } from "@prisma/client";
import {
  claimNotificationDeliveries,
  deliveryRetryAt,
  enqueueNotificationDelivery,
  processNotificationDeliveryQueue,
  type DeliveryWorkerConfig,
} from "../lib/notification-delivery";
import { createNotification } from "../lib/notifications";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260728210000_notification_delivery_queue/migration.sql",
  "utf8",
);
const worker = readFileSync("scripts/notification-worker.ts", "utf8");
const adminPage = readFileSync("app/admin/notifications/page.tsx", "utf8");
const compose = readFileSync("docker-compose.yml", "utf8");

const config: DeliveryWorkerConfig = {
  batchSize: 20,
  leaseMs: 300_000,
  maxAttempts: 5,
  retryBaseMs: 60_000,
  retryMaxMs: 360_000,
};

test("delivery retry timing is exponential and bounded", () => {
  const now = new Date("2026-07-28T20:00:00.000Z");
  assert.equal(
    deliveryRetryAt(1, now, config).toISOString(),
    "2026-07-28T20:01:00.000Z",
  );
  assert.equal(
    deliveryRetryAt(3, now, config).toISOString(),
    "2026-07-28T20:04:00.000Z",
  );
  assert.equal(
    deliveryRetryAt(10, now, config).toISOString(),
    "2026-07-28T20:06:00.000Z",
  );
});

test("delivery enqueue uses one durable job per notification target", async () => {
  const calls: unknown[] = [];
  await enqueueNotificationDelivery(
    {
      notificationId: "notification-1",
      transport: "webhook",
      destinationKey: "endpoint-1",
      payload: { version: 1 },
    },
    {
      notificationDeliveryJob: {
        upsert: async (args: unknown) => {
          calls.push(args);
          return { id: "job-1" };
        },
      },
    } as never,
  );
  assert.equal(calls.length, 1);
  assert.match(
    JSON.stringify(calls[0]),
    /sourceType_sourceId_transport_destinationKey/,
  );
});

test("notification and requested outbound jobs share the caller transaction", async () => {
  const jobs: unknown[] = [];
  const store = {
    notification: {
      upsert: async () => ({ id: "notification-1" }),
      create: async () => ({ id: "notification-1" }),
    },
    notificationDeliveryJob: {
      upsert: async (args: unknown) => {
        jobs.push(args);
        return { id: "job-1" };
      },
    },
  };
  await createNotification(
    {
      recipientUserId: "user-1",
      type: "trade.proposed",
      category: "trades",
      title: "Trade proposed",
      sourceType: "trade_event",
      sourceId: "event-1",
      deliveries: [{ transport: "webhook", destinationKey: "endpoint-1" }],
    },
    store as never,
  );
  assert.equal(jobs.length, 1);
  assert.match(JSON.stringify(jobs[0]), /Trade proposed/);
});

function deliveryStore() {
  const attempts: unknown[] = [];
  const job: Record<string, any> = {
    id: "job-1",
    notificationId: "notification-1",
    transport: "test",
    destinationKey: "destination-1",
    payloadJson: { version: 1 },
    status: NotificationDeliveryStatus.PENDING,
    attemptCount: 0,
    maxAttempts: 2,
    nextAttemptAt: new Date("2026-07-28T19:00:00.000Z"),
    claimToken: null,
    claimedAt: null,
    claimExpiresAt: null,
    lastError: null,
    sentAt: null,
    createdAt: new Date("2026-07-28T19:00:00.000Z"),
    updatedAt: new Date("2026-07-28T19:00:00.000Z"),
    notification: {
      recipientUserId: "user-1",
      type: "trade.proposed",
      category: "trades",
    },
  };
  const store: Record<string, any> = {
    notificationDeliveryJob: {
      findMany: async () =>
        job.status === NotificationDeliveryStatus.PENDING ||
        job.status === NotificationDeliveryStatus.FAILED
          ? [{ id: job.id }]
          : [],
      updateMany: async ({ where, data }: Record<string, any>) => {
        if (
          where.claimToken !== undefined &&
          where.claimToken !== job.claimToken
        ) {
          return { count: 0 };
        }
        if (
          data.status === NotificationDeliveryStatus.SENDING &&
          job.status !== NotificationDeliveryStatus.PENDING &&
          job.status !== NotificationDeliveryStatus.FAILED
        ) {
          return { count: 0 };
        }
        Object.assign(job, data);
        return { count: 1 };
      },
      findUnique: async () => ({ ...job }),
    },
    notificationDeliveryAttempt: {
      create: async ({ data }: Record<string, any>) => {
        attempts.push(data);
        return data;
      },
    },
  };
  store.$transaction = async (callback: (tx: typeof store) => unknown) =>
    callback(store);
  return { store, job, attempts };
}

test("an expiring claim can only be held by one worker", async () => {
  const fixture = deliveryStore();
  const now = new Date("2026-07-28T20:00:00.000Z");
  const first = await claimNotificationDeliveries(
    now,
    "worker-a",
    config,
    fixture.store as never,
  );
  const second = await claimNotificationDeliveries(
    now,
    "worker-b",
    config,
    fixture.store as never,
  );
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.match(first[0].claimToken ?? "", /^worker-a:/);
});

test("failed delivery retains attempt history and a bounded retry", async () => {
  const fixture = deliveryStore();
  const result = await processNotificationDeliveryQueue(
    {
      test: async () => {
        throw new Error("Temporary endpoint failure");
      },
    },
    new Date("2026-07-28T20:00:00.000Z"),
    fixture.store as never,
    config,
  );
  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1 });
  assert.equal(fixture.job.status, NotificationDeliveryStatus.FAILED);
  assert.equal(fixture.job.attemptCount, 1);
  assert.ok(fixture.job.nextAttemptAt instanceof Date);
  assert.equal(fixture.attempts.length, 1);
  assert.match(
    JSON.stringify(fixture.attempts[0]),
    /Temporary endpoint failure/,
  );
});

test("phase three schema, worker, operations, and admin visibility are wired", () => {
  assert.match(schema, /model NotificationDeliveryJob \{/);
  assert.match(schema, /model NotificationDeliveryAttempt \{/);
  assert.match(schema, /enum NotificationDeliveryStatus \{/);
  assert.match(migration, /CREATE TABLE "NotificationDeliveryJob"/);
  assert.match(migration, /CREATE TABLE "NotificationDeliveryAttempt"/);
  assert.match(worker, /processNotificationDeliveryQueue/);
  assert.match(adminPage, /Notification delivery/);
  assert.match(adminPage, /Queue success test/);
  assert.match(adminPage, /Recent attempt history/);
  assert.match(compose, /NOTIFICATION_DELIVERY_LEASE_MS/);
  assert.match(compose, /NOTIFICATION_DELIVERY_RETRY_MAX_MS/);
});
