export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminMode } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { PricingDashboardAutoRefresh } from "@/components/admin/PricingDashboardAutoRefresh";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { prisma } from "@/lib/prisma";
import {
  enqueuePricingRefreshJob,
  listPricingWorkerStatus,
} from "@/lib/pricing-worker-store";

async function enqueueRefreshJob() {
  "use server";
  const user = await requireAdminMode();
  let jobId: string;
  try {
    jobId = await enqueuePricingRefreshJob(user.username);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to queue pricing job.";
    redirect(`/admin/prices?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/admin/prices");
  redirect(`/admin/prices?queued=${encodeURIComponent(jobId)}`);
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

function numberLabel(value: number | bigint | null | undefined) {
  if (value == null) return "0";
  return Number(value).toLocaleString();
}

async function getCurrentPriceProjectionStats() {
  const [row] = await prisma.$queryRaw<
    Array<{
      projected_count: bigint;
      eligible_count: bigint;
      latest_projected_at: Date | null;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE prices ? 'mtgjson') AS projected_count,
      COUNT(*) FILTER (WHERE "mtgjsonUuid" IS NOT NULL) AS eligible_count,
      MAX("priceLastFetchedAt") FILTER (WHERE prices ? 'mtgjson') AS latest_projected_at
    FROM "Card"
  `;
  return {
    projectedCount: row?.projected_count ?? 0n,
    eligibleCount: row?.eligible_count ?? 0n,
    latestProjectedAt: row?.latest_projected_at ?? null,
  };
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-zinc-100">{value}</div>
      {detail ? (
        <div className="mt-1 text-xs text-zinc-500">{detail}</div>
      ) : null}
    </div>
  );
}

export default async function AdminPricesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminMode();
  const params = await searchParams;
  const [status, projection] = await Promise.all([
    listPricingWorkerStatus(),
    getCurrentPriceProjectionStats(),
  ]);
  const errorLogs = status.logs.filter((log) => log.level === "ERROR");
  const autoRefresh =
    Boolean(params.queued) ||
    status.stats.activeJobCount > 0 ||
    status.jobs.some(
      (job) => job.status === "QUEUED" || job.status === "RUNNING",
    );

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-4 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Pricing worker</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Separate pricing database control plane. Inventory pages read the
              latest projected card price from the main app database and keep
              historical pricing out of page-load queries.
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
        {params.queued ? (
          <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-100">
            Pricing refresh queued. Job ID:{" "}
            <span className="font-mono">{params.queued}</span>
          </div>
        ) : null}
        {params.error ? (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
            Pricing refresh could not be queued: {params.error}
          </div>
        ) : null}
        <PricingDashboardAutoRefresh enabled={autoRefresh} />
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current price coverage"
          value={`${numberLabel(projection.projectedCount)} / ${numberLabel(
            projection.eligibleCount,
          )}`}
          detail={`Last projected ${dateLabel(
            projection.latestProjectedAt?.toISOString() ?? null,
          )}`}
        />
        <StatCard
          label="Historical snapshots"
          value={numberLabel(status.stats.snapshotCount)}
          detail={`${numberLabel(status.stats.pricedCardCount)} priced cards`}
        />
        <StatCard
          label="Latest observed price"
          value={dateLabel(status.stats.latestObservedDate)}
          detail={`Ingested ${dateLabel(status.stats.latestIngestedAt)}`}
        />
        <StatCard
          label="Job queue"
          value={`${numberLabel(status.stats.activeJobCount)} active`}
          detail={`${numberLabel(status.stats.failedJobCount)} failed jobs`}
        />
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
                  <th className="py-2 pr-3">Progress</th>
                  <th className="py-2 pr-3">Timing</th>
                </tr>
              </thead>
              <tbody>
                {status.jobs.map((job) => (
                  <tr key={job.id} className="border-t border-zinc-800">
                    <td className="py-2 pr-3 align-top">
                      <div>{job.type}</div>
                      <div className="mt-1 font-mono text-xs text-zinc-500">
                        {job.id.slice(0, 8)}
                      </div>
                      {job.requested_by ? (
                        <div className="mt-1 text-xs text-zinc-500">
                          Requested by {job.requested_by}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusPill status={job.status} />
                      {job.status === "QUEUED" || job.status === "RUNNING" ? (
                        <div className="mt-2 text-xs text-sky-300">
                          {job.status === "QUEUED"
                            ? "Waiting for worker pickup"
                            : "Worker is processing this job"}
                        </div>
                      ) : null}
                      {job.error ? (
                        <details className="mt-2 max-w-sm text-xs text-red-200">
                          <summary className="cursor-pointer text-red-300">
                            Error
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded border border-red-900/70 bg-red-950/30 p-2">
                            {job.error}
                          </pre>
                        </details>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">
                      <div>{numberLabel(job.processed_count)} processed</div>
                      <div className="text-xs text-zinc-500">
                        {numberLabel(job.inserted_count)} inserted /{" "}
                        {numberLabel(job.skipped_count)} skipped
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">
                      <div>Created {dateLabel(job.created_at)}</div>
                      <div className="text-xs text-zinc-500">
                        Started {dateLabel(job.started_at)}
                      </div>
                      <div className="text-xs text-zinc-500">
                        Finished {dateLabel(job.finished_at)}
                      </div>
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
          <h2 className="text-lg font-semibold">Worker error log</h2>
          <div className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">
            {errorLogs.map((log) => (
              <div
                key={log.id}
                className="rounded border border-red-900/70 bg-red-950/20 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase text-red-300">{log.level}</span>
                  <span className="text-xs text-zinc-500">
                    {dateLabel(log.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-red-100">{log.message}</p>
              </div>
            ))}
            {!errorLogs.length ? (
              <p className="text-sm text-zinc-500">
                No worker errors have been recorded.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-950/60 p-4">
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
      </section>
    </main>
  );
}
