export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { NotificationDeliveryStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { filterButtonClass, filterInputClass } from "@/components/filterStyles";
import { isAdminModeEnabled, requireLogin } from "@/lib/auth";
import { enqueueNotificationDelivery } from "@/lib/notification-delivery";
import {
  getWebhookNotificationPreferences,
  setWebhookNotificationPreferences,
} from "@/lib/notification-preferences";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  buildWebhookPayload,
  decryptWebhookValue,
  encryptWebhookValue,
  parseWebhookEndpointType,
  validateDiscordWebhookUrl,
  validateWebhookUrlSyntax,
  WEBHOOK_ENDPOINT_TYPES,
  WEBHOOK_TRANSPORT,
  webhookEncryptionAvailable,
  webhookSecretHint,
  webhookUrlHint,
} from "@/lib/webhook-delivery";

const panelClass =
  "rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)]";

function requiredName(value: FormDataEntryValue | null) {
  const name = String(value || "")
    .trim()
    .slice(0, 80);
  if (!name) throw new Error("Webhook name is required.");
  return name;
}

function requiredSecret(value: FormDataEntryValue | null) {
  const secret = String(value || "").trim();
  if (secret.length < 16 || secret.length > 512) {
    throw new Error("Signing secret must be between 16 and 512 characters.");
  }
  return secret;
}

const publicWebhookFormErrors = new Set([
  "Webhook name is required.",
  "Signing secret must be between 16 and 512 characters.",
  "Enter admin mode before approving a private-network webhook.",
  "A webhook with that name already exists.",
  "Webhook URL is required and must be 2,048 characters or fewer.",
  "Webhook URL is invalid.",
  "Public webhook URLs must use HTTPS.",
  "Webhook URL must use HTTP or HTTPS.",
  "Webhook URLs cannot include embedded usernames or passwords.",
  "Webhook URLs cannot include fragments.",
  "Discord destinations must use an official Discord webhook URL.",
  "Discord webhook URL is invalid.",
  "Webhook endpoint not found.",
  "Add a signing secret when changing a Discord destination to signed JSON.",
]);

function webhookFormErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return publicWebhookFormErrors.has(message)
    ? message
    : "Webhook settings could not be saved. Check the application logs.";
}

function redirectWebhookFormError(error: unknown): never {
  redirect(
    `/settings/webhooks?error=${encodeURIComponent(
      webhookFormErrorMessage(error),
    )}`,
  );
}

async function privateNetworkChoice(
  user: Awaited<ReturnType<typeof requireLogin>>,
  formData: FormData,
  preserveWhenUnavailable = false,
) {
  const requested = formData.get("allowPrivateNetwork") === "on";
  const adminModeActive = await isAdminModeEnabled(user);
  if (requested && !adminModeActive) {
    throw new Error(
      "Enter admin mode before approving a private-network webhook.",
    );
  }
  if (!adminModeActive && preserveWhenUnavailable) return true;
  return requested;
}

