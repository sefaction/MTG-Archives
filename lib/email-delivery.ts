import { createHash } from "node:crypto";
import type { Notification, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  enqueueEventDelivery,
  enqueueNotificationDelivery,
  type NotificationDeliveryHandlerContext,
} from "./notification-delivery";
import {
  buildNotificationEmail,
  EMAIL_CATEGORIES,
  EMAIL_TRANSPORT,
  getEmailConfig,
  safeSmtpError,
  validEmailAddress,
  type EmailConfig,
} from "./email-config";

type EmailStore = Pick<
  Prisma.TransactionClient,
  "user" | "notificationPreference" | "notificationDeliveryJob"
>;
type DeliveryStore = Pick<
  Prisma.TransactionClient,
  "user" | "notificationPreference" | "notification"
>;

export async function enqueueEmailForNotification(
  notification: Pick<Notification, "id" | "recipientUserId" | "category">,
  store: EmailStore = prisma,
) {
  if (
    !EMAIL_CATEGORIES.includes(
      notification.category as (typeof EMAIL_CATEGORIES)[number],
    )
  )
    return;
  const preference = await store.notificationPreference.findUnique({
    where: {
      userId_category: {
        userId: notification.recipientUserId,
        category: notification.category,
      },
    },
    select: { emailEnabled: true },
  });
  if (!preference?.emailEnabled) return;
  const user = await store.user.findUnique({
    where: { id: notification.recipientUserId },
    select: { email: true, isActive: true },
  });
  if (!user?.isActive || !validEmailAddress(user.email)) return;
  // Queue only identifiers. Credentials, addresses and card details are not copied into jobs.
  return enqueueNotificationDelivery(
    {
      notificationId: notification.id,
      transport: EMAIL_TRANSPORT,
      destinationKey: `email:${notification.recipientUserId}`,
      payload: { version: 1 },
    },
    store,
  );
}

export async function queueEmailTest(
  userId: string,
  store: EmailStore = prisma,
  env: Record<string, string | undefined> = process.env,
  now = new Date(),
) {
  getEmailConfig(env);
  const user = await store.user.findUnique({
    where: { id: userId },
    select: { email: true, isActive: true },
  });
  if (!user?.isActive || !validEmailAddress(user.email))
    throw new Error(
      "Add a valid email address to your account before sending a test.",
    );
  return enqueueEventDelivery(
    {
      sourceType: "email_test",
      sourceId: `${userId}:${Math.floor(now.getTime() / 60_000)}`,
      transport: EMAIL_TRANSPORT,
      destinationKey: `email:${userId}`,
      payload: { version: 1 },
    },
    store,
  );
}

type Message = ReturnType<typeof buildNotificationEmail> & {
  to: string;
  messageId: string;
};
export async function sendSmtpEmail(config: EmailConfig, message: Message) {
  let transport: import("nodemailer").Transporter | undefined;
  try {
    const nodemailer = (await import("nodemailer")).default;
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.security === "tls",
      requireTLS: config.security === "starttls",
      ignoreTLS: config.security === "plain",
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      ...(config.user
        ? { auth: { user: config.user, pass: config.password } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      dnsTimeout: 10_000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await transport.sendMail({
      ...message,
      from: { name: "MTG Archives", address: config.from },
      to: { address: message.to, name: "" },
      envelope: { from: config.from, to: [message.to] },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch (error) {
    throw new Error(safeSmtpError(error));
  } finally {
    transport?.close();
  }
}

export async function deliverNotificationEmail(
  context: NotificationDeliveryHandlerContext,
  store: DeliveryStore = prisma,
  env: Record<string, string | undefined> = process.env,
  send: (
    config: EmailConfig,
    message: Message,
  ) => Promise<void> = sendSmtpEmail,
) {
  const config = getEmailConfig(env);
  const userId = context.destinationKey.startsWith("email:")
    ? context.destinationKey.slice(6)
    : "";
  if (
    !userId ||
    typeof context.payload !== "object" ||
    context.payload === null ||
    Array.isArray(context.payload) ||
    context.payload.version !== 1
  )
    throw new Error("Invalid email delivery job.");
  const user = await store.user.findUnique({
    where: { id: userId },
    select: { email: true, isActive: true },
  });
  if (!user?.isActive || !validEmailAddress(user.email))
    throw new Error(
      "Email recipient is inactive or has no valid email address.",
    );
  let category = "test";
  let href: string | null = "/settings/email";
  if (context.notificationId) {
    const notification = await store.notification.findUnique({
      where: { id: context.notificationId },
      select: { recipientUserId: true, category: true, href: true },
    });
    if (
      !notification ||
      notification.recipientUserId !== userId ||
      !EMAIL_CATEGORIES.includes(
        notification.category as (typeof EMAIL_CATEGORIES)[number],
      )
    )
      throw new Error(
        "Email notification is missing or does not belong to the recipient.",
      );
    const preference = await store.notificationPreference.findUnique({
      where: { userId_category: { userId, category: notification.category } },
      select: { emailEnabled: true },
    });
    if (!preference?.emailEnabled)
      throw new Error(
        "Email delivery is disabled for this notification category.",
      );
    category = notification.category;
    href = notification.href;
  } else if (
    context.sourceType !== "email_test" ||
    !context.sourceId.startsWith(`${userId}:`)
  )
    throw new Error("Invalid test-email delivery job.");
  const messageId = `<${createHash("sha256").update(context.idempotencyKey).digest("hex")}@mtg-archives.local>`;
  // sendSmtpEmail sanitizes transport failures before the shared queue stores them.
  await send(config, {
    ...buildNotificationEmail(config.appUrl, category, href),
    to: user.email,
    messageId,
  });
}
