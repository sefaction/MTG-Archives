import {
  TradeWishlistStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { WISHLIST_DIGEST_NOTIFICATION_CATEGORY } from "@/lib/notification-preferences";
import { prisma } from "@/lib/prisma";

type WishlistActivityStore = Pick<
  Prisma.TransactionClient,
  "tradeWishlistNotificationActivity"
>;

type DigestStore = Pick<
  PrismaClient,
  | "$transaction"
  | "notification"
  | "notificationPreference"
  | "tradeWishlistNotificationActivity"
  | "user"
>;

export type WishlistDigestResult = {
  cutoff: Date;
  activitiesProcessed: number;
  notificationsCreated: number;
  groupsProcessed: number;
};

export async function recordTradeWishlistNotificationActivity(
  store: WishlistActivityStore,
  input: {
    actorUserId: string;
    targetOwnerPlayerId: string;
    tradeWishlistItemId: string;
    cardName: string;
    quantityAdded: number;
  },
) {
  return store.tradeWishlistNotificationActivity.create({
    data: {
      actorUserId: input.actorUserId,
      targetOwnerPlayerId: input.targetOwnerPlayerId,
      tradeWishlistItemId: input.tradeWishlistItemId,
      cardName: input.cardName.trim().slice(0, 200),
      quantityAdded: Math.max(1, Math.floor(input.quantityAdded)),
    },
  });
}

export function startOfUtcHour(value: Date) {
  const start = new Date(value);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

function digestWindowKey(value: Date) {
  return startOfUtcHour(value).toISOString();
}

function digestCopy(
  activities: Array<{
    cardName: string;
    quantityAdded: number;
    actorUser: { displayName: string; username: string };
  }>,
) {
  const cardNames = Array.from(
    new Set(activities.map((activity) => activity.cardName)),
  );
  const people = Array.from(
    new Set(
      activities.map(
        (activity) =>
          activity.actorUser.displayName || activity.actorUser.username,
      ),
    ),
  );
  const copies = activities.reduce(
    (total, activity) => total + activity.quantityAdded,
    0,
  );
  const peopleLabel =
    people.length === 1
      ? people[0]
      : `${people.slice(0, 2).join(", ")}${
          people.length > 2 ? ` and ${people.length - 2} more` : ""
        }`;
  const cardLabel =
    cardNames.length === 1
      ? cardNames[0]
      : `${cardNames.length} different cards`;
  return {
    title: `${copies} new wishlist ${copies === 1 ? "request" : "requests"}`,
    message: `${peopleLabel} wishlisted ${cardLabel} from your public inventory.`,
    cards: cardNames,
    people,
    copies,
  };
}

export async function processHourlyWishlistDigests(
  now = new Date(),
  store: DigestStore = prisma,
): Promise<WishlistDigestResult> {
  const cutoff = startOfUtcHour(now);
  const pending = await store.tradeWishlistNotificationActivity.findMany({
    where: {
      processedAt: null,
      createdAt: { lt: cutoff },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      actorUser: {
        select: { id: true, displayName: true, username: true },
      },
      tradeWishlistItem: {
        select: { status: true },
      },
    },
  });
  const groups = new Map<string, typeof pending>();
  for (const activity of pending) {
    const key = `${activity.targetOwnerPlayerId}:${digestWindowKey(
      activity.createdAt,
    )}`;
    const group = groups.get(key) ?? [];
    group.push(activity);
    groups.set(key, group);
  }

  let activitiesProcessed = 0;
  let notificationsCreated = 0;
  for (const [groupKey, activities] of groups) {
    const openActivities = activities.filter(
      (activity) =>
        activity.tradeWishlistItem.status === TradeWishlistStatus.OPEN,
    );
    await store.$transaction(async (tx) => {
      if (openActivities.length) {
        const recipients = await tx.user.findMany({
          where: {
            playerId: activities[0].targetOwnerPlayerId,
            isActive: true,
            id: {
              notIn: Array.from(
                new Set(openActivities.map((activity) => activity.actorUserId)),
              ),
            },
          },
          select: {
            id: true,
            notificationPreferences: {
              where: { category: WISHLIST_DIGEST_NOTIFICATION_CATEGORY },
              select: { inAppEnabled: true },
            },
          },
        });
        const copy = digestCopy(openActivities);
        for (const recipient of recipients) {
          if (recipient.notificationPreferences[0]?.inAppEnabled === false) {
            continue;
          }
          await createNotification(
            {
              recipientUserId: recipient.id,
              type: "wishlist.digest",
              category: WISHLIST_DIGEST_NOTIFICATION_CATEGORY,
              title: copy.title,
              message: copy.message,
              href: "/trades?view=wishlist",
              sourceType: "wishlist_digest",
              sourceId: groupKey,
              metadata: {
                activityCount: openActivities.length,
                cardNames: copy.cards,
                wishlisters: copy.people,
                quantityAdded: copy.copies,
                windowStart: digestWindowKey(activities[0].createdAt),
              },
            },
            tx,
          );
          notificationsCreated += 1;
        }
      }
      const updated = await tx.tradeWishlistNotificationActivity.updateMany({
        where: {
          id: { in: activities.map((activity) => activity.id) },
          processedAt: null,
        },
        data: { processedAt: now },
      });
      activitiesProcessed += updated.count;
    });
  }

  return {
    cutoff,
    activitiesProcessed,
    notificationsCreated,
    groupsProcessed: groups.size,
  };
}