async function ensureUniqueName(
  userId: string,
  name: string,
  excludeId?: string,
) {
  const duplicate = await prisma.notificationWebhookEndpoint.findFirst({
    where: {
      userId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) throw new Error("A webhook with that name already exists.");
}

async function createEndpoint(formData: FormData) {
  "use server";
  const user = await requireLogin();
  try {
    const name = requiredName(formData.get("name"));
    const deliveryType = parseWebhookEndpointType(formData.get("deliveryType"));
    const isDiscord = deliveryType === WEBHOOK_ENDPOINT_TYPES.discord;
    const secret = isDiscord ? null : requiredSecret(formData.get("secret"));
    const allowPrivateNetwork = isDiscord
      ? false
      : await privateNetworkChoice(user, formData);
    const url = (
      isDiscord
        ? validateDiscordWebhookUrl(String(formData.get("url") || ""))
        : validateWebhookUrlSyntax(
            String(formData.get("url") || ""),
            allowPrivateNetwork,
          )
    ).toString();
    await ensureUniqueName(user.id, name);
    await prisma.notificationWebhookEndpoint.create({
      data: {
        userId: user.id,
        name,
        deliveryType,
        urlEncrypted: encryptWebhookValue(url),
        urlHint: webhookUrlHint(url),
        secretEncrypted: secret ? encryptWebhookValue(secret) : null,
        secretHint: secret ? webhookSecretHint(secret) : null,
        enabled: formData.get("enabled") === "on",
        allowPrivateNetwork,
      },
    });
  } catch (error) {
    redirectWebhookFormError(error);
  }
  revalidatePath("/settings/webhooks");
  redirect("/settings/webhooks?created=1");
}

async function updateEndpoint(formData: FormData) {
  "use server";
  const user = await requireLogin();
  try {
    const id = String(formData.get("endpointId") || "");
    const existing = await prisma.notificationWebhookEndpoint.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) throw new Error("Webhook endpoint not found.");
    const name = requiredName(formData.get("name"));
    await ensureUniqueName(user.id, name, existing.id);
    const deliveryType = parseWebhookEndpointType(formData.get("deliveryType"));
    const isDiscord = deliveryType === WEBHOOK_ENDPOINT_TYPES.discord;
    const allowPrivateNetwork = isDiscord
      ? false
      : await privateNetworkChoice(
          user,
          formData,
          existing.allowPrivateNetwork,
        );
    const urlInput = String(formData.get("url") || "").trim();
    const secretInput = String(formData.get("secret") || "").trim();
    const enabled = formData.get("enabled") === "on";
    const data: Prisma.NotificationWebhookEndpointUpdateInput = {
      name,
      deliveryType,
      enabled,
      allowPrivateNetwork,
    };
    if (urlInput) {
      const url = (
        isDiscord
          ? validateDiscordWebhookUrl(urlInput)
          : validateWebhookUrlSyntax(urlInput, allowPrivateNetwork)
      ).toString();
      data.urlEncrypted = encryptWebhookValue(url);
      data.urlHint = webhookUrlHint(url);
    } else if (deliveryType !== existing.deliveryType && isDiscord) {
      validateDiscordWebhookUrl(decryptWebhookValue(existing.urlEncrypted));
    }
    if (isDiscord) {
      data.secretEncrypted = null;
      data.secretHint = null;
    } else if (secretInput) {
      const secret = requiredSecret(secretInput);
      data.secretEncrypted = encryptWebhookValue(secret);
      data.secretHint = webhookSecretHint(secret);
    } else if (!existing.secretEncrypted) {
      throw new Error(
        "Add a signing secret when changing a Discord destination to signed JSON.",
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.notificationWebhookEndpoint.update({
        where: { id: existing.id },
        data,
      });
      if (!enabled) {
        await tx.notificationDeliveryJob.updateMany({
          where: {
            transport: WEBHOOK_TRANSPORT,
            destinationKey: existing.id,
            status: {
              in: [
                NotificationDeliveryStatus.PENDING,
                NotificationDeliveryStatus.FAILED,
              ],
            },
          },
          data: {
            status: NotificationDeliveryStatus.FAILED,
            nextAttemptAt: null,
            lastError: "Webhook endpoint was disabled.",
            claimToken: null,
            claimedAt: null,
            claimExpiresAt: null,
          },
        });
      }
    });
  } catch (error) {
    redirectWebhookFormError(error);
  }
  revalidatePath("/settings/webhooks");
  redirect("/settings/webhooks?saved=1");
}

async function deleteEndpoint(formData: FormData) {
  "use server";
  const user = await requireLogin();
  const id = String(formData.get("endpointId") || "");
  const confirmation = String(formData.get("confirmation") || "").trim();
  const endpoint = await prisma.notificationWebhookEndpoint.findFirst({
    where: { id, userId: user.id },
    select: { id: true, name: true },
  });
  if (!endpoint) throw new Error("Webhook endpoint not found.");
  if (confirmation !== endpoint.name) {
    throw new Error("Type the webhook name exactly to remove it.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.notificationDeliveryJob.updateMany({
      where: {
        transport: WEBHOOK_TRANSPORT,
        destinationKey: endpoint.id,
        status: {
          in: [
            NotificationDeliveryStatus.PENDING,
            NotificationDeliveryStatus.FAILED,
          ],
        },
      },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        nextAttemptAt: null,
        lastError: "Webhook endpoint was removed.",
      },
    });
    await tx.notificationWebhookEndpoint.delete({ where: { id: endpoint.id } });
  });
  revalidatePath("/settings/webhooks");
  redirect("/settings/webhooks?deleted=1");
}

