export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { NotificationDeliveryStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { requireAdminMode } from "@/lib/auth";
import { getNotificationDeliveryHealth } from "@/lib/notification-delivery";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

async function queueDiagnostic(formData: FormData) {
  "use server";
  const user = await requireAdminMode();
  const mode = formData.get("mode") === "fail" ? "fail" : "success";
  const sourceId = `diagnostic:${randomUUID()}`;
  const notification = await prisma.$transaction((tx) =>
    createNotification(
      {
        recipientUserId: user.id,
        type: "system.delivery_diagnostic",
        category: "system",
        title:
          mode === "fail"
            ? "Failure delivery diagnostic queued"
            : "Delivery diagnostic queued",
        message:
          mode === "fail"
            ? "This local diagnostic intentionally fails to demonstrate retry and failure visibility."
            : "This local diagnostic confirms that the asynchronous delivery queue is processing jobs.",
        href: "/admin/notifications",
        sourceType: "delivery_diagnostic",
        sourceId,
        deliveries: [
          {
            transport: "diagnostic",
            destinationKey: `admin:${user.id}`,
            payload: { mode, sourceId },
          },
        ],
      },
      tx,
    ),
  );
  revalidatePath("/admin/notifications");
  revalidatePath("/notifications");
  redirect(
    `/admin/notifications?queued=${encodeURIComponent(notification.id)}`,
  );
}

async function retryDelivery(formData: FormData) {
  "use server";
  await requireAdminMode();
  const jobId = String(formData.get("jobId") || "");
  const job = await prisma.notificationDeliveryJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, attemptCount: true, maxAttempts: true },
  });
  if (!job || job.status !== NotificationDeliveryStatus.FAILED) {
    redirect("/admin/notifications?error=Delivery+job+is+not+retryable");
  }
  await prisma.notificationDeliveryJob.update({
    where: { id: job.id },
    data: {
      status: NotificationDeliveryStatus.PENDING,
      nextAttemptAt: new Date(),
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      maxAttempts: Math.max(job.maxAttempts, job.attemptCount + 1),
    },
  });
  revalidatePath("/admin/notifications");
  redirect(`/admin/notifications?retried=${encodeURIComponent(job.id)}`);
}

function dateLabel(value: Date | null) {
  return value ? value.toLocaleString() : "—";
}

function StatusPill({ status }: { status: NotificationDeliveryStatus }) {
  const tone =
    status === NotificationDeliveryStatus.SENT
      ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
      : status === NotificationDeliveryStatus.SENDING
        ? "border-sky-700/60 bg-sky-950/40 text-sky-200"
        : status === NotificationDeliveryStatus.FAILED
          ? "border-red-700/60 bg-red-950/40 text-red-200"
          : "border-amber-700/60 bg-amber-950/40 text-amber-200";
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {status}
    </span>
  );
}

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminMode();
  const params = await searchParams;
  const health = await getNotificationDeliveryHealth();

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
            System console
          </p>
          <h1 className="text-3xl font-bold text-stone-50">
            Notification delivery
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-stone-400">
            Transport-neutral outbound jobs run independently from web requests.
            Claims expire safely, failures retain every attempt, and local
            notifications continue working if this worker is stopped.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/admin"
            className="rounded border border-stone-700 px-3 py-2 text-sm text-stone-200 hover:bg-stone-900"
          >
            Back to admin
          </a>
          <a
            href="/admin/notifications"
            className="rounded border border-cyan-800 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40"
          >
            Refresh
          </a>
        </div>
      </header>

      {params.queued ? (
        <p className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm text-sky-100">
          Diagnostic queued. The notification worker will claim it on its next
          poll.
        </p>
      ) : null}
      {params.retried ? (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
          Failed delivery released back to the queue.
        </p>
      ) : null}
      {params.error ? (
        <p className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
          {params.error}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.values(NotificationDeliveryStatus).map((status) => (
          <div
            key={status}
            className="rounded-lg border border-[#2a332d] bg-[#101614] p-4"
          >
            <p className="text-xs uppercase tracking-wide text-stone-500">
              {status}
            </p>
            <p className="mt-1 text-2xl font-semibold text-stone-50">
              {health.byStatus[status].toLocaleString()}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-[#2a332d] bg-[#101614]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2a332d] p-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-100">
              Queue diagnostics
            </h2>
            <p className="text-sm text-stone-400">
              These local-only jobs exercise success and bounded retry paths
              without contacting an external service.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={queueDiagnostic}>
              <input type="hidden" name="mode" value="success" />
              <SubmitButton
                pendingLabel="Queueing…"
                className="rounded border border-emerald-700 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-950/40"
              >
                Queue success test
              </SubmitButton>
            </form>
            <form action={queueDiagnostic}>
              <input type="hidden" name="mode" value="fail" />
              <SubmitButton
                pendingLabel="Queueing…"
                className="rounded border border-red-800 px-3 py-2 text-sm text-red-100 hover:bg-red-950/40"
                confirmMessage="Queue an intentional failure to review retry visibility?"
              >
                Queue failure test
              </SubmitButton>
            </form>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#2a332d] bg-[#101614]">
        <div className="border-b border-[#2a332d] p-4">
          <h2 className="text-lg font-semibold text-stone-100">Recent jobs</h2>
          <p className="text-sm text-stone-400">
            Destination keys are identifiers only; secrets and credentials do
            not belong in this queue.
          </p>
        </div>
        {health.recentJobs.length ? (
          <div className="divide-y divide-[#2a332d]">
            {health.recentJobs.map((job) => (
              <article key={job.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={job.status} />
                      <span className="font-medium text-stone-100">
                        {job.notification.title}
                      </span>
                      <span className="rounded border border-stone-700 px-2 py-0.5 text-xs text-stone-400">
                        {job.transport}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      {job.notification.recipientUser.displayName ||
                        job.notification.recipientUser.username}{" "}
                      · {job.destinationKey} · {job.attemptCount}/
                      {job.maxAttempts} attempts
                    </p>
                  </div>
                  {job.status === NotificationDeliveryStatus.FAILED ? (
                    <form action={retryDelivery}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <SubmitButton
                        pendingLabel="Releasing…"
                        className="rounded border border-amber-800 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-950/40"
                      >
                        Retry now
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
                <dl className="grid gap-2 text-xs text-stone-400 md:grid-cols-4">
                  <div>
                    <dt className="text-stone-600">Created</dt>
                    <dd>{dateLabel(job.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-600">Next attempt</dt>
                    <dd>{dateLabel(job.nextAttemptAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-600">Lease expires</dt>
                    <dd>{dateLabel(job.claimExpiresAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-600">Sent</dt>
                    <dd>{dateLabel(job.sentAt)}</dd>
                  </div>
                </dl>
                {job.lastError ? (
                  <p className="rounded border border-red-950 bg-red-950/20 p-2 text-xs text-red-200">
                    {job.lastError}
                  </p>
                ) : null}
                {job.attempts.length ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-stone-400">
                      Recent attempt history
                    </summary>
                    <ul className="mt-2 space-y-1 text-stone-500">
                      {job.attempts.map((attempt) => (
                        <li key={attempt.id}>
                          #{attempt.attemptNumber} {attempt.status} ·{" "}
                          {dateLabel(attempt.finishedAt)}
                          {attempt.errorMessage
                            ? ` · ${attempt.errorMessage}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm text-stone-500">
            No outbound delivery jobs have been queued.
          </p>
        )}
      </section>
    </main>
  );
}
