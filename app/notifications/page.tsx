export const dynamic = "force-dynamic";

import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { requireLogin } from "@/lib/auth";
import {
  getUnreadNotificationCount,
  listNotifications,
} from "@/lib/notifications";
import {
  markAllNotificationsRead,
  markNotificationRead,
  openNotification,
} from "./actions";

function categoryLabel(category: string) {
  return category.replaceAll("_", " ");
}

export default async function NotificationsPage() {
  const user = await requireLogin();
  const [notifications, unreadCount] = await Promise.all([
    listNotifications(user.id),
    getUnreadNotificationCount(user.id),
  ]);

  return (
    <main className="space-y-6 p-4 sm:p-8">
      <Nav />

      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="app-muted mt-1 text-sm">
            Quiet updates from trades and other collection activity.
          </p>
        </div>
        <form action={markAllNotificationsRead}>
          <SubmitButton
            pendingLabel="Marking read..."
            disabled={unreadCount === 0}
            className="rounded-md border border-cyan-800 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-100 hover:border-cyan-600"
          >
            Mark all read
          </SubmitButton>
        </form>
      </section>

      <section className="app-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border)] px-4 py-3">
          <h2 className="font-semibold">Recent activity</h2>
          <span className="app-muted text-sm">
            {unreadCount} unread · {notifications.length} recent
          </span>
        </div>

        {notifications.length ? (
          <div className="divide-y divide-[var(--app-border)]">
            {notifications.map((notification) => {
              const unread = !notification.readAt;
              return (
                <article
                  key={notification.id}
                  className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between ${
                    unread ? "bg-cyan-950/15" : ""
                  }`}
                >
                  <div className="flex min-w-0 gap-3">
                    <span
                      aria-label={unread ? "Unread" : "Read"}
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        unread ? "bg-cyan-400" : "bg-zinc-700"
                      }`}
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          className={
                            unread
                              ? "font-semibold text-cyan-50"
                              : "font-medium"
                          }
                        >
                          {notification.title}
                        </h3>
                        <span className="app-muted rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide">
                          {categoryLabel(notification.category)}
                        </span>
                      </div>
                      {notification.message ? (
                        <p className="app-muted text-sm">
                          {notification.message}
                        </p>
                      ) : null}
                      <p className="app-muted text-xs">
                        {notification.createdAt.toLocaleString()}
                        {notification.actorUser
                          ? ` · ${notification.actorUser.displayName || notification.actorUser.username}`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 pl-5 sm:pl-0">
                    {unread ? (
                      <form action={markNotificationRead}>
                        <input
                          type="hidden"
                          name="notificationId"
                          value={notification.id}
                        />
                        <SubmitButton
                          pendingLabel="Saving..."
                          minWidthClassName="min-w-0"
                          className="rounded border border-[var(--app-border)] px-2.5 py-1.5 text-xs hover:border-cyan-700 hover:text-cyan-100"
                        >
                          Mark read
                        </SubmitButton>
                      </form>
                    ) : null}
                    {notification.href ? (
                      <form action={openNotification}>
                        <input
                          type="hidden"
                          name="notificationId"
                          value={notification.id}
                        />
                        <SubmitButton
                          pendingLabel="Opening..."
                          minWidthClassName="min-w-0"
                          className="rounded border border-cyan-800 bg-cyan-950/30 px-2.5 py-1.5 text-xs text-cyan-100 hover:border-cyan-600"
                        >
                          Open
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <p className="font-medium">You are all caught up.</p>
            <p className="app-muted mt-1 text-sm">
              New trade activity will appear here as notification coverage is
              enabled.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
