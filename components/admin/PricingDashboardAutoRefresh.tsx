"use client";

import { useEffect } from "react";

export function PricingDashboardAutoRefresh({
  enabled,
  intervalMs = 5000,
}: {
  enabled: boolean;
  intervalMs?: number;
}) {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      window.location.replace("/admin/prices");
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);

  if (!enabled) return null;
  return (
    <div className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm text-sky-100">
      Refresh job activity detected. This page will update automatically while
      the worker runs.
    </div>
  );
}
