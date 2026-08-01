export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  cn,
  filterButtonClass,
  filterInputClass,
  filterOptionClass,
  filterPanelClass,
  filterPrimaryButtonClass,
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
import { defaultVisibilityLabel } from "@/lib/visibility";
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
          publicDisplayName,
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
          publicDisplayName: before.publicDisplayName,
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
          publicDisplayName: updated.publicDisplayName,
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
    revalidatePath("/public/decks");
  }

  return (
    <main className="p-8 space-y-6">
      <Nav />
      {params.saved ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          Settings saved.
        </p>
      ) : null}
      <section className="app-panel flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="space-y-1">
          <p className="app-muted text-xs font-medium uppercase tracking-wider">
            Account
          </p>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="app-muted text-sm">
            Personalize the workspace, notifications, and public collection.
          </p>
        </div>
        <nav
          aria-label="Settings sections"
          className="flex flex-wrap gap-2 text-sm"
        >
          {[
            ["appearance", "Appearance"],
            ["identity", "Identity"],
            ["pricing", "Pricing"],
            ["notifications", "Notifications"],
            ["collection", "Collection"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className={filterButtonClass}>
              {label}
            </a>
          ))}
        </nav>
        {adminModeActive ? (
          <p className="w-full rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
            Admin mode is active, but these settings update only your own
            account preferences.
          </p>
        ) : null}
      </section>

      <form action={updateVisibilitySettings} className="space-y-4">
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section
            id="appearance"
            className={cn(filterPanelClass, "space-y-3 xl:col-span-2")}
          >
            <div>
              <p className="app-muted text-xs font-medium uppercase tracking-wider">
                Workspace
              </p>
              <h2 className="text-lg font-semibold">Appearance</h2>
              <p className="app-muted text-sm">
                Themes are saved per user and apply across the full app shell.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {APP_THEMES.map((theme) => (
                <label
                  key={theme.id}
                  className="app-card flex cursor-pointer gap-2 p-2.5 transition-colors has-[:checked]:border-[var(--app-accent)] has-[:checked]:bg-[var(--app-accent-soft)]"
                >
                  <input
                    type="radio"
                    name="theme"
                    value={theme.id}
                    defaultChecked={normalizeAppTheme(user.theme) === theme.id}
                    className="mt-0.5"
                  />
                  <span className="space-y-1">
                    <span className="flex items-center gap-2 font-medium">
                      {theme.label}
                      <span className="app-muted rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide">
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

          <section id="identity" className={cn(filterPanelClass, "space-y-4")}>
            <div>
              <p className="app-muted text-xs font-medium uppercase tracking-wider">
                Shared views
              </p>
              <h2 className="text-lg font-semibold">User identity</h2>
              <p className="app-muted text-sm">
                Your player color marks your cards in public inventory and
                multi-user views.
              </p>
            </div>
            <label className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>
                <span className="block font-medium">Player color</span>
                <span className="app-muted block text-xs">
                  Used as your visual marker across shared screens.
                </span>
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  name="playerColor"
                  defaultValue={normalizePlayerColor(user.player?.color)}
                  className="h-9 w-12 cursor-pointer rounded border border-[var(--app-border)] bg-transparent p-1"
                />
                <span
                  className="inline-flex items-center gap-2 rounded border border-[var(--app-border)] px-2.5 py-1.5 text-sm"
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

          <section id="pricing" className={cn(filterPanelClass, "space-y-4")}>
            <div>
              <p className="app-muted text-xs font-medium uppercase tracking-wider">
                Valuation
              </p>
              <h2 className="text-lg font-semibold">Pricing</h2>
              <p className="app-muted text-sm">
                Choose the source used when current pricing is available.
              </p>
            </div>
            <label className="block text-sm">
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
              <span className="app-muted mt-1 block text-xs">
                Scryfall remains the fallback when the selected provider has no
                current price.
              </span>
            </label>
          </section>

          <section
            id="notifications"
            className={cn(filterPanelClass, "space-y-4")}
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="app-muted text-xs font-medium uppercase tracking-wider">
                    Updates
                  </p>
                  <h2 className="text-lg font-semibold">Notifications</h2>
                </div>
                <a href="/settings/webhooks" className={filterButtonClass}>
                  Manage webhooks
                </a>
              </div>
              <p className="app-muted text-sm">
                Choose which quiet in-app updates appear in the header and
                notification history.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <label className="app-card flex cursor-pointer items-start gap-2 p-3 text-sm">
                <input
                  type="checkbox"
                  name="tradeNotifications"
                  defaultChecked={notificationPreferences.trades}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">Trade activity</span>
                  <span className="app-muted block text-xs">
                    Proposals, counters, status changes, and exchanges.
                  </span>
                </span>
              </label>
              <label className="app-card flex cursor-pointer items-start gap-2 p-3 text-sm">
                <input
                  type="checkbox"
                  name="wishlistDigestNotifications"
                  defaultChecked={notificationPreferences.wishlistDigest}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">Wishlist digest</span>
                  <span className="app-muted block text-xs">
                    Bundle new interest in your public cards into one quiet
                    update per hourly window.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section
            id="collection"
            className={cn(filterPanelClass, "space-y-4")}
          >
            <div>
              <p className="app-muted text-xs font-medium uppercase tracking-wider">
                Sharing
              </p>
              <h2 className="text-lg font-semibold">Collection visibility</h2>
              <p className="app-muted text-sm">
                Public decks appear in the public deck list. Inventory in public
                locations appears in the public inventory browser.
              </p>
            </div>

            <label className="block text-sm">
              Public display name
              <input
                name="publicDisplayName"
                defaultValue={user.publicDisplayName ?? user.displayName}
                className={cn(filterInputClass, "mt-1 w-full")}
              />
              <span className="app-muted mt-1 block text-xs">
                Shown beside your cards and decks in public browsing.
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
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
                  locations that use the account default resolve to this
                  setting.
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
        </div>

        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--app-border-strong)] bg-[color-mix(in_srgb,var(--app-surface)_94%,transparent)] px-4 py-3 shadow-xl shadow-[var(--app-shadow)] backdrop-blur">
          <p className="app-muted text-sm">
            Changes apply only after you save.
          </p>
          <SubmitButton
            pendingLabel="Saving settings..."
            className={filterPrimaryButtonClass}
          >
            Save settings
          </SubmitButton>
        </div>
      </form>
    </main>
  );
}
