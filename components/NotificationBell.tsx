"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type NotificationBellProps = {
  appName: string;
  initialUnreadCount: number;
};

function browserTitle(appName: string, unreadCount: number) {
  return unreadCount > 0 ? `(${unreadCount}) ${appName}` : appName;
}

export function NotificationBell({
  appName,
  initialUnreadCount,
}: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  const refreshUnreadCount = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const response = await fetch("/api/notifications/summary", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { unreadCount?: number };
      if (Number.isInteger(data.unreadCount) && Number(data.unreadCount) >= 0) {
        setUnreadCount(Number(data.unreadCount));
      }
    } catch {
      // The last known count remains useful while the local server reconnects.
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.title = browserTitle(appName, unreadCount);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [appName, unreadCount]);

  useEffect(() => {
    const interval = window.setInterval(refreshUnreadCount, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshUnreadCount();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refreshUnreadCount);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refreshUnreadCount);
    };
  }, [refreshUnreadCount]);

  const displayCount = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <Link
      href="/notifications"
      aria-label={`Notifications, ${unreadCount} unread`}
      title={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
      className="relative inline-flex h-9 items-center gap-2 rounded-md border border-[#364139] px-2.5 text-stone-200 hover:border-cyan-700 hover:bg-cyan-950/20 hover:text-cyan-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
      <span className="hidden sm:inline">Notifications</span>
      {unreadCount > 0 ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[0.65rem] font-bold leading-none text-white">
          {displayCount}
        </span>
      ) : null}
    </Link>
  );
}
