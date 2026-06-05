"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ProgressBar } from "./feedback/ProgressBar";

export type ImportProgressSnapshot = {
  total: number;
  processed: number;
  matched: number;
  needsReview: number;
  skipped: number;
  failed: number;
  percent: number;
  terminal: boolean;
  statusLabel: string;
};

export function ImportProgressPanel({
  batchId,
  initialProgress,
}: {
  batchId: string;
  initialProgress: ImportProgressSnapshot;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [failures, setFailures] = useState(0);
  const shouldPoll = useMemo(() => !progress.terminal, [progress.terminal]);

  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/imports/${batchId}/progress`, {
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(`Progress request failed: ${response.status}`);
        const data = await response.json();
        if (!cancelled && data.success && data.progress) {
          setProgress(data.progress);
          setFailures(0);
          router.refresh();
        }
      } catch {
        if (!cancelled) setFailures((value) => value + 1);
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [batchId, router, shouldPoll]);

  return (
    <section
      className="rounded border border-sky-900 bg-sky-950/20 p-4 space-y-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Card identification progress</h3>
        <span className="text-sm text-zinc-300">{progress.statusLabel}</span>
      </div>
      <ProgressBar
        value={progress.processed}
        max={progress.total}
        label={progress.statusLabel}
      />
      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
        <div>
          <span className="text-zinc-400">Processed</span>
          <div className="font-semibold">
            {progress.processed} / {progress.total}
          </div>
        </div>
        <div>
          <span className="text-zinc-400">Matched</span>
          <div className="font-semibold text-emerald-200">
            {progress.matched}
          </div>
        </div>
        <div>
          <span className="text-zinc-400">Needs review</span>
          <div className="font-semibold text-amber-200">
            {progress.needsReview}
          </div>
        </div>
        <div>
          <span className="text-zinc-400">Skipped</span>
          <div className="font-semibold">{progress.skipped}</div>
        </div>
        <div>
          <span className="text-zinc-400">Failed</span>
          <div className="font-semibold text-red-200">{progress.failed}</div>
        </div>
      </div>
      {failures >= 2 ? (
        <p className="text-sm text-amber-200">
          Progress updates are having trouble connecting. This panel will keep
          retrying.
        </p>
      ) : null}
      {progress.terminal ? (
        <p className="text-sm text-emerald-200">
          Identification reached a terminal state. Counts are based on saved
          import rows.
        </p>
      ) : null}
    </section>
  );
}
