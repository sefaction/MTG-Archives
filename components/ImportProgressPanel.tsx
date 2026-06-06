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

type ResolutionJobSnapshot = {
  id: string;
  status: string;
  eligibleRowsAtStart: number;
  processedRows: number;
  resolvedRows: number;
  cacheHitRows: number;
  scryfallMatchRows: number;
  manualReviewRows: number;
  notFoundRows: number;
  transientErrorRows: number;
  failedRows: number;
  scryfallRequestsMade: number;
  scryfallRateLimitWaits: number;
  currentChunk: number;
  currentMessage: string | null;
  lastHeartbeatAt: string | null;
  terminal: boolean;
  percent: number;
};

export function ImportProgressPanel({
  batchId,
  initialProgress,
  initialResolutionJob,
  pollIntervalMs = 1500,
}: {
  batchId: string;
  initialProgress: ImportProgressSnapshot;
  initialResolutionJob?: ResolutionJobSnapshot | null;
  pollIntervalMs?: number;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [resolutionJob, setResolutionJob] = useState(
    initialResolutionJob ?? null,
  );
  const [failures, setFailures] = useState(0);
  const shouldPoll = useMemo(
    () =>
      !progress.terminal || Boolean(resolutionJob && !resolutionJob.terminal),
    [progress.terminal, resolutionJob],
  );

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
          setResolutionJob(data.resolutionJob ?? null);
          setFailures(0);
          router.refresh();
        }
      } catch {
        if (!cancelled) setFailures((value) => value + 1);
      }
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [batchId, pollIntervalMs, router, shouldPoll]);

  const activeResolution = resolutionJob && !resolutionJob.terminal;
  const progressMax = resolutionJob?.eligibleRowsAtStart || progress.total;
  const progressValue = resolutionJob?.processedRows ?? progress.processed;
  const statusLabel = resolutionJob
    ? `${resolutionJob.status}: ${resolutionJob.currentMessage ?? "Resolution job status updated."}`
    : progress.statusLabel;

  return (
    <section
      className="rounded border border-sky-900 bg-sky-950/20 p-4 space-y-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Card identification progress</h3>
        <span className="text-sm text-zinc-300">{statusLabel}</span>
      </div>
      <ProgressBar
        value={progressValue}
        max={progressMax}
        label={statusLabel}
      />
      {resolutionJob ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            <div>
              <span className="text-zinc-400">Processed</span>
              <div className="font-semibold">
                {resolutionJob.processedRows} /{" "}
                {resolutionJob.eligibleRowsAtStart}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">Resolved</span>
              <div className="font-semibold text-emerald-200">
                {resolutionJob.resolvedRows}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">Cache hits</span>
              <div className="font-semibold">{resolutionJob.cacheHitRows}</div>
            </div>
            <div>
              <span className="text-zinc-400">Scryfall matches</span>
              <div className="font-semibold">
                {resolutionJob.scryfallMatchRows}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">Needs review</span>
              <div className="font-semibold text-amber-200">
                {resolutionJob.manualReviewRows}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">Not found</span>
              <div className="font-semibold text-red-200">
                {resolutionJob.notFoundRows}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">Failures</span>
              <div className="font-semibold text-red-200">
                {resolutionJob.failedRows + resolutionJob.transientErrorRows}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">Chunk</span>
              <div className="font-semibold">{resolutionJob.currentChunk}</div>
            </div>
            <div>
              <span className="text-zinc-400">Scryfall requests</span>
              <div className="font-semibold">
                {resolutionJob.scryfallRequestsMade}
              </div>
            </div>
            <div>
              <span className="text-zinc-400">Last updated</span>
              <div className="font-semibold">
                {resolutionJob.lastHeartbeatAt
                  ? new Date(resolutionJob.lastHeartbeatAt).toLocaleTimeString()
                  : "—"}
              </div>
            </div>
          </div>
          {activeResolution ? (
            <p className="text-sm text-sky-200">
              Resolving cards… this will continue through subsequent chunks
              automatically.
            </p>
          ) : null}
        </div>
      ) : (
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
      )}
      {failures >= 2 ? (
        <p className="text-sm text-amber-200">
          Progress updates are having trouble connecting. This panel will keep
          retrying.
        </p>
      ) : null}
      {resolutionJob?.terminal ? (
        <p className="text-sm text-emerald-200">
          Resolution reached {resolutionJob.status}. Review unmatched rows or
          confirm the import when ready.
        </p>
      ) : progress.terminal ? (
        <p className="text-sm text-emerald-200">
          Identification reached a terminal state. Counts are based on saved
          import rows.
        </p>
      ) : null}
    </section>
  );
}
