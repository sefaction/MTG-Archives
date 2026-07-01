export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { requireAdminMode } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  enqueuePricingRefreshJob,
  listPricingWorkerStatus,
} from "@/lib/pricing-worker-store";

async function enqueueRefreshJob() {
  "use server";
  const user = await requireAdminMode();
  await enqueuePricingRefreshJob(user.username);
  revalidatePath("/admin/prices");
}

function dateLabel(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "IDLE" || status === "SUCCEEDED" || status === "ACKNOWLEDGED"
      ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
      : status === "RUNNING" || status === "QUEUED"
        ? "border-sky-700/60 bg-sky-950/40 text-sky-200"
        : status === "FAILED" || status === "ERROR"
          ? "border-red-700/60 bg-red-950/40 text-red-200"
          : "border-zinc-700 bg-zinc-900 text-zinc-200";
  return (
    <span
      className={`rounded border px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      {status}
    </span>
  );
}

export default async function AdminPricesPage() {
  await requireAdminMode();
  const status = await listPricingWorkerStatus();

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-4 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Pricing worker</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Separate pricing database control plane. Inventory pages still use
              lightweight stored Scryfall prices until import processing is
              enabled.
            </p>
          </div>
          <form action={enqueueRefreshJob}>
            <SubmitButton
              pendingLabel="Queueing..."
              className="rounded border border-sky-700 px-3 py-2 text-sm text-sky-100 hover:bg-sky-950"
              confirmMessage="Queue a pricing metadata refresh job?"
            >
              Queue refresh job
            </SubmitButton>
          </form>
        </div>

        {!status.available ? (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">
            Pricing database is unavailable: {status.error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="text-lg font-semibold">Worker heartbeat</h2>
          <div className="mt-3 space-y-2 text-sm">
            {status.heartbeats.length ? (
              status.heartbeats.map((heartbeat) => (
                <div
                  key={heartbeat.worker_id}
                  className="rounded border border-zinc-800 bg-zinc-900/70 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-zinc-400">
                      {heartbeat.worker_id}
                    </span>
                    <StatusPill status={heartbeat.status} />
                  </div>
                  <p className="mt-2 text-zinc-300">
                    {heartbeat.message || "No message"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Last seen {dateLabel(heartbeat.last_seen_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-zinc-500">
                No worker heartbeat has been recorded.
              </p>
            )}
          </div>
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="text-lg font-semibold">Recent jobs</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Snapshots</th>
                  <th className="py-2 pr-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {status.jobs.map((job) => (
                  <tr key={job.id} className="border-t border-zinc-800">
                    <td className="py-2 pr-3">{job.type}</td>
                    <td className="py-2 pr-3">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">
                      {job.processed_count} / {job.inserted_count}
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">
                      {dateLabel(job.created_at)}
                    </td>
                  </tr>
                ))}
                {!status.jobs.length ? (
                  <tr>
                    <td className="py-3 text-zinc-500" colSpan={4}>
                      No pricing jobs have been queued.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="text-lg font-semibold">Recent runs</h2>
          <div className="mt-3 space-y-2 text-sm">
            {status.runs.map((run) => (
              <div key={run.id} className="rounded border border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-zinc-500">
                    {run.id.slice(0, 8)}
                  </span>
                  <StatusPill status={run.status} />
                </div>
                <p className="mt-2 text-zinc-300">
                  {run.message || run.error || "--"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Started {dateLabel(run.started_at)}
                </p>
              </div>
            ))}
            {!status.runs.length ? (
              <p className="text-sm text-zinc-500">No worker runs recorded.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="text-lg font-semibold">Worker logs</h2>
          <div className="mt-3 max-h-96 space-y-2 overflow-auto text-sm">
            {status.logs.map((log) => (
              <div key={log.id} className="rounded border border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase text-zinc-500">{log.level}</span>
                  <span className="text-xs text-zinc-500">
                    {dateLabel(log.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-zinc-300">{log.message}</p>
              </div>
            ))}
            {!status.logs.length ? (
              <p className="text-sm text-zinc-500">No worker logs recorded.</p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
