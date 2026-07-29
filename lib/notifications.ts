import type { Prisma } from "@prisma/client";
import { enqueueNotificationDelivery } from "@/lib/notification-delivery";
import { prisma } from "@/lib/prisma";
import { enqueueWebhookDeliveriesForNotification } from "@/lib/webhook-delivery";

const MAX_TITLE_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 800;

type NotificationStore = Pick<
  Prisma.TransactionClient,
  "notification" | "notificationDeliveryJob"
> &
  Partial<
    Pick<
      Prisma.TransactionClient,
      "notificationPreference" | "notificationWebhookEndpoint"
    >
  >;

export type NotificationDeliveryTarget = {
  transport: string;
  destinationKey: string;
  payload?: Prisma.InputJsonValue;
  maxAttempts?: number;
};

export type CreateNotificationInput = {
  recipientUserId: string;
  actorUserId?: string | null;
  type: string;
  category: string;
  title: string;
  message?: string | null;
  href?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
  deliveries?: NotificationDeliveryTarget[];
};

function requiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized.slice(0, maxLength);
}

function optionalText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function safeNotificationHref(value: string | null | undefined) {
  const href = optionalText(value, 500);
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  return href;
}

export async function createNotification(
  input: CreateNotificationInput,
  store: NotificationStore = prisma,
) {
  const sourceType = optionalText(input.sourceType, 80);
  const sourceId = optionalText(input.sourceId, 160);
  const data = {
    recipientUserId: requiredText(
      input.recipientUserId,
      "Notification recipient",
      160,
    ),
    actorUserId: optionalText(input.actorUserId, 160),
    type: requiredText(input.type, "Notification type", 100),
    category: requiredText(input.category, "Notification category", 100),
    title: requiredText(input.title, "Notification title", MAX_TITLE_LENGTH),
    message: optionalText(input.message, MAX_MESSAGE_LENGTH),
    href: safeNotificationHref(input.href),
    sourceType,
    sourceId,
    metadataJson: input.metadata,
  };

  const notification =
    sourceType && sourceId
      ? await store.notification.upsert({
          where: {
            recipientUserId_sourceType_sourceId: {
              recipientUserId: data.recipientUserId,
              sourceType,
              sourceId,
            },
          },
          update: {},
          create: data,
        })
      : await store.notification.create({ data });

  for (const delivery of input.deliveries ?? []) {
    await enqueueNotificationDelivery(
      {
        notificationId: notification.id,
        transport: delivery.transport,
        destinationKey: delivery.destinationKey,
        maxAttempts: delivery.maxAttempts,
        payload:
          delivery.payload ??
          ({
            notificationId: notification.id,
            recipientUserId: data.recipientUserId,
            type: data.type,
            category: data.category,
            title: data.title,
            message: data.message,
            href: data.href,
            metadata: data.metadataJson ?? null,
          } satisfies Prisma.InputJsonObject),
      },
      store,
    );
  }
  if (store.notificationPreference && store.notificationWebhookEndpoint) {
    await enqueueWebhookDeliveriesForNotification(
      notification,
      store as Parameters<typeof enqueueWebhookDeliveriesForNotification>[1],
    );
  }
  return notification;
}

export async function getUnreadNotificationCount(recipientUserId: string) {
  return prisma.notification.count({
    where: { recipientUserId, readAt: null },
  });
}

export async function listNotifications(recipientUserId: string, limit = 100) {
  return prisma.notification.findMany({
    where: { recipientUserId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      actorUser: {
        select: { id: true, displayName: true, username: true },
      },
    },
  });
}
