"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function PricingDashboardAutoRefresh({
  enabled,
  intervalMs = 5000,
}: {
  enabled: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!enabled || paused) return;
    const timer = window.setInterval(() => {
      // Refresh server health without discarding on-demand totals, focus or
      // open disclosures. A full document reload aborts the history request.
      if (new URL(window.location.href).searchParams.has("queued"))
        router.replace("/admin/prices", { scroll: false });
      else router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, paused, intervalMs, router]);

  if (!enabled) return null;
  return (
    <div className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm text-sky-100">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={!paused}
          onChange={(event) => setPaused(!event.target.checked)}
        />
        Update worker health automatically while jobs are active
      </label>
    </div>
  );
}
