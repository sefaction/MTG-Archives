import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import {
  buildNotificationEmail,
  emailConfigurationStatus,
  getEmailConfig,
  safeSmtpError,
  validEmailAddress,
} from "../lib/email-config";
import {
  deliverNotificationEmail,
  enqueueEmailForNotification,
  queueEmailTest,
  sendSmtpEmail,
} from "../lib/email-delivery";
import {
  getEmailNotificationPreferences,
  setEmailNotificationPreferences,
} from "../lib/notification-preferences";

const env = {
  SMTP_ENABLED: "true",
  SMTP_HOST: "127.0.0.1",
  SMTP_FROM: "archive@example.test",
  APP_BASE_URL: "http://127.0.0.1:13001",
};
const context = {
  idempotencyKey: "job-1",
  notificationId: "notification-1",
  sourceType: "notification",
  sourceId: "notification-1",
  destinationKey: "email:user-1",
  payload: { version: 1 },
};
const notification = {
  id: "notification-1",
  recipientUserId: "user-1",
  category: "trades",
};
function fixture() {
  const jobs: any[] = [];
  const user = { email: "user@example.test" as string | null, isActive: true };
  const preference = { emailEnabled: true };
  const stored = { ...notification, href: "/trades?view=active" };
  const store = {
    user: { findUnique: async () => user },
    notificationPreference: { findUnique: async () => preference },
    notification: { findUnique: async () => stored },
    notificationDeliveryJob: {
      upsert: async (args: unknown) => {
        jobs.push(args);
        return { id: "job-1" };
      },
    },
  };
  return { store, jobs, user, preference, stored };
}

test("SMTP configuration fails closed without leaking supplied secrets", () => {
  assert.equal(emailConfigurationStatus({}).ready, false);
  assert.equal(getEmailConfig(env).security, "starttls");
  assert.equal(getEmailConfig({ ...env, SMTP_SECURITY: "tls" }).port, 465);
  assert.throws(
    () => getEmailConfig({ ...env, SMTP_SECURITY: "plain" }),
    /SMTP_ALLOW_INSECURE/,
  );
  assert.throws(
    () => getEmailConfig({ ...env, SMTP_USER: "private-secret" }),
    /both SMTP_USER/,
  );
  assert.throws(
    () =>
      getEmailConfig({
        ...env,
        APP_BASE_URL: "https://secret:credential@host.test",
      }),
    /without credentials/,
  );
  assert.equal(
    emailConfigurationStatus({
      ...env,
      SMTP_HOST: "secret-value\nnot-host",
    }).message.includes("secret-value"),
    false,
  );
  assert.equal(
    validEmailAddress("victim@example.test\r\nBcc:other@example.test"),
    false,
  );
  assert.equal(
    validEmailAddress("first@example.test,second@example.test"),
    false,
  );
  assert.equal(validEmailAddress(null), false);
  assert.equal(
    safeSmtpError({ code: "EAUTH", message: "password=secret" }).includes(
      "secret",
    ),
    false,
  );
  assert.equal(
    safeSmtpError(
      new Error("user@example.test private SMTP transcript"),
    ).includes("example.test"),
    false,
  );
});

test("email templates contain only summaries and same-origin links", () => {
  const normal = buildNotificationEmail(
    env.APP_BASE_URL,
    "trades",
    "/trades?view=active&a=%22",
  );
  assert.match(normal.text, /new activity on one of your trades/);
  assert.match(normal.html, /&amp;/);
  for (const href of [
    "//evil.invalid",
    "/\\evil.invalid",
    "https://evil.invalid",
    "/\r\nevil.invalid",
  ]) {
    const message = buildNotificationEmail(
      env.APP_BASE_URL,
      "wishlist_digest",
      href,
    );
    assert.match(message.text, /127.0.0.1:13001\/notifications/);
    assert.doesNotMatch(message.html, /evil.invalid/);
  }
});

