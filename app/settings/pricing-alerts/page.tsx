export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { requireLogin } from "@/lib/auth";
import { queryPricingJson } from "@/lib/pricing-db-query";
import { prisma } from "@/lib/prisma";

const providers = [
  "tcgplayer",
  "cardmarket",
  "cardkingdom",
  "manapool",
  "mtgo",
  "cardhoarder",
] as const;
const finishes = ["normal", "foil", "etched"] as const;
const modes = ["absolute", "percent", "either"] as const;

function choice(
  value: FormDataEntryValue | null,
  options: readonly string[],
  fallback: string,
) {
  const text = String(value ?? "");
  return options.includes(text) ? text : fallback;
}

function threshold(
  value: FormDataEntryValue | null,
  fallback: number,
  maximum: number,
) {
  if (value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum
    ? Number(parsed.toFixed(2))
    : fallback;
}

async function savePricingAlerts(form: FormData) {
  "use server";
  const user = await requireLogin();
  if (!user.playerId)
    throw new Error("An inventory owner is required for pricing alerts.");
  const previous = await prisma.pricingAlertPreference.findUnique({
    where: { userId: user.id },
  });
  const enabled = form.get("enabled") === "on";
  const provider = choice(form.get("provider"), providers, "tcgplayer");
  const finish = choice(form.get("finish"), finishes, "normal");
  const priceType = choice(
    form.get("priceType"),
    ["retail", "buylist"],
    "retail",
  );
  const currencyInput = String(form.get("currency") ?? "USD").toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyInput) ? currencyInput : "USD";
  const thresholdMode = choice(form.get("thresholdMode"), modes, "absolute");
  const minAbsolute = threshold(form.get("minAbsolute"), 2, 100_000);
  const minPercent = threshold(form.get("minPercent"), 25, 10_000);
  const minPriorPrice = threshold(form.get("minPriorPrice"), 1, 100_000);
  const changed =
    !previous ||
    previous.provider !== provider ||
    previous.finish !== finish ||
    previous.priceType !== priceType ||
    previous.currency !== currency ||
    previous.thresholdMode !== thresholdMode ||
    Number(previous.minAbsolute) !== minAbsolute ||
    Number(previous.minPercent) !== minPercent ||
    Number(previous.minPriorPrice) !== minPriorPrice;
  const data = {
    enabled,
    enabledAt: enabled
      ? changed || !previous?.enabled
        ? new Date()
        : previous.enabledAt
      : null,
    provider,
    finish,
    priceType,
    currency,
    thresholdMode,
    minAbsolute,
    minPercent,
    minPriorPrice,
    lastSentAt: changed || !previous?.enabled ? null : previous.lastSentAt,
    lastCheckedAt:
      changed || !previous?.enabled ? null : previous.lastCheckedAt,
    lastProcessedImportDate:
      changed || !previous?.enabled ? null : previous.lastProcessedImportDate,
    lastError: null,
  };
  await prisma.pricingAlertPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  revalidatePath("/settings/pricing-alerts");
  redirect("/settings/pricing-alerts?saved=1");
}

