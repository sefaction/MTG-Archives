import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildDiscordWebhookPayload,
  buildWebhookPayload,
  createPinnedLookup,
  decryptWebhookValue,
  encryptWebhookValue,
  enqueueWebhookDeliveriesForNotification,
  resolveWebhookTarget,
  validateDiscordWebhookUrl,
  validateWebhookUrlSyntax,
  webhookSecretHint,
  webhookSignature,
  webhookUrlHint,
} from "../lib/webhook-delivery";
import {
  ensureWebhookEncryptionKey,
  loadWebhookEncryptionKey,
  webhookEncryptionKeyPath,
} from "../lib/webhook-encryption-key";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260728220000_signed_webhook_delivery/migration.sql",
  "utf8",
);
const discordMigration = readFileSync(
  "prisma/migrations/20260729010000_discord_webhook_destinations/migration.sql",
  "utf8",
);
const worker = readFileSync("scripts/notification-worker.ts", "utf8");
const settings = readFileSync("app/settings/webhooks/page.tsx", "utf8");
const notifications = readFileSync("lib/notifications.ts", "utf8");

const originalKey = process.env.NOTIFICATION_WEBHOOK_ENCRYPTION_KEY;
process.env.NOTIFICATION_WEBHOOK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
  "base64",
);

test.after(() => {
  if (originalKey === undefined) {
    delete process.env.NOTIFICATION_WEBHOOK_ENCRYPTION_KEY;
  } else {
    process.env.NOTIFICATION_WEBHOOK_ENCRYPTION_KEY = originalKey;
  }
});

test("webhook URLs and signing secrets encrypt without revealing saved values", () => {
  const secret = "correct horse battery staple";
  const encrypted = encryptWebhookValue(secret);
  assert.notEqual(encrypted, secret);
  assert.doesNotMatch(encrypted, /correct|horse|battery|staple/);
  assert.equal(decryptWebhookValue(encrypted), secret);
  assert.equal(webhookSecretHint(secret), "••••aple");
  assert.equal(
    webhookUrlHint("https://hooks.example.test/private/token?key=secret"),
    "https://hooks.example.test/…",
  );
  const encryptedParts = encrypted.split(".");
  encryptedParts[3] = `${
    encryptedParts[3][0] === "A" ? "B" : "A"
  }${encryptedParts[3].slice(1)}`;
  assert.throws(
    () => decryptWebhookValue(encryptedParts.join(".")),
    /could not be decrypted/,
  );
});

test("webhook master key is generated once in persistent backup storage", () => {
  const backupDirectory = mkdtempSync(
    join(tmpdir(), "mtg-archives-webhook-key-"),
  );
  const env = { BACKUP_DIR: backupDirectory };
  try {
    const first = ensureWebhookEncryptionKey(env);
    const second = ensureWebhookEncryptionKey(env);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.path, webhookEncryptionKeyPath(env));
    assert.deepEqual(first.key, second.key);
    assert.deepEqual(loadWebhookEncryptionKey(env), first.key);
    assert.match(
      first.path,
      /[\\/]\.system-secrets[\\/]notification-webhook\.key$/,
    );
  } finally {
    rmSync(backupDirectory, { recursive: true, force: true });
  }
});

test("webhook signatures cover the timestamp and exact raw body", () => {
  const signature = webhookSignature(
    "0123456789abcdef",
    "1722196800",
    '{"version":"1"}',
  );
  assert.equal(signature.length, 64);
  assert.notEqual(
    signature,
    webhookSignature("0123456789abcdef", "1722196801", '{"version":"1"}'),
  );
  assert.notEqual(
    signature,
    webhookSignature("0123456789abcdef", "1722196800", '{"version":"2"}'),
  );
});

