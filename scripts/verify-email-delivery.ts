// Run only in the disposable local web container with the SMTP capture overlay.
// Future-date fixture jobs atomically so the regular worker cannot claim them.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getEmailConfig } from "../lib/email-config";
import { deliverNotificationEmail } from "../lib/email-delivery";
import { createNotification } from "../lib/notifications";
import { processNotificationDeliveryQueue } from "../lib/notification-delivery";

async function main() {
  const config = getEmailConfig();
  if (
    process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
    config.host !== "smtp-capture" ||
    config.port !== 1025 ||
    config.appUrl !== "http://127.0.0.1:13001"
  )
    throw new Error(
      "Requires the local snapshot and SMTP capture overlay; refusing external delivery.",
    );
  const tag = `email-integration-${randomUUID()}`;
  const address = `${tag}@example.test`;
  const captureUrl = `http://smtp-capture:8025/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`;
  const user = await prisma.user.create({
    data: {
      username: tag,
      displayName: "Email integration fixture",
      passwordHash: "not-a-login-hash",
      email: null,
    },
  });
  const destinationKey = `email:${user.id}`;
  const store = {
    $transaction: prisma.$transaction.bind(prisma),
    notificationDeliveryAttempt: prisma.notificationDeliveryAttempt,
    notificationDeliveryJob: {
      findMany: (args: Prisma.NotificationDeliveryJobFindManyArgs) =>
        prisma.notificationDeliveryJob.findMany({
          ...args,
          where: {
            AND: [args.where ?? {}, { transport: "email", destinationKey }],
          },
        }),
      findUnique: prisma.notificationDeliveryJob.findUnique.bind(
        prisma.notificationDeliveryJob,
      ),
      updateMany: prisma.notificationDeliveryJob.updateMany.bind(
        prisma.notificationDeliveryJob,
      ),
    },
  };
  const input = {
    recipientUserId: user.id,
    type: "trade.proposed",
    category: "trades",
    title: "Private fixture card details must not be emailed",
    message: "Secret inventory detail fixture",
    href: "/trades?view=active",
    sourceType: "email_integration",
    sourceId: tag,
  };
  const fixtureTime = new Date(Date.now() + 24 * 60 * 60_000);
  async function deferredNotification(data: typeof input) {
    return prisma.$transaction(async (tx) => {
      const notification = await createNotification(data, tx);
      await tx.notificationDeliveryJob.updateMany({
        where: {
          notificationId: notification.id,
          destinationKey,
          status: "PENDING",
        },
        data: { nextAttemptAt: fixtureTime },
      });
      return notification;
    });
  }
  try {
    await prisma.notificationPreference.create({
      data: { userId: user.id, category: "trades", emailEnabled: true },
    });
    const withoutAddress = await createNotification({
      ...input,
      sourceId: `${tag}:no-address`,
    });
    assert.ok(withoutAddress.id);
    assert.equal(
      await prisma.notificationDeliveryJob.count({ where: { destinationKey } }),
      0,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { email: address },
    });
    const notification = await deferredNotification(input);
    const again = await deferredNotification(input);
    assert.equal(again.id, notification.id);
    assert.equal(
      await prisma.notificationDeliveryJob.count({ where: { destinationKey } }),
      1,
    );
    // A real refused SMTP connection must become a sanitized, retryable queue failure.
    const failure = await processNotificationDeliveryQueue(
      {
        email: (context) =>
          deliverNotificationEmail(context, prisma, {
            ...process.env,
            SMTP_PORT: "1",
          }),
      },
      fixtureTime,
      store as never,
    );
    assert.equal(failure.failed, 1);
    let job = await prisma.notificationDeliveryJob.findFirstOrThrow({
      where: { destinationKey },
      include: { attempts: true },
    });
    assert.equal(job.status, "FAILED");
    assert.equal(job.attemptCount, 1);
    assert.ok(job.nextAttemptAt);
    assert.match(
      job.lastError ?? "",
      /SMTP connection or TLS negotiation failed/,
    );
    assert.doesNotMatch(
      job.lastError ?? "",
      /example.test|smtp-capture|password|ECONNREFUSED/,
    );
    await prisma.notificationDeliveryJob.update({
      where: { id: job.id },
      data: { nextAttemptAt: fixtureTime },
    });
    const success = await processNotificationDeliveryQueue(
      { email: deliverNotificationEmail },
      fixtureTime,
      store as never,
    );
    assert.equal(success.sent, 1);
    job = await prisma.notificationDeliveryJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { attempts: true },
    });
    assert.equal(job.status, "SENT");
    assert.equal(job.attemptCount, 2);
    assert.equal(job.attempts.length, 2);
    const response = await fetch(captureUrl);
    assert.ok(response.ok);
    const capture = (await response.json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    assert.equal(capture.messages.length, 1);
    const mail = (await (
      await fetch(
        `http://smtp-capture:8025/api/v1/message/${capture.messages[0]!.ID}`,
      )
    ).json()) as { Text: string; HTML: string };
    assert.match(mail.Text, /new activity on one of your trades/);
    assert.match(mail.HTML, /Open MTG Archives/);
    assert.doesNotMatch(
      mail.Text + mail.HTML,
      /Secret inventory|Private fixture card/,
    );
    await deferredNotification({ ...input, sourceId: `${tag}:opt-out` });
    await prisma.notificationPreference.update({
      where: { userId_category: { userId: user.id, category: "trades" } },
      data: { emailEnabled: false },
    });
    const suppressed = await processNotificationDeliveryQueue(
      { email: deliverNotificationEmail },
      fixtureTime,
      store as never,
    );
    assert.equal(suppressed.failed, 1);
    const after = (await (await fetch(captureUrl)).json()) as {
      messages: unknown[];
    };
    assert.equal(after.messages.length, 1);
    console.log(
      JSON.stringify({
        noAddressLocalNotification: true,
        deduplicated: true,
        smtpFailureRecorded: true,
        retryDelivered: true,
        attempts: 2,
        currentOptOutHonored: true,
        minimalMultipartMessage: true,
      }),
    );
  } finally {
    await prisma.notificationDeliveryJob.deleteMany({
      where: { destinationKey, transport: "email" },
    });
    await prisma.user.delete({ where: { id: user.id } });
    // Exact fixture search only; never call DELETE /messages with an empty ID list.
    const response = await fetch(captureUrl, { method: "DELETE" });
    assert.ok(response.ok);
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
