export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  filterButtonClass,
  filterPrimaryButtonClass,
} from "@/components/filterStyles";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  emailConfigurationStatus,
  validEmailAddress,
} from "@/lib/email-config";
import { queueEmailTest } from "@/lib/email-delivery";
import {
  getEmailNotificationPreferences,
  getLocalNotificationPreferences,
  setEmailNotificationPreferences,
} from "@/lib/notification-preferences";

async function savePreferences(form: FormData) {
  "use server";
  const user = await requireLogin();
  await prisma.$transaction((tx) =>
    setEmailNotificationPreferences(
      user.id,
      {
        trades: form.get("emailTrades") === "on",
        wishlistDigest: form.get("emailWishlist") === "on",
      },
      tx,
    ),
  );
  revalidatePath("/settings/email");
  redirect("/settings/email?saved=1");
}

async function testEmail() {
  "use server";
  const user = await requireLogin();
  // Only the authenticated account's stored address is eligible. No form-supplied target.
  if (!emailConfigurationStatus().ready)
    redirect("/settings/email?error=config");
  const current = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true },
  });
  if (!validEmailAddress(current?.email))
    redirect("/settings/email?error=address");
  try {
    await queueEmailTest(user.id);
  } catch {
    redirect("/settings/email?error=queue");
  }
  revalidatePath("/settings/email");
  redirect("/settings/email?queued=1");
}

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireLogin();
  const params = await searchParams;
  const status = emailConfigurationStatus();
  const [preferences, local, account, jobs] = await Promise.all([
    getEmailNotificationPreferences(user.id),
    getLocalNotificationPreferences(user.id),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true },
    }),
    prisma.notificationDeliveryJob.findMany({
      where: { transport: "email", destinationKey: `email:${user.id}` },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 3 } },
    }),
  ]);
  const errors: Record<string, string> = {
    config: "Email is not configured. See the configuration status below.",
    address:
      "Ask your administrator to add a valid email address to your account.",
    queue: "The test could not be queued. Check configuration and try again.",
  };
  return (
    <main className="min-w-0 space-y-5 p-4 md:p-8">
      <Nav />
      <section className="app-panel space-y-3 p-4">
        <a href="/settings" className="text-sm text-[var(--app-link)]">
          Back to settings
        </a>
        <h1 className="text-2xl font-bold">Email notifications</h1>
        <p className="app-muted text-sm">
          Email is optional and delivered by the background worker. No browser
          or desktop pop-ups.
        </p>
        <p className="break-words text-sm">
          Account email: {account.email ?? "Not set"}
        </p>
        <p className="app-muted text-xs">
          Your administrator manages this address. Test messages can only be
          sent to your own account address.
        </p>
        <p
          role="status"
          className="rounded border border-[var(--app-border)] p-3 text-sm"
        >
          {status.message}
        </p>
        {params.saved && <p role="status">Email preferences saved.</p>}
        {params.queued && (
          <p role="status">
            Test email queued. The worker will deliver it asynchronously;
            refresh to see the result. At most one test is queued per minute.
          </p>
        )}
        {params.error && (
          <p role="alert">{errors[params.error] ?? "Email action failed."}</p>
        )}
        <form action={savePreferences} className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="emailTrades"
              defaultChecked={preferences.trades}
            />{" "}
            Email trade activity
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="emailWishlist"
              defaultChecked={preferences.wishlistDigest}
            />{" "}
            Email wishlist digests
          </label>
          <p className="app-muted text-xs">
            Email mirrors stored notifications. The matching in-app category
            must also be enabled in Settings. Missing addresses never prevent
            local notifications.
          </p>
          {(!local.trades || !local.wishlistDigest) && (
            <p className="text-xs text-amber-200">
              Disabled in-app categories:{" "}
              {[
                !local.trades ? "Trade activity" : "",
                !local.wishlistDigest ? "Wishlist digest" : "",
              ]
                .filter(Boolean)
                .join(", ")}
              . Enable them in Settings to generate notifications for email.
            </p>
          )}
          <SubmitButton
            className={filterPrimaryButtonClass}
            pendingLabel="Saving…"
          >
            Save email preferences
          </SubmitButton>
        </form>
        <form action={testEmail}>
          <SubmitButton
            disabled={!status.ready || !validEmailAddress(account.email)}
            className={filterButtonClass}
            pendingLabel="Queueing…"
          >
            Send test email
          </SubmitButton>
        </form>
      </section>
      <section
        className="app-panel space-y-3 p-4"
        aria-label="Email delivery history"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Recent email deliveries</h2>
          <a href="/settings/email" className={filterButtonClass}>
            Refresh delivery history
          </a>
        </div>
        <p className="app-muted text-xs">
          Last 10 jobs for your account. Failures retry automatically up to the
          configured limit; an administrator can retry exhausted jobs. Disabling
          a category prevents pending delivery, recorded as a failure rather
          than a sent message.
        </p>
        {!jobs.length && (
          <p className="app-muted text-sm">No email deliveries yet.</p>
        )}
        {jobs.map((job) => (
          <article
            key={job.id}
            className="app-card min-w-0 space-y-1 p-3 text-sm"
          >
            <p>
              {job.sourceType === "email_test"
                ? "Test email"
                : "Notification email"}{" "}
              · {job.status} · {job.attemptCount} attempts
            </p>
            <p className="app-muted text-xs">
              {job.createdAt.toISOString()}
              {job.nextAttemptAt
                ? ` · Next attempt ${job.nextAttemptAt.toISOString()}`
                : ""}
            </p>
            {job.lastError && (
              <p className="break-words text-amber-200">{job.lastError}</p>
            )}
            {job.attempts.map((attempt) => (
              <p key={attempt.id} className="app-muted break-words text-xs">
                Attempt {attempt.attemptNumber}: {attempt.status}
                {attempt.errorMessage ? ` — ${attempt.errorMessage}` : ""}
              </p>
            ))}
          </article>
        ))}
      </section>
    </main>
  );
}