test("pinned webhook DNS lookup supports Node's single and all-address callbacks", async () => {
  const lookup = createPinnedLookup({ address: "192.0.2.10", family: 4 });
  const single = await new Promise<{
    address: string | { address: string; family: number }[];
    family?: number;
  }>((resolve, reject) => {
    lookup("ignored.example", { all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(single, { address: "192.0.2.10", family: 4 });

  const all = await new Promise<string | { address: string; family: number }[]>(
    (resolve, reject) => {
      lookup("ignored.example", { all: true }, (error, address) => {
        if (error) reject(error);
        else resolve(address);
      });
    },
  );
  assert.deepEqual(all, [{ address: "192.0.2.10", family: 4 }]);
});

test("public webhooks require HTTPS and private access remains explicit", async () => {
  assert.equal(
    validateWebhookUrlSyntax("https://example.test/hook", false).protocol,
    "https:",
  );
  assert.throws(
    () => validateWebhookUrlSyntax("http://example.test/hook", false),
    /must use HTTPS/,
  );
  assert.throws(
    () => validateWebhookUrlSyntax("file:///etc/passwd", true),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => validateWebhookUrlSyntax("https://user:pass@example.test", false),
    /usernames or passwords/,
  );
  await assert.rejects(
    resolveWebhookTarget("https://127.0.0.1/hook", true),
    /blocked local or link-local/,
  );
  const privateTarget = await resolveWebhookTarget(
    "http://192.168.1.20/hook",
    true,
  );
  assert.equal(privateTarget.address.address, "192.168.1.20");
  await assert.rejects(
    resolveWebhookTarget("https://192.168.1.20/hook", false),
    /private or blocked/,
  );
});

test("versioned webhook payload avoids recipient and inventory detail", () => {
  const payload = buildWebhookPayload({
    notificationId: "notification-1",
    type: "trade.proposed",
    category: "trades",
    title: "Trade proposed",
    message: "A trade needs your review.",
    href: "/trades?view=active",
    createdAt: new Date("2026-07-28T20:00:00.000Z"),
  });
  assert.equal(payload.version, "1");
  assert.equal(payload.event, "notification.created");
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /recipientUserId|email|inventory|metadata/);
  assert.match(serialized, /Trade proposed/);
});

test("Discord destinations use official URLs and mention-safe embed payloads", () => {
  const url = validateDiscordWebhookUrl(
    "https://discord.com/api/webhooks/123456/token_value",
  );
  assert.equal(url.hostname, "discord.com");
  assert.throws(
    () =>
      validateDiscordWebhookUrl(
        "https://hooks.example.test/api/webhooks/123456/token_value",
      ),
    /official Discord webhook URL/,
  );
  assert.throws(
    () => validateDiscordWebhookUrl("https://discord.com/api/webhooks/bad"),
    /invalid/,
  );

  const generic = buildWebhookPayload({
    notificationId: "notification-1",
    type: "trade.proposed",
    category: "trades",
    title: "Trade proposed",
    message: "@everyone A trade needs your review.",
    href: "/trades?view=active",
    createdAt: new Date("2026-07-28T20:00:00.000Z"),
    test: true,
  });
  const discord = buildDiscordWebhookPayload(generic);
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  assert.match(JSON.stringify(discord), /"embeds"/);
  assert.match(JSON.stringify(discord), /Trade proposed/);
  assert.match(JSON.stringify(discord), /Test delivery/);
  assert.match(JSON.stringify(discord), /trades\?view=active/);
});

test("enabled webhook categories enqueue one durable job per endpoint", async () => {
  const jobs: unknown[] = [];
  const store = {
    notificationPreference: {
      findUnique: async () => ({ webhookEnabled: true }),
    },
    notificationWebhookEndpoint: {
      findMany: async () => [{ id: "endpoint-1" }, { id: "endpoint-2" }],
    },
    notificationDeliveryJob: {
      upsert: async (args: unknown) => {
        jobs.push(args);
        return { id: `job-${jobs.length}` };
      },
    },
  };
  await enqueueWebhookDeliveriesForNotification(
    {
      id: "notification-1",
      recipientUserId: "user-1",
      type: "trade.proposed",
      category: "trades",
      title: "Trade proposed",
      message: null,
      href: "/trades?view=active",
      createdAt: new Date("2026-07-28T20:00:00.000Z"),
    },
    store as never,
  );
  assert.equal(jobs.length, 2);
  assert.match(JSON.stringify(jobs[0]), /endpoint-1/);
  assert.match(JSON.stringify(jobs[1]), /endpoint-2/);
  assert.doesNotMatch(JSON.stringify(jobs), /secret|urlEncrypted/);
});

test("phase four schema, queue integration, UI, and worker are wired", () => {
  assert.match(schema, /model NotificationWebhookEndpoint \{/);
  assert.match(schema, /webhookEnabled Boolean\s+@default\(false\)/);
  assert.match(migration, /CREATE TABLE "NotificationWebhookEndpoint"/);
  assert.match(migration, /ADD COLUMN "webhookEnabled"/);
  assert.match(schema, /deliveryType\s+String\s+@default\("SIGNED_JSON"\)/);
  assert.match(discordMigration, /ADD COLUMN "deliveryType"/);
  assert.match(discordMigration, /"secretEncrypted" DROP NOT NULL/);
  assert.match(notifications, /enqueueWebhookDeliveriesForNotification/);
  assert.match(worker, /deliverNotificationWebhook/);
  assert.match(settings, /Save webhook categories/);
  assert.match(settings, /Send test/);
  assert.match(settings, /Allow private\/LAN destination/);
  assert.match(settings, /Discord message/);
  assert.match(settings, /Signing secret \(generic JSON only\)/);
  assert.match(settings, /Copy Webhook URL/);
  assert.match(settings, /params\.error/);
  assert.match(settings, /X-MTG-Archives-Webhook-Signature/);
  assert.doesNotMatch(settings, /urlEncrypted\}/);
  assert.doesNotMatch(settings, /secretEncrypted\}/);
});