async function testEndpoint(formData: FormData) {
  "use server";
  const user = await requireLogin();
  const endpoint = await prisma.notificationWebhookEndpoint.findFirst({
    where: {
      id: String(formData.get("endpointId") || ""),
      userId: user.id,
    },
    select: { id: true, name: true },
  });
  if (!endpoint) throw new Error("Webhook endpoint not found.");
  const sourceId = `webhook-test:${randomUUID()}`;
  await prisma.$transaction(async (tx) => {
    const notification = await createNotification(
      {
        recipientUserId: user.id,
        type: "system.webhook_test",
        category: "system",
        title: `Webhook test queued for ${endpoint.name}`,
        message:
          "The notification worker will deliver this test asynchronously.",
        href: "/settings/webhooks",
        sourceType: "webhook_test",
        sourceId,
      },
      tx,
    );
    await enqueueNotificationDelivery(
      {
        notificationId: notification.id,
        transport: WEBHOOK_TRANSPORT,
        destinationKey: endpoint.id,
        maxAttempts: 1,
        payload: buildWebhookPayload({
          notificationId: notification.id,
          type: notification.type,
          category: notification.category,
          title: notification.title,
          message: notification.message,
          href: notification.href,
          createdAt: notification.createdAt,
          test: true,
        }),
      },
      tx,
    );
  });
  revalidatePath("/settings/webhooks");
  revalidatePath("/notifications");
  redirect("/settings/webhooks?tested=1");
}

async function saveWebhookPreferences(formData: FormData) {
  "use server";
  const user = await requireLogin();
  await setWebhookNotificationPreferences(user.id, {
    trades: formData.get("webhookTrades") === "on",
    wishlistDigest: formData.get("webhookWishlistDigest") === "on",
  });
  revalidatePath("/settings/webhooks");
  redirect("/settings/webhooks?preferences=1");
}

function dateLabel(value: Date | null) {
  return value ? value.toLocaleString() : "—";
}

