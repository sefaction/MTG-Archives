import type { Prisma } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { TRADE_NOTIFICATION_CATEGORY } from "@/lib/notification-preferences";

type TradeNotificationStore = Pick<
  Prisma.TransactionClient,
  | "notification"
  | "notificationDeliveryJob"
  | "notificationPreference"
  | "tradeEvent"
  | "user"
>;

export type RecordTradeEventInput = {
  tradeId: string;
  eventType: string;
  actorUserId?: string | null;
  actorPlayerId?: string | null;
  message?: string | null;
  metadata?: Prisma.InputJsonValue;
  notification?: {
    type: string;
    title: string;
    message?: string | null;
    recipientPlayerIds: string[];
  };
};

export async function recordTradeEvent(
  store: TradeNotificationStore,
  input: RecordTradeEventInput,
) {
  const event = await store.tradeEvent.create({
    data: {
      tradeId: input.tradeId,
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      actorPlayerId: input.actorPlayerId,
      message: input.message,
      metadataJson: input.metadata,
    },
  });
  const recipientPlayerIds = Array.from(
    new Set(input.notification?.recipientPlayerIds.filter(Boolean) ?? []),
  );
  if (!input.notification || !recipientPlayerIds.length) return event;

  const recipients = await store.user.findMany({
    where: {
      playerId: { in: recipientPlayerIds },
      isActive: true,
      ...(input.actorUserId ? { id: { not: input.actorUserId } } : {}),
    },
    select: {
      id: true,
      notificationPreferences: {
        where: { category: TRADE_NOTIFICATION_CATEGORY },
        select: { inAppEnabled: true },
      },
    },
  });

  for (const recipient of recipients) {
    if (recipient.notificationPreferences[0]?.inAppEnabled === false) continue;
    await createNotification(
      {
        recipientUserId: recipient.id,
        actorUserId: input.actorUserId,
        type: input.notification.type,
        category: TRADE_NOTIFICATION_CATEGORY,
        title: input.notification.title,
        message: input.notification.message,
        href: "/trades?view=active",
        sourceType: "trade_event",
        sourceId: event.id,
        metadata: {
          tradeId: input.tradeId,
          eventType: input.eventType,
        },
      },
      store,
    );
  }
  return event;
}
