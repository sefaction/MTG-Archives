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
import { APP_THEMES, normalizeAppTheme } from "@/lib/themes";
import {
  assertPublicSlug,
  defaultVisibilityLabel,
  normalizePublicSlug,
} from "@/lib/visibility";
import { DefaultCollectionVisibility } from "@prisma/client";

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

  async function updateVisibilitySettings(fd: FormData) {
    "use server";
    const actor = await requireLogin();
    const before = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!before) throw new Error("User not found.");

    const publicProfileEnabled = fd.get("publicProfileEnabled") === "on";
    const theme = normalizeAppTheme(fd.get("theme"));
    const publicDisplayName =
      String(fd.get("publicDisplayName") || "").trim() || null;
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

    const updated = await prisma.user.update({
      where: { id: actor.id },
      data: {
        inventoryDefaultVisibility: parseDefaultVisibility(
          fd.get("inventoryDefaultVisibility"),
        ),
        deckDefaultVisibility: parseDefaultVisibility(
          fd.get("deckDefaultVisibility"),
        ),
        theme,
        publicProfileEnabled,
        publicDisplayName,
        publicSlug,
      },
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
        },
        afterJson: {
          inventoryDefaultVisibility: updated.inventoryDefaultVisibility,
          deckDefaultVisibility: updated.deckDefaultVisibility,
          publicProfileEnabled: updated.publicProfileEnabled,
          publicDisplayName: updated.publicDisplayName,
          publicSlug: updated.publicSlug,
          theme: updated.theme,
        },
        reason: "Collection visibility settings updated.",
      },
    });

    revalidatePath("/settings");
    revalidatePath("/locations");
    revalidatePath("/inventory");
    if (updated.publicSlug) revalidatePath(`/u/${updated.publicSlug}`);
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
