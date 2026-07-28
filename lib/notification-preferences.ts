import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const TRADE_NOTIFICATION_CATEGORY = "trades";
export const WISHLIST_DIGEST_NOTIFICATION_CATEGORY = "wishlist_digest";

export const LOCAL_NOTIFICATION_CATEGORIES = [
  TRADE_NOTIFICATION_CATEGORY,
  WISHLIST_DIGEST_NOTIFICATION_CATEGORY,
] as const;

type PreferenceStore = Pick<Prisma.TransactionClient, "notificationPreference">;

export async function notificationCategoryEnabled(
  userId: string,
  category: string,
  store: PreferenceStore = prisma,
) {
  const preference = await store.notificationPreference.findUnique({
    where: { userId_category: { userId, category } },
    select: { inAppEnabled: true },
  });
  return preference?.inAppEnabled ?? true;
}

export async function getLocalNotificationPreferences(userId: string) {
  const preferences = await prisma.notificationPreference.findMany({
    where: {
      userId,
      category: { in: [...LOCAL_NOTIFICATION_CATEGORIES] },
    },
    select: { category: true, inAppEnabled: true },
  });
  const byCategory = new Map(
    preferences.map((preference) => [
      preference.category,
      preference.inAppEnabled,
    ]),
  );
  return {
    trades: byCategory.get(TRADE_NOTIFICATION_CATEGORY) ?? true,
    wishlistDigest:
      byCategory.get(WISHLIST_DIGEST_NOTIFICATION_CATEGORY) ?? true,
  };
}

export async function setLocalNotificationPreferences(
  userId: string,
  input: { trades: boolean; wishlistDigest: boolean },
  store: PreferenceStore = prisma,
) {
  const values = [
    {
      category: TRADE_NOTIFICATION_CATEGORY,
      inAppEnabled: input.trades,
    },
    {
      category: WISHLIST_DIGEST_NOTIFICATION_CATEGORY,
      inAppEnabled: input.wishlistDigest,
    },
  ];
  await Promise.all(
    values.map((value) =>
      store.notificationPreference.upsert({
        where: { userId_category: { userId, category: value.category } },
        update: { inAppEnabled: value.inAppEnabled },
        create: {
          userId,
          category: value.category,
          inAppEnabled: value.inAppEnabled,
        },
      }),
    ),
  );
}