export default async function PricingAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireLogin();
  const [{ saved }, preference, recent] = await Promise.all([
    searchParams,
    prisma.pricingAlertPreference.findUnique({ where: { userId: user.id } }),
    prisma.notification.findMany({
      where: { recipientUserId: user.id, sourceType: "pricing_digest" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        message: true,
        createdAt: true,
        href: true,
      },
    }),
  ]);
  let sourceStatus: string | null = null;
  if (preference?.enabled) {
    try {
      const [source] = await queryPricingJson<{ latestEpoch: number | null; ageSeconds: number | null }>(
        `SELECT EXTRACT(EPOCH FROM MAX(latest_ingested_at))::float8 AS "latestEpoch",
                EXTRACT(EPOCH FROM now() - MAX(latest_ingested_at))::float8 AS "ageSeconds"
         FROM price_scope_summary
         WHERE provider = '${preference.provider.replace(/'/g, "''")}'
           AND finish = '${preference.finish.replace(/'/g, "''")}'
           AND price_type = '${preference.priceType.replace(/'/g, "''")}'
           AND currency = '${preference.currency.replace(/'/g, "''")}'`,
        { timeoutMs: 3_000 },
      );
      if (source?.latestEpoch == null) {
        sourceStatus = "No prices have arrived for the selected source and currency.";
      } else {
        const latest = new Date(source.latestEpoch * 1000);
        sourceStatus = `${(source.ageSeconds ?? 0) >= 72 * 60 * 60 ? "Selected price source is stale. Last update" : "Selected price source last updated"} ${latest.toLocaleString()}. A source outage does not create a movement alert.`;
      }
    } catch {
      sourceStatus = "Selected price source status is unavailable. Check Pricing data status.";
    }
  }
  return (
    <main className="min-w-0 space-y-4 p-4 sm:p-8">
      <Nav />
      <a href="/settings" className="text-sm text-sky-200 underline">
        Back to Settings
      </a>
      <section className="space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <h1 className="text-2xl font-semibold">Pricing movement digest</h1>
        <p className="text-sm text-zinc-400">
          One quiet in-app digest per UTC import day for meaningful changes in
          your currently owned exact printings. Off until you enable it. Email
          and webhook delivery are not part of this first release.
        </p>
        {saved === "1" ? (
          <p role="status" className="text-emerald-200">
            Preferences saved.
          </p>
        ) : null}
        {preference?.lastSentAt ? (
          <p className="text-sm text-zinc-400">
            Last digest sent {preference.lastSentAt.toLocaleString()}.
          </p>
        ) : null}
        {preference?.lastError ? (
          <p role="status" className="text-sm text-amber-200">
            The last digest check failed. It will retry automatically; check the
            notification worker log if this continues.
          </p>
        ) : null}
        {sourceStatus ? (
          <p className="text-sm text-amber-200" role="status">{sourceStatus}</p>
        ) : null}
      </section>
      <form
        action={savePricingAlerts}
        className="grid gap-4 rounded border border-zinc-800 bg-zinc-950/60 p-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <label className="flex items-center gap-2 text-sm sm:col-span-2 xl:col-span-4">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={preference?.enabled ?? false}
            disabled={!user.playerId}
          />
          Enable daily in-app Pricing digests
        </label>
        <label className="text-sm">
          Provider
          <select
            name="provider"
            defaultValue={preference?.provider ?? "tcgplayer"}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          >
            {providers.map((provider) => (
              <option key={provider}>{provider}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Finish
          <select
            name="finish"
            defaultValue={preference?.finish ?? "normal"}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          >
            {finishes.map((finish) => (
              <option key={finish}>{finish}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Price type
          <select
            name="priceType"
            defaultValue={preference?.priceType ?? "retail"}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          >
            <option value="retail">Retail</option>
            <option value="buylist">Buylist</option>
          </select>
        </label>
        <label className="text-sm">
          Currency
          <input
            name="currency"
            maxLength={3}
            pattern="[A-Za-z]{3}"
            defaultValue={preference?.currency ?? "USD"}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          />
        </label>
        <label className="text-sm">
          Threshold rule
          <select
            name="thresholdMode"
            defaultValue={preference?.thresholdMode ?? "absolute"}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          >
            <option value="absolute">Currency change</option>
            <option value="percent">Percent change</option>
            <option value="either">Either threshold</option>
          </select>
        </label>
        <label className="text-sm">
          Minimum per-card change
          <input
            name="minAbsolute"
            type="number"
            min="0"
            step="0.01"
            defaultValue={String(preference?.minAbsolute ?? 2)}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          />
        </label>
        <label className="text-sm">
          Minimum percent
          <input
            name="minPercent"
            type="number"
            min="0"
            step="0.01"
            defaultValue={String(preference?.minPercent ?? 25)}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          />
        </label>
        <label className="text-sm">
          Minimum prior price for percent
          <input
            name="minPriorPrice"
            type="number"
            min="0"
            step="0.01"
            defaultValue={String(preference?.minPriorPrice ?? 1)}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
          />
        </label>
        <div className="sm:col-span-2 xl:col-span-4">
          <SubmitButton pendingLabel="Saving digest…">
            Save Pricing digest
          </SubmitButton>
        </div>
      </form>
      <section className="space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 className="text-lg font-semibold">Recent digests</h2>
        {recent.length ? (
          recent.map((item) => (
            <p key={item.id} className="text-sm text-zinc-300">
              <span className="text-zinc-500">
                {item.createdAt.toLocaleString()} ·{" "}
              </span>
              {item.href ? (
                <a href={item.href} className="text-sky-200 underline">
                  {item.title}
                </a>
              ) : (
                item.title
              )}
              {item.message ? ` — ${item.message}` : ""}
            </p>
          ))
        ) : (
          <p className="text-sm text-zinc-400">No Pricing digests yet.</p>
        )}
      </section>
    </main>
  );
}
