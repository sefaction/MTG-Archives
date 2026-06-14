"use client";

import { useEffect, useState } from "react";

type Job = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  heartbeatAt?: string | null;
  progressJson?: any;
  resultJson?: any;
  errorMessage?: string | null;
  requestedBy?: { displayName?: string | null; username?: string | null } | null;
};

type WorkerStatus = {
  online: boolean;
  heartbeats: Array<{
    workerId: string;
    lastSeenAt: string;
    startedAt?: string | null;
    hostname?: string | null;
  }>;
};

function jobLabel(type: string) {
  if (type === "map_mtgjson_cards") return "Map MTGJSON card UUIDs";
  if (type === "import_prices_today") return "Import today's prices";
  if (type === "import_prices_history") return "Backfill price history";
  return type;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function summarizeJson(value: any) {
  if (!value || typeof value !== "object") return "—";
  const keys = [
    "phase",
    "totalMtgjsonCards",
    "matchedLocalCards",
    "snapshotsParsed",
    "snapshotsInserted",
    "duplicatesSkipped",
    "localCardsMappedThisRun",
    "ambiguousLocalCards",
    "unmatchedLocalCards",
  ];
  const parts = keys
    .filter((key) => value[key] !== undefined && value[key] !== null)
    .map((key) => `${key}: ${value[key]}`);
  return parts.length ? parts.join(" · ") : JSON.stringify(value);
}

function isStaleHeartbeat(value?: string | null) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() > 2 * 60 * 1000;
}

export function PriceImportJobsPanel({
  initialJobs,
  initialWorker,
}: {
  initialJobs: Job[];
  initialWorker: WorkerStatus;
}) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [worker, setWorker] = useState<WorkerStatus>(initialWorker);
  const hasActive = jobs.some((job) => ["queued", "running"].includes(job.status));
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(async () => {
      const response = await fetch("/api/admin/prices/jobs", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      if (Array.isArray(payload.jobs)) setJobs(payload.jobs);
      if (payload.worker) setWorker(payload.worker);
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActive]);

  return (
    <section className="space-y-3 rounded border border-zinc-800 p-4">
      <h2 className="text-xl font-semibold">Recent price jobs</h2>
      {hasActive ? (
        worker.online ? (
          <p className="text-sm text-emerald-200">
            Price worker online. Jobs should move from queued to running shortly.
          </p>
        ) : (
          <p className="text-sm text-amber-200">
            Jobs are queued, but no price worker heartbeat is currently fresh.
            Start the price-worker service in Docker/Portainer.
          </p>
        )
      ) : null}
      {jobs.length ? (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded border border-zinc-800 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{jobLabel(job.type)}</p>
                <span className="rounded bg-zinc-900 px-2 py-1 text-xs uppercase tracking-wide">
                  {job.status}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Requested {formatDate(job.createdAt)} by {job.requestedBy?.displayName || job.requestedBy?.username || "—"}
              </p>
              <p className="text-xs text-zinc-400">
                Started {formatDate(job.startedAt)} · Finished {formatDate(job.finishedAt)} · Last update {formatDate(job.heartbeatAt)}
              </p>
              <p className="mt-2 text-xs text-zinc-300">Progress: {summarizeJson(job.progressJson)}</p>
              <p className="text-xs text-zinc-300">Result: {summarizeJson(job.resultJson)}</p>
              {job.status === "running" && isStaleHeartbeat(job.heartbeatAt) ? (
                <p className="text-xs text-amber-200">
                  This job appears stalled. The job heartbeat is stale.
                </p>
              ) : null}
              {job.errorMessage ? <p className="text-xs text-red-300">Error: {job.errorMessage}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No price import jobs have been queued yet.</p>
      )}
    </section>
  );
}