test("email enqueue is opt-in and does not copy address, credentials or card data", async () => {
  const f = fixture();
  f.preference.emailEnabled = false;
  await enqueueEmailForNotification(notification, f.store as never);
  assert.equal(f.jobs.length, 0);
  f.preference.emailEnabled = true;
  f.user.email = null;
  await enqueueEmailForNotification(notification, f.store as never);
  assert.equal(f.jobs.length, 0);
  f.user.email = "user@example.test";
  await enqueueEmailForNotification(notification, f.store as never);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs[0].create.transport, "email");
  assert.deepEqual(f.jobs[0].create.payloadJson, { version: 1 });
  assert.doesNotMatch(JSON.stringify(f.jobs), /example.test|password|cardName/);
  await enqueueEmailForNotification(
    { ...notification, category: "system" },
    f.store as never,
  );
  assert.equal(f.jobs.length, 1);
});

test("delivery rechecks recipient ownership, activity and current preferences", async () => {
  const f = fixture();
  const sent: any[] = [];
  const send = async (_config: unknown, message: unknown) => {
    sent.push(message);
  };
  await deliverNotificationEmail(context, f.store as never, env, send);
  assert.equal(sent[0].to, f.user.email);
  const messageId = sent[0].messageId;
  await deliverNotificationEmail(context, f.store as never, env, send);
  assert.equal(sent[1].messageId, messageId);
  f.preference.emailEnabled = false;
  await assert.rejects(
    deliverNotificationEmail(context, f.store as never, env, send),
    /disabled for this/,
  );
  f.preference.emailEnabled = true;
  f.stored.recipientUserId = "someone-else";
  await assert.rejects(
    deliverNotificationEmail(context, f.store as never, env, send),
    /does not belong/,
  );
  f.user.isActive = false;
  await assert.rejects(
    deliverNotificationEmail(context, f.store as never, env, send),
    /inactive/,
  );
  assert.equal(sent.length, 2);
});

test("test email rate keys are user scoped and normal preferences default off", async () => {
  const f = fixture();
  await queueEmailTest(
    "user-1",
    f.store as never,
    env,
    new Date("2026-09-20T06:00:01Z"),
  );
  await queueEmailTest(
    "user-1",
    f.store as never,
    env,
    new Date("2026-09-20T06:00:59Z"),
  );
  assert.deepEqual(f.jobs[0].where, f.jobs[1].where);
  assert.equal(f.jobs[0].create.destinationKey, "email:user-1");
  const calls: any[] = [];
  const store = {
    notificationPreference: {
      findMany: async () => [],
      upsert: async (args: unknown) => calls.push(args),
    },
  };
  assert.deepEqual(
    await getEmailNotificationPreferences("user-1", store as never),
    { trades: false, wishlistDigest: false },
  );
  await setEmailNotificationPreferences(
    "user-1",
    { trades: true, wishlistDigest: false },
    store as never,
  );
  assert.deepEqual(
    calls.map((call) => call.update),
    [{ emailEnabled: true }, { emailEnabled: false }],
  );
  assert.ok(
    calls.every((call) => call.where.userId_category.userId === "user-1"),
  );
});

test("SMTP transport delivers multipart mail to an isolated loopback receiver", async () => {
  let captured = "";
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 localhost test receiver\r\n");
    let pending = "";
    let data = false;
    socket.on("data", (chunk) => {
      pending += chunk;
      let index: number;
      while ((index = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        if (data) {
          if (line === ".") {
            data = false;
            socket.write("250 captured locally\r\n");
          } else captured += line + "\r\n";
        } else if (line.startsWith("EHLO") || line.startsWith("HELO"))
          socket.write("250 localhost\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as import("node:net").AddressInfo).port;
    const config = getEmailConfig({
      ...env,
      SMTP_PORT: String(port),
      SMTP_SECURITY: "plain",
      SMTP_ALLOW_INSECURE: "true",
    });
    await sendSmtpEmail(config, {
      ...buildNotificationEmail(config.appUrl, "test"),
      to: "fixture@example.test",
      messageId: "<fixture@mtg-archives.local>",
    });
    assert.match(captured, /To: fixture@example.test/);
    assert.match(captured, /multipart\/alternative/);
    assert.match(captured, /text\/plain/);
    assert.match(captured, /text\/html/);
    assert.match(captured, /MTG Archives test email/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