export default async function WebhookSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireLogin();
  const params = await searchParams;
  const adminModeActive = await isAdminModeEnabled(user);
  const encryptionReady = webhookEncryptionAvailable();
  const [endpoints, preferences] = await Promise.all([
    prisma.notificationWebhookEndpoint.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    }),
    getWebhookNotificationPreferences(user.id),
  ]);
  const endpointIds = endpoints.map((endpoint) => endpoint.id);
  const recentJobs = endpointIds.length
    ? await prisma.notificationDeliveryJob.findMany({
        where: {
          transport: WEBHOOK_TRANSPORT,
          destinationKey: { in: endpointIds },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 30,
        include: {
          notification: { select: { title: true, category: true } },
          attempts: {
            orderBy: { attemptNumber: "desc" },
            take: 3,
          },
        },
      })
    : [];
  const endpointNames = new Map(
    endpoints.map((endpoint) => [endpoint.id, endpoint.name]),
  );

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
            Notification settings
          </p>
          <h1 className="text-3xl font-bold">Webhooks</h1>
          <p className="app-muted mt-1 max-w-3xl text-sm">
            Send selected notifications as signed JSON or Discord messages.
            Delivery runs in the background and never exposes saved URLs or
            signing secrets.
          </p>
        </div>
        <a href="/settings" className={filterButtonClass}>
          Back to settings
        </a>
      </header>

      {params.created || params.saved || params.preferences ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-100">
          Webhook settings saved.
        </p>
      ) : null}
      {params.error ? (
        <p className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
          {params.error}
        </p>
      ) : null}
      {params.tested ? (
        <p className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm text-sky-100">
          Test delivery queued. Refresh after the notification worker polls to
          see the final result.
        </p>
      ) : null}
      {params.deleted ? (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
          Webhook endpoint removed.
        </p>
      ) : null}
      {!encryptionReady ? (
        <p className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
          Webhook configuration is locked because the persistent encryption key
          could not be loaded. Check the application startup log and backup
          directory permissions.
        </p>
      ) : null}

      <section className={`${panelClass} p-4`}>
        <form action={saveWebhookPreferences} className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Webhook categories</h2>
            <p className="app-muted text-sm">
              Webhook delivery defaults off and is independent from the in-app
              notification preferences.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="webhookTrades"
                defaultChecked={preferences.trades}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">Trade activity</span>
                <span className="app-muted block text-xs">
                  Proposals, counters, status changes, and confirmations.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="webhookWishlistDigest"
                defaultChecked={preferences.wishlistDigest}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">
                  Hourly wishlist digest
                </span>
                <span className="app-muted block text-xs">
                  The same hourly summary used by local notifications.
                </span>
              </span>
            </label>
          </div>
          <SubmitButton
            pendingLabel="Saving…"
            className="rounded border border-cyan-800 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40"
          >
            Save webhook categories
          </SubmitButton>
        </form>
      </section>

      <section className={panelClass}>
        <details open={!endpoints.length}>
          <summary className="cursor-pointer list-none border-b border-[var(--app-border)] p-4">
            <span className="text-lg font-semibold">Add webhook endpoint</span>
          </summary>
          <form
            action={createEndpoint}
            className="grid gap-3 p-4 md:grid-cols-2"
          >
            <label className="space-y-1 text-sm">
              <span>Name</span>
              <input
                name="name"
                required
                maxLength={80}
                placeholder="Discord trades"
                className={filterInputClass}
                disabled={!encryptionReady}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Destination type</span>
              <select
                name="deliveryType"
                defaultValue={WEBHOOK_ENDPOINT_TYPES.discord}
                className={filterInputClass}
                disabled={!encryptionReady}
              >
                <option value={WEBHOOK_ENDPOINT_TYPES.discord}>
                  Discord message
                </option>
                <option value={WEBHOOK_ENDPOINT_TYPES.signedJson}>
                  Generic signed JSON
                </option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Webhook URL</span>
              <input
                name="url"
                type="url"
                required
                placeholder="https://discord.com/api/webhooks/..."
                className={filterInputClass}
                disabled={!encryptionReady}
              />
              <span className="app-muted block text-xs">
                For Discord, use Server Settings → Integrations → Webhooks →
                Copy Webhook URL. Channel and invite links will not work.
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span>Signing secret (generic JSON only)</span>
              <input
                name="secret"
                type="password"
                minLength={16}
                maxLength={512}
                autoComplete="new-password"
                placeholder="Not used for Discord"
                className={filterInputClass}
                disabled={!encryptionReady}
              />
            </label>
            <div className="space-y-2 rounded border border-[var(--app-border)] p-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="enabled" defaultChecked />
                Enabled
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="allowPrivateNetwork"
                  disabled={!adminModeActive}
                  className="mt-0.5"
                />
                <span>
                  Allow private/LAN destination
                  <span className="app-muted block text-xs">
                    Generic JSON only. Requires admin mode. Loopback,
                    link-local, and metadata destinations remain blocked.
                  </span>
                </span>
              </label>
            </div>
            <SubmitButton
              pendingLabel="Adding…"
              className="rounded border border-cyan-800 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40 md:col-span-2"
              disabled={!encryptionReady}
            >
              Add webhook
            </SubmitButton>
          </form>
        </details>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Destinations</h2>
          <p className="app-muted text-sm">
            Saved URLs and secrets are encrypted. Only masked hints are shown
            after entry. The application manages its persistent encryption key
            automatically.
          </p>
        </div>
        {endpoints.length ? (
          endpoints.map((endpoint) => (
            <article key={endpoint.id} className={`${panelClass} p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{endpoint.name}</h3>
                    <span className="rounded border border-cyan-900 px-2 py-0.5 text-xs text-cyan-100">
                      {endpoint.deliveryType === WEBHOOK_ENDPOINT_TYPES.discord
                        ? "Discord"
                        : "Signed JSON"}
                    </span>
                    <span
                      className={
                        endpoint.enabled
                          ? "rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-200"
                          : "rounded border border-stone-700 px-2 py-0.5 text-xs text-stone-400"
                      }
                    >
                      {endpoint.enabled ? "Enabled" : "Disabled"}
                    </span>
                    {endpoint.allowPrivateNetwork ? (
                      <span className="rounded border border-amber-800 px-2 py-0.5 text-xs text-amber-200">
                        LAN approved
                      </span>
                    ) : null}
                  </div>
                  <p className="app-muted mt-1 text-xs">
                    {endpoint.urlHint}
                    {endpoint.secretHint
                      ? ` · secret ${endpoint.secretHint}`
                      : " · Discord URL token encrypted"}
                  </p>
                </div>
                <form action={testEndpoint}>
                  <input type="hidden" name="endpointId" value={endpoint.id} />
                  <SubmitButton
                    pendingLabel="Queueing…"
                    className="rounded border border-sky-800 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-950/40"
                    disabled={!encryptionReady}
                  >
                    Send test
                  </SubmitButton>
                </form>
              </div>
              <details className="mt-3">
                <summary
                  className={`${filterButtonClass} inline-flex cursor-pointer list-none`}
                >
                  Edit
                </summary>
                <form
                  action={updateEndpoint}
                  className="mt-3 grid gap-3 md:grid-cols-2"
                >
                  <input type="hidden" name="endpointId" value={endpoint.id} />
                  <label className="space-y-1 text-sm">
                    <span>Name</span>
                    <input
                      name="name"
                      defaultValue={endpoint.name}
                      className={filterInputClass}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Destination type</span>
                    <select
                      name="deliveryType"
                      defaultValue={endpoint.deliveryType}
                      className={filterInputClass}
                    >
                      <option value={WEBHOOK_ENDPOINT_TYPES.discord}>
                        Discord message
                      </option>
                      <option value={WEBHOOK_ENDPOINT_TYPES.signedJson}>
                        Generic signed JSON
                      </option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Replace URL</span>
                    <input
                      name="url"
                      type="url"
                      placeholder={`Keep ${endpoint.urlHint}`}
                      className={filterInputClass}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Replace signing secret (generic JSON only)</span>
                    <input
                      name="secret"
                      type="password"
                      minLength={16}
                      maxLength={512}
                      autoComplete="new-password"
                      placeholder={
                        endpoint.secretHint
                          ? `Keep ${endpoint.secretHint}`
                          : "Required only when changing to signed JSON"
                      }
                      className={filterInputClass}
                    />
                  </label>
                  <div className="space-y-2 rounded border border-[var(--app-border)] p-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={endpoint.enabled}
                      />
                      Enabled
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="allowPrivateNetwork"
                        defaultChecked={endpoint.allowPrivateNetwork}
                        disabled={!adminModeActive}
                      />
                      Allow private/LAN destination
                    </label>
                    <p className="app-muted text-xs">
                      Generic JSON only. Discord destinations must use an
                      official public Discord webhook URL.
                    </p>
                  </div>
                  <SubmitButton
                    pendingLabel="Saving…"
                    className="rounded border border-cyan-800 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40 md:col-span-2"
                  >
                    Save endpoint
                  </SubmitButton>
                </form>
                <form
                  action={deleteEndpoint}
                  className="mt-4 flex flex-wrap items-end gap-2 border-t border-red-950 pt-4"
                >
                  <input type="hidden" name="endpointId" value={endpoint.id} />
                  <label className="space-y-1 text-xs text-red-200">
                    <span>Type “{endpoint.name}” to remove</span>
                    <input name="confirmation" className={filterInputClass} />
                  </label>
                  <SubmitButton
                    pendingLabel="Removing…"
                    className="rounded border border-red-800 px-3 py-2 text-sm text-red-100 hover:bg-red-950/40"
                    confirmMessage={`Remove webhook ${endpoint.name}?`}
                  >
                    Remove webhook
                  </SubmitButton>
                </form>
              </details>
            </article>
          ))
        ) : (
          <p className={`${panelClass} app-muted p-5 text-sm`}>
            No webhook destinations configured.
          </p>
        )}
      </section>

      <section className={panelClass}>
        <div className="border-b border-[var(--app-border)] p-4">
          <h2 className="text-lg font-semibold">Recent webhook deliveries</h2>
          <p className="app-muted text-sm">
            All destinations use the same queue, timeout, response cap, and
            failure history. Generic JSON is signed; Discord receives
            mention-safe embeds.
          </p>
        </div>
        {recentJobs.length ? (
          <div className="divide-y divide-[var(--app-border)]">
            {recentJobs.map((job) => (
              <div key={job.id} className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {endpointNames.get(job.destinationKey) ??
                      "Removed endpoint"}
                  </span>
                  <span className="rounded border border-[var(--app-border)] px-2 py-0.5 text-xs">
                    {job.status}
                  </span>
                  <span className="app-muted text-xs">
                    {job.notification?.title ?? job.sourceType}
                  </span>
                </div>
                <p className="app-muted text-xs">
                  {job.attemptCount}/{job.maxAttempts} attempts · next{" "}
                  {dateLabel(job.nextAttemptAt)} · sent {dateLabel(job.sentAt)}
                </p>
                {job.lastError ? (
                  <p className="rounded border border-red-950 bg-red-950/20 p-2 text-xs text-red-200">
                    {job.lastError}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="app-muted p-5 text-sm">
            No webhook deliveries have been queued.
          </p>
        )}
      </section>

      <section className={`${panelClass} p-4 text-sm`}>
        <h2 className="font-semibold">Destination security</h2>
        <p className="app-muted mt-1">
          Generic JSON receivers compute HMAC-SHA256 over{" "}
          <code className="text-stone-200">
            timestamp + &quot;.&quot; + raw body
          </code>{" "}
          using the saved secret, then compare it to the{" "}
          <code className="text-stone-200">
            X-MTG-Archives-Webhook-Signature
          </code>{" "}
          header. The timestamp and stable delivery ID are sent in adjacent
          headers.
        </p>
        <p className="app-muted mt-2">
          Discord destinations do not use a separate signing secret. The
          encrypted Discord webhook URL contains Discord&apos;s token, and
          messages disable all allowed mentions.
        </p>
      </section>
    </main>
  );
}
