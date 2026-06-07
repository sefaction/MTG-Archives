export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { getAccessScope, getCurrentUser, requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
        },
        afterJson: {
          inventoryDefaultVisibility: updated.inventoryDefaultVisibility,
          deckDefaultVisibility: updated.deckDefaultVisibility,
          publicProfileEnabled: updated.publicProfileEnabled,
          publicDisplayName: updated.publicDisplayName,
          publicSlug: updated.publicSlug,
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
          Collection visibility settings saved.
        </p>
      ) : null}
      <section className="space-y-2">
        <h1 className="text-2xl font-bold">Collection visibility settings</h1>
        <p className="text-zinc-400">
          Control whether your inventory and future deck pages are private or
          public. New accounts stay private until you opt in.
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
        className="space-y-5 rounded border border-zinc-800 p-4"
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="publicProfileEnabled"
            defaultChecked={user.publicProfileEnabled}
          />
          Enable public collection page
        </label>
        <p className="text-xs text-zinc-400">
          When disabled, public pages hide all inventory even if a location is
          marked Public.
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Public display name
            <input
              name="publicDisplayName"
              defaultValue={user.publicDisplayName ?? user.displayName}
              className="mt-1 w-full border bg-zinc-900 p-2"
            />
          </label>
          <label className="text-sm">
            Public slug
            <input
              name="publicSlug"
              defaultValue={user.publicSlug ?? suggestedSlug}
              className="mt-1 w-full border bg-zinc-900 p-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Inventory default visibility
            <select
              name="inventoryDefaultVisibility"
              defaultValue={user.inventoryDefaultVisibility}
              className="mt-1 w-full border bg-zinc-900 p-2"
            >
              <option value={DefaultCollectionVisibility.PRIVATE}>
                Private by default
              </option>
              <option value={DefaultCollectionVisibility.PUBLIC}>
                Public by default
              </option>
            </select>
            <span className="mt-1 block text-xs text-zinc-400">
              {defaultVisibilityLabel(user.inventoryDefaultVisibility)}:
              locations that use the account default resolve to this setting.
            </span>
          </label>
          <label className="text-sm">
            Deck default visibility
            <select
              name="deckDefaultVisibility"
              defaultValue={user.deckDefaultVisibility}
              className="mt-1 w-full border bg-zinc-900 p-2"
            >
              <option value={DefaultCollectionVisibility.PRIVATE}>
                Private by default
              </option>
              <option value={DefaultCollectionVisibility.PUBLIC}>
                Public by default
              </option>
            </select>
            <span className="mt-1 block text-xs text-zinc-400">
              Deck pages are planned; this setting is stored now for future deck
              visibility controls.
            </span>
          </label>
        </div>

        {user.publicSlug ? (
          <p className="text-sm text-sky-200">
            Public inventory link:{" "}
            <a className="underline" href={`/u/${user.publicSlug}/inventory`}>
              /u/{user.publicSlug}/inventory
            </a>
          </p>
        ) : null}
        <SubmitButton
          pendingLabel="Saving visibility…"
          className="border px-3 py-2"
        >
          Save visibility settings
        </SubmitButton>
      </form>
    </main>
  );
}
