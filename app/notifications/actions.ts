"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { safeNotificationHref } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

function revalidateNotificationSurfaces() {
  revalidatePath("/", "layout");
  revalidatePath("/notifications");
}

export async function markNotificationRead(formData: FormData) {
  const user = await requireLogin();
  const notificationId = String(formData.get("notificationId") || "");
  if (!notificationId) return;

  await prisma.notification.updateMany({
    where: {
      id: notificationId,
      recipientUserId: user.id,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  revalidateNotificationSurfaces();
}

export async function markAllNotificationsRead() {
  const user = await requireLogin();
  await prisma.notification.updateMany({
    where: { recipientUserId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidateNotificationSurfaces();
}

export async function openNotification(formData: FormData) {
  const user = await requireLogin();
  const notificationId = String(formData.get("notificationId") || "");
  const notification = notificationId
    ? await prisma.notification.findFirst({
        where: { id: notificationId, recipientUserId: user.id },
        select: { id: true, href: true, readAt: true },
      })
    : null;

  if (!notification) redirect("/notifications");
  if (!notification.readAt) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });
    revalidateNotificationSurfaces();
  }
  redirect(safeNotificationHref(notification.href) ?? "/notifications");
}
