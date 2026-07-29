export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  cn,
  filterButtonClass,
  filterInputClass,
  filterOptionClass,
  filterSelectClass,
} from "@/components/filterStyles";
import { getAccessScope, getCurrentUser, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PLAYER_COLOR,
  normalizePlayerColor,
} from "@/lib/player-colors";
import {
  getLocalNotificationPreferences,
  setLocalNotificationPreferences,
} from "@/lib/notification-preferences";
import { APP_THEMES, normalizeAppTheme } from "@/lib/themes";
import {
  assertPublicSlug,
  defaultVisibilityLabel,
  normalizePublicSlug,
} from "@/lib/visibility";
import { DefaultCollectionVisibility } from "@prisma/client";

const PRICE_PROVIDERS = [
  { value: "scryfall", label: "Scryfall" },
  { value: "tcgplayer", label: "TCGplayer" },
  { value: "cardmarket", label: "Cardmarket" },
  { value: "cardhoarder", label: "Cardhoarder" },
];

function normalizePriceProvider(value: FormDataEntryValue | null) {
  const provider = String(value || "scryfall").toLowerCase();
  return PRICE_PROVIDERS.some((option) => option.value === provider)
    ? provider
    : "scryfall";
}

function parseDefaultVisibility(value: FormDataEntryValue | null) {
  return value === DefaultCollectionVisibility.PUBLIC
    ? DefaultCollectionVisibility.PUBLIC
    : DefaultCollectionVisibility.PRIVATE;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="p-8 space-y-4">
        <Nav />
        <p className="rounded border border-zinc-800 p-3">
          Log in to manage collection visibility.
        </p>
      </main>
    );
  }
  const scope = await getAccessScope(user);
  const adminModeActive = scope?.mode === "admin";
  const suggestedSlug = normalizePublicSlug(user.username || user.displayName);
  const notificationPreferences = await getLocalNotificationPreferences(
    user.id,
  );

  async function updateVisibilitySettings(fd: FormData) {
    "use server";
    const actor = await requireLogin();
    const before = await prisma.user.findUnique({
      where: { id: actor.id },
      include: { player: true },
    });
    if (!before) throw new Error("User not found.");
    const beforeNotificationPreferences = await getLocalNotificationPreferences(
      actor.id,
    );

    const publicProfileEnabled = fd.get("publicProfileEnabled") === "on";
    const tradeNotifications = fd.get("tradeNotifications") === "on";
    const wishlistDigestNotifications =
      fd.get("wishlistDigestNotifications") === "on";
    const theme = normalizeAppTheme(fd.get("theme"));
    const publicDisplayName =
      String(fd.get("publicDisplayName") || "").trim() || null;
    const playerColor = normalizePlayerColor(fd.get("playerColor"));
    const preferredPriceProvider = normalizePriceProvider(
      fd.get("preferredPriceProvider"),
    );
    const publicSlugInput = String(fd.get("publicSlug") || "").trim();
    const publicSlug = publicProfileEnabled
      ? assertPublicSlug(publicSlugInput)
      : publicSlugInput
        ? assertPublicSlug(publicSlugInput)
        : before.publicSlug;

    if (publicSlug) {
      const duplicate = await prisma.user.findFirst({
        where: { publicSlug, id: { not: actor.id } },
        select: { id: true },
      });
      if (duplicate) throw new Error("That public slug is already in use.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const savedUser = await tx.user.update({
        where: { id: actor.id },
        data: {
          inventoryDefaultVisibility: parseDefaultVisibility(
            fd.get("inventoryDefaultVisibility"),
          ),
          deckDefaultVisibility: parseDefaultVisibility(
            fd.get("deckDefaultVisibility"),
          ),
          theme,
          preferredPriceProvider,
          publicProfileEnabled,
          publicDisplayName,
          publicSlug,
        },
      });
      if (actor.playerId) {
        await tx.player.update({
          where: { id: actor.playerId },
          data: { color: playerColor },
        });
      }
      await setLocalNotificationPreferences(
        actor.id,
        {
          trades: tradeNotifications,
          wishlistDigest: wishlistDigestNotifications,
        },
        tx,
      );
      return savedUser;
    });

    await prisma.inventoryAuditLog.create({
      data: {
        changedByUserId: actor.id,
        changeType: "collection_visibility_settings_updated",
        beforeJson: {
          inventoryDefaultVisibility: before.inventoryDefaultVisibility,
          deckDefaultVisibility: before.deckDefaultVisibility,
          publicProfileEnabled: before.publicProfileEnabled,
          publicDisplayName: before.publicDisplayName,
          publicSlug: before.publicSlug,
          theme: before.theme,
          preferredPriceProvider: before.preferredPriceProvider,
          playerColor: before.player?.color ?? DEFAULT_PLAYER_COLOR,
          tradeNotifications: beforeNotificationPreferences.trades,
          wishlistDigestNotifications:
            beforeNotificationPreferences.wishlistDigest,
        },
        afterJson: {
          inventoryDefaultVisibility: updated.inventoryDefaultVisibility,
          deckDefaultVisibility: updated.deckDefaultVisibility,
          publicProfileEnabled: updated.publicProfileEnabled,
          publicDisplayName: updated.publicDisplayName,
          publicSlug: updated.publicSlug,
          theme: updated.theme,
          preferredPriceProvider: updated.preferredPriceProvider,
          playerColor,
          tradeNotifications,
          wishlistDigestNotifications,
        },
        reason: "Collection visibility settings updated.",
      },
    });

    revalidatePath("/settings");
    revalidatePath("/locations");
    revalidatePath("/inventory");
    revalidatePath("/public/inventory");
    if (updated.publicSlug) revalidatePath(`/u/${updated.publicSlug}`);
    if (updated.publicSlug)
      revalidatePath(`/u/${updated.publicSlug}/inventory`);
  }

  return (
    <main className="p-8 space-y-6">
      <Nav />
      {params.saved ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          Settings saved.
        </p>
      ) : null}
      <section className="space-y-2">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="app-muted">
          Choose your workspace theme and control whether your inventory and
          future deck pages are private or public.
        </p>
        {adminModeActive ? (
          <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
            Admin mode is active, but these settings update your own public
            collection profile only.
          </p>
        ) : null}
      </section>

      <form
        action={updateVisibilitySettings}
        className="app-panel space-y-6 p-4"
      >
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Theme</h2>
            <p className="app-muted text-sm">
              Themes are saved per user and apply across the full app shell.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {APP_THEMES.map((theme) => (
              <label
                key={theme.id}
                className="app-card flex cursor-pointer gap-3 p-3"
              >
                <input
                  type="radio"
                  name="theme"
                  value={theme.id}
                  defaultChecked={normalizeAppTheme(user.theme) === theme.id}
                  className="mt-1"
                />
                <span className="space-y-1">
                  <span className="flex items-center gap-2 font-medium">
                    {theme.label}
                    <span className="app-muted rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide">
                      {theme.mode}
                    </span>
                  </span>
                  <span className="app-muted block text-xs">
                    {theme.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-4 border-t border-[var(--app-border)] pt-5">
          <div>
            <h2 className="text-base font-semibold">User identity</h2>
            <p className="app-muted text-sm">
              Your player color marks your cards in public inventory and
              multi-user views.
            </p>
          </div>
          <label className="text-sm">
            Player color
            <span className="mt-1 flex items-center gap-3">
              <input
                type="color"
                name="playerColor"
                defaultValue={normalizePlayerColor(user.player?.color)}
                className="h-10 w-14 cursor-pointer rounded border border-[var(--app-border)] bg-transparent p-1"
              />
              <span
                className="inline-flex items-center gap-2 rounded border border-[var(--app-border)] px-3 py-2 text-sm"
                style={{
                  borderColor: normalizePlayerColor(user.player?.color),
                }}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: normalizePlayerColor(user.player?.color),
                  }}
                />
                {user.displayName}
              </span>
            </span>
          </label>
        </section>

        <section className="space-y-4 border-t border-[var(--app-border)] pt-5">
          <div>
            <h2 className="text-base font-semibold">Pricing</h2>
            <p className="app-muted text-sm">
              Choose the source used when current pricing is available for a
              card. Scryfall remains the fallback when a provider has no current
              price.
            </p>
          </div>
          <label className="text-sm">
            Preferred pricing source
            <select
              name="preferredPriceProvider"
              defaultValue={user.preferredPriceProvider || "scryfall"}
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {PRICE_PROVIDERS.map((provider) => (
                <option
                  key={provider.value}
                  className={filterOptionClass}
                  value={provider.value}
                >
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="space-y-4 border-t border-[var(--app-border)] pt-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Notifications</h2>
              <a href="/settings/webhooks" className={filterButtonClass}>
                Manage webhooks
              </a>
            </div>
            <p className="app-muted text-sm">
              Choose which quiet in-app updates appear in the header and
              notification history.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="tradeNotifications"
              defaultChecked={notificationPreferences.trades}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">Trade activity</span>
              <span className="app-muted block text-xs">
                Proposals, counters, status changes, and physical exchange
                confirmations.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="wishlistDigestNotifications"
              defaultChecked={notificationPreferences.wishlistDigest}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">
                Hourly trade-wishlist digest
              </span>
              <span className="app-muted block text-xs">
                Bundle new interest in your public cards into one quiet update
                per hourly window.
              </span>
            </span>
          </label>
        </section>

        <section className="space-y-4 border-t border-[var(--app-border)] pt-5">
          <div>
            <h2 className="text-base font-semibold">Collection visibility</h2>
            <p className="app-muted text-sm">
              New accounts stay private until you opt in.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="publicProfileEnabled"
              defaultChecked={user.publicProfileEnabled}
            />
            Enable public collection page
          </label>
          <p className="app-muted text-xs">
            When disabled, public pages hide all inventory even if a location is
            marked Public.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Public display name
              <input
                name="publicDisplayName"
                defaultValue={user.publicDisplayName ?? user.displayName}
                className={cn(filterInputClass, "mt-1 w-full")}
              />
            </label>
            <label className="text-sm">
              Public slug
              <input
                name="publicSlug"
                defaultValue={user.publicSlug ?? suggestedSlug}
                className={cn(filterInputClass, "mt-1 w-full")}
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Inventory default visibility
              <select
                name="inventoryDefaultVisibility"
                defaultValue={user.inventoryDefaultVisibility}
                className={cn(filterSelectClass, "mt-1 w-full")}
              >
                <option
                  className={filterOptionClass}
                  value={DefaultCollectionVisibility.PRIVATE}
                >
                  Private by default
                </option>
                <option
                  className={filterOptionClass}
                  value={DefaultCollectionVisibility.PUBLIC}
                >
                  Public by default
                </option>
              </select>
              <span className="app-muted mt-1 block text-xs">
                {defaultVisibilityLabel(user.inventoryDefaultVisibility)}:
                locations that use the account default resolve to this setting.
              </span>
            </label>
            <label className="text-sm">
              Deck default visibility
              <select
                name="deckDefaultVisibility"
                defaultValue={user.deckDefaultVisibility}
                className={cn(filterSelectClass, "mt-1 w-full")}
              >
                <option
                  className={filterOptionClass}
                  value={DefaultCollectionVisibility.PRIVATE}
                >
                  Private by default
                </option>
                <option
                  className={filterOptionClass}
                  value={DefaultCollectionVisibility.PUBLIC}
                >
                  Public by default
                </option>
              </select>
              <span className="app-muted mt-1 block text-xs">
                Decks that use the account default resolve to this setting.
              </span>
            </label>
          </div>
        </section>

        {user.publicSlug ? (
          <p className="text-sm text-sky-200">
            Public inventory link:{" "}
            <a className="underline" href={`/u/${user.publicSlug}/inventory`}>
              /u/{user.publicSlug}/inventory
            </a>
          </p>
        ) : null}
        <SubmitButton
          pendingLabel="Saving settings…"
          className={filterButtonClass}
        >
          Save settings
        </SubmitButton>
      </form>
    </main>
  );
}
