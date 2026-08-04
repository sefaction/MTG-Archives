export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { NotificationDeliveryStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { filterButtonClass, filterInputClass } from "@/components/filterStyles";
import { requireAdminMode } from "@/lib/auth";
import { enqueueEventDelivery } from "@/lib/notification-delivery";
import { prisma } from "@/lib/prisma";
import {
  buildTradeAnnouncementPayload,
  encryptWebhookValue,
  parseWebhookEndpointType,
  tradeAnnouncementDestinationKey,
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

function formError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const allowed = [
    "Webhook name is required.",
    "Signing secret must be between 16 and 512 characters.",
    "A trade announcement webhook with that name already exists.",
    "Webhook URL is required and must be 2,048 characters or fewer.",
    "Webhook URL is invalid.",
    "Public webhook URLs must use HTTPS.",
    "Webhook URL must use HTTP or HTTPS.",
    "Webhook URLs cannot include embedded usernames or passwords.",
    "Webhook URLs cannot include fragments.",
    "Discord destinations must use an official Discord webhook URL.",
    "Discord webhook URL is invalid.",
  ];
  return allowed.includes(message)
    ? message
    : "Trade announcement webhook could not be saved. Check the application logs.";
}

async function createEndpoint(formData: FormData) {
  "use server";
  await requireAdminMode();
  try {
    const name = requiredName(formData.get("name"));
    const duplicate = await prisma.tradeAnnouncementWebhookEndpoint.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      throw new Error(
        "A trade announcement webhook with that name already exists.",
      );
    }
    const deliveryType = parseWebhookEndpointType(formData.get("deliveryType"));
    const discord = deliveryType === WEBHOOK_ENDPOINT_TYPES.discord;
    const allowPrivateNetwork = discord
      ? false
      : formData.get("allowPrivateNetwork") === "on";
    const url = (
      discord
        ? validateDiscordWebhookUrl(String(formData.get("url") || ""))
        : validateWebhookUrlSyntax(
            String(formData.get("url") || ""),
            allowPrivateNetwork,
          )
    ).toString();
    const secret = discord ? null : requiredSecret(formData.get("secret"));
    await prisma.tradeAnnouncementWebhookEndpoint.create({
      data: {
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
    redirect(
      `/admin/notifications/trade-announcements?error=${encodeURIComponent(formError(error))}`,
    );
  }
  revalidatePath("/admin/notifications/trade-announcements");
  redirect("/admin/notifications/trade-announcements?created=1");
}

async function toggleEndpoint(formData: FormData) {
  "use server";
  await requireAdminMode();
  const id = String(formData.get("endpointId") || "");
  const endpoint = await prisma.tradeAnnouncementWebhookEndpoint.findUnique({
    where: { id },
    select: { id: true, enabled: true },
  });
  if (!endpoint) throw new Error("Webhook endpoint not found.");
  const enabled = !endpoint.enabled;
  await prisma.$transaction(async (tx) => {
    await tx.tradeAnnouncementWebhookEndpoint.update({
      where: { id },
      data: { enabled },
    });
    if (!enabled) {
      await tx.notificationDeliveryJob.updateMany({
        where: {
          transport: WEBHOOK_TRANSPORT,
          destinationKey: tradeAnnouncementDestinationKey(id),
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
          lastError: "Trade announcement webhook was disabled.",
          claimToken: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
    }
  });
  revalidatePath("/admin/notifications/trade-announcements");
  redirect("/admin/notifications/trade-announcements?saved=1");
}

async function testEndpoint(formData: FormData) {
  "use server";
  await requireAdminMode();
  const endpoint = await prisma.tradeAnnouncementWebhookEndpoint.findUnique({
    where: { id: String(formData.get("endpointId") || "") },
    select: { id: true },
  });
  if (!endpoint) throw new Error("Webhook endpoint not found.");
  const cards = await prisma.card.findMany({
    orderBy: { firstCachedAt: "asc" },
    take: 2,
    select: {
      name: true,
      setCode: true,
      collectorNumber: true,
      imageUri: true,
      imageUris: true,
    },
  });
  const sampleCard = (index: number, fallback: string) => {
    const card = cards[index];
    const images = card?.imageUris as
      { normal?: string; large?: string; small?: string } | null | undefined;
    return {
      name: card?.name ?? fallback,
      quantity: 1,
      setCode: card?.setCode ?? "TST",
      collectorNumber: card?.collectorNumber ?? String(index + 1),
      imageUrl:
        images?.normal ?? images?.large ?? images?.small ?? card?.imageUri,
    };
  };
  const sourceId = `test:${randomUUID()}`;
  await enqueueEventDelivery({
    sourceType: "trade.announcement_test",
    sourceId,
    transport: WEBHOOK_TRANSPORT,
    destinationKey: tradeAnnouncementDestinationKey(endpoint.id),
    maxAttempts: 1,
    payload: buildTradeAnnouncementPayload({
      tradeId: sourceId,
      proposerName: "Sample proposer",
      receiverName: "Sample recipient",
      offeredCards: [sampleCard(0, "Sample offered card")],
      requestedCards: [sampleCard(1, "Sample requested card")],
      createdAt: new Date(),
      test: true,
    }),
  });
  revalidatePath("/admin/notifications/trade-announcements");
  redirect("/admin/notifications/trade-announcements?tested=1");
}

async function deleteEndpoint(formData: FormData) {
  "use server";
  await requireAdminMode();
  const id = String(formData.get("endpointId") || "");
  const confirmation = String(formData.get("confirmation") || "").trim();
  const endpoint = await prisma.tradeAnnouncementWebhookEndpoint.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!endpoint) throw new Error("Webhook endpoint not found.");
  if (confirmation !== endpoint.name) {
    redirect(
      "/admin/notifications/trade-announcements?error=Type+the+webhook+name+exactly+to+remove+it.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.notificationDeliveryJob.updateMany({
      where: {
        transport: WEBHOOK_TRANSPORT,
        destinationKey: tradeAnnouncementDestinationKey(id),
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
        lastError: "Trade announcement webhook was removed.",
      },
    });
    await tx.tradeAnnouncementWebhookEndpoint.delete({ where: { id } });
  });
  revalidatePath("/admin/notifications/trade-announcements");
  redirect("/admin/notifications/trade-announcements?deleted=1");
}

export default async function TradeAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminMode();
  const params = await searchParams;
  const endpoints = await prisma.tradeAnnouncementWebhookEndpoint.findMany({
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });
  return (
    <main className="space-y-6 p-8">
      <Nav />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
            System console
          </p>
          <h1 className="text-3xl font-bold text-stone-50">
            Trade announcements
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-stone-400">
            Announce every completed trade independently from personal
            notification preferences. Discord destinations receive card lists
            and exact-printing images.
          </p>
        </div>
        <a href="/admin/notifications" className={filterButtonClass}>
          Back to delivery
        </a>
      </header>

      {params.created || params.saved || params.deleted || params.tested ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-100">
          {params.tested
            ? "Test announcement queued."
            : params.deleted
              ? "Trade announcement webhook removed."
              : "Trade announcement webhook saved."}
        </p>
      ) : null}
      {params.error ? (
        <p className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100">
          {params.error}
        </p>
      ) : null}
      {!webhookEncryptionAvailable() ? (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
          Webhook configuration is locked because the persistent encryption key
          is unavailable.
        </p>
      ) : null}

      <details className={panelClass}>
        <summary className="cursor-pointer p-4 text-lg font-semibold text-stone-100">
          Add trade announcement webhook
        </summary>
        <form
          action={createEndpoint}
          className="grid gap-4 border-t border-[var(--app-border)] p-4 md:grid-cols-2"
        >
          <label className="space-y-1 text-sm text-stone-300">
            <span>Name</span>
            <input
              name="name"
              required
              maxLength={80}
              className={filterInputClass}
              placeholder="Community trade feed"
            />
          </label>
          <label className="space-y-1 text-sm text-stone-300">
            <span>Delivery type</span>
            <select
              name="deliveryType"
              className={filterInputClass}
              defaultValue={WEBHOOK_ENDPOINT_TYPES.discord}
            >
              <option value={WEBHOOK_ENDPOINT_TYPES.discord}>
                Discord message
              </option>
              <option value={WEBHOOK_ENDPOINT_TYPES.signedJson}>
                Signed JSON
              </option>
            </select>
          </label>
          <label className="space-y-1 text-sm text-stone-300 md:col-span-2">
            <span>Webhook URL</span>
            <input
              name="url"
              type="url"
              required
              maxLength={2048}
              className={filterInputClass}
              placeholder="https://discord.com/api/webhooks/..."
            />
          </label>
          <label className="space-y-1 text-sm text-stone-300">
            <span>Signing secret (signed JSON only)</span>
            <input
              name="secret"
              type="password"
              minLength={16}
              maxLength={512}
              className={filterInputClass}
              autoComplete="new-password"
            />
          </label>
          <div className="space-y-2 text-sm text-stone-300">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="enabled" defaultChecked /> Enabled
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="allowPrivateNetwork" /> Allow
              private/LAN destination (signed JSON only)
            </label>
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingLabel="Adding…" className={filterButtonClass}>
              Add webhook
            </SubmitButton>
          </div>
        </form>
      </details>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-stone-100">Destinations</h2>
        {endpoints.length ? (
          endpoints.map((endpoint) => (
            <article
              key={endpoint.id}
              className={`${panelClass} space-y-3 p-4`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-stone-100">
                      {endpoint.name}
                    </h3>
                    <span className="rounded border border-stone-700 px-2 py-0.5 text-xs text-stone-400">
                      {endpoint.deliveryType === WEBHOOK_ENDPOINT_TYPES.discord
                        ? "Discord"
                        : "Signed JSON"}
                    </span>
                    <span
                      className={
                        endpoint.enabled
                          ? "text-xs text-emerald-300"
                          : "text-xs text-stone-500"
                      }
                    >
                      {endpoint.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    {endpoint.urlHint}
                    {endpoint.secretHint ? ` · ${endpoint.secretHint}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={toggleEndpoint}>
                    <input
                      type="hidden"
                      name="endpointId"
                      value={endpoint.id}
                    />
                    <SubmitButton
                      pendingLabel="Saving…"
                      className={filterButtonClass}
                    >
                      {endpoint.enabled ? "Disable" : "Enable"}
                    </SubmitButton>
                  </form>
                  <form action={testEndpoint}>
                    <input
                      type="hidden"
                      name="endpointId"
                      value={endpoint.id}
                    />
                    <SubmitButton
                      pendingLabel="Queueing…"
                      className={filterButtonClass}
                    >
                      Send test
                    </SubmitButton>
                  </form>
                </div>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-red-300">
                  Remove webhook
                </summary>
                <form
                  action={deleteEndpoint}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="endpointId" value={endpoint.id} />
                  <label className="space-y-1 text-xs text-stone-400">
                    <span>Type {endpoint.name} to confirm</span>
                    <input
                      name="confirmation"
                      required
                      className={filterInputClass}
                    />
                  </label>
                  <SubmitButton
                    pendingLabel="Removing…"
                    className="rounded border border-red-800 px-3 py-2 text-sm text-red-100"
                    confirmMessage={`Remove webhook ${endpoint.name}?`}
                  >
                    Remove
                  </SubmitButton>
                </form>
              </details>
            </article>
          ))
        ) : (
          <p className={`${panelClass} p-6 text-sm text-stone-500`}>
            No global trade announcement destinations are configured.
          </p>
        )}
      </section>
    </main>
  );
}
